"""Bulk lead actions on the tasks of the selected texts (issue 336, step 1)."""

from datetime import datetime
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
    BulkRoundKind,
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
    # The cap of every selection action (Plan…, Move to front): texts of at
    # most ``MAX_SELECTED_CASES`` cases. The MCP tools take fewer per call.
    rows: list[RowRefView] = Field(min_length=1, max_length=MAX_SELECTED_ROWS)
    # Which tasks of the texts; default: annotations.
    tasks: list[Task] = Field(default_factory=_annotations, min_length=1)
    preview: bool = Field(default_factory=lambda: False)
    # With ``preview``: only the counts and the token, no task lists (the
    # selection bar asks this to know whether an action can do anything).
    summary_only: bool = Field(default_factory=lambda: False)
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


class BulkStartRoundRequest(BaseModel):
    """Start a new work round for the submitted annotations of the selected
    texts. ``reason`` is required to apply a ``clean_restart``."""

    model_config = ConfigDict(extra="forbid")
    rows: list[RowRefView] = Field(min_length=1, max_length=MAX_SELECTED_ROWS)
    # ``carry_forward``: the round continues from the task's submission.
    # ``clean_restart``: it has none of the earlier findings; a task from
    # tool proposals starts on the newest proposal set.
    kind: BulkRoundKind
    reason: str | None = Field(default=None, max_length=2000)
    preview: bool = Field(default_factory=lambda: False)
    summary_only: bool = Field(default_factory=lambda: False)
    preview_token: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def _token_to_apply(self) -> Self:
        require_one_selection([], self.rows)
        if not self.preview and self.preview_token is None:
            raise ValueError("Send preview: true, or the preview_token to apply.")
        return self


class BulkTaskView(BaseModel):
    case_id: str
    language: str
    assignment_id: int
    document_id: str
    version: int
    task: Task
    status: Literal["open", "in_progress", "submitted", "reopened"]
    person: PersonRefView
    # Issue 464: a lead paused the task's text. A task reopened or given a
    # round there is paused from the start, until the text is released.
    text_paused: bool = Field(default_factory=lambda: False)


class BulkKeptTaskView(BulkTaskView):
    # not_submitted, lead_correction, discarded, lead_correction_open,
    # person_unavailable (reopen); submitted, started, paused, paused_by_lead,
    # within_limit, lead_correction_task (withdraw); not_submitted, paused, not_current_version,
    # person_unavailable, translation_not_accepted, no_round (start-round).
    reason: str
    message: str


class BulkSkippedTextView(BaseModel):
    case_id: str
    language: str
    # final_chosen (reopen); final_result, consolidation_open (start-round).
    reason: Literal["final_chosen", "final_result", "consolidation_open"]
    message: str


class BulkUndoView(BaseModel):
    """The server's record of an applied action; ``id`` undoes it once,
    before ``expires_at``, for the lead who applied it."""

    id: int
    expires_at: datetime


class BulkTaskActionView(BaseModel):
    action: BulkAction
    # ``start_round``: the kind of round asked for; else null.
    kind: BulkRoundKind | None = None
    # False: a preview; True: every task in ``changes`` was changed.
    applied: bool
    # Selected texts found.
    texts: int
    # Selected texts the project does not have (another spelling, letter
    # case or language), as they were sent; also with ``summary_only``.
    unknown_rows: list[RowRefView] = Field(default_factory=list)
    # Counts of the three lists below; the lists are empty with
    # ``summary_only``.
    change_count: int
    kept_count: int
    skipped_count: int
    changes: list[BulkTaskView]
    kept: list[BulkKeptTaskView]
    skipped: list[BulkSkippedTextView]
    preview_token: str
    # After apply with changes: send its ``id`` to ``bulk-task-actions/undo``.
    # None when nothing changed, a translation review was reopened, or the
    # action started rounds.
    undo: BulkUndoView | None = None


class BulkUndoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # ``undo.id`` of the apply.
    undo_id: int = Field(ge=1)
    # True: only list the tasks the Undo would bring back and what blocks it.
    preview: bool = Field(default_factory=lambda: False)


class BulkUndoTaskView(BaseModel):
    case_id: str
    language: str
    assignment_id: int
    document_id: str
    task: Task
    # The task's status now: in a preview before the Undo, else after it.
    status: Literal["open", "in_progress", "submitted", "reopened"]
    person: PersonRefView


