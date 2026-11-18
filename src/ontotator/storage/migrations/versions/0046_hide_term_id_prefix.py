"""Show term ids without the ontology prefix (display only).

Purely additive: one column ``projects.hide_term_id_prefix``. With it on, a
project with one ontology shows `N18.1` instead of `ICD10CM:N18.1` in the
editor. Stored annotations, exports and the API keep the full id.

No existing row changes: every project starts with the prefix shown.

Follows 0045 (lead pause of a text).
"""

import sqlalchemy as sa
from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "hide_term_id_prefix",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("projects", "hide_term_id_prefix", schema=SCHEMA)
