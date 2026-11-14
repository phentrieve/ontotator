"""Let a lead withdraw a final result (issue 343).

Purely additive: the application role may delete rows of
``final_selections``, the pointer to a text's current final result. The
history stays append-only: ``final_selection_events`` records the
withdrawal (with the withdrawn result, its revision and the reason), and
export snapshots keep what a final export froze. No table, column, row or
trigger changes.

Follows 0038 (delete an empty project).
"""

from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"


def upgrade() -> None:
    op.execute(f"GRANT DELETE ON {SCHEMA}.final_selections TO {APP_ROLE}")


def downgrade() -> None:
    op.execute(f"REVOKE DELETE ON {SCHEMA}.final_selections FROM {APP_ROLE}")
