"""Link templates for term codes, per ontology of a project.

Purely additive: one column ``projects.term_link_templates`` (ontology id ->
template such as ``https://www.icd10data.com/search?s={code}``). Every
project starts with none and keeps today's links.

Follows 0058 (hide the term id prefix).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "term_link_templates",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("projects", "term_link_templates", schema=SCHEMA)
