"""Explicit result selection and final export acknowledgements."""

from datetime import datetime
from typing import Any, Literal, Self

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontotator.api.bulk_task_action_routes import BulkUndoView
from ontotator.api.identity import PrincipalDep
from ontotator.api.person_views import PersonRefView
from ontotator.api.routes import get_access
from ontotator.api.work_plan_routes import (
    MAX_SELECTED_ROWS,
    RowRefView,
    require_one_selection,
)
from ontotator.application.final_results import FinalResultService
from ontotator.auth.audit import Actor
from ontotator.domain.errors import DomainError
from ontotator.domain.work_plans import RowKey
from ontotator.exchange.archive import expire_archive_files

router = APIRouter(prefix="/api/v1/projects/{key}", tags=["final-results"])


class FinalSelectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str
    submission_id: str
    expected_revision: int = Field(ge=0)
    acknowledged_cause_ids: list[str] = Field(default_factory=list)


class FinalSelectionView(BaseModel):
    case_id: str
    language: str
    document_id: str
    submission_id: str
    revision: int
    selected_at: datetime | None = None
    updated_at: datetime | None = None
    selected_by: str | None = None
    adjudicator_not_annotator: bool | None = None
    # Set when this choice replaced another final result of the text: send
    # its ``id`` to ``final-selections/bulk-change/undo`` to bring the
    # earlier one back (the Undo of the bulk "Change final…", for one text).
    undo: BulkUndoView | None = None


class FinalWithdrawalRequest(BaseModel):
    """Withdraw the final result of one text (#343)."""

    model_config = ConfigDict(extra="forbid")
    case_id: str
    language: str
    # The revision of the final result being withdrawn.
    expected_revision: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=2000)


class FinalWithdrawalView(BaseModel):
    case_id: str
    language: str
    # The withdrawn result.
    document_id: str
    submission_id: str
    # The withdrawal's revision; the text has no final result now.
    revision: int


class AcceptAgreeingRequest(BaseModel):
    """Preview (``preview``) or apply (``preview_token``) accepting every
    agreeing text (#354)."""

    model_config = ConfigDict(extra="forbid")
    preview: bool = False
    # The token of the preview being applied; required unless ``preview``.
    preview_token: str | None = Field(default=None, max_length=80)
    # Only these cases; None: every text of the project.
    case_ids: list[str] | None = Field(default=None, max_length=10000)
    # Only these texts (the Documents selection, issue 336); not together
    # with ``case_ids``.
    rows: list[RowRefView] | None = Field(
        default=None, min_length=1, max_length=MAX_SELECTED_ROWS
    )

    @model_validator(mode="after")
    def _token_to_apply(self) -> "AcceptAgreeingRequest":
        if not self.preview and self.preview_token is None:
            raise ValueError("Send preview: true, or the preview_token to apply.")
        if self.rows is not None:
            if self.case_ids is not None:
                raise ValueError("send case_ids or rows, not both")
            require_one_selection([], self.rows)
        return self


class AgreeingText(BaseModel):
    case_id: str
    language: str
    # The submission that becomes the final result.
    document_id: str
    submission_id: str
    findings: int | None = None


class AgreeingSkip(BaseModel):
    case_id: str
    language: str
    reason: Literal[
        "open_task",
        "not_ready",
        "not_in_plan",
        "fewer_than_two",
        "consolidation",
        "differ",
    ]
    message: str


class AcceptAgreeingView(BaseModel):
    project: str
    # False: a preview; True: every listed text has become final.
    applied: bool
    texts: list[AgreeingText]
    skipped: list[AgreeingSkip]
    # Texts that already have a final result: not changed (Change final…).
    already_final: int
    # With ``rows``: the selected texts that already have a final result.
    already_final_rows: list[RowRefView] = Field(default_factory=list)
    # Requested ``case_ids`` the project does not have.
    unknown_case_ids: list[str] = Field(default_factory=list)
    preview_token: str


class BulkChangeFinalRequest(BaseModel):
    """Preview (``preview``) or apply (``preview_token``) bulk Change final…
    for the selected texts (issue 336)."""

    model_config = ConfigDict(extra="forbid")
    rows: list[RowRefView] = Field(min_length=1, max_length=MAX_SELECTED_ROWS)
    # The rule that picks each text's new final result. "newest_submission":
    # the newest submission the final panel offers on the current version,
    # when it was submitted after the final result was chosen and is a
    # consolidation, the only submission, or agrees in full with the others.
    rule: Literal["newest_submission"] = "newest_submission"
    preview: bool = Field(default_factory=lambda: False)
    # With ``preview``: only the counts and the token, no lists.
    summary_only: bool = Field(default_factory=lambda: False)
    # The token of the preview being applied; required unless ``preview``.
    preview_token: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def _token_to_apply(self) -> Self:
        require_one_selection([], self.rows)
        if not self.preview and self.preview_token is None:
            raise ValueError("Send preview: true, or the preview_token to apply.")
        return self


