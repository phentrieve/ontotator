"""Record the submissions a typo fix carries to its new version (issue 465).

Purely additive: one new, empty, append-only table ``typo_fix_carries``.
After "Fix typos…" a person's submitted annotation moves to the new version
by itself when every finding is placed on the new text and no number
changed. The system then stores a copy of the submission on the new
version, with the same author and findings; one row here per copy names the
copy, the submission it was made from, both versions and the editorial
correction that caused it. Readers use it to count the copy as the same
annotation, not as a second one.

No existing table, column or row changes. Follows 0050 (annotations per text);
when other migrations land first, it follows the then-current head.
"""

import sqlalchemy as sa
from alembic import op

revision = "0052"
down_revision = "0050"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
TABLE = "typo_fix_carries"
DOCUMENTS = [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"]
SUBMISSIONS = [
    f"{SCHEMA}.submissions.project_id",
    f"{SCHEMA}.submissions.submission_id",
]


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
        sa.Column("submission_id", sa.Text(), nullable=False),
        sa.Column("source_submission_id", sa.Text(), nullable=False),
        sa.Column(
            "correction_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.translation_editorial_corrections.id"),
            nullable=False,
        ),
        sa.Column("from_document_id", sa.Text(), nullable=False),
        sa.Column("to_document_id", sa.Text(), nullable=False),
        sa.Column(
            "carried_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["project_id", "from_document_id"], DOCUMENTS),
        sa.ForeignKeyConstraint(["project_id", "to_document_id"], DOCUMENTS),
        sa.ForeignKeyConstraint(["project_id", "submission_id"], SUBMISSIONS),
        sa.ForeignKeyConstraint(["project_id", "source_submission_id"], SUBMISSIONS),
        sa.UniqueConstraint("project_id", "submission_id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_typo_fix_carries_source",
        TABLE,
        ["project_id", "source_submission_id"],
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
