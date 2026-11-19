"""Deliberate correction allocation and displayed source-obligation resolution."""

from datetime import date, datetime
from typing import Literal, Self

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontotator.api.assignment_routes import AssignmentView, _views
from ontotator.api.encoded_routes import EncodedParameterRoute
from ontotator.api.identity import PrincipalDep
from ontotator.api.routes import get_access
from ontotator.application.editorial_corrections import EditorialCorrectionService
from ontotator.application.query_decisions import (
    QueryDecisionKind,
    QueryDecisionService,
)
from ontotator.application.translation_reviews import TranslationReviewRecord
from ontotator.application.translation_workflow import TranslationWorkflowService
from ontotator.application.version_uploads import UploadMethod, VersionUploadService
from ontotator.auth.audit import Actor
from ontotator.domain.translation_review import ClinicalCategory
from ontotator.domain.work_rounds import SourceReviewObligation

router = APIRouter(
    prefix="/api/v1", tags=["translation-workflow"], route_class=EncodedParameterRoute
)


class CorrectionAssignmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    expected_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    reason: str = Field(min_length=1)
    confirm_language: bool = False


class CorrectionReasonAdditionRequest(BaseModel):
    """Issue 483: what the lead adds to the reason of a correction request."""

    model_config = ConfigDict(extra="forbid")
    note: str = Field(min_length=1, max_length=2000)


class CorrectionReasonAdditionView(BaseModel):
    """One addition to the reason of a correction request, as saved."""

    assignment_id: int
    note: str
    added_at: datetime


class LeadCorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    confirm_language: bool = False


class LeadCorrectionAnnotationsView(BaseModel):
    submitted: int
    open: int


class LeadCorrectionPreview(BaseModel):
    """What "Correct the translation…" would start (issue 341 b)."""

    document_id: str
    version: int
    next_version: int
    translation_status: str | None
    available: bool
    reason: str | None
    reviewed_again: bool
    review_on: bool
    annotate_accepted_only: bool
    annotations: LeadCorrectionAnnotationsView
    open_consolidations: int
    final_result: bool


# A text of this size is far beyond any case report; it bounds the request.
MAX_VERSION_TEXT = 1_000_000


class VersionUploadPreviewRequest(BaseModel):
    """Issue 341 a: the text to check before "Upload new version…" saves it."""

    model_config = ConfigDict(extra="forbid")
    text: str | None = Field(default=None, max_length=MAX_VERSION_TEXT)


class VersionUploadPreview(BaseModel):
    """What uploading a new version after this one would do (read only)."""

    document_id: str
    case_id: str
    language: str
    version: int
    next_version: int
    translation_status: str | None
    # The hash of this version's text, which the upload names.
    text_sha256: str
    available: bool
    # not_newest, discarded, review_open, or unchanged (the text sent equals
    # this version's text).
    reason: str | None
    review_on: bool
    annotate_accepted_only: bool
    annotations: LeadCorrectionAnnotationsView
    open_consolidations: int
    final_result: bool
    # With a text: the text as it would be stored, this version's text to
    # compare it with, and whether both are the same.
    text: str | None
    previous_text: str | None
    unchanged: bool | None


class VersionUploadRequest(BaseModel):
    """Issue 341 a: a text made elsewhere as the next version of a translation."""

    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=MAX_VERSION_TEXT)
    # The text hash of the version this one follows (from the preview).
    expected_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    # How the text was made; the version is a correction in every case.
    method: UploadMethod
    # Required for a machine translation.
    provider: str | None = Field(default=None, max_length=200)
    model: str | None = Field(default=None, max_length=200)
    made_on: date | None = None
    made_by: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _provider(self) -> Self:
        if self.method == "machine_translation" and not (self.provider or "").strip():
            raise ValueError("A machine translation names its provider.")
        return self


class VersionUploadResult(BaseModel):
    case_id: str
    language: str
    document_id: str
    version: int
    previous_document_id: str
    previous_version: int
    translation_status: Literal["ready_for_review"]
    text_sha256: str


class EditorialReplacement(BaseModel):
    """One passage of the text and what replaces it."""

    model_config = ConfigDict(extra="forbid")
    # Must occur exactly once in the text of the corrected version.
    old: str = Field(min_length=1, max_length=2000)
    new: str = Field(max_length=2000)


