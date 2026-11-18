"""Assigned translation-review drafts and atomic immutable review records."""

from collections.abc import Callable
from dataclasses import asdict, dataclass, field, replace
from datetime import UTC, date, datetime
from typing import Any, Literal

from ontospan import TranslationCheck, canonical_text
from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError
from sqlalchemy import Connection, RowMapping, func, insert, select, update

from ontotator.assignments.service import (
    Assignment,
    AssignmentService,
    latest_reopen,
    move_waiting_tasks,
    second_review_requests,
)
from ontotator.auth.audit import Actor, record_audit
from ontotator.auth.authority import lock_user_authority
from ontotator.authz.policy import Access, Action, can
from ontotator.authz.project_authority import hidden_from_token
from ontotator.authz.visibility import (
    current_access,
    qualifying_assignment,
    require_document,
    visible_documents,
)
from ontotator.domain.bracketed_passages import BracketCheck, check_added_brackets
from ontotator.domain.errors import DomainError, RevisionConflict, project_not_found
from ontotator.domain.translation_review import (
    LEAD_CORRECTION_DECISION,
    REVIEW_POLICY,
    ClinicalCategory,
    ReviewDecisionCode,
    ReviewForm,
    check_review,
    next_status,
)
from ontotator.domain.typography import (
    TypographyHint,
    count_by_rule,
    typography_hints,
)
from ontotator.domain.variants import (
    TranslationStatus,
    VariantInfo,
    descends_from_accepted,
    resolve_translation_lineage,
    translation_review_comparisons,
    variant_document_id,
)
from ontotator.jobs.queue import JobQueue
from ontotator.storage.database import Database
from ontotator.storage.guidelines import current_guideline_version, guideline_facts
from ontotator.storage.plan_tables import (
    EditorialCorrectionRow,
    TranslationVersionUploadRow,
)
from ontotator.storage.repository import Repository, _lock_id
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    TranslationReviewDraftRow,
    TranslationReviewRow,
    UserLanguageRow,
)

# The reviewer's checked-sentence marks (issue 256) live in the draft's form JSON under
# this key. They are a working aid only: never part of the review form, the submitted
# record, exports or audit details, and saving them changes neither the draft revision
# nor the assignment status.
CHECKED_SENTENCES_KEY = "checked_sentences"
MAX_CHECKED_SENTENCES = 5000


class CheckedSentence(BaseModel):
    """One checked sentence: its position and a short hash of its text."""

    model_config = ConfigDict(extra="forbid")
    index: StrictInt = Field(ge=0, le=1_000_000)
    hash: str = Field(pattern=r"^[0-9a-f]{8}$")


class CheckedSentences(BaseModel):
    """Checked sentences per side; each side is marked on its own."""

    model_config = ConfigDict(extra="forbid")
    source: list[CheckedSentence] = Field(
        default_factory=list, max_length=MAX_CHECKED_SENTENCES
    )
    translation: list[CheckedSentence] = Field(
        default_factory=list, max_length=MAX_CHECKED_SENTENCES
    )


class CheckedSentencesSave(CheckedSentences):
    """New marks, optionally with the marks they were made from (issue 284).

    With ``base``, the server applies only what changed from ``base`` to the new
    marks to the stored marks, so marks set meanwhile in another tab stay. Without
    ``base``, the new marks replace the stored ones.
    """

    base: CheckedSentences | None = None


def merged_checked_sentences(
    stored: CheckedSentences, base: CheckedSentences, marks: CheckedSentences
) -> CheckedSentences:
    """Stored marks with the change from ``base`` to ``marks`` applied, per side."""

    def keys(value: CheckedSentences, side: str) -> set[tuple[int, str]]:
        return {(mark.index, mark.hash) for mark in getattr(value, side)}

    sides: dict[str, list[CheckedSentence]] = {}
    for side in ("source", "translation"):
        before, after = keys(base, side), keys(marks, side)
        result = (keys(stored, side) - (before - after)) | (after - before)
        sides[side] = [
            CheckedSentence(index=index, hash=hash_)
            for index, hash_ in sorted(result)[:MAX_CHECKED_SENTENCES]
        ]
    return CheckedSentences(**sides)


