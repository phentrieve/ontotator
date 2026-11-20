"""Explicit re-review of accepted translations and exact source-change causes."""

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Connection, insert, select, update

from ontotator.application.translation_reviews import (
    TranslationReviewRecord,
    TranslationReviewService,
)
from ontotator.assignments.eligibility import (
    check_variant_assignable,
    load_variants,
    reads_all,
)
from ontotator.assignments.service import Assignment, AssignmentService
from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.policy import Access
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.errors import AccessDenied, DomainError, RevisionConflict
from ontotator.domain.variants import VariantInfo, descends_from_accepted
from ontotator.domain.work_plans import RowKey
from ontotator.domain.work_rounds import derive_source_obligations
from ontotator.jobs.queue import JobQueue
from ontotator.projects.assignments import revoke_assignments
from ontotator.storage import work_plan_store
from ontotator.storage.database import Database
from ontotator.storage.final_tables import FinalSelectionRow
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.tables import (
    AssignmentRow,
    ProjectMembershipRow,
    TranslationReviewDraftRow,
    TranslationReviewRow,
    UserLanguageRow,
    UserRow,
)
from ontotator.storage.workflow_tables import (
    ReviewObligationResolutionRow,
    WorkRoundRow,
    WorkRoundStateRow,
)


def work_on_version(
    conn: Connection,
    project: Mapping[Any, Any],
    variant: VariantInfo,
    variants: Mapping[str, VariantInfo],
) -> dict[str, Any]:
    """What a new version after ``variant`` leaves on it (issue 341 a, b).

    ``annotations`` counts the live annotation tasks on this version
    (submitted, open), ``open_consolidations`` and ``final_result`` name
    consolidation tasks and a final result on it: all stay on the version,
    and the row then offers the text-change steps. ``next_version`` is the
    number the new version gets, ``review_on`` the row's Review flag and
    ``annotate_accepted_only`` the project's rule.
    """
    pid = project["id"]
    work = conn.execute(
        select(AssignmentRow.task, AssignmentRow.status).where(
            AssignmentRow.project_id == pid,
            AssignmentRow.document_id == variant.document_id,
            AssignmentRow.task.in_(("annotate", "review")),
            AssignmentRow.revoked_at.is_(None),
        )
    ).all()
    statuses = [row.status for row in work if row.task == "annotate"]
    consolidations = sum(
        1 for row in work if row.task == "review" and row.status != "submitted"
    )
    final_here = (
        conn.execute(
            select(FinalSelectionRow.document_id).where(
                FinalSelectionRow.project_id == pid,
                FinalSelectionRow.case_id == variant.case_id,
                FinalSelectionRow.language == variant.language,
                FinalSelectionRow.document_id == variant.document_id,
            )
        ).first()
        is not None
    )
    key = RowKey(variant.case_id, variant.language)
    flags = work_plan_store.effective_plan(conn, pid, [variant.case_id]).get(key)
    newest = max(
        v.version
        for v in variants.values()
        if (v.external_id, v.language) == (variant.external_id, variant.language)
    )
    submitted = sum(1 for status in statuses if status == "submitted")
    return {
        "next_version": newest + 1,
        "review_on": bool(flags and flags.review),
        "annotate_accepted_only": bool(project["annotate_accepted_translations_only"]),
        "annotations": {"submitted": submitted, "open": len(statuses) - submitted},
        "open_consolidations": consolidations,
        "final_result": final_here,
    }


