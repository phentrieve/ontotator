"""When work on an assignment started since it was last given (issue 268).

Purely additive: one nullable column ``assignments.started_at``. It is set by
the first saved change after the assignment was given or reopened, and
cleared when the lead reopens it or starts a new round. Documents reads it
for reopened assignments: "assigned, not started" until that first save.

Backfill: every assignment whose status left ``open`` gets its
``updated_at``. For ``in_progress`` and ``submitted`` rows that is what the
status already says. A row that is ``reopened`` at upgrade time keeps reading
as started, as before this migration: whether its person saved anything since
the reopen is not recorded anywhere reliable.

The downgrade drops the column. Follows 0042 (translation version uploads).
"""

import sqlalchemy as sa
from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.execute(
        f"UPDATE {SCHEMA}.assignments SET started_at = updated_at"
        " WHERE status <> 'open'"
    )


def downgrade() -> None:
    op.drop_column("assignments", "started_at", schema=SCHEMA)
