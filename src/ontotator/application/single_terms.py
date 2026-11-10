"""Single-term review (issue 381): bases, batches, decisions and their state.

A lead *starts* (later *refreshes*) the review basis: a frozen final-result
snapshot, taken through the final export's own freeze
(``FinalResultService.insert_snapshot``) without an export job. The
candidate groups of a basis are derived from the snapshot with the export's
conversion (``exchange.single_terms``); a basis stores the digest of its
derivation and the negation cues it used, so the derivation is recomputed
deterministically and checked against the digest (and cached per basis in
this process).

The lead creates *batches*: a subset of the open and stale groups of the
newest basis, frozen at creation, for one reviewer, with an optional blind
second review of a deterministic sample. A reviewer records one decision per
group: ``accept``, ``adjust_span`` (a re-cut of one occurrence),
``adjust_term`` (an ancestor of the term), ``reject`` with a reason, or
``withdrawn`` (the group is open again). The newest decision per (project,
group, role) wins; decisions of an abandoned batch do not count.

A group's state in a basis is ``open`` (``blocked`` when one of its
occurrences blocks it), ``decided`` or ``stale``. A decision carries over to
a later basis while its group exists and the decision still holds there:
an adjusted term is active and an ancestor of the term in every
occurrence's release, a re-cut occurrence is still there, and an accepted
group has not become blocked. Otherwise the group is ``stale`` and opens
again. Occurrences the decision did not list are inherited unseen
(``seen_by_reviewer`` false).

Reviewers see the groups and contexts of their own batches only, never
annotator or consolidator pseudonyms, and a second reviewer never sees the
first decision. Everything refuses while the project setting is off; the
stored data stays.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any, Literal, cast, get_args

import ontospan
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    Connection,
    RowMapping,
    delete,
    func,
    insert,
    null,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontotator.application.final_results import FinalResultService
from ontotator.application.workflow_warnings import state_digest
from ontotator.auth.accounts import normalize_username
from ontotator.auth.audit import Actor, record_audit
from ontotator.auth.authority import lock_user_authority
from ontotator.authz.policy import Access, Action, Role, can
from ontotator.authz.project_authority import hidden_from_token
from ontotator.domain.documents import Segment, validate_segments
from ontotator.domain.errors import AccessDenied, DomainError, NotAuthenticated
from ontotator.exchange.final_content import thaw_content
from ontotator.exchange.final_export import bundle_submissions, round_input_refs
from ontotator.exchange.single_terms import (
    CandidateGroup,
    Derivation,
    Occurrence,
    SourceUnit,
    contains_negation,
    derive_candidates,
    negation_patterns,
    occurrence_ref,
    other_finding_segments,
    overlaps,
    second_review_sample,
    source_units,
)
from ontotator.jobs.queue import StructuredJobError
from ontotator.storage.database import Database, advisory_lock_id
from ontotator.storage.final_tables import ExportSelectionSnapshotRow
from ontotator.storage.guidelines import current_guideline_version
from ontotator.storage.single_term_tables import (
    REJECT_REASONS,
    SingleTermBasisRow,
    SingleTermBatchRow,
    SingleTermBatchStateRow,
    SingleTermDecisionRow,
    SingleTermReviewerRow,
)
from ontotator.storage.tables import (
    DraftRow,
    ProjectMembershipRow,
    ProjectRow,
    SubmissionRow,
    UserRow,
)
from ontotator.storage.workflow_tables import WorkflowCommandReceiptRow

BASIS_PURPOSE = "single_term_basis"
CONTEXT_WINDOW = 200  # code points before and after an occurrence
DEFAULT_CONTEXTS = 5
MAX_CONTEXTS = 50
SECOND_SHARE = 0.2
SECOND_MINIMUM = 50
MAX_NOTE = 2000

GroupState = Literal["open", "blocked", "decided", "stale"]
DecisionKind = Literal["accept", "adjust_span", "adjust_term", "reject", "withdrawn"]
PhraseOnly = Literal["would_accept", "would_reject"]
RejectReason = Literal[
    "needs_context",
    "ambiguous_abbreviation",
    "too_general",
    "term_wrong_out_of_context",
    "contains_other_finding",
    "negation_in_span",
    "needs_rewrite",
    "conflict",
    "other",
]
BatchRole = Literal["primary", "second"]
BatchState = Literal["open", "submitted", "abandoned"]
BatchAction = Literal["submit", "reopen", "abandon"]
# A stored row as read (``RowMapping``) or as a plain mapping.
Record = Mapping[str, Any] | RowMapping
ACCEPTING = frozenset({"accept", "adjust_span", "adjust_term"})
assert set(REJECT_REASONS) == set(get_args(RejectReason))


# --- requests and views -----------------------------------------------------


class SingleTermSecondReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reviewer: str = Field(min_length=1, max_length=200)
    share: float = Field(SECOND_SHARE, gt=0, le=1)


class SingleTermBatchRequest(BaseModel):
    """A new batch: the open and stale groups of the newest basis that match
    every given filter (and are in no other open primary batch)."""

    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=128)
    reviewer: str = Field(min_length=1, max_length=200)
    language: str | None = Field(None, max_length=8)
    layer_id: str | None = Field(None, max_length=200)
    document_ids: list[str] | None = Field(None, max_length=10000)
    stale_only: bool = False
    limit: int | None = Field(None, ge=1, le=100000)
    second_review: SingleTermSecondReviewRequest | None = None


class SingleTermSpanRequest(BaseModel):
    """A re-cut of one occurrence, in code points of its text."""

    model_config = ConfigDict(extra="forbid")
    occurrence_ref: str = Field(min_length=1, max_length=128)
    start: int = Field(ge=0)
    end: int = Field(ge=1)


class SingleTermDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=128)
    group_id: str = Field(min_length=64, max_length=64)
    phrase_only: PhraseOnly | None = None
    decision: DecisionKind
    reason: RejectReason | None = None
    note: str | None = Field(None, max_length=MAX_NOTE)
    adjusted_span: SingleTermSpanRequest | None = None
    adjusted_term_id: str | None = Field(None, max_length=64)


class SingleTermBasisView(BaseModel):
    basis_id: int
    snapshot_id: str
    derivation_sha256: str
    created_at: datetime
    # Counts only (exchange.single_terms.Derivation.report).
    report: dict[str, Any]


class SingleTermSurfaceVariantView(BaseModel):
    text: str
    count: int


class SingleTermDecisionView(BaseModel):
    decision_id: int
    batch_id: int
    basis_id: int
    group_id: str
    role: BatchRole
    phrase_only: PhraseOnly | None
    decision: DecisionKind
    reason: RejectReason | None
    note: str | None
    adjusted_span: dict[str, Any] | None
    adjusted_term_id: str | None
    reviewer_independent: bool
    guideline_version: int | None
    created_at: datetime


class SingleTermGroupView(BaseModel):
    """A phrase-term group as its viewer may see it.

    For a lead ``decision`` is the newest primary decision that counts and
    ``second_decision`` the second review's; for a reviewer ``decision`` is
    their own newest decision in the batch, ``second_decision`` is empty.
    """

    group_id: str
    language: str
    phrase: str
    display_text: str
    term_id: str
    label: str | None
    surface_variants: list[SingleTermSurfaceVariantView]
    occurrences: int
    documents: int
    flags: list[str]
    blocked_reason: str | None
    conflict_with: list[str]
    state: GroupState
    # Occurrences the deciding reviewer did not see (inherited decisions).
    unseen_occurrences: int
    decision: SingleTermDecisionView | None
    second_decision: SingleTermDecisionView | None = None


class SingleTermContextView(BaseModel):
    occurrence_ref: str
    document_id: str
    start: int
    end: int
    before: str
    text: str
    after: str
    # Code points of the whole text: whether before and after reach its ends.
    text_length: int
    flags: list[str]
    blocked: list[str]


class SingleTermContextsView(BaseModel):
    group_id: str
    total: int
    offset: int
    contexts: list[SingleTermContextView]


class SingleTermAncestorView(BaseModel):
    term_id: str
    label: str | None
    # Not an ancestor of another offered term: a parent of the term.
    nearest: bool


class SingleTermAncestorsView(BaseModel):
    group_id: str
    term_id: str
    # Active strict ancestors of the term in the release of every
    # occurrence, nearest first.
    ancestors: list[SingleTermAncestorView]


class SingleTermBatchWarning(BaseModel):
    code: str
    groups: int


class SingleTermBatchView(BaseModel):
    batch_id: int
    basis_id: int
    role: BatchRole
    parent_batch_id: int | None
    second_batch_ids: list[int]
    reviewer_username: str
    reviewer_pseudonym: str
    state: BatchState
    filter: dict[str, Any]
    groups: int
    decided: int
    current_basis: bool
    created_at: datetime
    updated_at: datetime
    warnings: list[SingleTermBatchWarning] = Field(default_factory=list)


class SingleTermLanguageCounts(BaseModel):
    language: str
    groups: int
    occurrences: int
    open: int
    blocked: int
    decided: int
    stale: int
    conflicts: int
    # Open, blocked or stale groups in no open batch: what a new batch can take.
    available: int
    available_stale: int


class SingleTermAgreementView(BaseModel):
    """Primary vs second review on accept (accept or adjust) vs reject."""

    pairs: int
    agreeing: int
    percent: float | None
    kappa: float | None


class SingleTermSummaryView(BaseModel):
    basis: SingleTermBasisView | None
    bases: int
    languages: list[SingleTermLanguageCounts]
    exclusions: dict[str, dict[str, int]]
    blocked: dict[str, dict[str, int]]
    batches: dict[str, int]
    agreement: SingleTermAgreementView


class SingleTermReviewerView(BaseModel):
    username: str
    pseudonym: str
    added_at: datetime


# --- derivation of a basis --------------------------------------------------


@dataclass(frozen=True)
class BasisData:
    """A basis's derivation with what the review reads beside it."""

    derivation: Derivation
    # By submission id: the selected units (texts and other findings).
    sources: Mapping[str, SourceUnit]
    # By ontology digest: the release views (ancestor checks).
    views: Mapping[str, ontospan.OntologyView]
    groups: Mapping[str, CandidateGroup]


