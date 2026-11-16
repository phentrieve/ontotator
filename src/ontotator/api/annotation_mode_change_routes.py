"""Lead-only annotation-mode changes after submitted work, and restores (#109)."""

from datetime import datetime
from typing import Any, Literal, Self

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontotator.api.identity import PrincipalDep
from ontotator.api.person_views import PersonRefView
from ontotator.api.routes import get_access
from ontotator.api.work_plan_routes import (
    MAX_CASE_ID_LENGTH,
    MAX_LANGUAGE_LENGTH,
    MAX_SELECTED_ROWS,
    RowRefView,
    require_one_selection,
)
from ontotator.application.annotation_mode_changes import AnnotationModeChangeService
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action, can
from ontotator.domain.annotation_modes import AnnotationMode
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.work_plans import RowKey

router = APIRouter(
    prefix="/api/v1/projects/{key}/annotation-mode-changes",
    tags=["annotation-mode-changes"],
)


class ModeChangeTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_id: str = Field(min_length=1, max_length=MAX_CASE_ID_LENGTH)
    language: str = Field(min_length=1, max_length=MAX_LANGUAGE_LENGTH)
    mode: AnnotationMode


class ModeChangeRequest(ModeChangeTarget):
    reason: str = Field(min_length=1, max_length=2000)
    # The case's plan revision the lead saw (WORK_PLAN_CHANGED otherwise).
    expected_revision: int
    # Exactly the submissions the preview listed (MODE_CHANGE_STALE otherwise).
    expected_submission_ids: list[str] = Field(max_length=10000)


class ModeRestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int


class DiscardedSubmissionView(BaseModel):
    submission_id: str
    document_id: str
    mode: str
    recorded_at: datetime
    author: PersonRefView


class RevokedAssignmentView(BaseModel):
    assignment_id: int
    document_id: str
    task: Literal["annotate", "review"]
    status: str
    person: PersonRefView


class ModeChangePreview(BaseModel):
    case_id: str
    language: str
    from_mode: AnnotationMode
    to_mode: AnnotationMode
    revision: int
    # Submitted work the change discards (kept, restorable).
    submissions: list[DiscardedSubmissionView]
    # Live annotate and review assignments the change revokes.
    assignments: list[RevokedAssignmentView]


class ModeChangeView(BaseModel):
    change_id: int
    case_id: str
    language: str
    from_mode: AnnotationMode
    to_mode: AnnotationMode
    reason: str
    changed_at: datetime
    changed_by: PersonRefView
    restored_at: datetime | None
    restored_by: PersonRefView | None
    revoked_assignment_ids: list[int]
    # The submissions still discarded by this change (empty once restored).
    submissions: list[DiscardedSubmissionView]
    restorable: bool
    # Why an unrestored change cannot be restored now (e.g. new work started).
    restore_blocked: str | None


class ModeChangeList(BaseModel):
    # The filters asked for; None lists the changes of every case or language.
    case_id: str | None
    language: str | None
    changes: list[ModeChangeView]


class ModeChangeResult(BaseModel):
    change: ModeChangeView
    revision: int


class BulkModeChangeRequest(BaseModel):
    """Change the annotation mode of the selected texts. ``reason`` is
    required to apply."""

    model_config = ConfigDict(extra="forbid")
    rows: list[RowRefView] = Field(min_length=1, max_length=MAX_SELECTED_ROWS)
    # The new mode; texts already annotated this way are skipped.
    mode: AnnotationMode
    reason: str | None = Field(default=None, max_length=2000)
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


class BulkModeSkippedView(BaseModel):
    case_id: str
    language: str
    # The single change's refusal: no_current_version, not_locked (no
    # annotation work fixes the mode), unchanged, no_proposals, final_result.
    reason: Literal[
        "no_current_version", "not_locked", "unchanged", "no_proposals", "final_result"
    ]
    message: str


class BulkModeChangeView(BaseModel):
    mode: AnnotationMode
    # False: a preview; True: every text in ``changes`` was changed.
    applied: bool
    # Selected texts found.
    texts: int
    change_count: int
    skipped_count: int
    skipped_by_reason: dict[str, int]
    # Submissions discarded and assignments revoked over all changed texts.
    submission_count: int
    assignment_count: int
    # Per text what a single change previews; empty with ``summary_only``.
    changes: list[ModeChangePreview]
    skipped: list[BulkModeSkippedView]
    preview_token: str


def _service(request: Request, key: str, principal: Any) -> AnnotationModeChangeService:
    access = get_access(request)
    if not can(access, Action.VIEW_PROJECT, key):
        raise DomainError("PROJECT_NOT_FOUND")
    if not can(access, Action.MANAGE_ASSIGNMENTS, key):
        raise AccessDenied("NOT_ALLOWED")
    return AnnotationModeChangeService(
        request.app.state.repo.db,
        Actor.user(principal.user_id, principal.username),
        access,
    )


@router.get("", response_model=ModeChangeList)
def list_mode_changes(
    key: str,
    principal: PrincipalDep,
    request: Request,
    case_id: str | None = Query(None, min_length=1, max_length=MAX_CASE_ID_LENGTH),
    language: str | None = Query(None, min_length=1, max_length=MAX_LANGUAGE_LENGTH),
) -> dict[str, Any]:
    """Mode changes, newest first: of one text, or of every text that matches
    the filters given (the whole project without filters)."""
    return _service(request, key, principal).list_changes(key, case_id, language)


@router.post("/preview", response_model=ModeChangePreview)
def preview_mode_change(
    key: str, body: ModeChangeTarget, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    return _service(request, key, principal).preview(
        key, body.case_id, body.language, body.mode
    )


@router.post("", response_model=ModeChangeResult)
def change_mode(
    key: str, body: ModeChangeRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    return _service(request, key, principal).change(
        key,
        body.case_id,
        body.language,
        body.mode,
        reason=body.reason,
        expected_revision=body.expected_revision,
        expected_submission_ids=body.expected_submission_ids,
    )


@router.post("/{change_id}/restore", response_model=ModeChangeResult)
def restore_mode_change(
    key: str,
    change_id: int,
    body: ModeRestoreRequest,
    principal: PrincipalDep,
    request: Request,
) -> dict[str, Any]:
    return _service(request, key, principal).restore(
        key, change_id, body.expected_revision
    )


@router.post("/bulk", response_model=BulkModeChangeView)
def bulk_change_mode(
    key: str, body: BulkModeChangeRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Change the annotation mode of many texts (issue 336, step 4).

    Each text is changed as ``POST annotation-mode-changes`` changes one: its
    live submissions are marked discarded, its live annotate and review
    assignments are revoked and the mode is stored. ``preview: true`` lists,
    per text, the submissions and assignments with their people, the texts
    left as they are with the reason (the single change's refusals; a text
    with a final result: withdraw it first) and a ``preview_token``. Applying
    sends that token and a ``reason``: every listed text changes, or none
    (409 ``PREVIEW_STALE`` with a fresh ``preview`` in the details when
    anything changed). Each text is audited like a single change
    (``annotation_mode.change``, ``via: bulk_change_mode``) and can be
    restored on its own (``.../{change_id}/restore``); there is no bulk undo.
    """
    return _service(request, key, principal).bulk(
        key,
        [RowKey(row.case_id, row.language) for row in body.rows],
        body.mode,
        reason=body.reason,
        preview=body.preview,
        preview_token=body.preview_token,
        summary_only=body.summary_only,
    )
