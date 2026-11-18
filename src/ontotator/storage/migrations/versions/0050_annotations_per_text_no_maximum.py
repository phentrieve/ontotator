"""No built-in maximum of "Annotations per text" (issue 457).

Two check constraints are replaced, nothing else: the project setting
(``projects.annotations_per_text``) and a text's own value
(``text_settings.annotations_per_text``). Both kept ``BETWEEN 1 AND 20``
(migration 0041) and now keep only the minimum, ``>= 1``. No row changes;
every stored value (1 to 20) satisfies the new check. A server may set its
own maximum (``ONTOTATOR_MAX_ANNOTATIONS_PER_TEXT``); the application checks
it, not the database.

The downgrade restores the bound of 20. It refuses while a project or a text
holds a value above 20: lowering the value is a lead's decision (it decides
which texts are over their limit), not the migration's.

Follows 0046 (a review after a typo fix reviews the fixed version).
"""

import sqlalchemy as sa
from alembic import op

revision = "0050"
down_revision = "0046"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
TABLES = ("projects", "text_settings")
OLD_MAX = 20


def _replace(check: str) -> None:
    for table in TABLES:
        name = f"ck_{table}_annotations_per_text"
        op.drop_constraint(name, table, schema=SCHEMA)
        op.create_check_constraint(op.f(name), table, check, schema=SCHEMA)


def upgrade() -> None:
    _replace("annotations_per_text >= 1")


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
    _replace(f"annotations_per_text BETWEEN 1 AND {OLD_MAX}")
