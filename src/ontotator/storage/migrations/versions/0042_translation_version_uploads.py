"""Record uploaded translation versions and how their text was made (issue 341 a).

Purely additive: one new, empty, append-only table
``translation_version_uploads``, one row per translation version a lead
uploaded from the text card ("Upload new version…"). It names the version,
the version it corrects, who uploaded it and when, and how the text was made
(``method``; ``provider`` and ``model`` for a machine translation, plus an
optional date, person and note). The version itself is an ordinary
``correction`` row of ``documents``.

No existing table, column or row changes. Follows 0041 (annotators per text
up to 20).
"""

import sqlalchemy as sa
from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
TABLE = "translation_version_uploads"
DOCUMENTS = [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"]


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
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("previous_document_id", sa.Text(), nullable=False),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=True),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("made_on", sa.Date(), nullable=True),
        sa.Column("made_by", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "uploaded_by",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.users.id"),
            nullable=True,
        ),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["project_id", "document_id"], DOCUMENTS),
        sa.ForeignKeyConstraint(["project_id", "previous_document_id"], DOCUMENTS),
        sa.UniqueConstraint("project_id", "document_id"),
        sa.CheckConstraint(
            "method IN ('machine_translation', 'human_translation',"
            " 'manual_correction')",
            name="method",
        ),
        sa.CheckConstraint(
            "method <> 'machine_translation' OR provider IS NOT NULL",
            name="provider_required",
        ),
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
