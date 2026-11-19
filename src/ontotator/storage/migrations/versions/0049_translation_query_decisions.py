"""Record a lead's decisions on queried translation reviews (issue 483).

Purely additive: one new, empty, append-only table
``translation_query_decisions``, one row per translation review submitted as
a query that a lead decided. It names the review, the version the lead
decided on, the version the decision accepted, the kind of decision
(``reviewer_text``: the reviewer's proposed text became the next version;
``unchanged``: the queried version was accepted as it is), the lead's answer
to the reviewer, who decided and when.

No existing table, column or row changes. Follows 0048 (the label of a
guideline version).
"""

import sqlalchemy as sa
from alembic import op

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
TABLE = "translation_query_decisions"
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
        # translation_reviews.id; no foreign key (see QueryDecisionRow).
        sa.Column("review_id", sa.BigInteger(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.Column("accepted_document_id", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column(
            "edited", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "decided_by",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.users.id"),
            nullable=True,
        ),
        sa.Column(
            "decided_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["project_id", "document_id"], DOCUMENTS),
        sa.ForeignKeyConstraint(["project_id", "accepted_document_id"], DOCUMENTS),
        sa.UniqueConstraint("review_id"),
        sa.CheckConstraint("kind IN ('reviewer_text', 'unchanged')", name="kind"),
        sa.CheckConstraint(
            "kind <> 'unchanged' OR btrim(coalesce(answer, '')) <> ''",
            name="answer_required",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_translation_query_decisions_project_accepted",
        TABLE,
        ["project_id", "accepted_document_id"],
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