_lock = threading.Lock()
_derivations: OrderedDict[tuple[str, int, str], BasisData] = OrderedDict()
_views: dict[str, ontospan.OntologyView] = {}
_CACHED_BASES = 8


def derive_basis(
    db: Database,
    project: str,
    snapshot_id: str,
    payload: Mapping[str, Any],
    cues: Mapping[str, Sequence[str]],
) -> BasisData:
    """The derivation of a frozen snapshot, as the final export converts it.

    The selected results, thawed from the snapshot, are built into T1 units
    with ``build_t1_units`` (the same conversion, bundle id and references
    as the final export of that snapshot) and derived with the cues.
    """
    from ontotator.exchange.jobs import build_t1_units

    content = thaw_content(dict(payload["content"]))
    overrides, _ = round_input_refs(project, payload, snapshot_id)
    selected = bundle_submissions(content, payload)["selected"]
    with _lock:
        views = dict(_views)
    try:
        built = build_t1_units(
            db,
            project,
            replace(content, submissions=selected),
            final_snapshot_id=snapshot_id,
            source_ref_overrides=overrides,
            round_kinds=payload["round_kinds"],
            views=views,
        )
    except StructuredJobError as exc:
        raise DomainError(
            "SINGLE_TERM_DERIVATION_FAILED",
            {"cause": {"code": exc.code, "details": exc.details}},
        ) from exc
    with _lock:
        _views.update(views)
    units = source_units(payload, selected, built.units, built.views)
    derivation = derive_candidates(
        units, negation_cues=cues, bundle_id=f"selected-{snapshot_id}"
    )
    return BasisData(
        derivation=derivation,
        sources={unit.submission_id: unit for unit in units},
        views=views,
        groups={group.group_id: group for group in derivation.groups},
    )


# --- decisions in force -----------------------------------------------------


HPO_ROOT = "HP:0000001"
PHENOTYPIC_ABNORMALITY = "HP:0000118"


def _too_general(term: str, occurrences: Iterable[Occurrence], views: Record) -> bool:
    """The HPO root, the branch roots directly under it or an organ-system
    term directly under Phenotypic abnormality (guideline R1) in some
    occurrence's release: never offered or accepted as a generalised term.
    Checked when deciding only, so a decision carries over as the export
    has it."""
    for occurrence in occurrences:
        view = views.get(occurrence.ontology_digest or "")
        above = set(view.ancestors(term)) if view is not None else set()
        if above <= {HPO_ROOT} or above == {HPO_ROOT, PHENOTYPIC_ABNORMALITY}:
            return True
    return False


def _ancestor_everywhere(
    term: str, occurrences: Iterable[Occurrence], views: Record
) -> bool:
    """Whether ``term`` is an active, strict ancestor of each occurrence's
    term in that occurrence's release."""
    for occurrence in occurrences:
        view = views.get(occurrence.ontology_digest or "")
        if (
            view is None
            or term == occurrence.term_id
            or not view.is_active(term)
            or term not in view.ancestors(occurrence.term_id)
        ):
            return False
    return True


def carries(decision: Record, group: CandidateGroup, data: BasisData) -> bool:
    """Whether a decision still holds for the group as this basis has it."""
    kind = decision["decision"]
    # Neither an acceptance nor a term adjustment lifts a block the group
    # has come to have (as the export's ``export_state`` has it).
    if kind in ("accept", "adjust_term") and group.blocked:
        return False
    if kind == "adjust_term":
        return _ancestor_everywhere(
            decision["adjusted_term_id"], group.occurrences, data.views
        )
    if kind == "adjust_span":
        refs = {occurrence_ref(o) for o in group.occurrences}
        return bool(decision["adjusted_span"]["occurrence_ref"] in refs)
    return True


def group_state(
    group: CandidateGroup, decision: Record | None, data: BasisData
) -> GroupState:
    if decision is None or decision["decision"] == "withdrawn":
        return "blocked" if group.blocked else "open"
    return "decided" if carries(decision, group, data) else "stale"


def _unseen(group: CandidateGroup, decision: Record | None) -> int:
    if decision is None or decision["decision"] == "withdrawn":
        return 0
    seen = {item["ref"] for item in decision["occurrence_refs"]}
    return sum(occurrence_ref(o) not in seen for o in group.occurrences)


def agreement(
    pairs: Sequence[tuple[str, str]],
) -> SingleTermAgreementView:
    """Percent agreement and Cohen's kappa of (primary, second) pairs of
    ``accept``/``reject``; kappa is None when chance agreement is certain."""
    total = len(pairs)
    if not total:
        return SingleTermAgreementView(pairs=0, agreeing=0, percent=None, kappa=None)
    agreeing = sum(a == b for a, b in pairs)
    observed = agreeing / total
    first = sum(a == "accept" for a, _ in pairs) / total
    second = sum(b == "accept" for _, b in pairs) / total
    expected = first * second + (1 - first) * (1 - second)
    kappa = None if expected >= 1 else (observed - expected) / (1 - expected)
    return SingleTermAgreementView(
        pairs=total,
        agreeing=agreeing,
        percent=round(100 * observed, 2),
        kappa=None if kappa is None else round(kappa, 4),
    )


def _binary(kind: str) -> str:
    return "accept" if kind in ACCEPTING else "reject"


# --- the service ------------------------------------------------------------


@dataclass(frozen=True)
class _Viewer:
    project_id: int
    user_id: int
    pseudonym: str
    lead: bool
    reviewer: bool
    cues: Mapping[str, list[str]]


