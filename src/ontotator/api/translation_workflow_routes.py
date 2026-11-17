"""Deliberate correction allocation and displayed source-obligation resolution."""

from datetime import date
from typing import Literal, Self

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontotator.api.assignment_routes import AssignmentView, _views
from ontotator.api.encoded_routes import EncodedParameterRoute
from ontotator.api.identity import PrincipalDep
from ontotator.api.routes import get_access
from ontotator.application.translation_reviews import TranslationReviewRecord
from ontotator.application.translation_workflow import TranslationWorkflowService
from ontotator.application.version_uploads import UploadMethod, VersionUploadService
from ontotator.auth.audit import Actor
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
