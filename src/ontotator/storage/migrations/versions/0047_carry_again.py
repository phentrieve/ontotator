"""Carry a submission again after its carried task was withdrawn (issue 461).

``text_change_resolutions`` allowed one decision per submission and target
version (``uq_text_change_resolutions_submission_target``). A carry whose
task was withdrawn or removed without a submission may now be followed by a
new carry of the same submission to the same version. The table is
append-only, so the earlier row stays and a second row is added: the unique
constraint becomes a plain index. The application keeps the rule "one
standing decision", under the project lock.

No row changes. The downgrade is refused while a submission has more than
one decision for a target: the unique constraint could not come back, and
rows of this table are never deleted.

Follows 0045 (the lead pause of a text).
"""

import sqlalchemy as sa
from alembic import op

revision = "0047"
down_revision = "0045"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
TABLE = "text_change_resolutions"
UNIQUE = "uq_text_change_resolutions_submission_target"
INDEX = "ix_text_change_resolutions_submission_target"
COLUMNS = ["project_id", "submission_id", "to_document_id"]


def upgrade() -> None:
    op.drop_constraint(UNIQUE, TABLE, schema=SCHEMA)
    op.create_index(INDEX, TABLE, COLUMNS, schema=SCHEMA)


def downgrade() -> None:
    repeated = op.get_bind().execute(
        sa.text(
            f"SELECT EXISTS (SELECT 1 FROM {SCHEMA}.{TABLE}"
            " WHERE submission_id IS NOT NULL"
            " GROUP BY project_id, submission_id, to_document_id"
            " HAVING count(*) > 1)"
        )
    )
    if repeated.scalar_one():
        raise RuntimeError(
            "Cannot downgrade: a submission was carried to the same version"
            " more than once; the previous revision allows one decision"
        )
    op.drop_index(INDEX, table_name=TABLE, schema=SCHEMA)
    op.create_unique_constraint(UNIQUE, TABLE, COLUMNS, schema=SCHEMA)
