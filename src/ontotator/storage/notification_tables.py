"""In-app notifications: one row per person and event (issue 557).

A row names what happened (``kind``), to whom (``recipient_id``), who did it
(``actor_id``) and where it points: the task (``assignment_id``) and, for a
problem report or a question, its id (``target_id``). It holds no text at
all: the case, the language and the person are read when the list is shown,
so an erased account or purged work never stays behind in a notification.

``assignment_id`` has no foreign key on purpose: purged work (D1, D4) takes
its notifications out of the list instead of being blocked by them.
"""

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Identity, Index, func
from sqlalchemy.orm import Mapped, mapped_column

from ontotator.storage.tables import SCHEMA, Base

# Every kind the table accepts. The prototype writes the first three and
# ``text_problem_received``; the others are reserved for "Ask the lead"
# (issue 553) and the lead's decision queue, so they need no migration.
NOTIFICATION_KINDS = (
    "task_assigned",
    "task_reopened",
    "task_released",
    "text_problem_received",
    "question_received",
    "answer_received",
    "submission_waiting",
)


class NotificationRow(Base):
    """One notification of one person; ``read_at`` is null while unread."""

    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{kind}'" for kind in NOTIFICATION_KINDS) + ")",
            name="kind",
        ),
        # The list (newest first), the unread count and the retention.
        Index("ix_notifications_recipient_id_id", "recipient_id", "id"),
        Index("ix_notifications_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    recipient_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    kind: Mapped[str]
    actor_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    assignment_id: Mapped[int | None] = mapped_column(BigInteger)
    target_id: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    read_at: Mapped[datetime | None]
