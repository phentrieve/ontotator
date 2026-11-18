"""A project's own label of a guideline version (issue 487).

Purely additive: one nullable column ``label`` on ``guideline_versions``,
the project's own name of the version ("3.1"), given at publish and shown
before the upload number ("Guidelines 3.1 (v2)"). The upload number stays
the identifier. The label is at most 40 characters and stays when the
version is withdrawn.

No existing row changes: every version starts without a label. The table is
append-only for the application; adding a column does not touch its rows.

Follows 0047 (carry a submission again).
"""

import sqlalchemy as sa
from alembic import op

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
TABLE = "guideline_versions"


def upgrade() -> None:
    op.add_column(TABLE, sa.Column("label", sa.Text()), schema=SCHEMA)
    op.create_check_constraint(
        op.f("ck_guideline_versions_label"),
        TABLE,
        "char_length(label) BETWEEN 1 AND 40",
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint("ck_guideline_versions_label", TABLE, schema=SCHEMA)
    op.drop_column(TABLE, "label", schema=SCHEMA)
