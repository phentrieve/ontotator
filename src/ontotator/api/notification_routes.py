"""In-app notifications of the signed-in person (issue 557): the header bell."""

from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from ontotator.api.identity import PrincipalDep
from ontotator.application.notifications import (
    DEFAULT_LIMIT,
    NotificationList,
    NotificationService,
    NotificationSummary,
)

router = APIRouter(prefix="/api/v1", tags=["notifications"])


class MarkAllReadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # The newest id the list showed: one that arrived since stays unread.
    up_to: int | None = Field(default=None, ge=1)


def _service(request: Request) -> NotificationService:
    return NotificationService(request.app.state.repo.db)


@router.get("/me/notifications")
def list_notifications(
    request: Request,
    principal: PrincipalDep,
    limit: Annotated[int, Query(ge=1, le=100)] = DEFAULT_LIMIT,
) -> NotificationList:
    """The caller's newest notifications and the number of unread ones."""
    return _service(request).list(principal.user_id, limit=limit)


@router.get("/me/notifications/summary")
def notification_summary(
    request: Request, principal: PrincipalDep
) -> NotificationSummary:
    """The number of unread notifications (the bell's count)."""
    return _service(request).summary(principal.user_id)


@router.post("/me/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: int, request: Request, principal: PrincipalDep
) -> NotificationSummary:
    """Mark one notification read; another person's id changes nothing."""
    return _service(request).mark_read(principal.user_id, notification_id)


@router.post("/me/notifications/read-all")
def mark_all_notifications_read(
    body: MarkAllReadRequest, request: Request, principal: PrincipalDep
) -> NotificationSummary:
    """Mark every notification read, up to ``up_to`` when given."""
    return _service(request).mark_all_read(principal.user_id, up_to=body.up_to)