def review_form(form: dict[str, Any]) -> dict[str, Any]:
    """The draft form without the checked-sentence marks."""
    return {k: v for k, v in form.items() if k != CHECKED_SENTENCES_KEY}


def stored_checked_sentences(form: dict[str, Any] | None) -> CheckedSentences:
    """The stored marks; marks that do not fit today's rules read as none."""
    raw = (form or {}).get(CHECKED_SENTENCES_KEY)
    if raw is None:
        return CheckedSentences()
    try:
        return CheckedSentences.model_validate(raw)
    except ValidationError:
        return CheckedSentences()


class TranslationReviewRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    document_id: str
    assignment_id: int
    reviewer_user_id: int
    reviewer_pseudonym: str
    reviewer_qualification: str
    reviewer_languages: list[str]
    decision: ReviewDecisionCode
    clinical_change: bool
    categories: list[ClinicalCategory]
    rationale: str | None
    machine_text_sha256: str
    proposed_text: str
    proposed_text_sha256: str
    status_before: str
    status_after: str
    created_variant_id: str | None
    review_policy: str
    created_at: datetime
    # The guideline version in force at submit (G15); NULL when none was.
    guideline_version: int | None = None
    guideline_withdrawn: bool = False


def with_guideline_withdrawn(
    conn: Connection, project_id: int, records: list[TranslationReviewRecord]
) -> list[TranslationReviewRecord]:
    """``records`` with ``guideline_withdrawn`` set from the stamped versions."""
    if not any(r.guideline_version is not None for r in records):
        return records
    facts = guideline_facts(conn, project_id)
    # The stamp has a foreign key to its version, so every stamp has a fact.
    return [
        r
        if r.guideline_version is None
        else r.model_copy(
            update={"guideline_withdrawn": facts[r.guideline_version].withdrawn}
        )
        for r in records
    ]


def failed_translation_checks(
    translation: dict[str, Any] | None,
) -> list[TranslationCheck]:
    """Failed automatic checks of a translation run (spec A.7).

    The review workspace lists them; My tasks shows their count.
    """
    checks = (translation or {}).get("checks", [])
    return [
        check
        for check in (TranslationCheck.model_validate(c) for c in checks)
        if not check.passed
    ]


def version_failed_checks(
    variant: VariantInfo, ancestor: VariantInfo
) -> list[TranslationCheck]:
    """Failed automatic checks of the reviewed version itself.

    The checks ran on the text of the translation run (the first version). A
    later version is another text that was never checked, so it carries no
    failed check: none is counted in My tasks and "Accepted unchanged" needs
    no rationale for one. The run's checks stay readable on the ancestor.
    """
    if variant.document_id != ancestor.document_id:
        return []
    return failed_translation_checks(ancestor.translation)


@dataclass(frozen=True)
class ReviewText:
    variant: VariantInfo
    text: str


@dataclass(frozen=True)
class VersionOrigin:
    """How a version after the first was made, for its reviewer.

    ``upload``: a lead uploaded the text ("Upload new version…", with the
    upload record's fields); ``review_correction``: a translation reviewer
    corrected the previous version; ``lead_correction``: a lead did
    ("Correct the translation…"); ``editorial_correction``: a lead fixed
    spacing, typos or grammar without a review ("Fix typos…", ``note`` is
    the recorded reason); ``correction``: no record (an import).
    """

    kind: Literal[
        "upload",
        "review_correction",
        "lead_correction",
        "editorial_correction",
        "correction",
    ]
    previous_version: int
    at: datetime | None = None
    method: str | None = None
    provider: str | None = None
    model: str | None = None
    made_on: date | None = None
    made_by: str | None = None
    note: str | None = None


@dataclass(frozen=True)
class ReviewDraft:
    text: str
    form: dict[str, Any]
    revision: int