class FinalChange(BaseModel):
    case_id: str
    language: str
    # The final result being replaced and its revision.
    expected_revision: int
    from_document_id: str
    from_submission_id: str
    from_version: int | None = None
    # The submission that becomes the final result.
    document_id: str
    submission_id: str
    version: int
    kind: Literal["annotation", "consolidation"]
    # Who submitted it.
    person: PersonRefView | None = None
    # Submissions the final panel offers on the text; above 1 for an
    # annotation: all of them agree in full.
    eligible_submissions: int


class FinalChangeSkip(BaseModel):
    case_id: str
    language: str
    reason: Literal[
        "no_final",
        "open_task",
        "nothing_submitted",
        "already_newest",
        "not_newer",
        "own_result",
        "differ",
    ]
    message: str


class BulkChangeFinalView(BaseModel):
    project: str
    rule: Literal["newest_submission"]
    # False: a preview; True: every text in ``changes`` has its new final.
    applied: bool
    # Selected texts found.
    texts: int
    # Selected texts the project does not have (another spelling, letter
    # case or language), as they were sent; also with ``summary_only``.
    unknown_rows: list[RowRefView] = Field(default_factory=list)
    # Counts of the lists below; the lists are empty with ``summary_only``.
    change_count: int
    skipped_count: int
    # reason -> number of skipped texts (also with ``summary_only``).
    skipped_by_reason: dict[str, int]
    changes: list[FinalChange]
    skipped: list[FinalChangeSkip]
    preview_token: str
    # After apply with changes: send its ``id`` to
    # ``final-selections/bulk-change/undo``. None for a preview or when
    # nothing changed.
    undo: BulkUndoView | None = None


class BulkChangeFinalUndoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # ``undo.id`` of the apply.
    undo_id: int = Field(ge=1)
    # True: only list what would be restored and what blocks the Undo.
    preview: bool = Field(default_factory=lambda: False)


class FinalRestore(BaseModel):
    case_id: str
    language: str
    # The final result the text gets back, as it was before the action.
    document_id: str
    submission_id: str
    version: int | None = None
    # The final result the action chose (the text's final result now).
    from_document_id: str
    from_submission_id: str
    from_version: int | None = None
    # Who had chosen the earlier final result, and when.
    selected_by: PersonRefView | None = None
    selected_at: datetime


class FinalRestoreBlock(BaseModel):
    case_id: str
    language: str
    # What changed since the action: the final result (``final``), the
    # text's versions (``versions``), its plan row (``plan``), a task
    # (``tasks``) or its submissions (``submissions``).
    reason: Literal["final", "versions", "plan", "tasks", "submissions"]
    message: str


class BulkChangeFinalUndoView(BaseModel):
    project: str
    undo_id: int
    # False: a preview; True: every text in ``restores`` has its earlier
    # final result again.
    applied: bool
    expires_at: datetime
    # Texts the action changed.
    texts: int
    restore_count: int
    blocked_count: int
    restores: list[FinalRestore]
    # Texts that changed since the action; one is enough to refuse the Undo.
    blocked: list[FinalRestoreBlock]
    # Final exports made since the action: they stay as they are and hold
    # the results the action chose.
    exports_since: int


class FinalWarning(BaseModel):
    id: str
    code: str
    cause_revision: int
    cause_id: str | None = None
    case_id: str
    language: str
    document_id: str | None = None
    report_id: str | None = None
    assignment_id: int | None = None
    reason: str
    destination: str


class FinalOmission(BaseModel):
    case_id: str
    language: str


class FinalPreflight(BaseModel):
    project: str
    selections: list[FinalSelectionView]
    warnings: list[FinalWarning]
    omissions: list[FinalOmission]
    state_digest: str
    # Rows with a final result and Annotate off: kept, not exported (information).
    not_in_plan: list[RowRefView] = Field(default_factory=list)
    # Texts taken out of the work plan that a final export names in
    # planned-out.csv (#338); not part of the state digest.
    planned_out_texts: int = 0


