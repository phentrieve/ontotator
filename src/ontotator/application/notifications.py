"""In-app notifications (issue 557): tell people about their tasks and about
what waits for the lead.

Writing: the services call ``notify`` (one person) or ``notify_leads`` (the
leads of a project) inside their own transaction, so a notification exists
exactly when the event committed. Both skip the person who caused the event,
inactive or erased accounts and practice projects. Nothing is sent anywhere:
the header bell of the app reads the list (``NotificationService``).

What a row holds: the kind, the recipient, the actor, the project, the task
and the id of a problem report or question. No text: the case, the language
and the person's label are read when the list is shown, under the rules of
every other view (display names only for leads and for oneself). So a
notification never carries clinical text, an erased name never stays in one,
and a notification whose task was purged or that belongs to a project the
person left is not shown.

Retention: a person keeps at most ``MAX_PER_PERSON`` notifications; read
ones go after ``READ_RETENTION`` and unread ones after ``UNREAD_RETENTION``.
Each write prunes the recipient's rows, so the table cannot grow without
bound.

For "Ask the lead" (issue 553): a question is
``notify_leads(conn, project_id, "question_received", actor_id=asker,
assignment_id=task, target_id=question_id)``; its answer is
``notify(conn, asker, project_id, "answer_received", actor_id=lead,
assignment_id=task, target_id=question_id)``.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy import Connection, and_, delete, func, insert, select, update

from ontotator.api.person_views import PersonRefView
from ontotator.application.people import person_refs
from ontotator.storage.database import Database
from ontotator.storage.notification_tables import NotificationRow
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectMembershipRow,
    ProjectRow,
    UserRow,
)

NotificationKind = Literal[
    "task_assigned",
    "task_reopened",
    "task_released",
    "text_problem_received",
    "question_received",
    "answer_received",
    "submission_waiting",
]
# Kinds about the recipient's own task: shown only while the task is theirs.
OWN_TASK_KINDS: frozenset[str] = frozenset(
    {"task_assigned", "task_reopened", "task_released", "answer_received"}
)

MAX_PER_PERSON = 200
READ_RETENTION = timedelta(days=30)
UNREAD_RETENTION = timedelta(days=180)
DEFAULT_LIMIT = 20


def _now() -> datetime:
    return datetime.now(UTC)


def _recipients(
    conn: Connection, project_id: int, user_ids: Iterable[int], actor_id: int | None
) -> list[int]:
    """The ids that may get a notification: active, not erased, not the actor,
    in a project that is not a practice project."""
    ids = sorted({uid for uid in user_ids if uid != actor_id})
    if not ids:
        return []
    practice = conn.execute(
        select(ProjectRow.practice).where(ProjectRow.id == project_id)
    ).scalar_one_or_none()
    if practice is None or practice:
        return []
    return list(
        conn.execute(
            select(UserRow.id)
            .where(
                UserRow.id.in_(ids),
                UserRow.active.is_(True),
                UserRow.anonymised_at.is_(None),
            )
            .order_by(UserRow.id)
        ).scalars()
    )


def _prune(conn: Connection, user_ids: list[int], now: datetime) -> None:
    """Retention: old rows go, and each person keeps the newest ones only."""
    conn.execute(
        delete(NotificationRow).where(
            NotificationRow.recipient_id.in_(user_ids),
            (
                and_(
                    NotificationRow.read_at.is_not(None),
                    NotificationRow.created_at < now - READ_RETENTION,
                )
                | (NotificationRow.created_at < now - UNREAD_RETENTION)
            ),
        )
    )
    for uid in user_ids:
        cutoff = conn.execute(
            select(NotificationRow.id)
            .where(NotificationRow.recipient_id == uid)
            .order_by(NotificationRow.id.desc())
            .offset(MAX_PER_PERSON)
            .limit(1)
        ).scalar_one_or_none()
        if cutoff is not None:
            conn.execute(
                delete(NotificationRow).where(
                    NotificationRow.recipient_id == uid,
                    NotificationRow.id <= cutoff,
                )
            )


def notify_many(
    conn: Connection,
    recipients: Iterable[int],
    project_id: int,
    kind: NotificationKind,
    *,
    actor_id: int | None = None,
    assignment_id: int | None = None,
    target_id: str | None = None,
    at: datetime | None = None,
) -> int:
    """Add one notification per recipient in the caller's transaction; the
    number written."""
    now = at or _now()
    ids = _recipients(conn, project_id, recipients, actor_id)
    if not ids:
        return 0
    conn.execute(
        insert(NotificationRow),
        [
            {
                "recipient_id": uid,
                "project_id": project_id,
                "kind": kind,
                "actor_id": actor_id,
                "assignment_id": assignment_id,
                "target_id": target_id,
                "created_at": now,
            }
            for uid in ids
        ],
    )
    _prune(conn, ids, now)
    return len(ids)


def notify(
    conn: Connection,
    recipient_id: int,
    project_id: int,
    kind: NotificationKind,
    *,
    actor_id: int | None = None,
    assignment_id: int | None = None,
    target_id: str | None = None,
    at: datetime | None = None,
) -> int:
    """Tell one person about an event (see ``notify_many``)."""
    return notify_many(
        conn,
        [recipient_id],
        project_id,
        kind,
        actor_id=actor_id,
        assignment_id=assignment_id,
        target_id=target_id,
        at=at,
    )


def project_leads(conn: Connection, project_id: int) -> list[int]:
    """The ids of the project's leads."""
    return list(
        conn.execute(
            select(ProjectMembershipRow.user_id)
            .where(
                ProjectMembershipRow.project_id == project_id,
                ProjectMembershipRow.role == "lead",
            )
            .order_by(ProjectMembershipRow.user_id)
        ).scalars()
    )


