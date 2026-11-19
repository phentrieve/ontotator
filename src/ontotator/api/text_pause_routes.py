"""Lead pause: pause and release the work on the selected texts (issue 464)."""

from datetime import datetime
from typing import Any, Literal, Self

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontotator.api.identity import PrincipalDep
from ontotator.api.person_views import MemberRefView
from ontotator.api.routes import get_access
from ontotator.api.work_plan_routes import (
    MAX_SELECTED_ROWS,
    RowRefView,
    require_one_selection,
)
from ontotator.application.text_pauses import TextPauseAction, TextPauseService
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action, Task, can
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.work_plans import RowKey

router = APIRouter(prefix="/api/v1/projects/{key}", tags=["text-pauses"])


class TextPauseRequest(BaseModel):
    """Pause or release the selected texts. ``reason`` is required to apply a
    pause (the people see it in My tasks and in the task) and optional for a
    release."""

    model_config = ConfigDict(extra="forbid")
    rows: list[RowRefView] = Field(min_length=1, max_length=MAX_SELECTED_ROWS)
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


class TextPauseInfoView(BaseModel):
    reason: str
    # None: paused through an API token or by an account since erased.
    paused_by: MemberRefView | None = None
    paused_at: datetime


class PausedTaskView(BaseModel):
    """A task in progress on the text: what a pause stops and a release opens."""

    assignment_id: int
    document_id: str
    version: int
    task: Task
    status: Literal["open", "in_progress", "reopened"]
    person: MemberRefView
    # A problem report pauses the task as well: after a release it stays
    # paused until that report is decided.
    paused_by_report: bool


class TextPauseChangeView(BaseModel):
    case_id: str
    language: str
    # Release: the pause that ends. Pause: null.
    pause: TextPauseInfoView | None = None
    # The text's tasks in progress (none: only later tasks are affected).
    tasks: list[PausedTaskView]


class TextPauseSkippedView(BaseModel):
    case_id: str
    language: str
    reason: Literal["already_paused", "not_paused"]
    message: str
    # ``already_paused``: the pause in place.
    pause: TextPauseInfoView | None = None


class TextPauseActionView(BaseModel):
    action: TextPauseAction
    # False: a preview; True: every text in ``changes`` was changed.
    applied: bool
    # Selected texts found.
    texts: int
    # Selected texts the project does not have (another spelling, letter
    # case or language), as they were sent; also with ``summary_only``.
    unknown_rows: list[RowRefView] = Field(default_factory=list)
    # Counts; the lists are empty with ``summary_only``.
    change_count: int
    skipped_count: int
    # Tasks in progress on the texts in ``changes``.
    task_count: int
    # Release: of those, the tasks a problem report still pauses.
    still_paused_count: int
    changes: list[TextPauseChangeView]
    skipped: list[TextPauseSkippedView]
    preview_token: str


def _run(
    request: Request,
    key: str,
    principal: Any,
    body: TextPauseRequest,
    action: TextPauseAction,
) -> dict[str, Any]:
    access = get_access(request)
    if not can(access, Action.VIEW_PROJECT, key):
        raise DomainError("PROJECT_NOT_FOUND")
    if not can(access, Action.MANAGE_ASSIGNMENTS, key):
        raise AccessDenied("NOT_ALLOWED")
    service = TextPauseService(
        request.app.state.repo.db, Actor.user(principal.user_id, principal.username)
    )
    return service.run(
        key,
        [RowKey(row.case_id, row.language) for row in body.rows],
        action,
        reason=body.reason,
        preview=body.preview,
        preview_token=body.preview_token,
        summary_only=body.summary_only,
    )


@router.post("/text-pauses/pause", response_model=TextPauseActionView)
def pause_texts(
    key: str, body: TextPauseRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Pause the work on many texts (issue 464).

    A paused text keeps its tasks: the people see them in My tasks, marked
    "Paused by lead" with the ``reason``, and can read them, but no task in
    progress can be saved (409 ``TASK_HELD`` with ``causes: ["lead"]``):
    annotation, translation review and consolidation, on every version of
    the text. A task assigned, reopened or given a new round later is paused
    from the start. Submitted work and final results are untouched and
    exported as before. The pause from a problem report is a separate cause
    and stays as it is.

    ``preview: true`` lists the texts that would be paused with their tasks
    in progress, the texts skipped (already paused) and a ``preview_token``.
    Applying sends that token and a ``reason``: every listed text is paused,
    or none (409 ``PREVIEW_STALE`` with a fresh ``preview`` in the details
    when anything changed). Each text is audited (``text.pause``, ``via:
    bulk_pause_texts``). The way back is ``text-pauses/release``.
    """
    return _run(request, key, principal, body, "pause")


@router.post("/text-pauses/release", response_model=TextPauseActionView)
def release_texts(
    key: str, body: TextPauseRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Release paused texts (issue 464).

    Ends the lead pause of the selected texts: their tasks in progress can
    be saved again. A task that a problem report pauses as well stays paused
    until that report is decided (``paused_by_report``,
    ``still_paused_count``); deciding a report never releases the lead
    pause. Texts that are not paused are skipped. Preview and apply as
    ``text-pauses/pause``; ``reason`` is optional. Each text is audited
    (``text.release``, ``via: bulk_release_texts``).
    """
    return _run(request, key, principal, body, "release")