class WarningAcknowledgement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    cause_revision: int


class FinalExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=128)
    state_digest: str = Field(pattern="^[0-9a-f]{64}$")
    acknowledged_warnings: list[WarningAcknowledgement]
    accepted_omissions: list[FinalOmission]
    # The file of the final export: the T1 bundle with receipt, or
    # Phenopackets derived from the same frozen results (#308).
    format: Literal["t1", "phenopacket"] = "t1"


class AgreementValues(BaseModel):
    """F1 values (``modifier_agreement`` a share); None without anything to compare."""

    annotation_strict_f1: float | None
    annotation_tolerant_f1: float | None
    mention_strict_f1: float | None
    mention_tolerant_f1: float | None
    term_f1: float | None
    modifier_agreement: float | None


class AgreementCounts(BaseModel):
    findings_a: int
    findings_b: int
    equal: int
    compatible: int
    axis_conflicts: int
    term_conflicts: int
    a_only: int
    b_only: int
    mentions_a: int
    mentions_b: int
    mentions_equal: int
    mentions_compatible: int
    terms_a: int
    terms_b: int
    terms_equal: int
    modifiers_compared: int
    modifiers_agreeing: int
    # Of term_conflicts: the terms are ancestor and descendant (#303).
    related_term_conflicts: int


class AgreementMacroMean(AgreementValues):
    """Mean over texts of each text's mean over its pairs."""

    texts: int
    pairs: int


class AgreementPooled(AgreementCounts, AgreementValues):
    """F1 of the counts summed over every pair (micro average)."""

    texts: int
    pairs: int


class AgreementSummary(BaseModel):
    macro_mean: AgreementMacroMean
    pooled: AgreementPooled


class AnnotatorPairAgreement(AgreementSummary):
    """Every text the two people both annotated."""

    pseudonym_a: str
    pseudonym_b: str


class TextAgreement(AgreementSummary):
    """Every pair of annotators of one text."""

    case_id: str
    language: str
    document_id: str
    text_version: str


class PairAgreement(AgreementCounts, AgreementValues):
    """Two people's annotations of one text: a row of agreement.csv."""

    case_id: str
    language: str
    document_id: str
    text_version: str
    submission_a: str
    pseudonym_a: str
    submission_b: str
    pseudonym_b: str


class ProjectAgreement(BaseModel):
    """The agreement a final export would write now (agreement.csv and
    agreement-summary.csv), for the texts with a final result."""

    project: str
    # The preflight's digest: the same selection as a final export with it.
    state_digest: str
    selected_texts: int
    summary: AgreementSummary
    annotator_pairs: list[AnnotatorPairAgreement]
    texts: list[TextAgreement]
    pairs: list[PairAgreement]


def _service(request: Request, principal: Any) -> FinalResultService:
    return FinalResultService(
        request.app.state.repo.db,
        Actor.user(principal.user_id, principal.username),
        get_access(request),
    )


