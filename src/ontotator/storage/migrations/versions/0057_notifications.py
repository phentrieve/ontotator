"""In-app notifications (issue 557).

Purely additive: one new, empty table ``notifications`` with its indexes and
grants. A row tells one person about one event (a new task, a reopened or
released task, a text problem for the lead) and holds identifiers only, no
text. Unlike the history tables it is not append-only: reading a
notification sets ``read_at``, and old rows are deleted (retention).

No existing table, column or row changes. Follows 0055 (task questions).
"""

from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0057"
down_revision = "0055"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
TABLE = "notifications"
KINDS = (
    "task_assigned",
    "task_reopened",
    "task_released",
    "text_problem_received",
    "question_received",
    "answer_received",
    "submission_waiting",
)


def _user(name: str, *, nullable: bool = False) -> sa.Column[Any]:
    return sa.Column(
        name, sa.BigInteger(), sa.ForeignKey(f"{SCHEMA}.users.id"), nullable=nullable
    )


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        _user("recipient_id"),
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.projects.id"),
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        _user("actor_id", nullable=True),
        sa.Column("assignment_id", sa.BigInteger(), nullable=True),
        sa.Column("target_id", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN (" + ", ".join(f"'{kind}'" for kind in KINDS) + ")",
            name="kind",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_notifications_recipient_id_id",
        TABLE,
        ["recipient_id", "id"],
        schema=SCHEMA,
    )
    op.create_index("ix_notifications_created_at", TABLE, ["created_at"], schema=SCHEMA)
    # Reading sets read_at; retention and erasure delete rows.
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON {SCHEMA}.{TABLE} TO {APP_ROLE}"
    )
    op.execute(f"GRANT USAGE, SELECT ON SEQUENCE {SCHEMA}.{TABLE}_id_seq TO {APP_ROLE}")


def downgrade() -> None:
    op.drop_table(TABLE, schema=SCHEMA)