def _not_found(key: str) -> DomainError:
    return DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")


def _decision_view(row: Record | None) -> SingleTermDecisionView | None:
    if row is None:
        return None
    return SingleTermDecisionView(
        decision_id=row["id"],
        batch_id=row["batch_id"],
        basis_id=row["basis_id"],
        group_id=row["group_id"],
        role=row["role"],
        phrase_only=row["phrase_only"],
        decision=row["decision"],
        reason=row["reason"],
        note=row["note"],
        adjusted_span=row["adjusted_span"],
        adjusted_term_id=row["adjusted_term_id"],
        reviewer_independent=row["reviewer_independent"],
        guideline_version=row["guideline_version"],
        created_at=row["created_at"],
    )


class SingleTermService:
    """The single-term review of one request's actor and access."""

    def __init__(
        self,
        db: Database,
        actor: Actor,
        access: Access,
        *,
        now: Any = None,
    ) -> None:
        self.db, self.actor, self.access = db, actor, access
        self._now = now or (lambda: datetime.now(UTC))

    # -- access ---------------------------------------------------------------

    def _viewer(self, conn: Connection, key: str, *, write: bool = False) -> _Viewer:
        """The actor's standing in the project, read fresh under the locks.

        Raises:
            DomainError: ``PROJECT_NOT_FOUND`` or ``SINGLE_TERM_REVIEW_OFF``.
        """
        if hidden_from_token(key):
            raise _not_found(key)
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(advisory_lock_id("members", key)))
        )
        if write:
            conn.execute(
                select(
                    func.pg_advisory_xact_lock(advisory_lock_id("single-terms", key))
                )
            )
        project = conn.execute(
            select(
                ProjectRow.id,
                ProjectRow.practice,
                ProjectRow.single_term_review,
                ProjectRow.single_term_negation_cues,
            ).where(ProjectRow.project_key == key)
        ).one_or_none()
        if project is None or self.actor.user_id is None:
            raise _not_found(key)
        user = lock_user_authority(conn, self.actor.user_id)
        if not user["active"]:
            raise NotAuthenticated()
        roles = frozenset(
            cast(Role, role)
            for role in conn.execute(
                select(ProjectMembershipRow.role).where(
                    ProjectMembershipRow.project_id == project.id,
                    ProjectMembershipRow.user_id == self.actor.user_id,
                )
            ).scalars()
        )
        access = Access(
            user_id=self.actor.user_id,
            pseudonym=user["pseudonym"],
            is_system_admin=user["is_system_admin"],
            roles={key: roles},
            practice=frozenset({key}) if project.practice else frozenset(),
        )
        if not can(access, Action.VIEW_PROJECT, key):
            raise _not_found(key)
        if not project.single_term_review:
            raise DomainError(
                "SINGLE_TERM_REVIEW_OFF",
                "The single-term review is off in this project's settings.",
            )
        lead = can(access, Action.MANAGE_ASSIGNMENTS, key)
        granted = bool(roles) and (
            conn.execute(
                select(SingleTermReviewerRow.user_id).where(
                    SingleTermReviewerRow.project_id == project.id,
                    SingleTermReviewerRow.user_id == self.actor.user_id,
                )
            ).first()
            is not None
        )
        return _Viewer(
            project_id=project.id,
            user_id=self.actor.user_id,
            pseudonym=user["pseudonym"],
            lead=lead,
            reviewer=lead or granted,
            cues=project.single_term_negation_cues,
        )

    @staticmethod
    def _require_lead(viewer: _Viewer) -> None:
        if not viewer.lead:
            raise AccessDenied(
                "NOT_ALLOWED", "Only a lead manages the single-term review."
            )

    # -- receipts -------------------------------------------------------------

    def _replayed(
        self, conn: Connection, viewer: _Viewer, request_id: str, request_hash: str
    ) -> dict[str, Any] | None:
        row = (
            conn.execute(
                select(WorkflowCommandReceiptRow).where(
                    WorkflowCommandReceiptRow.project_id == viewer.project_id,
                    WorkflowCommandReceiptRow.actor_key == str(viewer.user_id),
                    WorkflowCommandReceiptRow.request_id == request_id,
                )
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            return None
        if row["request_hash"] != request_hash:
            raise DomainError("WORKFLOW_REQUEST_CONFLICT")
        return dict(row["response"])

    def _remember(
        self,
        conn: Connection,
        viewer: _Viewer,
        request_id: str,
        request_hash: str,
        response: dict[str, Any],
        now: datetime,
    ) -> None:
        conn.execute(
            insert(WorkflowCommandReceiptRow).values(
                project_id=viewer.project_id,
                actor_key=str(viewer.user_id),
                request_id=request_id,
                request_hash=request_hash,
                response=response,
                created_at=now,
            )
        )

    # -- bases ----------------------------------------------------------------

    @staticmethod
    def _latest_basis(conn: Connection, pid: int) -> RowMapping | None:
        return (
            conn.execute(
                select(SingleTermBasisRow)
                .where(SingleTermBasisRow.project_id == pid)
                .order_by(SingleTermBasisRow.id.desc())
                .limit(1)
            )
            .mappings()
            .first()
        )

    @staticmethod
    def _basis(conn: Connection, pid: int, basis_id: int) -> RowMapping:
        row = (
            conn.execute(
                select(SingleTermBasisRow).where(
                    SingleTermBasisRow.project_id == pid,
                    SingleTermBasisRow.id == basis_id,
                )
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            raise DomainError("SINGLE_TERM_NO_BASIS")
        return row

    def _data(self, conn: Connection, key: str, basis: Record) -> BasisData:
        """The basis's derivation: cached, else recomputed and checked."""
        cache_key = (
            str(self.db.engine.url),
            int(basis["id"]),
            str(basis["derivation_sha256"]),
        )
        with _lock:
            cached = _derivations.get(cache_key)
            if cached is not None:
                _derivations.move_to_end(cache_key)
                return cached
        payload = conn.execute(
            select(ExportSelectionSnapshotRow.payload).where(
                ExportSelectionSnapshotRow.snapshot_id == basis["snapshot_id"]
            )
        ).scalar_one()
        data = derive_basis(
            self.db, key, basis["snapshot_id"], payload, basis["negation_cues"]
        )
        if data.derivation.sha256() != basis["derivation_sha256"]:
            raise DomainError(
                "SINGLE_TERM_BASIS_CHANGED",
                "The candidates of this basis no longer derive as recorded.",
            )
        self._cache(cache_key, data)
        return data

    @staticmethod
    def _cache(cache_key: tuple[str, int, str], data: BasisData) -> None:
        with _lock:
            _derivations[cache_key] = data
            _derivations.move_to_end(cache_key)
            while len(_derivations) > _CACHED_BASES:
                _derivations.popitem(last=False)

    @staticmethod
    def _basis_view(row: Record) -> SingleTermBasisView:
        return SingleTermBasisView(
            basis_id=row["id"],
            snapshot_id=row["snapshot_id"],
            derivation_sha256=row["derivation_sha256"],
            created_at=row["created_at"],
            report=row["report"],
        )

    def start_basis(self, key: str, request_id: str) -> SingleTermBasisView:
        """Start or refresh the review basis: freeze the current final results.

        Raises:
            DomainError: ``SINGLE_TERM_REVIEW_OFF``,
                ``SINGLE_TERM_NO_FINAL_RESULTS``, ``WORKFLOW_REQUEST_CONFLICT``.
        """
        request_hash = state_digest({"command": "single_term_basis"})
        now = self._now()
        finals = FinalResultService(self.db, self.actor, self.access)
        with self.db.transaction() as conn:
            pid = finals.authorize(conn, key)
            viewer = self._viewer(conn, key, write=True)
            self._require_lead(viewer)
            replayed = self._replayed(conn, viewer, request_id, request_hash)
            if replayed is not None:
                return self._basis_view(self._basis(conn, pid, replayed["basis_id"]))
            previous = self._latest_basis(conn, pid)
            cues = dict(viewer.cues)
            sid, _digest, _payload = finals.freeze_current(
                conn,
                key,
                pid,
                {
                    "request_id": f"single-term-basis:{request_id}",
                    "purpose": BASIS_PURPOSE,
                },
            )
            # As stored (JSONB orders the keys anew), so that a recomputation
            # and the final export see the same order of texts.
            payload = conn.execute(
                select(ExportSelectionSnapshotRow.payload).where(
                    ExportSelectionSnapshotRow.snapshot_id == sid
                )
            ).scalar_one()
            data = derive_basis(self.db, key, sid, payload, cues)
            derivation_sha256 = data.derivation.sha256()
            report = data.derivation.report()
            basis_id = conn.execute(
                insert(SingleTermBasisRow)
                .values(
                    project_id=pid,
                    snapshot_id=sid,
                    derivation_sha256=derivation_sha256,
                    negation_cues=cues,
                    report=report,
                    created_by=viewer.user_id,
                    created_at=now,
                )
                .returning(SingleTermBasisRow.id)
            ).scalar_one()
            record_audit(
                conn,
                self.actor,
                "project.single_term_basis",
                target_type="project",
                target_id=key,
                project_id=pid,
                details={
                    "basis_id": basis_id,
                    "snapshot_id": sid,
                    "derivation_sha256": derivation_sha256,
                    "refresh": previous is not None,
                    "groups": sum(report["groups"].values()),
                },
                at=now,
            )
            self._remember(
                conn, viewer, request_id, request_hash, {"basis_id": basis_id}, now
            )
            row = self._basis(conn, pid, basis_id)
            self._cache((str(self.db.engine.url), basis_id, derivation_sha256), data)
            return self._basis_view(row)

    # -- decisions in force ----------------------------------------------------

    @staticmethod
    def _decisions(conn: Connection, pid: int) -> list[RowMapping]:
        """Every decision that counts (not of an abandoned batch), oldest first."""
        from ontotator.exchange.final_single_terms import counted_decisions

        return counted_decisions(conn, pid)

    @staticmethod
    def _newest(decisions: Iterable[Record], role: str) -> dict[str, Record]:
        newest: dict[str, Record] = {}
        for row in decisions:
            if row["role"] == role:
                newest[row["group_id"]] = row
        return newest

    def _states(
        self, conn: Connection, pid: int, data: BasisData
    ) -> tuple[dict[str, GroupState], dict[str, Record], list[RowMapping]]:
        decisions = self._decisions(conn, pid)
        primary = self._newest(decisions, "primary")
        states = {
            group.group_id: group_state(group, primary.get(group.group_id), data)
            for group in data.derivation.groups
        }
        return states, primary, decisions

    # -- reads ------------------------------------------------------------------

    def summary(self, key: str) -> SingleTermSummaryView:
        with self.db.transaction() as conn:
            viewer = self._viewer(conn, key)
            self._require_lead(viewer)
            pid = viewer.project_id
            basis = self._latest_basis(conn, pid)
            bases = conn.execute(
                select(func.count())
                .select_from(SingleTermBasisRow)
                .where(SingleTermBasisRow.project_id == pid)
            ).scalar_one()
            batch_states: dict[str, int] = dict.fromkeys(
                ("open", "submitted", "abandoned"), 0
            )
            for state, count in conn.execute(
                select(SingleTermBatchStateRow.state, func.count())
                .join(
                    SingleTermBatchRow,
                    SingleTermBatchRow.id == SingleTermBatchStateRow.batch_id,
                )
                .where(SingleTermBatchRow.project_id == pid)
                .group_by(SingleTermBatchStateRow.state)
            ).all():
                batch_states[state] = count
            if basis is None:
                return SingleTermSummaryView(
                    basis=None,
                    bases=0,
                    languages=[],
                    exclusions={},
                    blocked={},
                    batches=batch_states,
                    agreement=agreement([]),
                )
            data = self._data(conn, key, basis)
            states, primary, decisions = self._states(conn, pid, data)
            second = self._newest(decisions, "second")
            taken = self._in_open_batches(conn, pid)
        counts: dict[str, dict[str, int]] = {}
        for group in data.derivation.groups:
            per = counts.setdefault(
                group.language,
                dict.fromkeys(
                    (
                        "groups",
                        "occurrences",
                        "open",
                        "blocked",
                        "decided",
                        "stale",
                        "conflicts",
                        "available",
                        "available_stale",
                    ),
                    0,
                ),
            )
            state = states[group.group_id]
            per["groups"] += 1
            per["occurrences"] += len(group.occurrences)
            per[state] += 1
            per["conflicts"] += group.conflict
            if state != "decided" and group.group_id not in taken:
                per["available"] += 1
                per["available_stale"] += state == "stale"
        pairs = [
            (_binary(primary[gid]["decision"]), _binary(row["decision"]))
            for gid, row in sorted(second.items())
            if row["decision"] != "withdrawn"
            and gid in primary
            and primary[gid]["decision"] != "withdrawn"
        ]
        report = data.derivation.report()
        return SingleTermSummaryView(
            basis=self._basis_view(basis),
            bases=bases,
            languages=[
                SingleTermLanguageCounts(language=language, **per)
                for language, per in sorted(counts.items())
            ],
            exclusions=report["exclusions"],
            blocked=report["blocked_groups"],
            batches=batch_states,
            agreement=agreement(pairs),
        )

    def _batch(self, conn: Connection, pid: int, batch_id: int) -> RowMapping:
        row = (
            conn.execute(
                select(
                    SingleTermBatchRow,
                    SingleTermBatchStateRow.state,
                    SingleTermBatchStateRow.updated_at,
                )
                .join(
                    SingleTermBatchStateRow,
                    SingleTermBatchStateRow.batch_id == SingleTermBatchRow.id,
                )
                .where(
                    SingleTermBatchRow.project_id == pid,
                    SingleTermBatchRow.id == batch_id,
                )
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            raise DomainError("SINGLE_TERM_BATCH_NOT_FOUND")
        return row

    def _visible_batch(
        self, conn: Connection, viewer: _Viewer, batch_id: int
    ) -> RowMapping:
        """A batch the viewer leads or reviews; another's looks missing. Their
        own is refused once their reviewer capability is revoked."""
        batch = self._batch(conn, viewer.project_id, batch_id)
        if viewer.lead:
            return batch
        if batch["reviewer_user_id"] != viewer.user_id:
            raise DomainError("SINGLE_TERM_BATCH_NOT_FOUND")
        if not viewer.reviewer:
            raise AccessDenied(
                "NOT_ALLOWED", "Only a single-term reviewer works on a batch."
            )
        return batch

    def groups(
        self,
        key: str,
        *,
        language: str | None = None,
        state: GroupState | None = None,
        batch_id: int | None = None,
    ) -> list[SingleTermGroupView]:
        """The groups of the newest basis (leads), or of one batch in its
        basis (its reviewer and leads)."""
        with self.db.transaction() as conn:
            viewer = self._viewer(conn, key)
            pid = viewer.project_id
            if batch_id is None:
                self._require_lead(viewer)
                basis = self._latest_basis(conn, pid)
                if basis is None:
                    return []
                data = self._data(conn, key, basis)
                states, primary, decisions = self._states(conn, pid, data)
                second = self._newest(decisions, "second")
                chosen = list(data.derivation.groups)
                own: dict[str, Record] = primary
            else:
                batch = self._visible_batch(conn, viewer, batch_id)
                if not viewer.reviewer:
                    raise AccessDenied("NOT_ALLOWED")
                data = self._data(conn, key, self._basis(conn, pid, batch["basis_id"]))
                ids = set(batch["group_ids"])
                chosen = [g for g in data.derivation.groups if g.group_id in ids]
                if viewer.lead and batch["reviewer_user_id"] != viewer.user_id:
                    states, primary, decisions = self._states(conn, pid, data)
                    second = self._newest(decisions, "second")
                    own = primary
                else:
                    mine = [
                        row
                        for row in self._decisions(conn, pid)
                        if row["batch_id"] == batch_id
                    ]
                    own = self._newest(mine, batch["role"])
                    states = {
                        g.group_id: group_state(g, own.get(g.group_id), data)
                        for g in chosen
                    }
                    second = {}
        views = []
        for group in chosen:
            if language is not None and group.language != language:
                continue
            group_state_ = states[group.group_id]
            if state is not None and group_state_ != state:
                continue
            decision = own.get(group.group_id)
            views.append(
                SingleTermGroupView(
                    group_id=group.group_id,
                    language=group.language,
                    phrase=group.phrase,
                    display_text=group.display_text,
                    term_id=group.term_id,
                    label=group.label,
                    surface_variants=[
                        SingleTermSurfaceVariantView(text=text, count=count)
                        for text, count in group.surface_variants
                    ],
                    occurrences=len(group.occurrences),
                    documents=len({o.document_id for o in group.occurrences}),
                    flags=list(group.flags),
                    blocked_reason=group.blocked_reason,
                    conflict_with=list(group.conflict_with),
                    state=group_state_,
                    unseen_occurrences=_unseen(group, decision),
                    decision=_decision_view(decision),
                    second_decision=_decision_view(second.get(group.group_id)),
                )
            )
        return views

    def contexts(
        self,
        key: str,
        group_id: str,
        *,
        batch_id: int | None = None,
        limit: int = DEFAULT_CONTEXTS,
        offset: int = 0,
    ) -> SingleTermContextsView:
        """The occurrences of a group in their text, ``CONTEXT_WINDOW`` code
        points either side. A reviewer reads only the groups of their batches."""
        data, group = self._readable_group(key, group_id, batch_id)
        items = group.occurrences[offset : offset + limit]
        contexts = []
        for occurrence in items:
            text = data.sources[occurrence.submission_id].unit.document.text
            contexts.append(
                SingleTermContextView(
                    occurrence_ref=occurrence_ref(occurrence),
                    document_id=occurrence.document_id,
                    start=occurrence.start,
                    end=occurrence.end,
                    before=text[
                        max(0, occurrence.start - CONTEXT_WINDOW) : occurrence.start
                    ],
                    text=text[occurrence.start : occurrence.end],
                    after=text[occurrence.end : occurrence.end + CONTEXT_WINDOW],
                    text_length=len(text),
                    flags=list(occurrence.flags),
                    blocked=list(occurrence.blocked),
                )
            )
        return SingleTermContextsView(
            group_id=group_id,
            total=len(group.occurrences),
            offset=offset,
            contexts=contexts,
        )

    def _readable_group(
        self, key: str, group_id: str, batch_id: int | None
    ) -> tuple[BasisData, CandidateGroup]:
        """A group of the newest basis (leads) or of one batch in its basis
        (its reviewer and leads), with the basis's data."""
        with self.db.transaction() as conn:
            viewer = self._viewer(conn, key)
            pid = viewer.project_id
            if batch_id is None:
                self._require_lead(viewer)
                basis = self._latest_basis(conn, pid)
                if basis is None:
                    raise DomainError("SINGLE_TERM_NO_BASIS")
            else:
                batch = self._visible_batch(conn, viewer, batch_id)
                if not viewer.reviewer:
                    raise AccessDenied("NOT_ALLOWED")
                if group_id not in batch["group_ids"]:
                    raise DomainError("SINGLE_TERM_GROUP_NOT_FOUND")
                basis = self._basis(conn, pid, batch["basis_id"])
            data = self._data(conn, key, basis)
        group = data.groups.get(group_id)
        if group is None:
            raise DomainError("SINGLE_TERM_GROUP_NOT_FOUND")
        return data, group

    def ancestors(
        self, key: str, group_id: str, *, batch_id: int | None = None
    ) -> SingleTermAncestorsView:
        """The terms a group's term can be generalised to (``adjust_term``):
        its active strict ancestors in the release of every occurrence."""
        data, group = self._readable_group(key, group_id, batch_id)
        offered: list[SingleTermAncestorView] = []
        first = (
            data.views.get(group.occurrences[0].ontology_digest or "")
            if group.occurrences
            else None
        )
        if first is not None:
            terms = {
                term
                for term in first.ancestors(group.term_id)
                if _ancestor_everywhere(term, group.occurrences, data.views)
                and not _too_general(term, group.occurrences, data.views)
            }
            above = {a for term in terms for a in first.ancestors(term)}
            offered = [
                SingleTermAncestorView(
                    term_id=term, label=first.label(term), nearest=term not in above
                )
                for term in sorted(terms, key=lambda t: (-len(first.ancestors(t)), t))
            ]
        return SingleTermAncestorsView(
            group_id=group.group_id, term_id=group.term_id, ancestors=offered
        )

    # -- reviewers --------------------------------------------------------------

    def reviewers(self, key: str) -> list[SingleTermReviewerView]:
        with self.db.transaction() as conn:
            viewer = self._viewer(conn, key)
            self._require_lead(viewer)
            rows = conn.execute(
                select(
                    UserRow.username, UserRow.pseudonym, SingleTermReviewerRow.added_at
                )
                .join(UserRow, UserRow.id == SingleTermReviewerRow.user_id)
                .where(SingleTermReviewerRow.project_id == viewer.project_id)
                .order_by(UserRow.username)
            ).all()
        return [
            SingleTermReviewerView(
                username=r.username, pseudonym=r.pseudonym, added_at=r.added_at
            )
            for r in rows
        ]

    def _member(self, conn: Connection, pid: int, username: str) -> RowMapping:
        name = normalize_username(username)
        user = (
            conn.execute(
                select(
                    UserRow.id, UserRow.username, UserRow.pseudonym, UserRow.active
                ).where(UserRow.username == name)
            )
            .mappings()
            .one_or_none()
        )
        if user is None:
            raise DomainError("USER_NOT_FOUND", f"There is no user '{name}'.")
        member = conn.execute(
            select(ProjectMembershipRow.role).where(
                ProjectMembershipRow.project_id == pid,
                ProjectMembershipRow.user_id == user["id"],
            )
        ).first()
        if member is None:
            raise DomainError(
                "SINGLE_TERM_NOT_A_MEMBER",
                "Only a member of the project can review single terms.",
            )
        return user

    def grant_reviewer(self, key: str, username: str) -> list[SingleTermReviewerView]:
        now = self._now()
        with self.db.transaction() as conn:
            viewer = self._viewer(conn, key, write=True)
            self._require_lead(viewer)
            user = self._member(conn, viewer.project_id, username)
            added = conn.execute(
                pg_insert(SingleTermReviewerRow)
                .values(
                    project_id=viewer.project_id,
                    user_id=user["id"],
                    added_by=viewer.user_id,
                    added_at=now,
                )
                .on_conflict_do_nothing()
                .returning(SingleTermReviewerRow.user_id)
            ).first()
            if added is not None:
                record_audit(
                    conn,
                    self.actor,
                    "project.single_term_reviewer_add",
                    target_type="user",
                    target_id=user["username"],
                    project_id=viewer.project_id,
                    details={"username": user["username"]},
                    at=now,
                )
        return self.reviewers(key)

    def revoke_reviewer(self, key: str, username: str) -> list[SingleTermReviewerView]:
        now = self._now()
        with self.db.transaction() as conn:
            viewer = self._viewer(conn, key, write=True)
            self._require_lead(viewer)
            name = normalize_username(username)
            user_id = conn.execute(
                select(UserRow.id).where(UserRow.username == name)
            ).scalar_one_or_none()
            if user_id is None:
                raise DomainError("USER_NOT_FOUND", f"There is no user '{name}'.")
            removed = conn.execute(
                delete(SingleTermReviewerRow)
                .where(
                    SingleTermReviewerRow.project_id == viewer.project_id,
                    SingleTermReviewerRow.user_id == user_id,
                )
                .returning(SingleTermReviewerRow.user_id)
            ).first()
            if removed is not None:
                record_audit(
                    conn,
                    self.actor,
                    "project.single_term_reviewer_remove",
                    target_type="user",
                    target_id=name,
                    project_id=viewer.project_id,
                    details={"username": name},
                    at=now,
                )
        return self.reviewers(key)

    def _may_review(self, conn: Connection, pid: int, user: Record) -> bool:
        """A lead of the project, or a member granted the capability."""
        roles = set(
            conn.execute(
                select(ProjectMembershipRow.role).where(
                    ProjectMembershipRow.project_id == pid,
                    ProjectMembershipRow.user_id == user["id"],
                )
            ).scalars()
        )
        if "lead" in roles:
            return True
        return bool(roles) and (
            conn.execute(
                select(SingleTermReviewerRow.user_id).where(
                    SingleTermReviewerRow.project_id == pid,
                    SingleTermReviewerRow.user_id == user["id"],
                )
            ).first()
            is not None
        )

    def _reviewer(self, conn: Connection, pid: int, username: str) -> RowMapping:
        user = self._member(conn, pid, username)
        if not user["active"] or not self._may_review(conn, pid, user):
            raise DomainError(
                "SINGLE_TERM_NOT_A_REVIEWER",
                f"'{user['username']}' is no single-term reviewer of the project.",
            )
        return user

    # -- batches ----------------------------------------------------------------

    @staticmethod
    def _worked_on(conn: Connection, pid: int, pseudonym: str) -> set[str]:
        """The texts a person annotated or consolidated (drafts included)."""
        submitted = conn.execute(
            select(SubmissionRow.document_id).where(
                SubmissionRow.project_id == pid,
                SubmissionRow.annotator_id == pseudonym,
            )
        ).scalars()
        drafted = conn.execute(
            select(DraftRow.document_id).where(
                DraftRow.project_id == pid, DraftRow.annotator_id == pseudonym
            )
        ).scalars()
        return {*submitted, *drafted}

    def _batch_view(
        self,
        conn: Connection,
        pid: int,
        batch: Record,
        *,
        warnings: Sequence[SingleTermBatchWarning] = (),
    ) -> SingleTermBatchView:
        reviewer = conn.execute(
            select(UserRow.username, UserRow.pseudonym).where(
                UserRow.id == batch["reviewer_user_id"]
            )
        ).one()
        decided = {
            row["group_id"]: row
            for row in conn.execute(
                select(SingleTermDecisionRow.group_id, SingleTermDecisionRow.decision)
                .where(SingleTermDecisionRow.batch_id == batch["id"])
                .order_by(SingleTermDecisionRow.id)
            ).mappings()
        }
        children = list(
            conn.execute(
                select(SingleTermBatchRow.id)
                .where(SingleTermBatchRow.parent_batch_id == batch["id"])
                .order_by(SingleTermBatchRow.id)
            ).scalars()
        )
        latest = self._latest_basis(conn, pid)
        return SingleTermBatchView(
            batch_id=batch["id"],
            basis_id=batch["basis_id"],
            role=batch["role"],
            parent_batch_id=batch["parent_batch_id"],
            second_batch_ids=children,
            reviewer_username=reviewer.username,
            reviewer_pseudonym=reviewer.pseudonym,
            state=batch["state"],
            filter=batch["filter"],
            groups=len(batch["group_ids"]),
            decided=sum(row["decision"] != "withdrawn" for row in decided.values()),
            current_basis=latest is not None and latest["id"] == batch["basis_id"],
            created_at=batch["created_at"],
            updated_at=batch["updated_at"],
            warnings=list(warnings),
        )

    def batches(self, key: str) -> list[SingleTermBatchView]:
        with self.db.transaction() as conn:
            viewer = self._viewer(conn, key)
            if not viewer.reviewer:
                raise AccessDenied("NOT_ALLOWED")
            statement = (
                select(
                    SingleTermBatchRow,
                    SingleTermBatchStateRow.state,
                    SingleTermBatchStateRow.updated_at,
                )
                .join(
                    SingleTermBatchStateRow,
                    SingleTermBatchStateRow.batch_id == SingleTermBatchRow.id,
                )
                .where(SingleTermBatchRow.project_id == viewer.project_id)
                .order_by(SingleTermBatchRow.id)
            )
            if not viewer.lead:
                statement = statement.where(
                    SingleTermBatchRow.reviewer_user_id == viewer.user_id
                )
            rows = conn.execute(statement).mappings().all()
            return [self._batch_view(conn, viewer.project_id, row) for row in rows]

    def batch(self, key: str, batch_id: int) -> SingleTermBatchView:
        with self.db.transaction() as conn:
            viewer = self._viewer(conn, key)
            batch = self._visible_batch(conn, viewer, batch_id)
            return self._batch_view(conn, viewer.project_id, batch)

    def create_batch(
        self, key: str, body: SingleTermBatchRequest
    ) -> SingleTermBatchView:
        """Freeze a subset of the open and stale groups for one reviewer.

        Raises:
            DomainError: ``SINGLE_TERM_NO_BASIS``, ``SINGLE_TERM_NOT_A_REVIEWER``,
                ``SINGLE_TERM_SAME_REVIEWER``, ``SINGLE_TERM_BATCH_EMPTY``.
        """
        request_hash = state_digest(
            {"command": "single_term_batch", **body.model_dump(mode="json")}
        )
        now = self._now()
        with self.db.transaction() as conn:
            viewer = self._viewer(conn, key, write=True)
            self._require_lead(viewer)
            pid = viewer.project_id
            replayed = self._replayed(conn, viewer, body.request_id, request_hash)
            if replayed is not None:
                return SingleTermBatchView.model_validate(replayed)
            basis = self._latest_basis(conn, pid)
            if basis is None:
                raise DomainError(
                    "SINGLE_TERM_NO_BASIS", "Start the single-term review first."
                )
            reviewer = self._reviewer(conn, pid, body.reviewer)
            second_reviewer = None
            if body.second_review is not None:
                second_reviewer = self._reviewer(conn, pid, body.second_review.reviewer)
                if second_reviewer["id"] == reviewer["id"]:
                    raise DomainError(
                        "SINGLE_TERM_SAME_REVIEWER",
                        "The second review needs another reviewer.",
                    )
            data = self._data(conn, key, basis)
            states, _primary, _ = self._states(conn, pid, data)
            taken = self._in_open_batches(conn, pid)
            wanted_states = (
                {"stale"} if body.stale_only else {"open", "blocked", "stale"}
            )
            documents = (
                set(body.document_ids) if body.document_ids is not None else None
            )
            chosen = [
                group
                for group in data.derivation.groups
                if states[group.group_id] in wanted_states
                and group.group_id not in taken
                and (body.language is None or group.language == body.language)
                and (
                    body.layer_id is None
                    or any(o.layer_id == body.layer_id for o in group.occurrences)
                )
                and (
                    documents is None
                    or any(o.document_id in documents for o in group.occurrences)
                )
            ]
            if body.limit is not None:
                chosen = chosen[: body.limit]
            if not chosen:
                raise DomainError(
                    "SINGLE_TERM_BATCH_EMPTY",
                    "No open or stale group matches the batch.",
                )
            filter_ = body.model_dump(
                mode="json", exclude={"request_id", "reviewer", "second_review"}
            )
            batch_id = self._insert_batch(
                conn,
                pid,
                basis["id"],
                viewer.user_id,
                reviewer["id"],
                "primary",
                None,
                filter_,
                [g.group_id for g in chosen],
                now,
            )
            second_id = None
            sample: list[str] = []
            if body.second_review is not None and second_reviewer is not None:
                sample = second_review_sample(
                    chosen, body.second_review.share, SECOND_MINIMUM
                )
                second_id = self._insert_batch(
                    conn,
                    pid,
                    basis["id"],
                    viewer.user_id,
                    second_reviewer["id"],
                    "second",
                    batch_id,
                    {**filter_, "share": body.second_review.share},
                    sample,
                    now,
                )
            worked = self._worked_on(conn, pid, reviewer["pseudonym"])
            dependent = sum(
                any(o.document_id in worked for o in g.occurrences) for g in chosen
            )
            warnings = (
                [
                    SingleTermBatchWarning(
                        code="SINGLE_TERM_REVIEWER_NOT_INDEPENDENT", groups=dependent
                    )
                ]
                if dependent
                else []
            )
            second_dependent = None
            if second_id is not None:
                assert second_reviewer is not None
                second_worked = self._worked_on(conn, pid, second_reviewer["pseudonym"])
                sampled = set(sample)
                second_dependent = sum(
                    any(o.document_id in second_worked for o in g.occurrences)
                    for g in chosen
                    if g.group_id in sampled
                )
                if second_dependent:
                    warnings.append(
                        SingleTermBatchWarning(
                            code="SINGLE_TERM_SECOND_REVIEWER_NOT_INDEPENDENT",
                            groups=second_dependent,
                        )
                    )
            record_audit(
                conn,
                self.actor,
                "project.single_term_batch_create",
                target_type="project",
                target_id=key,
                project_id=pid,
                details={
                    "batch_id": batch_id,
                    "basis_id": basis["id"],
                    # Under ``username``, which account erasure rewrites.
                    "username": reviewer["username"],
                    "groups": len(chosen),
                    "second_batch_id": second_id,
                    "not_independent_groups": dependent,
                    "second_not_independent_groups": second_dependent,
                },
                at=now,
            )
            view = self._batch_view(
                conn, pid, self._batch(conn, pid, batch_id), warnings=warnings
            )
            self._remember(
                conn,
                viewer,
                body.request_id,
                request_hash,
                view.model_dump(mode="json"),
                now,
            )
            return view

    @staticmethod
    def _in_open_batches(conn: Connection, pid: int) -> set[str]:
        ids: set[str] = set()
        for group_ids in conn.execute(
            select(SingleTermBatchRow.group_ids)
            .join(
                SingleTermBatchStateRow,
                SingleTermBatchStateRow.batch_id == SingleTermBatchRow.id,
            )
            .where(
                SingleTermBatchRow.project_id == pid,
                SingleTermBatchRow.role == "primary",
                SingleTermBatchStateRow.state == "open",
            )
        ).scalars():
            ids.update(group_ids)
        return ids

    @staticmethod
    def _insert_batch(
        conn: Connection,
        pid: int,
        basis_id: int,
        created_by: int,
        reviewer_id: int,
        role: str,
        parent: int | None,
        filter_: dict[str, Any],
        group_ids: list[str],
        now: datetime,
    ) -> int:
        batch_id = conn.execute(
            insert(SingleTermBatchRow)
            .values(
                project_id=pid,
                basis_id=basis_id,
                created_by=created_by,
                reviewer_user_id=reviewer_id,
                role=role,
                parent_batch_id=parent,
                filter=filter_,
                group_ids=group_ids,
                created_at=now,
            )
            .returning(SingleTermBatchRow.id)
        ).scalar_one()
        conn.execute(
            insert(SingleTermBatchStateRow).values(
                batch_id=batch_id, state="open", updated_at=now, updated_by=created_by
            )
        )
        return int(batch_id)

    def act(
        self, key: str, batch_id: int, action: BatchAction, request_id: str
    ) -> SingleTermBatchView:
        """``submit`` (its reviewer or a lead: open to submitted), ``reopen``
        (a lead: submitted to open), ``abandon`` (a lead: its decisions stop
        counting; final).

        Raises:
            DomainError: ``SINGLE_TERM_BATCH_STATE``.
        """
        transitions: dict[str, tuple[set[str], str]] = {
            "submit": ({"open"}, "submitted"),
            "reopen": ({"submitted"}, "open"),
            "abandon": ({"open", "submitted"}, "abandoned"),
        }
        request_hash = state_digest(
            {"command": f"single_term_batch_{action}", "batch_id": batch_id}
        )
        now = self._now()
        with self.db.transaction() as conn:
            viewer = self._viewer(conn, key, write=True)
            pid = viewer.project_id
            replayed = self._replayed(conn, viewer, request_id, request_hash)
            if replayed is not None:
                return self._batch_view(conn, pid, self._batch(conn, pid, batch_id))
            batch = self._visible_batch(conn, viewer, batch_id)
            if action != "submit" or batch["reviewer_user_id"] != viewer.user_id:
                self._require_lead(viewer)
            allowed, target = transitions[action]
            if batch["state"] not in allowed:
                raise DomainError(
                    "SINGLE_TERM_BATCH_STATE",
                    {"state": batch["state"], "action": action},
                )
            conn.execute(
                update(SingleTermBatchStateRow)
                .where(SingleTermBatchStateRow.batch_id == batch_id)
                .values(state=target, updated_at=now, updated_by=viewer.user_id)
            )
            record_audit(
                conn,
                self.actor,
                f"project.single_term_batch_{action}",
                target_type="project",
                target_id=key,
                project_id=pid,
                details={"batch_id": batch_id, "state": target},
                at=now,
            )
            self._remember(
                conn, viewer, request_id, request_hash, {"batch_id": batch_id}, now
            )
            return self._batch_view(conn, pid, self._batch(conn, pid, batch_id))

    # -- decisions --------------------------------------------------------------

    def _partners(
        self,
        conn: Connection,
        key: str,
        pid: int,
        basis: Record,
        group: CandidateGroup,
    ) -> set[str]:
        """The group's phrase-conflict partners in its batch's basis and in
        the latest basis."""
        partners = set(group.conflict_with)
        latest = self._latest_basis(conn, pid)
        if latest is not None and latest["id"] != basis["id"]:
            current = self._data(conn, key, latest).groups.get(group.group_id)
            if current is not None:
                partners.update(current.conflict_with)
        return partners

    def decide(
        self, key: str, batch_id: int, body: SingleTermDecisionRequest
    ) -> SingleTermDecisionView:
        """Record the reviewer's decision on one group of their open batch.

        Raises:
            DomainError: ``SINGLE_TERM_BATCH_NOT_OPEN``,
                ``SINGLE_TERM_GROUP_NOT_FOUND``, ``SINGLE_TERM_DECISION_INVALID``,
                ``SINGLE_TERM_GROUP_BLOCKED``, ``SINGLE_TERM_NOT_ANCESTOR``,
                ``SINGLE_TERM_SPAN_INVALID``,
                ``SINGLE_TERM_SPAN_OVERLAPS_FINDING``,
                ``SINGLE_TERM_SPAN_NEGATED``, ``SINGLE_TERM_NOT_IN_CONFLICT``,
                ``SINGLE_TERM_CONFLICT_ACCEPTED``, ``WORKFLOW_REQUEST_CONFLICT``.
        """
        request_hash = state_digest(
            {
                "command": "single_term_decision",
                "batch_id": batch_id,
                **body.model_dump(mode="json"),
            }
        )
        now = self._now()
        with self.db.transaction() as conn:
            viewer = self._viewer(conn, key, write=True)
            pid = viewer.project_id
            replayed = self._replayed(conn, viewer, body.request_id, request_hash)
            if replayed is not None:
                return SingleTermDecisionView.model_validate(replayed)
            batch = self._visible_batch(conn, viewer, batch_id)
            if batch["reviewer_user_id"] != viewer.user_id or not viewer.reviewer:
                raise AccessDenied(
                    "NOT_ALLOWED", "Only the batch's reviewer decides on its groups."
                )
            if batch["state"] != "open":
                raise DomainError(
                    "SINGLE_TERM_BATCH_NOT_OPEN", {"state": batch["state"]}
                )
            if body.group_id not in batch["group_ids"]:
                raise DomainError("SINGLE_TERM_GROUP_NOT_FOUND")
            basis = self._basis(conn, pid, batch["basis_id"])
            data = self._data(conn, key, basis)
            group = data.groups[body.group_id]
            self._check_fields(body)
            adjusted_span = None
            if body.decision in {"accept", "adjust_term"} and group.blocked:
                raise DomainError(
                    "SINGLE_TERM_GROUP_BLOCKED",
                    {"blocked_reason": group.blocked_reason},
                )
            if body.decision == "adjust_term":
                assert body.adjusted_term_id is not None
                if not _ancestor_everywhere(
                    body.adjusted_term_id, group.occurrences, data.views
                ) or _too_general(body.adjusted_term_id, group.occurrences, data.views):
                    raise DomainError(
                        "SINGLE_TERM_NOT_ANCESTOR",
                        "The adjusted term must be an active ancestor of the term"
                        " in the release of every occurrence, below the HPO root,"
                        " its branch roots and the organ-system terms.",
                    )
            if body.decision == "adjust_span":
                assert body.adjusted_span is not None
                adjusted_span = self._check_span(
                    body.adjusted_span, group, data, basis["negation_cues"]
                )
            if (
                body.decision == "reject"
                and body.reason == "conflict"
                and not group.conflict
            ):
                raise DomainError(
                    "SINGLE_TERM_NOT_IN_CONFLICT",
                    "Only a group in a phrase conflict is rejected for it.",
                )
            role = batch["role"]
            # Conflict partners of the batch's basis and of the latest one: a
            # batch still open on an older basis must not accept a group
            # whose partner, new in a later basis, is already accepted.
            partners = (
                self._partners(conn, key, pid, basis, group)
                if body.decision in ACCEPTING and role == "primary"
                else set()
            )
            if partners:
                primary = self._newest(self._decisions(conn, pid), "primary")
                accepted = [
                    other
                    for other in sorted(partners)
                    if other in primary and primary[other]["decision"] in ACCEPTING
                ]
                if accepted:
                    raise DomainError(
                        "SINGLE_TERM_CONFLICT_ACCEPTED",
                        {"accepted_group_ids": accepted},
                    )
            worked = self._worked_on(conn, pid, viewer.pseudonym)
            independent = not any(o.document_id in worked for o in group.occurrences)
            refs = [
                {
                    "ref": occurrence_ref(o),
                    "document_id": o.document_id,
                    "submission_id": o.submission_id,
                    "annotation_id": o.annotation_id,
                    "start": o.start,
                    "end": o.end,
                }
                for o in group.occurrences
            ]
            decision_id = conn.execute(
                insert(SingleTermDecisionRow)
                .values(
                    project_id=pid,
                    batch_id=batch_id,
                    basis_id=batch["basis_id"],
                    group_id=group.group_id,
                    role=role,
                    language=group.language,
                    phrase_norm=group.phrase,
                    term_id=group.term_id,
                    phrase_only=body.phrase_only,
                    decision=body.decision,
                    # SQL NULL, not a JSON null (the check constraint).
                    adjusted_span=null() if adjusted_span is None else adjusted_span,
                    adjusted_term_id=body.adjusted_term_id,
                    reason=body.reason,
                    note=(body.note or "").strip() or None,
                    occurrence_refs=refs,
                    reviewer_user_id=viewer.user_id,
                    reviewer_pseudonym=viewer.pseudonym,
                    reviewer_independent=independent,
                    guideline_version=current_guideline_version(conn, pid),
                    created_at=now,
                )
                .returning(SingleTermDecisionRow.id)
            ).scalar_one()
            record_audit(
                conn,
                self.actor,
                "project.single_term_decision",
                target_type="project",
                target_id=key,
                project_id=pid,
                details={
                    "decision_id": decision_id,
                    "batch_id": batch_id,
                    "group_id": group.group_id,
                    "role": role,
                    "decision": body.decision,
                    "reason": body.reason,
                    "reviewer_independent": independent,
                },
                at=now,
            )
            row = (
                conn.execute(
                    select(SingleTermDecisionRow).where(
                        SingleTermDecisionRow.id == decision_id
                    )
                )
                .mappings()
                .one()
            )
            view = _decision_view(row)
            assert view is not None
            self._remember(
                conn,
                viewer,
                body.request_id,
                request_hash,
                {
                    "decision_id": view.decision_id,
                    **view.model_dump(mode="json", exclude={"decision_id"}),
                },
                now,
            )
            return view

    @staticmethod
    def _check_fields(body: SingleTermDecisionRequest) -> None:
        """One adjustment per decision, a reason only for a rejection."""
        problems = []
        if body.decision != "withdrawn" and body.phrase_only is None:
            problems.append("phrase_only is required")
        if body.decision == "withdrawn" and body.phrase_only is not None:
            problems.append("a withdrawal takes no phrase_only")
        if (body.decision == "reject") != (body.reason is not None):
            problems.append("a reason is given exactly for a rejection")
        if (body.decision == "adjust_span") != (body.adjusted_span is not None):
            problems.append("adjusted_span is given exactly for adjust_span")
        if (body.decision == "adjust_term") != (body.adjusted_term_id is not None):
            problems.append("adjusted_term_id is given exactly for adjust_term")
        if problems:
            raise DomainError("SINGLE_TERM_DECISION_INVALID", "; ".join(problems))

    @staticmethod
    def _check_span(
        span: SingleTermSpanRequest,
        group: CandidateGroup,
        data: BasisData,
        cues: Mapping[str, list[str]],
    ) -> dict[str, Any]:
        """A re-cut of one of the group's occurrences: in bounds, overlapping
        the occurrence and different from it, overlapping no other finding,
        without a negation cue. The stored text is the verbatim cut."""
        occurrence = next(
            (o for o in group.occurrences if occurrence_ref(o) == span.occurrence_ref),
            None,
        )
        if occurrence is None:
            raise DomainError(
                "SINGLE_TERM_SPAN_INVALID", "The occurrence is not one of the group."
            )
        source = data.sources[occurrence.submission_id]
        text = source.unit.document.text
        try:
            if span.end <= span.start:
                raise ValueError("empty span")
            validate_segments(text, [Segment(start=span.start, end=span.end)])
        except (ValueError, DomainError) as exc:
            raise DomainError("SINGLE_TERM_SPAN_INVALID", str(exc)) from exc
        cut = (span.start, span.end)
        original = (occurrence.start, occurrence.end)
        verbatim = text[span.start : span.end]
        if cut == original or not overlaps(cut, original) or not verbatim.strip():
            raise DomainError(
                "SINGLE_TERM_SPAN_INVALID",
                "A re-cut overlaps its occurrence and differs from it.",
            )
        if any(
            overlaps(cut, other)
            for other in other_finding_segments(source, occurrence.annotation_id)
        ):
            raise DomainError(
                "SINGLE_TERM_SPAN_OVERLAPS_FINDING",
                "The re-cut overlaps another finding of the text.",
            )
        if contains_negation(verbatim, group.language, negation_patterns(cues)):
            raise DomainError(
                "SINGLE_TERM_SPAN_NEGATED", "The re-cut holds a negation cue."
            )
        return {
            "occurrence_ref": span.occurrence_ref,
            "start": span.start,
            "end": span.end,
            "text": verbatim,
        }
