"""Additions to the reason of a correction request (issue 483).

Purely additive: one new, empty, append-only table
``translation_correction_reason_additions``. A lead who asked a reviewer to
correct an accepted translation ("Ask a reviewer to correct…") may add to the
reason while the review is open. Each row is one addition: the review task,
the round of the request it adds to, the text, who added it and when. The
reason of the request itself stays in its audit event and is never changed.

No existing table, column or row changes. Follows 0049 (the lead's decisions
on queried translation reviews).
"""

import sqlalchemy as sa
from alembic import op

revision = "0051"
down_revision = "0049"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
TABLE = "translation_correction_reason_additions"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.projects.id"),
            nullable=False,
        ),
        sa.Column(
            "assignment_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.assignments.id"),
            nullable=False,
        ),
        # work_rounds.round_id of the request; no foreign key (see the model).
        sa.Column("round_id", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column(
            "added_by",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.users.id"),
            nullable=True,
        ),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint("btrim(note) <> ''", name="note_required"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_translation_correction_reason_additions_assignment_id",
        TABLE,
        ["assignment_id"],
        schema=SCHEMA,
    )
    op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.{TABLE} TO {APP_ROLE}")
    op.execute(f"GRANT USAGE, SELECT ON SEQUENCE {SCHEMA}.{TABLE}_id_seq TO {APP_ROLE}")
    op.execute(
        f"CREATE TRIGGER {TABLE}_append_only BEFORE UPDATE OR DELETE ON"
        f" {SCHEMA}.{TABLE} FOR EACH ROW EXECUTE FUNCTION"
        f" {SCHEMA}.forbid_history_change()"
    )
    op.execute(
        f"CREATE TRIGGER {TABLE}_no_truncate BEFORE TRUNCATE ON {SCHEMA}.{TABLE}"
        f" FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
    )


def downgrade() -> None:
    op.drop_table(TABLE, schema=SCHEMA)
