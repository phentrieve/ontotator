"""Questions to the lead on a task (issue 553, prototype).

A question is a problem report of kind ``question``. Three new columns on
``problem_reports``; every existing row becomes kind ``problem`` and keeps
its meaning:

- ``kind``: ``problem`` (Report a text problem) or ``question`` (Ask the
  lead).
- ``quote``: the passage the question is about, optional.
- ``proposed_text``: the asker's wording for that passage, optional; only
  with a quote.

A question pauses the task only when the asker chose so: the pause is a
``task_holds`` row as for a report. The lead's answer is an event
``answer`` in ``problem_report_events``; nothing else changes. The table
stays append-only: adding columns with a default rewrites no row through
the triggers.

Follows 0052. 0053 and 0054 are held by open pull requests; at merge time
``down_revision`` follows the then-current head.
"""

import sqlalchemy as sa
from alembic import op

revision = "0055"
down_revision = "0052"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
TABLE = "problem_reports"


def upgrade() -> None:
    op.add_column(
        TABLE,
        sa.Column("kind", sa.Text(), nullable=False, server_default="problem"),
        schema=SCHEMA,
    )
    op.add_column(TABLE, sa.Column("quote", sa.Text(), nullable=True), schema=SCHEMA)
    op.add_column(
        TABLE, sa.Column("proposed_text", sa.Text(), nullable=True), schema=SCHEMA
    )
    op.create_check_constraint(
        op.f("ck_problem_reports_kind"),
        TABLE,
        "kind IN ('problem', 'question')",
        schema=SCHEMA,
    )
    # A proposed wording belongs to a quoted passage, and only questions carry them.
    op.create_check_constraint(
        op.f("ck_problem_reports_question_parts"),
        TABLE,
        "(proposed_text IS NULL OR quote IS NOT NULL)"
        " AND (kind = 'question' OR (quote IS NULL AND proposed_text IS NULL))",
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_problem_reports_question_parts"), TABLE, schema=SCHEMA)
    op.drop_constraint(op.f("ck_problem_reports_kind"), TABLE, schema=SCHEMA)
    op.drop_column(TABLE, "proposed_text", schema=SCHEMA)
    op.drop_column(TABLE, "quote", schema=SCHEMA)
    op.drop_column(TABLE, "kind", schema=SCHEMA)
