"""Bulk lead actions on the tasks of the selected texts (issue 336, step 1)."""

from typing import Any, Literal, Self

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontotator.api.identity import PrincipalDep
from ontotator.api.person_views import PersonRefView
from ontotator.api.routes import get_access
from ontotator.api.work_plan_routes import (
    MAX_SELECTED_ROWS,
    RowRefView,
    require_one_selection,
)
from ontotator.application.bulk_task_actions import (
    BulkAction,
    BulkTaskActionService,
    Options,
)
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action, Task, can
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.work_plans import RowKey

router = APIRouter(prefix="/api/v1/projects/{key}", tags=["bulk-task-actions"])


def _annotations() -> list[Task]:
    return ["annotate"]


class _BulkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[RowRefView] = Field(min_length=1, max_length=MAX_SELECTED_ROWS)
    # Which tasks of the texts; default: annotations.
    tasks: list[Task] = Field(default_factory=_annotations, min_length=1)
    preview: bool = Field(default_factory=lambda: False)
    # The token of the preview being applied; required unless ``preview``.
    preview_token: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def _token_to_apply(self) -> Self:
        require_one_selection([], self.rows)
        if not self.preview and self.preview_token is None:
            raise ValueError("Send preview: true, or the preview_token to apply.")
        return self


class BulkReopenRequest(_BulkRequest):
    """Reopen the submitted tasks of the selected texts. ``reason`` is
    required to apply; the people see it in My tasks."""

    reason: str | None = Field(default=None, max_length=2000)


class BulkWithdrawRequest(_BulkRequest):
    """Withdraw the open tasks of the selected texts; drafts stay."""

    reason: str | None = Field(default=None, max_length=2000)
    # Also tasks in progress or reopened; default: only tasks not started.
    include_started: bool = Field(default_factory=lambda: False)
    # Only annotations above "annotators per text" of their version (#339 b).
    over_limit_only: bool = Field(default_factory=lambda: False)


class BulkTaskView(BaseModel):
    case_id: str
    language: str
    assignment_id: int
    document_id: str
    version: int
    task: Task
    status: Literal["open", "in_progress", "submitted", "reopened"]
    person: PersonRefView


class BulkKeptTaskView(BulkTaskView):
    # not_submitted, lead_correction, discarded, lead_correction_open,
    # person_unavailable (reopen); submitted, started, paused, within_limit,
    # lead_correction_task (withdraw).
    reason: str
    message: str


class BulkSkippedTextView(BaseModel):
    case_id: str
    language: str
    reason: Literal["final_chosen"]
    message: str


class BulkUndoView(BaseModel):
    action: BulkAction
    assignment_ids: list[int]
    token: str


class BulkTaskActionView(BaseModel):
    action: BulkAction
    # False: a preview; True: every task in ``changes`` was changed.
    applied: bool
    # Selected texts found.
    texts: int
    changes: list[BulkTaskView]
    kept: list[BulkKeptTaskView]
    skipped: list[BulkSkippedTextView]
    preview_token: str
    # After apply with changes: send it to ``bulk-task-actions/undo``.
    undo: BulkUndoView | None = None


class BulkUndoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: BulkAction
    assignment_ids: list[int] = Field(min_length=1, max_length=MAX_SELECTED_ROWS)
    token: str = Field(max_length=80)


class BulkUndoResult(BaseModel):
    undone: int


def _service(request: Request, key: str, principal: Any) -> BulkTaskActionService:
    access = get_access(request)
    if not can(access, Action.VIEW_PROJECT, key):
        raise DomainError("PROJECT_NOT_FOUND")
    if not can(access, Action.MANAGE_ASSIGNMENTS, key):
        raise AccessDenied("NOT_ALLOWED")
    return BulkTaskActionService(
        request.app.state.repo.db, Actor.user(principal.user_id, principal.username)
    )


def _rows(body: _BulkRequest) -> list[RowKey]:
    return [RowKey(row.case_id, row.language) for row in body.rows]


@router.post("/bulk-task-actions/reopen", response_model=BulkTaskActionView)
def bulk_reopen(
    key: str, body: BulkReopenRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Reopen the submitted tasks of many texts (issue 336).

    ``preview: true`` lists the tasks that would be reopened, the tasks kept
    and why, the texts skipped (a final result is chosen) and a
    ``preview_token``. Applying sends that token and a ``reason``: every
    listed task is reopened, or none (409 ``PREVIEW_STALE`` with a fresh
    ``preview`` in the details when anything changed). Each task is audited
    like a single reopen (``via: bulk_reopen``).
    """
    return _service(request, key, principal).run(
        key,
        _rows(body),
        Options("reopen", tuple(dict.fromkeys(body.tasks)), body.reason),
        preview=body.preview,
        preview_token=body.preview_token,
    )


@router.post("/bulk-task-actions/withdraw", response_model=BulkTaskActionView)
def bulk_withdraw(
    key: str, body: BulkWithdrawRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Withdraw the open tasks of many texts (issues 336, 339).

    Like a single withdrawal the drafts stay. Started tasks only with
    ``include_started``; ``over_limit_only`` withdraws only annotations above
    "annotators per text" of their version (submitted, then started, then the
    oldest stay). Preview and apply as ``bulk-task-actions/reopen``; each
    task is audited like a single withdrawal (``via: bulk_withdraw``).
    """
    return _service(request, key, principal).run(
        key,
        _rows(body),
        Options(
            "withdraw",
            tuple(dict.fromkeys(body.tasks)),
            body.reason,
            include_started=body.include_started,
            over_limit_only=body.over_limit_only,
        ),
        preview=body.preview,
        preview_token=body.preview_token,
    )


@router.post("/bulk-task-actions/undo", response_model=BulkUndoResult)
def bulk_undo(
    key: str, body: BulkUndoRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Undo a bulk reopen or withdrawal with the ``undo`` of its apply.

    Only while the texts are exactly as the action left them; otherwise 409
    ``BULK_UNDO_STALE`` and nothing is undone. Reopened tasks are submitted
    again; withdrawn tasks come back with their drafts.
    """
    return _service(request, key, principal).undo(
        key, body.action, body.assignment_ids, body.token
    )
