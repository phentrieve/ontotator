"""Accept the typo fixes left behind by a review of the old text.

Data only, no schema change. Until this release a translation review
assigned after "Fix typos…" (an editorial correction, 0044) on a rejected or
queried version reviewed the version before the fix. Accepted unchanged, it
left that version ``accepted`` and the fix ``reviewed`` with no decision and
no next step. From this release such a review is a review of the fix.

A fix has the status of the version it fixes: one made after the acceptance
would be ``accepted``. So every fix without a review of its own that is
``reviewed`` while the version it fixes is ``accepted`` becomes ``accepted``
(a fix of a fix follows, oldest first). The downgrade leaves the data as it
is.

Follows 0045 (the lead pause).
"""

from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"

_ACCEPT = f"""
UPDATE {SCHEMA}.documents AS fix
SET translation_status = 'accepted'
FROM {SCHEMA}.translation_editorial_corrections AS record
JOIN {SCHEMA}.documents AS fixed
  ON fixed.project_id = record.project_id
 AND fixed.document_id = record.previous_document_id
WHERE fix.project_id = record.project_id
  AND fix.document_id = record.document_id
  AND fix.translation_status = 'reviewed'
  AND fixed.translation_status = 'accepted'
  AND NOT EXISTS (
    SELECT 1 FROM {SCHEMA}.translation_reviews AS review
    WHERE review.project_id = fix.project_id
      AND review.document_id = fix.document_id
  )
"""


def upgrade() -> None:
    connection = op.get_bind()
    # A fix of a fix: one pass per link of the chain.
    while connection.exec_driver_sql(_ACCEPT).rowcount:
        pass


def downgrade() -> None:
    pass