class TranslationWorkflowService:
    def __init__(self, db: Database, jobs: JobQueue):
        self.db = db
        self.reviews = TranslationReviewService(db, jobs)

    def assign_correction(
        self,
        actor: Actor,
        project_key: str,
        document_id: str,
        username: str,
        *,
        expected_text_sha256: str,
        reason: str,
        confirm_language: bool = False,
    ) -> Assignment:
        if not reason.strip():
            raise DomainError("ROUND_REASON_REQUIRED")
        assignments = AssignmentService(self.db)
        with self.db.transaction() as conn:
            target = assignments._target(conn, username)
            project = assignments._prepare(conn, actor, project_key, target)
            variants = load_variants(conn, project["id"])
            variant = variants.get(document_id)
            if variant is None:
                raise DomainError("DOCUMENT_NOT_FOUND")
            if variant.text_sha256 != expected_text_sha256 or any(
                v.derived_from == document_id and v.origin == "correction"
                for v in variants.values()
            ):
                raise DomainError("VARIANT_REVIEW_STALE")
            if variant.translation_status != "accepted":
                raise DomainError("TRANSLATION_NOT_ACCEPTED")
            eligibility = assignments.check_assignable(
                conn,
                project,
                document_id,
                target,
                "translation_review",
                confirm_language,
                variants=variants,
                allow_accepted_translation_review=True,
                check_plan=False,
            )
            # An open lead correction is the version's one review (FD3), as
            # for an ordinary assignment: two open reviews of an accepted
            # version would decide against each other (issue 341 b).
            assignments._require_no_open_lead_correction(
                conn, project["id"], document_id
            )
            existing = assignments.active_for(
                conn, project["id"], document_id, target, "translation_review"
            )
            now = datetime.now(UTC)
            if existing is not None:
                assignments._locked(conn, existing.id)
                from ontotator.application.workflow_guards import (
                    require_task_writable,
                )

                require_task_writable(conn, existing.id)
                if existing.status != "submitted":
                    return existing
            self._plan_review(conn, actor, project["id"], variant)
            if existing is not None:
                assignment = existing
                conn.execute(
                    update(TranslationReviewDraftRow)
                    .where(TranslationReviewDraftRow.assignment_id == assignment.id)
                    .values(
                        text=self.reviews._text(conn, project["id"], variant),
                        form={},
                        revision=TranslationReviewDraftRow.revision + 1,
                        updated_at=now,
                        updated_by=target,
                    )
                )
            else:
                assignment = assignments._create(
                    conn,
                    actor,
                    project,
                    document_id,
                    target,
                    "translation_review",
                    eligibility,
                    now,
                )
            rid = f"round-{uuid4().hex}"
            prior = assignment.active_round_id
            if prior:
                conn.execute(
                    update(WorkRoundStateRow)
                    .where(WorkRoundStateRow.round_id == prior)
                    .values(state="superseded", revision=WorkRoundStateRow.revision + 1)
                )
            conn.execute(
                insert(WorkRoundRow).values(
                    round_id=rid,
                    project_id=project["id"],
                    assignment_id=assignment.id,
                    document_id=document_id,
                    annotator_id=assignment.pseudonym,
                    kind="clean_restart" if prior else "ordinary",
                    mode=None,
                    predecessor_round_id=prior,
                    input_manifest_sha256=canonical_hash([]),
                    input_submission_ids=[],
                    workspace_key=None,
                    created_by=actor.user_id,
                    created_at=now,
                )
            )
            conn.execute(
                insert(WorkRoundStateRow).values(
                    round_id=rid, state="editable", revision=1
                )
            )
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == assignment.id)
                .values(
                    status="reopened" if existing else "open",
                    # Issue 268: not started until the first save from here.
                    started_at=None,
                    active_round_id=rid,
                    last_submission_id=None,
                    workflow_revision=assignment.workflow_revision + 1,
                    updated_at=now,
                )
            )
            record_audit(
                conn,
                actor,
                "translation.correction_requested",
                target_type="assignment",
                target_id=assignment.id,
                project_id=project["id"],
                details={
                    "reason": reason.strip(),
                    "document_id": document_id,
                    "text_sha256": expected_text_sha256,
                    "round_id": rid,
                },
            )
            return assignments._get(conn, assignment.id)

    def add_correction_reason(
        self, actor: Actor, assignment_id: int, note: str
    ) -> dict[str, Any]:
        """Issue 483: the lead adds to the reason of a correction request.

        Append-only: the reason of the request stays as it was sent, each
        addition is a row of its own with who added it and when. Only while
        the requested review is open: refused with
        ``CORRECTION_REASON_NOT_AVAILABLE`` for a submitted (``submitted``)
        or withdrawn (``withdrawn``) review, and for a task whose current
        round was not started by "Ask a reviewer to correct…"
        (``not_a_correction_request``). The rights are those of the request.
        """
        note = note.strip()
        if not note:
            raise DomainError(
                "CORRECTION_REASON_NOT_AVAILABLE", {"reason": "note_required"}
            )
        from ontotator.assignments.service import second_review_requests
        from ontotator.storage.plan_tables import CorrectionReasonAdditionRow

        assignments = AssignmentService(self.db)
        with self.db.transaction() as conn:
            key = assignments._locate(conn, assignment_id)
            project = assignments._prepare(conn, actor, key)
            row = (
                conn.execute(
                    select(AssignmentRow)
                    .where(AssignmentRow.id == assignment_id)
                    .with_for_update(key_share=True)
                )
                .mappings()
                .one()
            )
            round_id = row["active_round_id"]
            requested = (
                row["task"] == "translation_review"
                and round_id is not None
                and assignment_id
                in second_review_requests(conn, {assignment_id: round_id})
            )
            if not requested:
                raise DomainError(
                    "CORRECTION_REASON_NOT_AVAILABLE",
                    {"reason": "not_a_correction_request"},
                )
            if row["revoked_at"] is not None:
                raise DomainError(
                    "CORRECTION_REASON_NOT_AVAILABLE", {"reason": "withdrawn"}
                )
            if row["status"] == "submitted":
                raise DomainError(
                    "CORRECTION_REASON_NOT_AVAILABLE", {"reason": "submitted"}
                )
            added = conn.execute(
                insert(CorrectionReasonAdditionRow)
                .values(
                    project_id=project["id"],
                    assignment_id=assignment_id,
                    round_id=round_id,
                    note=note,
                    added_by=actor.user_id,
                )
                .returning(
                    CorrectionReasonAdditionRow.id,
                    CorrectionReasonAdditionRow.added_at,
                )
            ).one()
            record_audit(
                conn,
                actor,
                "translation.correction_reason_added",
                target_type="assignment",
                target_id=assignment_id,
                project_id=project["id"],
                details={
                    "note": note,
                    "document_id": row["document_id"],
                    "round_id": round_id,
                },
            )
            return {
                "assignment_id": assignment_id,
                "note": note,
                "added_at": added.added_at,
            }

    def start_lead_correction(
        self,
        actor: Actor,
        project_key: str,
        document_id: str,
        *,
        expected_text_sha256: str,
        confirm_language: bool = False,
    ) -> Assignment:
        """F1: the lead reviews a rejected, queried or accepted version themselves.

        An ordinary translation review assigned to the lead with
        ``lead_correction`` (FD1); only the lead role grants it (FD2), so the
        task-role check is not applied. Submitted only as
        ``accepted_corrected`` (FD4, ``TranslationReviewService.submit``). The
        correction of an accepted version (issue 341 b) becomes a new version
        that is reviewed again; the accepted version and its annotations stay.
        """
        if actor.user_id is None:
            raise AccessDenied("NOT_ALLOWED", "Only a project lead can do this.")
        lead = actor.user_id
        assignments = AssignmentService(self.db)
        with self.db.transaction() as conn:
            project = assignments._prepare(conn, actor, project_key, lead)
            pid = project["id"]
            if "lead" not in set(
                conn.execute(
                    select(ProjectMembershipRow.role).where(
                        ProjectMembershipRow.project_id == pid,
                        ProjectMembershipRow.user_id == lead,
                    )
                ).scalars()
            ):
                raise AccessDenied("NOT_ALLOWED", "You may not manage this project.")
            variants = load_variants(conn, pid)
            variant = variants.get(document_id)
            if variant is None:
                raise DomainError("DOCUMENT_NOT_FOUND")
            if variant.text_sha256 != expected_text_sha256:
                raise DomainError("VARIANT_REVIEW_STALE")
            # Before any language or qualification prompt (FD3, FD6).
            self._require_not_discarded(conn, pid, variant)
            existing = assignments.active_for(
                conn, pid, document_id, lead, "translation_review"
            )
            if (
                existing is not None
                and existing.lead_correction
                and existing.status != "submitted"
            ):
                # Idempotent (FD3), a paused correction included: nothing is
                # written, so its hold does not apply.
                assignments._locked(conn, existing.id)
                return existing
            self._require_lead_correction_available(conn, pid, variant, variants, lead)
            if existing is not None and existing.status != "submitted":
                # The lead's own ordinary review (as annotator) is still open.
                raise DomainError(
                    "LEAD_CORRECTION_NOT_AVAILABLE", {"reason": "review_open"}
                )
            if existing is not None:
                # The earlier review is revoked below; a paused one keeps its
                # hold until a lead resumes it (no orphaned hold).
                assignments._locked(conn, existing.id)
                from ontotator.application.workflow_guards import (
                    require_task_writable,
                )

                require_task_writable(conn, existing.id)
            qualification = conn.execute(
                select(UserRow.qualification).where(UserRow.id == lead)
            ).scalar_one()
            required = check_variant_assignable(
                project,
                variant,
                "translation_review",
                variants.get,
                allow_accepted_translation_review=True,
            )
            languages = list(
                conn.execute(
                    select(UserLanguageRow.language)
                    .where(UserLanguageRow.user_id == lead)
                    .order_by(UserLanguageRow.language)
                ).scalars()
            )
            mismatch = not reads_all(languages, required)
            if mismatch and not confirm_language:
                raise DomainError(
                    "LANGUAGE_CONFIRMATION_REQUIRED",
                    {
                        "document_language": variant.language,
                        "user_languages": languages,
                        "required_languages": sorted(required),
                    },
                )
            if not (qualification or "").strip():
                raise DomainError("QUALIFICATION_REQUIRED")
            self._plan_review(conn, actor, pid, variant)
            now = datetime.now(UTC)
            if existing is not None:
                # A submitted earlier review of this lead (also an annotator)
                # holds the one active slot; the correction is a new task.
                revoke_assignments(
                    conn,
                    actor,
                    pid,
                    [dict(assignments._locked(conn, existing.id))],
                    now,
                    reason="lead_correction",
                )
            assignment = assignments._create(
                conn,
                actor,
                project,
                document_id,
                lead,
                "translation_review",
                (variant.language, languages, mismatch, sorted(required), False),
                now,
                lead_correction=True,
            )
            record_audit(
                conn,
                actor,
                "translation.lead_correction_started",
                target_type="assignment",
                target_id=assignment.id,
                project_id=pid,
                details={
                    "document_id": document_id,
                    "text_sha256": expected_text_sha256,
                    "assignment_id": assignment.id,
                },
                at=now,
            )
            return assignment

    def lead_correction_preview(
        self, actor: Actor, project_key: str, document_id: str
    ) -> dict[str, Any]:
        """What a lead correction of ``document_id`` would start (issue 341 b).

        Read only. ``available`` with the refusal ``reason`` of
        ``start_lead_correction`` (``not_newest``, ``not_rejected_or_queried``,
        ``review_open``, ``discarded``); ``annotate_accepted_only`` is the
        project's rule (the text-change steps wait for the new version's
        acceptance); ``annotations`` counts the live
        annotation tasks on this version (submitted, open), which stay on it:
        after the correction the row offers the text-change steps.
        ``open_consolidations`` and ``final_result`` name consolidation tasks
        and a final result on this version (they stay on it as well);
        ``reviewed_again``: the corrected version starts "ready for review".
        """
        if actor.user_id is None:
            raise AccessDenied("NOT_ALLOWED", "Only a project lead can do this.")
        assignments = AssignmentService(self.db)
        with self.db.transaction() as conn:
            project = assignments._prepare(conn, actor, project_key)
            pid = project["id"]
            variants = load_variants(conn, pid)
            variant = variants.get(document_id)
            if variant is None:
                raise DomainError("DOCUMENT_NOT_FOUND")
            reason: str | None = None
            try:
                self._require_not_discarded(conn, pid, variant)
            except DomainError:
                reason = "discarded"
            if reason is None:
                try:
                    self._require_lead_correction_available(
                        conn, pid, variant, variants, actor.user_id
                    )
                except DomainError as refused:
                    details = refused.details
                    reason = (
                        str(details.get("reason"))
                        if isinstance(details, Mapping)
                        else "not_available"
                    )
            own = assignments.active_for(
                conn, pid, document_id, actor.user_id, "translation_review"
            )
            if (
                reason is None
                and own is not None
                and not own.lead_correction
                and own.status != "submitted"
            ):
                # The lead's own ordinary review is open: start refuses too.
                reason = "review_open"
            return {
                "document_id": document_id,
                "version": variant.version,
                "translation_status": variant.translation_status,
                "available": reason is None,
                "reason": reason,
                "reviewed_again": descends_from_accepted(variant, variants.get),
                **work_on_version(conn, project, variant, variants),
            }

    @staticmethod
    def _require_lead_correction_available(
        conn: Connection,
        project_id: int,
        variant: VariantInfo,
        variants: Mapping[str, VariantInfo],
        lead: int,
    ) -> None:
        """FD3: the newest version of its chain, last decided rejected or
        query or accepted (issue 341 b), with no open translation review of
        someone else."""
        own = conn.execute(
            select(TranslationReviewRow.decision)
            .where(
                TranslationReviewRow.project_id == project_id,
                TranslationReviewRow.document_id == variant.document_id,
            )
            .order_by(TranslationReviewRow.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        # An editorial correction of a rejected or queried version counts as
        # that one (issue 453).
        decision = work_plan_store.inherited_review_decisions(
            conn, project_id, {variant.document_id: own} if own else {}
        ).get(variant.document_id)
        reason = None
        if variant.version != max(
            v.version
            for v in variants.values()
            if (v.external_id, v.language) == (variant.external_id, variant.language)
        ):
            reason = "not_newest"
        elif variant.translation_status != "accepted" and (
            variant.translation_status != "reviewed"
            or decision not in ("rejected", "query")
        ):
            reason = "not_rejected_or_queried"
        elif (
            conn.execute(
                select(AssignmentRow.id)
                .where(
                    AssignmentRow.project_id == project_id,
                    AssignmentRow.document_id == variant.document_id,
                    AssignmentRow.task == "translation_review",
                    AssignmentRow.revoked_at.is_(None),
                    AssignmentRow.status != "submitted",
                    AssignmentRow.user_id != lead,
                )
                .limit(1)
            ).first()
            is not None
        ):
            reason = "review_open"
        if reason is not None:
            raise DomainError("LEAD_CORRECTION_NOT_AVAILABLE", {"reason": reason})

    @staticmethod
    def _require_not_discarded(
        conn: Connection, project_id: int, variant: VariantInfo
    ) -> None:
        """A discarded version takes no new work (``NOT_IN_WORK_PLAN``)."""
        discarded = conn.execute(
            select(DiscardedVariantRow.document_id).where(
                DiscardedVariantRow.project_id == project_id,
                DiscardedVariantRow.document_id == variant.document_id,
            )
        ).first()
        if discarded is not None:
            raise DomainError("NOT_IN_WORK_PLAN")

    @staticmethod
    def _plan_review(
        conn: Connection, actor: Actor, project_id: int, variant: VariantInfo
    ) -> None:
        """D26: a correction needs Review; turn it on (audited, no consequences).

        A discarded version takes no new work (``NOT_IN_WORK_PLAN``).
        """
        from ontotator.application.work_plans import turn_review_on

        TranslationWorkflowService._require_not_discarded(conn, project_id, variant)
        turn_review_on(
            conn, actor, project_id, RowKey(variant.case_id, variant.language)
        )

    def obligations(self, access: Access, assignment_id: int) -> list[dict[str, Any]]:
        with self.db.transaction() as conn:
            assignment, pid, _ = self.reviews._authority(conn, access, assignment_id)
            variants = load_variants(conn, pid)
            resolved = set(
                conn.execute(
                    select(ReviewObligationResolutionRow.cause_id).where(
                        ReviewObligationResolutionRow.project_id == pid
                    )
                ).scalars()
            )
            return [
                {
                    **cause.model_dump(),
                    "old_source_text": self.reviews._text(
                        conn, pid, variants[cause.old_source_document_id]
                    ),
                    "new_source_text": self.reviews._text(
                        conn, pid, variants[cause.new_source_document_id]
                    ),
                }
                for cause in derive_source_obligations(
                    assignment.project_key, variants.values(), resolved
                )
                if cause.document_id == assignment.document_id
            ]

    def resolve(
        self,
        access: Access,
        assignment_id: int,
        cause_id: str,
        *,
        expected_revision: int,
        translation_text_sha256: str,
        old_source_text_sha256: str,
        new_source_text_sha256: str,
    ) -> TranslationReviewRecord:
        with self.db.transaction() as conn:
            assignment, pid, user = self.reviews._authority(
                conn, access, assignment_id, structural=True
            )
            cause = next(
                (
                    item
                    for item in self.obligations(access, assignment_id)
                    if item["cause_id"] == cause_id
                ),
                None,
            )
            if cause is None or any(
                cause[name] != value
                for name, value in {
                    "translation_text_sha256": translation_text_sha256,
                    "old_source_text_sha256": old_source_text_sha256,
                    "new_source_text_sha256": new_source_text_sha256,
                }.items()
            ):
                raise RevisionConflict(
                    "The source obligation changed; review it again."
                )
            draft = conn.execute(
                select(TranslationReviewDraftRow.form).where(
                    TranslationReviewDraftRow.assignment_id == assignment_id
                )
            ).scalar_one_or_none()
            if not draft or draft.get("decision") not in {
                "accepted_unchanged",
                "accepted_corrected",
            }:
                raise DomainError(
                    "REVIEW_INVALID",
                    "Accept unchanged or corrected to resolve this source change.",
                )
            record = self.reviews.submit(
                access, assignment_id, expected_revision=expected_revision
            )
            causes = [cause_id]
            if record.created_variant_id:
                for inherited in derive_source_obligations(
                    assignment.project_key, load_variants(conn, pid).values(), set()
                ):
                    if (
                        inherited.document_id == record.created_variant_id
                        and inherited.old_source_document_id
                        == cause["old_source_document_id"]
                        and inherited.new_source_document_id
                        == cause["new_source_document_id"]
                    ):
                        causes.append(inherited.cause_id)
            for resolved_id in causes:
                conn.execute(
                    insert(ReviewObligationResolutionRow).values(
                        project_id=pid,
                        cause_id=resolved_id,
                        resolved_by=access.user_id,
                        created_at=datetime.now(UTC),
                        payload={
                            "cause": {
                                k: v
                                for k, v in cause.items()
                                if not k.endswith("_text")
                            },
                            "review_id": record.id,
                            "decision": record.decision,
                            "created_variant_id": record.created_variant_id,
                        },
                    )
                )
            record_audit(
                conn,
                Actor.user(access.user_id, user["username"]),
                "translation.source_reviewed",
                target_type="document",
                target_id=assignment.document_id,
                project_id=pid,
                details={
                    "cause_id": cause_id,
                    "review_id": record.id,
                    "decision": record.decision,
                },
            )
            return record