class _EditorialText(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Either the whole corrected text or the replacements that make it.
    text: str | None = Field(default=None, min_length=1, max_length=MAX_VERSION_TEXT)
    replacements: list[EditorialReplacement] | None = Field(
        default=None, min_length=1, max_length=200
    )


class EditorialCorrectionPreviewRequest(_EditorialText):
    """Issue 453: the correction to check before it is saved (both fields
    left out: only whether a correction is possible)."""

    @model_validator(mode="after")
    def _one_form(self) -> Self:
        if self.text is not None and self.replacements is not None:
            raise ValueError("Give either the text or replacements, not both.")
        return self


class EditorialCorrectionRequest(_EditorialText):
    """Issue 453: an editorial correction of a translation version."""

    # The text hash of the corrected version (from the preview).
    expected_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    reason: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def _one_form(self) -> Self:
        if (self.text is None) == (self.replacements is None):
            raise ValueError("Give either the text or replacements.")
        if not self.reason.strip():
            raise ValueError("An editorial correction names its reason.")
        return self


class EditorialChange(BaseModel):
    """A changed passage, in Unicode code points of the old and the new text."""

    old_start: int
    old_end: int
    new_start: int
    new_end: int
    old_text: str
    new_text: str


class EditorialNumberChange(BaseModel):
    """A number the correction changes, adds (no ``old``) or removes (no ``new``)."""

    old: str | None
    new: str | None


class EditorialFindings(BaseModel):
    # Findings of the submitted annotations on the corrected version, and
    # how many of them the text-change steps cannot place on the new text.
    submitted: int
    needs_check: int


class EditorialProposals(BaseModel):
    # Tool proposal sets on the corrected version, the proposals that are
    # carried to the new text and the ones left for a check.
    sets: int
    carried: int
    needs_check: int


class EditorialCorrectionPreview(BaseModel):
    """What an editorial correction of this version would do (read only)."""

    document_id: str
    case_id: str
    language: str
    version: int
    next_version: int
    # The status the new version gets: the one of this version.
    translation_status: str | None
    # The hash of this version's text, which the correction names.
    text_sha256: str
    available: bool
    # not_newest, discarded, review_open, and with a text or replacements
    # that change nothing: unchanged.
    reason: str | None
    review_on: bool
    annotate_accepted_only: bool
    annotations: LeadCorrectionAnnotationsView
    open_consolidations: int
    final_result: bool
    # Annotation tasks nobody opened: they move to the new version.
    tasks_following: int
    # With a text or replacements only.
    text: str | None
    previous_text: str | None
    new_text_sha256: str | None
    inserted_characters: int | None
    deleted_characters: int | None
    changed_characters: int | None
    # The numbers the correction changes (a notice; nothing is refused).
    number_changes: list[EditorialNumberChange] | None
    diff: list[EditorialChange] | None
    findings: EditorialFindings | None
    proposals: EditorialProposals | None


class EditorialCorrectionResult(BaseModel):
    case_id: str
    language: str
    document_id: str
    version: int
    previous_document_id: str
    previous_version: int
    translation_status: str | None
    text_sha256: str
    inserted_characters: int
    deleted_characters: int
    tasks_following: int


class QueriedReviewView(BaseModel):
    """The translation review submitted as a query that the lead decides."""

    id: int
    assignment_id: int
    # The version the reviewer read (the decided version, or the version a
    # typo fix was made of).
    document_id: str
    version: int
    rationale: str | None
    categories: list[ClinicalCategory]
    # The text the reviewer proposed with the query.
    proposed_text: str
    created_at: datetime


class QueryDecisionPreview(BaseModel):
    """Issue 483, read only: the query a lead decides at this version."""

    document_id: str
    case_id: str
    language: str
    version: int
    next_version: int
    translation_status: str | None
    # The hash of this version's text, which the decision names.
    text_sha256: str
    # This version's text, to compare the reviewer's text with.
    text: str
    available: bool
    # already_decided, discarded, not_newest, review_open, not_a_query.
    reason: str | None
    review: QueriedReviewView | None
    # The reviewer's text differs from this version's text.
    proposes_changes: bool
    review_on: bool
    annotate_accepted_only: bool
    annotations: LeadCorrectionAnnotationsView
    open_consolidations: int
    final_result: bool


class QueryDecisionRequest(BaseModel):
    """Issue 483: the lead's decision on a queried translation review.

    ``reviewer_text``: ``text`` (the reviewer's proposed text, as the lead
    confirmed it) becomes the next version, accepted. ``unchanged``: the
    version is accepted as it is, and ``answer`` is required.
    """

    model_config = ConfigDict(extra="forbid")
    kind: QueryDecisionKind
    # The text hash of the decided version and the id of the querying review
    # (both from the preview).
    expected_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    expected_review_id: int = Field(gt=0)
    text: str | None = Field(default=None, min_length=1, max_length=MAX_VERSION_TEXT)
    # What the reviewer reads at their submitted task.
    answer: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _fields(self) -> Self:
        if (self.kind == "reviewer_text") != (self.text is not None):
            raise ValueError("Give the text with reviewer_text, and only then.")
        if self.kind == "unchanged" and not (self.answer or "").strip():
            raise ValueError("Accepting the version as it is needs an answer.")
        return self


class QueryDecisionResult(BaseModel):
    case_id: str
    language: str
    kind: QueryDecisionKind
    # The accepted version: the new one, or the decided version itself.
    document_id: str
    version: int
    decided_document_id: str
    decided_version: int
    translation_status: Literal["accepted"]
    text_sha256: str
    # The lead changed the reviewer's text before saving it.
    edited: bool


class SourceObligationView(SourceReviewObligation):
    old_source_text: str
    new_source_text: str


class ResolveSourceObligationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    translation_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    old_source_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    new_source_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


def _service(request: Request) -> TranslationWorkflowService:
    return TranslationWorkflowService(request.app.state.repo.db, request.app.state.jobs)


@router.post("/projects/{key}/documents/{doc:path}/translation-correction-assignment")
def assign_correction(
    key: str,
    doc: str,
    body: CorrectionAssignmentRequest,
    request: Request,
    principal: PrincipalDep,
) -> AssignmentView:
    row = _service(request).assign_correction(
        Actor.user(principal.user_id, principal.username), key, doc, **body.model_dump()
    )
    return _views(request, [row])[0]


@router.post("/assignments/{assignment_id}/correction-reason")
def add_correction_reason(
    assignment_id: int,
    body: CorrectionReasonAdditionRequest,
    request: Request,
    principal: PrincipalDep,
) -> CorrectionReasonAdditionView:
    """Issue 483: the lead adds to the reason of "Ask a reviewer to correct…"
    while the review is open. Append-only: the reason as sent never changes."""
    return CorrectionReasonAdditionView.model_validate(
        _service(request).add_correction_reason(
            Actor.user(principal.user_id, principal.username),
            assignment_id,
            body.note,
        )
    )


@router.post("/projects/{key}/documents/{doc:path}/lead-correction")
def start_lead_correction(
    key: str,
    doc: str,
    body: LeadCorrectionRequest,
    request: Request,
    principal: PrincipalDep,
) -> AssignmentView:
    """F1: the lead reviews a rejected, queried or accepted version themselves."""
    row = _service(request).start_lead_correction(
        Actor.user(principal.user_id, principal.username), key, doc, **body.model_dump()
    )
    return _views(request, [row])[0]


@router.get("/projects/{key}/documents/{doc:path}/lead-correction")
def preview_lead_correction(
    key: str, doc: str, request: Request, principal: PrincipalDep
) -> LeadCorrectionPreview:
    """Issue 341 b: availability and the annotation work that stays on the version."""
    return LeadCorrectionPreview.model_validate(
        _service(request).lead_correction_preview(
            Actor.user(principal.user_id, principal.username), key, doc
        )
    )


def _uploads(request: Request) -> VersionUploadService:
    return VersionUploadService(request.app.state.repo.db, request.app.state.jobs)


@router.post("/projects/{key}/variants/{document_id:path}/versions/preview")
def preview_version_upload(
    key: str,
    document_id: str,
    body: VersionUploadPreviewRequest,
    request: Request,
    principal: PrincipalDep,
) -> VersionUploadPreview:
    """Issue 341 a, read only: whether a new version can follow this one, the
    work that stays on it and, with a text, the text as it would be stored."""
    return VersionUploadPreview.model_validate(
        _uploads(request).preview(
            Actor.user(principal.user_id, principal.username),
            key,
            document_id,
            text=body.text,
        )
    )


@router.post("/projects/{key}/variants/{document_id:path}/versions")
def upload_version(
    key: str,
    document_id: str,
    body: VersionUploadRequest,
    request: Request,
    principal: PrincipalDep,
) -> VersionUploadResult:
    """Issue 341 a: save a text as the next version of this translation: a
    correction of this version, ready for review, with Review on."""
    return VersionUploadResult.model_validate(
        _uploads(request).upload(
            Actor.user(principal.user_id, principal.username),
            key,
            document_id,
            **body.model_dump(),
        )
    )


def _editorial(request: Request) -> EditorialCorrectionService:
    return EditorialCorrectionService(request.app.state.repo.db, request.app.state.jobs)


@router.post("/projects/{key}/documents/{doc:path}/editorial-correction/preview")
def preview_editorial_correction(
    key: str,
    doc: str,
    body: EditorialCorrectionPreviewRequest,
    request: Request,
    principal: PrincipalDep,
) -> EditorialCorrectionPreview:
    """Issue 453, read only: whether this version can be corrected and, with
    a text or replacements, the changes, the guards and what follows."""
    return EditorialCorrectionPreview.model_validate(
        _editorial(request).preview(
            Actor.user(principal.user_id, principal.username),
            key,
            doc,
            **body.model_dump(),
        )
    )


@router.post("/projects/{key}/documents/{doc:path}/editorial-correction")
def editorial_correction(
    key: str,
    doc: str,
    body: EditorialCorrectionRequest,
    request: Request,
    principal: PrincipalDep,
) -> EditorialCorrectionResult:
    """Issue 453: save an editorial fix (spacing, typos, grammar) as the next
    version of this translation, with this version's status."""
    return EditorialCorrectionResult.model_validate(
        _editorial(request).correct(
            Actor.user(principal.user_id, principal.username),
            key,
            doc,
            **body.model_dump(),
        )
    )


def _query_decisions(request: Request) -> QueryDecisionService:
    return QueryDecisionService(request.app.state.repo.db, request.app.state.jobs)


@router.get("/projects/{key}/documents/{doc:path}/query-decision")
def preview_query_decision(
    key: str, doc: str, request: Request, principal: PrincipalDep
) -> QueryDecisionPreview:
    """Issue 483, read only: the queried review of this version with the
    reviewer's proposed text, this version's text and whether a lead can
    decide the query."""
    return QueryDecisionPreview.model_validate(
        _query_decisions(request).preview(
            Actor.user(principal.user_id, principal.username), key, doc
        )
    )


@router.post("/projects/{key}/documents/{doc:path}/query-decision")
def decide_query(
    key: str,
    doc: str,
    body: QueryDecisionRequest,
    request: Request,
    principal: PrincipalDep,
) -> QueryDecisionResult:
    """Issue 483: close a queried translation review as the lead: take the
    reviewer's text as the next version, accepted, or accept this version as
    it is; with an answer the reviewer reads at their submitted task."""
    return QueryDecisionResult.model_validate(
        _query_decisions(request).decide(
            Actor.user(principal.user_id, principal.username),
            key,
            doc,
            **body.model_dump(),
        )
    )


@router.get("/translation-reviews/{assignment_id}/source-obligations")
def obligations(
    assignment_id: int, request: Request, principal: PrincipalDep
) -> list[SourceObligationView]:
    return [
        SourceObligationView.model_validate(item)
        for item in _service(request).obligations(get_access(request), assignment_id)
    ]


@router.post(
    "/translation-reviews/{assignment_id}/source-obligations/{cause_id}/resolve"
)
def resolve(
    assignment_id: int,
    cause_id: str,
    body: ResolveSourceObligationRequest,
    request: Request,
    principal: PrincipalDep,
) -> TranslationReviewRecord:
    return _service(request).resolve(
        get_access(request), assignment_id, cause_id, **body.model_dump()
    )
