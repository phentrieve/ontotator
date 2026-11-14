"""Explicit result selection and final export acknowledgements."""

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontotator.api.identity import PrincipalDep
from ontotator.api.routes import get_access
from ontotator.api.work_plan_routes import RowRefView
from ontotator.application.final_results import FinalResultService
from ontotator.auth.audit import Actor
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

    @model_validator(mode="after")
    def _token_to_apply(self) -> "AcceptAgreeingRequest":
        if not self.preview and self.preview_token is None:
            raise ValueError("Send preview: true, or the preview_token to apply.")
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
    reason: Literal["open_task", "fewer_than_two", "consolidation", "differ"]
    message: str


class AcceptAgreeingView(BaseModel):
    project: str
    # False: a preview; True: every listed text has become final.
    applied: bool
    texts: list[AgreeingText]
    skipped: list[AgreeingSkip]
    # Texts that already have a final result: not changed (Change final…).
    already_final: int
    preview_token: str


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

    ``preview: true`` lists the texts that would become final, the texts left
    out and why, and a ``preview_token``. Applying sends that token: all
    listed texts become final, or none (409 ``PREVIEW_STALE`` with a fresh
    ``preview`` in the details when anything changed). Texts that already
    have a final result are only counted.
    """
    return _service(request, principal).accept_agreeing(
        key,
        preview=body.preview,
        preview_token=body.preview_token,
        case_ids=body.case_ids,
    )


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
