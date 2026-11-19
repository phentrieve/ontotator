"""Lead pause of a text (issue 464).

Purely additive: four columns on ``text_settings`` (one row per text:
project, case, language). ``paused`` says a lead paused the work on the
text; ``pause_reason``, ``paused_by`` and ``paused_at`` say why, who and
when. Releasing sets ``paused`` to false and keeps the other three as the
record of the last pause. The pause belongs to the text, not to a version or
a task: a task assigned later is paused as well, until the text is released.

No existing row changes: every text starts not paused.

Follows 0044 (editorial corrections of a translation version).
"""

import sqlalchemy as sa
from alembic import op

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
TABLE = "text_settings"


def upgrade() -> None:
    op.add_column(
        TABLE,
        sa.Column("paused", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema=SCHEMA,
    )
    op.add_column(TABLE, sa.Column("pause_reason", sa.Text()), schema=SCHEMA)
    op.add_column(
        TABLE,
        sa.Column(
            "paused_by",
            sa.BigInteger(),
            sa.ForeignKey(
                f"{SCHEMA}.users.id", name=op.f("fk_text_settings_paused_by")
            ),
        ),
        schema=SCHEMA,
    )
    op.add_column(
        TABLE, sa.Column("paused_at", sa.DateTime(timezone=True)), schema=SCHEMA
    )
    op.create_check_constraint(
        op.f("ck_text_settings_pause"),
        TABLE,
        "NOT paused OR (pause_reason IS NOT NULL AND paused_at IS NOT NULL)",
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint("ck_text_settings_pause", TABLE, schema=SCHEMA)
    for column in ("paused_at", "paused_by", "pause_reason", "paused"):
        op.drop_column(TABLE, column, schema=SCHEMA)
