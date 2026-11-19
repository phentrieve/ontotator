"""Raise the upper bound of "Annotations per text" from 5 to 20 (issue 447).

Two check constraints are replaced, nothing else: the project setting
(``projects.annotations_per_text``, migration 0016) and a text's own value
(``text_settings.annotations_per_text``, migration 0039). No row changes;
every stored value (1 to 5) satisfies the new bounds.

The downgrade restores the bound of 5. It refuses while a project or a text
holds a value above 5: lowering the value is a lead's decision (it decides
which texts are over their limit), not the migration's.

Follows 0040 (withdraw a final result).
"""

import sqlalchemy as sa
from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
TABLES = ("projects", "text_settings")
OLD_MAX = 5
NEW_MAX = 20


def _replace(maximum: int) -> None:
    for table in TABLES:
        name = f"ck_{table}_annotations_per_text"
        op.drop_constraint(name, table, schema=SCHEMA)
        op.create_check_constraint(
            op.f(name),
            table,
            f"annotations_per_text BETWEEN 1 AND {maximum}",
            schema=SCHEMA,
        )


def upgrade() -> None:
    _replace(NEW_MAX)


def downgrade() -> None:
    bind = op.get_bind()
    for table, what in zip(TABLES, ("projects", "texts"), strict=True):
        above = bind.execute(
            sa.text(
                f"SELECT count(*) FROM {SCHEMA}.{table}"
                f" WHERE annotations_per_text > {OLD_MAX}"
            )
        ).scalar_one()
        if above:
            raise RuntimeError(
                f"{above} {what} have more than {OLD_MAX} annotations per text;"
                f" lower them to {OLD_MAX} or less before downgrading."
            )
    _replace(OLD_MAX)