@dataclass(frozen=True)
class ReviewWorkspace:
    assignment: Assignment
    variant: VariantInfo
    translation_ancestor: VariantInfo
    text: str
    source: ReviewText
    comparisons: list[ReviewText]
    failed_checks: list[TranslationCheck]
    draft: ReviewDraft
    qualification: str | None
    previous_reviews: list[TranslationReviewRecord]
    read_only: bool
    submitted_record: TranslationReviewRecord | None
    # FD1: the lead reviews this version themselves (accepted_corrected only).
    lead_correction: bool = False
    # Issue 341 b: the lead correction's new version is reviewed again (this
    # version or one it was corrected from is accepted).
    reviewed_again: bool = False
    # The reviewer's own checked-sentence marks (issue 256); empty once submitted.
    checked_sentences: CheckedSentences = field(default_factory=CheckedSentences)
    # A version after the first: how it was made and the version before it,
    # so the reviewer sees what changed. None for the first version.
    version_origin: VersionOrigin | None = None
    previous_version: ReviewText | None = None
    # What the lead said when asking for this review (as in My tasks): the
    # reason of "Request correction…" for the task's current round, and of the
    # latest "Reopen…" while the task is reopened.
    second_review_at: datetime | None = None
    second_review_reason: str | None = None
    reopened_at: datetime | None = None
    reopen_reason: str | None = None
    # Issue 484: bracketed passages of the reviewed version against those of
    # its source, computed when the review is opened. More in the translation
    # is shown in the checks band; it asks for nothing and is not counted in
    # ``failed_checks``.
    added_brackets: BracketCheck | None = None


# Hints listed for a draft; the counts stay exact.
DRAFT_HINTS_MAX = 200


@dataclass(frozen=True)
class DraftTypographyHints:
    """Typography hints of the stored draft text (issue 484), never stored.

    ``revision`` is the draft revision the hints were computed for. Positions
    count Unicode code points, as everywhere.
    """

    revision: int
    total: int
    counts: dict[str, int]
    hints: list[TypographyHint]
    truncated: bool