@router.put("/final-selections", response_model=FinalSelectionView)
def select_final(
    key: str, body: FinalSelectionRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Choose, confirm again or replace the final result of one text.

    A choice that replaces another final result returns ``undo`` (``id``,
    ``expires_at``), the handle of ``final-selections/bulk-change/undo``:
    the lead who made the change can take it back once, within 60 minutes
    and while nothing the final result rests on changed since. A first
    choice and a result confirmed again have no Undo (``undo`` is null).
    """
    return _service(request, principal).select(
        key,
        body.document_id,
        body.submission_id,
        body.expected_revision,
        body.acknowledged_cause_ids,
    )


@router.post("/final-selections/withdraw", response_model=FinalWithdrawalView)
def withdraw_final(
    key: str, body: FinalWithdrawalRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Withdraw a text's final result, with a reason (#343).

    The text has no final result until a lead chooses one again; submissions,
    consolidations and final exports already made stay. 409
    ``REVISION_CONFLICT`` when the final changed since ``expected_revision``.
    """
    return _service(request, principal).withdraw(
        key, body.case_id, body.language, body.expected_revision, body.reason
    )


@router.post("/final-selections/accept-agreeing", response_model=AcceptAgreeingView)
def accept_agreeing(
    key: str, body: AcceptAgreeingRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Accept the result of every text whose annotations agree in full (#354).

    ``preview: true`` lists the texts that would become final, every other
    text without a final result with the reason it is left out, and a
    ``preview_token``; unknown ``case_ids`` are named. Applying sends that token: all
    listed texts become final, or none (409 ``PREVIEW_STALE`` with a fresh
    ``preview`` in the details when anything changed). Texts that already
    have a final result are only counted.
    """
    return _service(request, principal).accept_agreeing(
        key,
        preview=body.preview,
        preview_token=body.preview_token,
        case_ids=body.case_ids,
        rows=None
        if body.rows is None
        else [RowKey(row.case_id, row.language) for row in body.rows],
    )


@router.post("/final-selections/bulk-change", response_model=BulkChangeFinalView)
def bulk_change_final(
    key: str, body: BulkChangeFinalRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Change the final result of many texts by a rule (issue 336).

    Rule ``newest_submission``: each selected text that has a final result
    gets its newest submission instead (of the submissions the final panel
    offers on the current version), when that one was submitted after the
    final result was chosen and is a consolidation, the text's only
    submission, or an annotation that agrees in full with the text's other
    submissions (the rule of ``accept-agreeing``). ``preview: true`` lists
    the texts that would change, with the result each one gets, the texts
    skipped and why (no final result, open work, nothing submitted, already
    the newest, nothing submitted since the final was chosen, your own
    result where the project forbids it, submissions that differ), the
    selected texts the project does not have (``unknown_rows``) and a
    ``preview_token``.
    Applying sends that token: every listed text changes, or none (409
    ``PREVIEW_STALE`` with a fresh ``preview`` in the details when anything
    changed, also a final result changed meanwhile). Each text is audited
    like a single change (``via: bulk_change_final``). An applied action
    returns ``undo``; ``final-selections/bulk-change/undo`` takes its ``id``.
    """
    return _service(request, principal).change_finals(
        key,
        [RowKey(row.case_id, row.language) for row in body.rows],
        preview=body.preview,
        preview_token=body.preview_token,
        summary_only=body.summary_only,
    )


@router.post(
    "/final-selections/bulk-change/undo", response_model=BulkChangeFinalUndoView
)
def undo_bulk_change_final(
    key: str,
    body: BulkChangeFinalUndoRequest,
    principal: PrincipalDep,
    request: Request,
) -> dict[str, Any]:
    """Undo a bulk Change final… by the ``undo.id`` of its apply.

    The server keeps the final result each text had; the request names only
    that record. It works once, for the lead who applied the action, before
    ``undo.expires_at`` (otherwise 409 ``BULK_UNDO_STALE`` with ``reason``
    ``not_found``, ``already_undone`` or ``expired``). ``preview: true``
    lists the final result each text would get back (``restores``) and the
    texts that changed since the action, with the reason (``blocked``): the
    final result, the text's versions, its plan row, a task of the text or
    its submissions. Applying restores every text, or none: with a blocked
    text it answers 409 ``BULK_UNDO_STALE`` (``reason`` ``changed``) with
    that ``preview`` in the details. Final exports made since the action do
    not block; they stay as they are and ``exports_since`` counts them. Each
    text is audited like a single change (``via: bulk_change_final_undo``).
    """
    try:
        return _service(request, principal).undo_change_finals(
            key, body.undo_id, preview=body.preview
        )
    except DomainError as refusal:
        details = refusal.details
        # Only the stale undo carries a preview (reason ``changed``).
        if (
            refusal.code != "BULK_UNDO_STALE"
            or not isinstance(details, dict)
            or "preview" not in details
        ):
            raise
        # The refused preview reads like the answer to ``preview: true``.
        shown = BulkChangeFinalUndoView.model_validate(details["preview"])
        raise DomainError(
            "BULK_UNDO_STALE", details | {"preview": shown.model_dump(mode="json")}
        ) from None


@router.get("/workflow-warnings", response_model=FinalPreflight)
@router.post("/exports/final/preflight", response_model=FinalPreflight)
def final_preflight(
    key: str, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    return _service(request, principal).preflight(key)


@router.get("/agreement", response_model=ProjectAgreement)
def project_agreement(
    key: str, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Agreement of the annotations behind the final results, project-wide."""
    return _service(request, principal).agreement(key)


@router.post("/exports/final")
def final_export(
    key: str, body: FinalExportRequest, principal: PrincipalDep, request: Request
) -> dict[str, int]:
    # A T1 request is stored without ``format``, as before #308, so that a
    # replayed older request matches its stored one.
    exclude = {"format"} if body.format == "t1" else None
    # Exports past their retention go first (#396).
    expire_archive_files(request.app.state.repo.db)
    return _service(request, principal).freeze(
        key, body.model_dump(mode="json", exclude=exclude)
    )