def notify_leads(
    conn: Connection,
    project_id: int,
    kind: NotificationKind,
    *,
    actor_id: int | None = None,
    assignment_id: int | None = None,
    target_id: str | None = None,
    at: datetime | None = None,
) -> int:
    """Tell every lead of the project, except the one who caused the event."""
    return notify_many(
        conn,
        project_leads(conn, project_id),
        project_id,
        kind,
        actor_id=actor_id,
        assignment_id=assignment_id,
        target_id=target_id,
        at=at,
    )


# --- Reading -------------------------------------------------------------


class NotificationView(BaseModel):
    """One entry of the bell's list. The app words it from these fields."""

    id: int
    kind: NotificationKind
    created_at: datetime
    read: bool
    project_key: str
    project_name: str
    actor: PersonRefView | None
    # The task the event is about, when it still exists.
    assignment_id: int | None
    task: Literal["annotate", "review", "translation_review"] | None
    case_id: str | None
    language: str | None
    version: int | None
    # A problem report's or a question's id.
    target_id: str | None


class NotificationList(BaseModel):
    unread: int
    items: list[NotificationView]


class NotificationSummary(BaseModel):
    """The bell's count."""

    unread: int


class NotificationService:
    def __init__(self, db: Database) -> None:
        self.db = db

    @staticmethod
    def _visible(
        conn: Connection, user_id: int, limit: int | None
    ) -> list[dict[str, Any]]:
        """The person's notifications newest first, without those of projects
        they left, of purged tasks, and about tasks that are no longer theirs."""
        member = (
            select(ProjectMembershipRow.project_id)
            .where(ProjectMembershipRow.user_id == user_id)
            .distinct()
        )
        query = (
            select(
                NotificationRow,
                ProjectRow.project_key,
                ProjectRow.name.label("project_name"),
                AssignmentRow.id.label("task_id"),
                AssignmentRow.user_id.label("task_owner"),
                AssignmentRow.revoked_at.label("task_revoked_at"),
                AssignmentRow.task,
                DocumentRow.case_id,
                DocumentRow.language,
                DocumentRow.version,
            )
            .join(ProjectRow, ProjectRow.id == NotificationRow.project_id)
            .outerjoin(AssignmentRow, AssignmentRow.id == NotificationRow.assignment_id)
            .outerjoin(
                DocumentRow,
                and_(
                    DocumentRow.project_id == AssignmentRow.project_id,
                    DocumentRow.document_id == AssignmentRow.document_id,
                ),
            )
            .where(
                NotificationRow.recipient_id == user_id,
                NotificationRow.project_id.in_(member),
            )
            .order_by(NotificationRow.id.desc())
        )
        rows = [dict(row) for row in conn.execute(query).mappings()]
        shown = [
            row
            for row in rows
            if (row["assignment_id"] is None or row["task_id"] is not None)
            and (
                row["kind"] not in OWN_TASK_KINDS
                or (row["task_owner"] == user_id and row["task_revoked_at"] is None)
            )
        ]
        return shown if limit is None else shown[:limit]

    def list(self, user_id: int, *, limit: int = DEFAULT_LIMIT) -> NotificationList:
        with self.db.snapshot() as conn:
            rows = self._visible(conn, user_id, None)
            page = rows[:limit]
            leads = set(
                conn.execute(
                    select(ProjectMembershipRow.project_id).where(
                        ProjectMembershipRow.user_id == user_id,
                        ProjectMembershipRow.role == "lead",
                    )
                ).scalars()
            )
            actors = {row["actor_id"] for row in page if row["actor_id"] is not None}
            # As everywhere: display names for a lead of the project, else
            # the pseudonym only.
            named = person_refs(conn, actors, viewer_id=user_id, viewer_is_lead=True)
            plain = person_refs(conn, actors, viewer_id=user_id, viewer_is_lead=False)
            items = [
                NotificationView(
                    id=row["id"],
                    kind=row["kind"],
                    created_at=row["created_at"],
                    read=row["read_at"] is not None,
                    project_key=row["project_key"],
                    project_name=row["project_name"],
                    actor=(
                        None
                        if row["actor_id"] is None
                        else (named if row["project_id"] in leads else plain)[
                            row["actor_id"]
                        ]
                    ),
                    assignment_id=row["task_id"],
                    task=row["task"],
                    case_id=row["case_id"],
                    language=row["language"],
                    version=row["version"],
                    target_id=row["target_id"],
                )
                for row in page
            ]
            unread = sum(1 for row in rows if row["read_at"] is None)
            return NotificationList(unread=unread, items=items)

    def summary(self, user_id: int) -> NotificationSummary:
        with self.db.snapshot() as conn:
            rows = self._visible(conn, user_id, None)
            return NotificationSummary(
                unread=sum(1 for row in rows if row["read_at"] is None)
            )

    def mark_read(self, user_id: int, notification_id: int) -> NotificationSummary:
        """Mark one of the caller's notifications read; another person's id
        changes nothing (no existence oracle)."""
        with self.db.transaction() as conn:
            conn.execute(
                update(NotificationRow)
                .where(
                    NotificationRow.id == notification_id,
                    NotificationRow.recipient_id == user_id,
                    NotificationRow.read_at.is_(None),
                )
                .values(read_at=func.now())
            )
        return self.summary(user_id)

    def mark_all_read(
        self, user_id: int, *, up_to: int | None = None
    ) -> NotificationSummary:
        """Mark the caller's notifications read, up to the id ``up_to`` (the
        newest one the list showed), so one that arrived since stays unread."""
        with self.db.transaction() as conn:
            condition = [
                NotificationRow.recipient_id == user_id,
                NotificationRow.read_at.is_(None),
            ]
            if up_to is not None:
                condition.append(NotificationRow.id <= up_to)
            conn.execute(
                update(NotificationRow).where(*condition).values(read_at=func.now())
            )
        return self.summary(user_id)