class TranslationReviewService:
    def __init__(
        self,
        db: Database,
        jobs: JobQueue,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.db, self.jobs, self._now = db, jobs, now

    def _authority(
        self,
        conn: Connection,
        access: Access,
        assignment_id: int,
        *,
        structural: bool = False,
    ) -> tuple[Assignment, int, RowMapping]:
        located = conn.execute(
            select(ProjectRow.project_key)
            .join(AssignmentRow, AssignmentRow.project_id == ProjectRow.id)
            .where(
                AssignmentRow.id == assignment_id,
                AssignmentRow.user_id == access.user_id,
                AssignmentRow.task == "translation_review",
                AssignmentRow.revoked_at.is_(None),
            )
        ).scalar_one_or_none()
        # A project token sees no review of another project (issue 351).
        if located is None or hidden_from_token(located):
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        if structural:
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("import"))))
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", located)))
        )
        lock = (
            func.pg_advisory_xact_lock
            if structural
            else func.pg_advisory_xact_lock_shared
        )
        conn.execute(select(lock(_lock_id("project", located))))
        user = lock_user_authority(conn, access.user_id)
        # Shared central SQL policy rechecks account/current role after all waits.
        valid = conn.execute(
            select(AssignmentRow.project_id)
            .where(
                AssignmentRow.id == assignment_id,
                AssignmentRow.task == "translation_review",
                qualifying_assignment(access.user_id),
            )
            .with_for_update(key_share=True)
        ).scalar_one_or_none()
        if valid is None:
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        assignment = AssignmentService._get(conn, assignment_id)
        return assignment, valid, user

    def _context(
        self, assignment: Assignment
    ) -> tuple[VariantInfo, VariantInfo, VariantInfo, dict[str, VariantInfo]]:
        variants = {
            v.document_id: v
            for v in Repository(self.db)._variants(assignment.project_key)
        }
        variant = variants.get(assignment.document_id)
        if variant is None:
            raise DomainError("DOCUMENT_NOT_FOUND")
        ancestor, source = resolve_translation_lineage(variant, variants.get)
        return variant, ancestor, source, variants

    @staticmethod
    def _text(conn: Connection, project_id: int, variant: VariantInfo) -> str:
        import hashlib

        text = conn.execute(
            select(DocumentRow.text).where(
                DocumentRow.project_id == project_id,
                DocumentRow.document_id == variant.document_id,
            )
        ).scalar_one()
        if hashlib.sha256(text.encode("utf-8")).hexdigest() != variant.text_sha256:
            raise DomainError(
                "VARIANT_SOURCE_UNKNOWN", "Immutable variant hash mismatch"
            )
        return text

    @staticmethod
    def _editable(assignment: Assignment) -> None:
        if assignment.held:
            raise DomainError(
                "TASK_HELD",
                {
                    "reason": assignment.hold_reason,
                    "causes": list(assignment.pause_causes),
                    "lead_reason": assignment.lead_pause_reason,
                    "assignment_id": assignment.id,
                },
            )
        if assignment.status == "submitted":
            raise DomainError("ASSIGNMENT_SUBMITTED")

    def _draft(
        self,
        conn: Connection,
        assignment: Assignment,
        project_id: int,
        variant: VariantInfo,
    ) -> ReviewDraft:
        row = (
            conn.execute(
                select(TranslationReviewDraftRow)
                .where(TranslationReviewDraftRow.assignment_id == assignment.id)
                .with_for_update()
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            text = self._text(conn, project_id, variant)
            conn.execute(
                insert(TranslationReviewDraftRow).values(
                    assignment_id=assignment.id,
                    text=text,
                    form={},
                    revision=0,
                    updated_at=self._now(),
                    updated_by=assignment.user_id,
                )
            )
            return ReviewDraft(text, {}, 0)
        return ReviewDraft(row["text"], row["form"], row["revision"])

    def _records(
        self,
        conn: Connection,
        access: Access,
        key: str,
        project_id: int,
        document_id: str,
    ) -> list[TranslationReviewRecord]:
        fresh = current_access(conn, access, project_id, key)
        if not can(fresh, Action.VIEW_PROJECT, key):
            # A foreign project looks like a missing one (E3, issue 398).
            raise project_not_found(key)
        require_document(conn, fresh, project_id, key, document_id)
        baseline_hash = conn.execute(
            select(DocumentRow.text_sha256).where(
                DocumentRow.project_id == project_id,
                DocumentRow.document_id == document_id,
            )
        ).scalar_one_or_none()
        if baseline_hash is None:
            raise DomainError("DOCUMENT_NOT_FOUND")
        query = select(TranslationReviewRow).where(
            TranslationReviewRow.project_id == project_id,
            TranslationReviewRow.document_id == document_id,
        )
        if not can(fresh, Action.VIEW_ALL_DOCUMENTS, key):
            query = query.where(TranslationReviewRow.reviewer_user_id == fresh.user_id)
        records = with_guideline_withdrawn(
            conn,
            project_id,
            [
                TranslationReviewRecord.model_validate(r)
                for r in conn.execute(
                    query.order_by(TranslationReviewRow.id)
                ).mappings()
            ],
        )
        if any(r.machine_text_sha256 != baseline_hash for r in records):
            raise DomainError("VARIANT_SOURCE_UNKNOWN", "Review baseline hash mismatch")
        return records

    def project_records(
        self, access: Access, project: str
    ) -> list[TranslationReviewRecord]:
        """Every submitted translation review of the project (#352), as
        ``records`` gives them per text: a reviewer without the right to see
        every text gets their own reviews of the texts they may see."""
        with self.db.transaction() as conn:
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(_lock_id("members", project)))
            )
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(_lock_id("project", project)))
            )
            lock_user_authority(conn, access.user_id)
            pid = Repository._project_id(conn, project)
            fresh = None if pid is None else current_access(conn, access, pid, project)
            if (
                pid is None
                or fresh is None
                or not can(fresh, Action.VIEW_PROJECT, project)
            ):
                raise DomainError("PROJECT_NOT_FOUND")
            query = select(TranslationReviewRow).where(
                TranslationReviewRow.project_id == pid
            )
            if not can(fresh, Action.VIEW_ALL_DOCUMENTS, project):
                visible = visible_documents(conn, fresh, pid, project)
                query = query.where(
                    TranslationReviewRow.reviewer_user_id == fresh.user_id,
                    TranslationReviewRow.document_id.in_(sorted(visible.document_ids)),
                )
            records = with_guideline_withdrawn(
                conn,
                pid,
                [
                    TranslationReviewRecord.model_validate(r)
                    for r in conn.execute(
                        query.order_by(TranslationReviewRow.id)
                    ).mappings()
                ],
            )
            baselines = dict(
                conn.execute(
                    select(DocumentRow.document_id, DocumentRow.text_sha256).where(
                        DocumentRow.project_id == pid,
                        DocumentRow.document_id.in_(
                            sorted({r.document_id for r in records})
                        ),
                    )
                )
                .tuples()
                .all()
            )
            if any(
                r.machine_text_sha256 != baselines.get(r.document_id) for r in records
            ):
                raise DomainError(
                    "VARIANT_SOURCE_UNKNOWN", "Review baseline hash mismatch"
                )
            return records

    def open(self, access: Access, assignment_id: int) -> ReviewWorkspace:
        with self.db.transaction() as conn:
            assignment, pid, user = self._authority(conn, access, assignment_id)
            variant, ancestor, source, variants = self._context(assignment)
            submitted = None
            if assignment.status == "submitted":
                records = (
                    conn.execute(
                        select(TranslationReviewRow).where(
                            TranslationReviewRow.assignment_id == assignment.id,
                            TranslationReviewRow.project_id == pid,
                            TranslationReviewRow.document_id == variant.document_id,
                        )
                    )
                    .mappings()
                    .all()
                )
                submitted = next(
                    (
                        TranslationReviewRecord.model_validate(r)
                        for r in records
                        if f"tr-{r['id']}" == assignment.last_submission_id
                    ),
                    None,
                )
                if (
                    submitted is None
                    or submitted.machine_text_sha256 != variant.text_sha256
                ):
                    raise DomainError("ASSIGNMENT_NOT_FOUND")
                (submitted,) = with_guideline_withdrawn(conn, pid, [submitted])
                row = conn.execute(
                    select(TranslationReviewDraftRow.revision).where(
                        TranslationReviewDraftRow.assignment_id == assignment.id
                    )
                ).scalar_one_or_none()
                draft = ReviewDraft(
                    submitted.proposed_text,
                    {
                        "decision": submitted.decision,
                        "clinical_change": submitted.clinical_change,
                        "categories": submitted.categories,
                        "rationale": submitted.rationale,
                    },
                    row or 0,
                )
                marks = CheckedSentences()
            else:
                draft = self._draft(conn, assignment, pid, variant)
                marks = stored_checked_sentences(draft.form)
                draft = replace(draft, form=review_form(draft.form))
            comparisons = translation_review_comparisons(
                variant, ancestor, variants.values()
            )
            second = second_review_requests(
                conn, {assignment.id: assignment.active_round_id}
            ).get(assignment.id)
            reopen = (
                latest_reopen(conn, assignment.id)
                if assignment.status == "reopened"
                else None
            )
            # A later version: the version it was corrected from.
            previous = (
                variants.get(variant.derived_from)
                if variant.origin == "correction" and variant.derived_from
                else None
            )
            texts = conn.execute(
                select(DocumentRow.document_id, DocumentRow.text).where(
                    DocumentRow.project_id == pid,
                    DocumentRow.document_id.in_([v.document_id for v in comparisons]),
                )
            ).all()
            by_id = {document_id: text for document_id, text in texts}
            version_text = self._text(conn, pid, variant)
            source_text = self._text(conn, pid, source)
            return ReviewWorkspace(
                assignment,
                variant,
                ancestor,
                version_text,
                ReviewText(source, source_text),
                [ReviewText(v, by_id[v.document_id]) for v in comparisons],
                version_failed_checks(variant, ancestor),
                draft,
                user["qualification"],
                self._records(
                    conn, access, assignment.project_key, pid, variant.document_id
                ),
                assignment.status == "submitted" or assignment.held,
                submitted,
                assignment.lead_correction,
                assignment.lead_correction
                and descends_from_accepted(variant, variants.get),
                marks,
                version_origin=self._version_origin(conn, pid, variant, previous),
                previous_version=None
                if previous is None
                else ReviewText(previous, self._text(conn, pid, previous)),
                second_review_at=second[0] if second else None,
                second_review_reason=second[1] if second else None,
                reopened_at=reopen[0] if reopen else None,
                reopen_reason=reopen[1] if reopen else None,
                added_brackets=check_added_brackets(source_text, version_text),
            )

    def draft_typography_hints(
        self, access: Access, assignment_id: int
    ) -> DraftTypographyHints:
        """Hints of the text the review would save: the stored draft, or the
        reviewed version while nothing was saved. Whoever may open the review
        may read them; nothing is written."""
        with self.db.transaction() as conn:
            assignment, pid, _ = self._authority(conn, access, assignment_id)
            variant, _, _, _ = self._context(assignment)
            row = conn.execute(
                select(
                    TranslationReviewDraftRow.text, TranslationReviewDraftRow.revision
                ).where(TranslationReviewDraftRow.assignment_id == assignment.id)
            ).one_or_none()
            if row is None:
                text, revision = self._text(conn, pid, variant), 0
            else:
                text, revision = row.text, row.revision
        hints = typography_hints(text)
        return DraftTypographyHints(
            revision,
            len(hints),
            count_by_rule(hints),
            hints[:DRAFT_HINTS_MAX],
            len(hints) > DRAFT_HINTS_MAX,
        )

    @staticmethod
    def _version_origin(
        conn: Connection,
        project_id: int,
        variant: VariantInfo,
        previous: VariantInfo | None,
    ) -> VersionOrigin | None:
        if previous is None:
            return None
        upload = (
            conn.execute(
                select(TranslationVersionUploadRow).where(
                    TranslationVersionUploadRow.project_id == project_id,
                    TranslationVersionUploadRow.document_id == variant.document_id,
                )
            )
            .mappings()
            .first()
        )
        if upload is not None:
            return VersionOrigin(
                "upload",
                previous.version,
                upload["uploaded_at"],
                upload["method"],
                upload["provider"],
                upload["model"],
                upload["made_on"],
                upload["made_by"],
                upload["note"],
            )
        editorial = (
            conn.execute(
                select(EditorialCorrectionRow).where(
                    EditorialCorrectionRow.project_id == project_id,
                    EditorialCorrectionRow.document_id == variant.document_id,
                )
            )
            .mappings()
            .first()
        )
        if editorial is not None:
            return VersionOrigin(
                "editorial_correction",
                previous.version,
                editorial["corrected_at"],
                note=editorial["reason"],
            )
        review = conn.execute(
            select(TranslationReviewRow.created_at, AssignmentRow.lead_correction)
            .join(AssignmentRow, AssignmentRow.id == TranslationReviewRow.assignment_id)
            .where(
                TranslationReviewRow.project_id == project_id,
                TranslationReviewRow.created_variant_id == variant.document_id,
            )
            .order_by(TranslationReviewRow.id)
            .limit(1)
        ).first()
        if review is None:
            return VersionOrigin("correction", previous.version)
        return VersionOrigin(
            "lead_correction" if review.lead_correction else "review_correction",
            previous.version,
            review.created_at,
        )

    def save_draft(
        self,
        access: Access,
        assignment_id: int,
        *,
        expected_revision: int,
        text: str,
        form: dict[str, Any],
    ) -> int:
        with self.db.transaction() as conn:
            assignment, pid, _ = self._authority(conn, access, assignment_id)
            self._editable(assignment)
            variant, _, _, _ = self._context(assignment)
            draft = self._draft(conn, assignment, pid, variant)
            if draft.revision != expected_revision:
                raise RevisionConflict()
            revision = draft.revision + 1
            now = self._now()
            # The marks are saved on their own; a draft save keeps the stored ones.
            stored = draft.form.get(CHECKED_SENTENCES_KEY)
            form = review_form(form)
            if stored is not None:
                form[CHECKED_SENTENCES_KEY] = stored
            conn.execute(
                update(TranslationReviewDraftRow)
                .where(TranslationReviewDraftRow.assignment_id == assignment.id)
                .values(
                    text=text,
                    form=form,
                    revision=revision,
                    updated_at=now,
                    updated_by=access.user_id,
                )
            )
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == assignment.id)
                .values(
                    status="in_progress"
                    if assignment.status == "open"
                    else assignment.status,
                    # Issue 268: the first save since given or reopened.
                    started_at=func.coalesce(AssignmentRow.started_at, now),
                    updated_at=now,
                )
            )
            return revision

    def save_checked_sentences(
        self,
        access: Access,
        assignment_id: int,
        marks: CheckedSentences,
        *,
        base: CheckedSentences | None = None,
    ) -> CheckedSentences:
        """Store the reviewer's checked-sentence marks and return the stored marks.

        With ``base`` (the marks the client changed), only that change is applied
        to the stored marks, so two tabs never remove each other's marks (issue
        284); without it, ``marks`` replace them. A working aid only: the draft
        revision, its time stamp and the assignment status stay as they are, so
        marking alone never starts a task.
        """
        with self.db.transaction() as conn:
            assignment, pid, _ = self._authority(conn, access, assignment_id)
            self._editable(assignment)
            variant, _, _, _ = self._context(assignment)
            # Locks the draft row: concurrent saves apply one after the other.
            draft = self._draft(conn, assignment, pid, variant)
            marks = CheckedSentences(source=marks.source, translation=marks.translation)
            if base is not None:
                marks = merged_checked_sentences(
                    stored_checked_sentences(draft.form), base, marks
                )
            conn.execute(
                update(TranslationReviewDraftRow)
                .where(TranslationReviewDraftRow.assignment_id == assignment.id)
                .values(
                    form={
                        **draft.form,
                        CHECKED_SENTENCES_KEY: marks.model_dump(mode="json"),
                    }
                )
            )
            return marks

    def submit(
        self, access: Access, assignment_id: int, *, expected_revision: int
    ) -> TranslationReviewRecord:
        import hashlib

        with self.db.transaction() as conn:
            assignment, pid, user = self._authority(
                conn, access, assignment_id, structural=True
            )
            self._editable(assignment)
            variant, ancestor, _, variants = self._context(assignment)
            draft = self._draft(conn, assignment, pid, variant)
            if draft.revision != expected_revision:
                raise RevisionConflict()
            if not (user["qualification"] or "").strip():
                raise DomainError("QUALIFICATION_REQUIRED")
            machine = self._text(conn, pid, variant)
            try:
                form = ReviewForm.model_validate(review_form(draft.form))
            except ValidationError as exc:
                raise DomainError(
                    "REVIEW_INVALID",
                    {
                        "issues": ["FORM_INVALID"],
                        "fields": [".".join(map(str, e["loc"])) for e in exc.errors()],
                    },
                ) from None
            if assignment.lead_correction and form.decision != "accepted_corrected":
                raise DomainError(
                    "REVIEW_INVALID", {"issues": [LEAD_CORRECTION_DECISION]}
                )
            issues = check_review(
                form,
                machine_text=machine,
                proposed_text=draft.text,
                failed_checks=bool(version_failed_checks(variant, ancestor)),
            )
            if issues:
                raise DomainError("REVIEW_INVALID", {"issues": issues})
            before = variant.translation_status
            assert before is not None
            after, child_status = next_status(form.decision)
            corrected_status: TranslationStatus | None = child_status
            if assignment.lead_correction and descends_from_accepted(
                variant, variants.get
            ):
                # Issue 341 b: the lead's correction of an accepted version is
                # a new text that is reviewed again; the accepted version and
                # the annotation work on it stay (text-change steps follow).
                # So is a further lead correction after that new text was
                # rejected or queried: it never counts as accepted unreviewed.
                corrected_status = "ready_for_review"
                if before == "accepted":
                    after = "accepted"
            child = None
            if child_status:
                latest = max(
                    v.version
                    for v in variants.values()
                    if (v.external_id, v.language)
                    == (variant.external_id, variant.language)
                )
                if latest != variant.version:
                    raise DomainError("VARIANT_REVIEW_STALE")
                child = replace(
                    variant,
                    document_id=variant_document_id(
                        variant.external_id, variant.language, latest + 1, set(variants)
                    ),
                    version=latest + 1,
                    origin="correction",
                    derived_from=variant.document_id,
                    translation=None,
                    translation_status=corrected_status,
                )
            proposed = canonical_text(draft.text)
            sha = hashlib.sha256(proposed.encode("utf-8")).hexdigest()
            languages = list(
                conn.execute(
                    select(UserLanguageRow.language)
                    .where(UserLanguageRow.user_id == access.user_id)
                    .order_by(UserLanguageRow.language)
                ).scalars()
            )
            now = self._now()
            values = dict(
                project_id=pid,
                document_id=variant.document_id,
                assignment_id=assignment.id,
                reviewer_user_id=access.user_id,
                reviewer_pseudonym=user["pseudonym"],
                reviewer_qualification=user["qualification"],
                reviewer_languages=languages,
                decision=form.decision,
                clinical_change=form.clinical_change,
                categories=sorted(set(form.categories)),
                rationale=form.rationale,
                machine_text_sha256=variant.text_sha256,
                proposed_text=proposed,
                proposed_text_sha256=sha,
                status_before=before,
                status_after=after,
                created_variant_id=child.document_id if child else None,
                review_policy=REVIEW_POLICY,
                created_at=now,
                guideline_version=current_guideline_version(conn, pid),
            )
            record_id = conn.execute(
                insert(TranslationReviewRow)
                .values(**values)
                .returning(TranslationReviewRow.id)
            ).scalar_one()
            if child:
                metadata = asdict(child)
                metadata.update(
                    text_sha256=sha, status_reason=f"translation review {record_id}"
                )
                conn.execute(
                    insert(DocumentRow).values(
                        project_id=pid, text=proposed, **metadata
                    )
                )
            conn.execute(
                update(DocumentRow)
                .where(
                    DocumentRow.project_id == pid,
                    DocumentRow.document_id == variant.document_id,
                )
                .values(translation_status=after)
            )
            if child:
                # After the status write: it decides whether the tasks wait.
                move_waiting_tasks(
                    conn,
                    Actor.user(access.user_id, user["username"]),
                    pid,
                    variant.document_id,
                    child.document_id,
                    now,
                )
            conn.execute(
                update(TranslationReviewDraftRow)
                .where(TranslationReviewDraftRow.assignment_id == assignment.id)
                .values(
                    revision=draft.revision + 1,
                    updated_at=now,
                    updated_by=access.user_id,
                )
            )
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == assignment.id)
                .values(
                    status="submitted",
                    last_submission_id=f"tr-{record_id}",
                    started_at=func.coalesce(AssignmentRow.started_at, now),
                    updated_at=now,
                )
            )
            if assignment.active_round_id is not None:
                from ontotator.storage.workflow_tables import WorkRoundStateRow

                conn.execute(
                    update(WorkRoundStateRow)
                    .where(WorkRoundStateRow.round_id == assignment.active_round_id)
                    .values(
                        state="submitted",
                        latest_submission_id=f"tr-{record_id}",
                        revision=WorkRoundStateRow.revision + 1,
                    )
                )
            record_audit(
                conn,
                Actor.user(access.user_id, user["username"]),
                "translation.review",
                target_type="document",
                target_id=variant.document_id,
                project_id=pid,
                details={
                    "document_id": variant.document_id,
                    "decision": form.decision,
                    "status_before": before,
                    "status_after": after,
                    "created_variant_id": child.document_id if child else None,
                },
                at=now,
            )
            if child:
                from ontotator.exchange.reanchor_job import enqueue_review_pair

                enqueue_review_pair(
                    self.jobs,
                    assignment.project_key,
                    pid,
                    variant.document_id,
                    child.document_id,
                    record_id,
                    Actor.user(access.user_id, user["username"]),
                )
            return TranslationReviewRecord(id=record_id, **values)

    def records(
        self, access: Access, project: str, document_id: str
    ) -> list[TranslationReviewRecord]:
        with self.db.transaction() as conn:
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(_lock_id("members", project)))
            )
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(_lock_id("project", project)))
            )
            lock_user_authority(conn, access.user_id)
            pid = Repository._project_id(conn, project)
            if pid is None:
                raise DomainError("PROJECT_NOT_FOUND")
            return self._records(conn, access, project, pid, document_id)