class BulkUndoBlock(BaseModel):
    # What stands in the way: the texts changed since the action
    # (``changed``), a text no longer plans the task or its version was
    # discarded (``not_in_plan``), a person left (``person_unavailable``).
    reason: Literal["changed", "not_in_plan", "person_unavailable"]
    message: str


class BulkUndoResult(BaseModel):
    # Tasks brought back; 0 in a preview.
    undone: int
    # False: a preview; True: every task in ``tasks`` is back.
    applied: bool = Field(default_factory=lambda: True)
    undo_id: int | None = None
    # The action undone: ``reopen`` (the tasks are submitted again) or
    # ``withdraw`` (the tasks come back with their drafts).
    action: Literal["reopen", "withdraw"] | None = None
    expires_at: datetime | None = None
    # Tasks the action changed, and those of them that still exist.
    task_count: int = Field(default_factory=lambda: 0)
    tasks: list[BulkUndoTaskView] = Field(default_factory=list)
    # A preview only: why the Undo cannot run now; null when it can.
    # Applying then answers 409 ``BULK_UNDO_STALE`` with this ``reason``.
    blocked: BulkUndoBlock | None = None


def _service(request: Request, key: str, principal: Any) -> BulkTaskActionService:
    access = get_access(request)
    if not can(access, Action.VIEW_PROJECT, key):
        raise DomainError("PROJECT_NOT_FOUND")
    if not can(access, Action.MANAGE_ASSIGNMENTS, key):
        raise AccessDenied("NOT_ALLOWED")
    return BulkTaskActionService(
        request.app.state.repo.db, Actor.user(principal.user_id, principal.username)
    )


def _rows(body: _BulkRequest | BulkStartRoundRequest) -> list[RowKey]:
    return [RowKey(row.case_id, row.language) for row in body.rows]


@router.post("/bulk-task-actions/reopen", response_model=BulkTaskActionView)
def bulk_reopen(
    key: str, body: BulkReopenRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Reopen the submitted tasks of many texts (issue 336).

    ``preview: true`` lists the tasks that would be reopened, the tasks kept
    and why, the texts skipped (a final result is chosen), the selected
    texts the project does not have (``unknown_rows``) and a
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
        summary_only=body.summary_only,
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
        summary_only=body.summary_only,
    )


@router.post("/bulk-task-actions/start-round", response_model=BulkTaskActionView)
def bulk_start_round(
    key: str, body: BulkStartRoundRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Start a new work round for the submitted annotations of many texts
    (issue 336, step 3).

    What ``POST /assignments/{id}/rounds`` does for one task: ``kind``
    ``carry_forward`` continues from the task's submission, ``clean_restart``
    starts without the earlier findings (a task from tool proposals on the
    newest proposal set) and needs a ``reason`` to apply. Either way the
    earlier submission no longer counts as submitted and the person submits
    the new round. Only submitted annotations on the text's current version
    get a round: other tasks are kept with the reason, texts with a final
    result or an open consolidation are skipped. Preview and apply as
    ``bulk-task-actions/reopen``; each round is audited like a single one
    (``round.create``, ``via: bulk_start_round``). There is no Undo
    (``undo`` is null).
    """
    return _service(request, key, principal).run(
        key,
        _rows(body),
        Options("start_round", ("annotate",), body.reason, kind=body.kind),
        preview=body.preview,
        preview_token=body.preview_token,
        summary_only=body.summary_only,
    )


@router.post("/bulk-task-actions/undo", response_model=BulkUndoResult)
def bulk_undo(
    key: str, body: BulkUndoRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Undo a bulk reopen or withdrawal by the ``undo.id`` of its apply.

    The server keeps what the action changed; the request names only that
    record. It works once, for the lead who applied the action, before
    ``undo.expires_at``, and only while the texts are exactly as the action
    left them (tasks, drafts, review drafts, rounds, final results, plan,
    versions); otherwise 409 ``BULK_UNDO_STALE`` and nothing is undone.
    Reopened tasks are submitted again; withdrawn tasks come back with their
    drafts. An action that reopened a translation review has no Undo.
    ``preview: true`` changes nothing: it lists the tasks the Undo would
    bring back (``tasks``) and, in ``blocked``, why it cannot run now
    (``changed``, ``not_in_plan``, ``person_unavailable``); a record that is
    unknown, expired or already undone is refused in a preview too.
    """
    return _service(request, key, principal).undo(
        key, body.undo_id, preview=body.preview
    )
