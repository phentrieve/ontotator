"""Record editorial corrections of translation versions (issue 453).

Purely additive: one new, empty, append-only table
``translation_editorial_corrections``, one row per translation version a
lead made by an editorial correction (spacing, typos, grammar). It names the
version, the version it corrects, who corrected it, when and why, and how
many characters the correction inserted and deleted. The version itself is an
ordinary ``correction`` row of ``documents`` with the translation status of
the version it corrects.

No existing table, column or row changes. Follows 0042 (uploaded translation
versions).
"""

import sqlalchemy as sa
from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
TABLE = "translation_editorial_corrections"
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
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("inserted_characters", sa.Integer(), nullable=False),
        sa.Column("deleted_characters", sa.Integer(), nullable=False),
        sa.Column(
            "corrected_by",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.users.id"),
            nullable=True,
        ),
        sa.Column(
            "corrected_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["project_id", "document_id"], DOCUMENTS),
        sa.ForeignKeyConstraint(["project_id", "previous_document_id"], DOCUMENTS),
        sa.UniqueConstraint("project_id", "document_id"),
        sa.CheckConstraint("btrim(reason) <> ''", name="reason_required"),
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
