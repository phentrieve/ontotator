"""Per-text override of "Annotations per text" (issue 422).

Purely additive: one new, empty table ``text_settings``, one row per text
(project, case, language: the unit of the work plan). ``annotations_per_text``
(1 to 5, nullable) replaces the project value for that text, as target and
as limit; NULL follows the project value again. A row is never deleted:
clearing the override sets NULL and keeps who changed it last. The value is
not tied to a text version, so it stays when a corrected version arrives.

No existing table, column or row changes. Follows 0038 (delete an empty
project), whose function counts rows of this table as work (they exist
only for texts, which are work anyway).
"""

import sqlalchemy as sa
from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"


def upgrade() -> None:
    op.create_table(
        "text_settings",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.projects.id"),
            nullable=False,
        ),
        sa.Column("case_id", sa.Text(), nullable=False),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("annotations_per_text", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "updated_by",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.users.id"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("project_id", "case_id", "language"),
        sa.CheckConstraint(
            "annotations_per_text BETWEEN 1 AND 5", name="annotations_per_text"
        ),
        schema=SCHEMA,
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.text_settings TO {APP_ROLE}")
    op.execute(
        f"GRANT USAGE, SELECT ON SEQUENCE {SCHEMA}.text_settings_id_seq TO {APP_ROLE}"
    )


def downgrade() -> None:
    op.drop_table("text_settings", schema=SCHEMA)
