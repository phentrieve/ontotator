"""Single-term review (issue 381).

Purely additive:

* ``projects.single_term_review`` (``NOT NULL DEFAULT false``) switches the
  review on per project. A constant default: PostgreSQL adds it without
  rewriting the table.
* ``single_term_bases``, ``single_term_batches`` and
  ``single_term_decisions``: append-only history with the shared
  ``forbid_history_change()`` trigger; ``single_term_batch_state`` holds the
  one mutable fact of a batch (pattern ``work_rounds``/``work_round_state``).

``delete_practice_project`` is replaced with a version that empties
``single_term_batch_state`` (it has no ``project_id``) before the generic
pass, its text otherwise unchanged. The downgrade restores it.

Follows 0038 (delete a project without work).
"""

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
HISTORY = ("single_term_bases", "single_term_batches", "single_term_decisions")
ROLES = "('primary', 'second')"
STATES = "('open', 'abandoned')"
PHRASE_ONLY = "('would_accept', 'would_reject')"
DECISIONS = "('accept', 'adjust_span', 'adjust_term', 'reject', 'withdrawn')"
REASONS = (
    "('needs_context', 'ambiguous_abbreviation', 'too_general',"
    " 'needs_rewrite', 'conflict', 'other')"
)


def _migration(name: str) -> ModuleType:
    """An earlier revision of this directory, for the function text it holds."""
    path = Path(__file__).with_name(f"{name}.py")
    spec = importlib.util.spec_from_file_location(f"_ontotator_{name}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _replaced(text: str, old: str, new: str) -> str:
    assert text.count(old) == 1, old
    return text.replace(old, new)


def _practice_functions() -> tuple[str, str]:
    """(original, with single-term state) of ``delete_practice_project``."""
    original = _migration("0029_practice_projects")._DELETE_PRACTICE.replace(
        "CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1
    )
    anchor = f"  DELETE FROM {SCHEMA}.translation_review_drafts WHERE assignment_id IN"
    extended = _replaced(
        original,
        anchor,
        f"  DELETE FROM {SCHEMA}.single_term_batch_state WHERE batch_id IN\n"
        f"    (SELECT id FROM {SCHEMA}.single_term_batches"
        " WHERE project_id = p_project);\n" + anchor,
    )
    return original, extended


def _id() -> sa.Column[Any]:
    return sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True)


def _project() -> sa.Column[Any]:
    return sa.Column(
        "project_id",
        sa.BigInteger(),
        sa.ForeignKey(f"{SCHEMA}.projects.id"),
        nullable=False,
    )


def _user(name: str, *, nullable: bool = False) -> sa.Column[Any]:
    return sa.Column(
        name, sa.BigInteger(), sa.ForeignKey(f"{SCHEMA}.users.id"), nullable=nullable
    )


def _created(name: str = "created_at") -> sa.Column[Any]:
    return sa.Column(
        name, sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "single_term_review",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "single_term_bases",
        _id(),
        _project(),
        sa.Column(
            "snapshot_id",
            sa.Text(),
            sa.ForeignKey(f"{SCHEMA}.export_selection_snapshots.snapshot_id"),
            nullable=False,
        ),
        sa.Column("derivation_sha256", sa.Text(), nullable=False),
        sa.Column("report", postgresql.JSONB(), nullable=False),
        _user("created_by"),
        _created(),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_single_term_bases_project_id_id",
        "single_term_bases",
        ["project_id", "id"],
        schema=SCHEMA,
    )
    op.create_table(
        "single_term_batches",
        _id(),
        _project(),
        sa.Column(
            "basis_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.single_term_bases.id"),
            nullable=False,
        ),
        _user("created_by"),
        _user("reviewer_user_id"),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column(
            "parent_batch_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.single_term_batches.id"),
            nullable=True,
        ),
        sa.Column("filter", postgresql.JSONB(), nullable=False),
        sa.Column("group_ids", postgresql.JSONB(), nullable=False),
        _created(),
        sa.CheckConstraint(f"role IN {ROLES}", name="role"),
        sa.CheckConstraint(
            "(role = 'primary') = (parent_batch_id IS NULL)", name="parent"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_single_term_batches_project_id_basis_id",
        "single_term_batches",
        ["project_id", "basis_id"],
        schema=SCHEMA,
    )
    op.create_table(
        "single_term_batch_state",
        sa.Column(
            "batch_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.single_term_batches.id"),
            primary_key=True,
        ),
        sa.Column("state", sa.Text(), nullable=False),
        _created("updated_at"),
        _user("updated_by", nullable=True),
        sa.CheckConstraint(f"state IN {STATES}", name="state"),
        schema=SCHEMA,
    )
    op.create_table(
        "single_term_decisions",
        _id(),
        _project(),
        sa.Column(
            "batch_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.single_term_batches.id"),
            nullable=False,
        ),
        sa.Column(
            "basis_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.single_term_bases.id"),
            nullable=False,
        ),
        sa.Column("group_id", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("phrase_norm", sa.Text(), nullable=False),
        sa.Column("term_id", sa.Text(), nullable=False),
        sa.Column("phrase_only", sa.Text(), nullable=True),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("adjusted_span", postgresql.JSONB(), nullable=True),
        sa.Column("adjusted_term_id", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("occurrence_refs", postgresql.JSONB(), nullable=False),
        _user("reviewer_user_id"),
        sa.Column("reviewer_pseudonym", sa.Text(), nullable=False),
        sa.Column("reviewer_independent", sa.Boolean(), nullable=False),
        sa.Column("guideline_version", sa.Integer(), nullable=True),
        _created(),
        sa.CheckConstraint(f"role IN {ROLES}", name="role"),
        sa.CheckConstraint(f"decision IN {DECISIONS}", name="decision"),
        sa.CheckConstraint(
            f"phrase_only IS NULL OR phrase_only IN {PHRASE_ONLY}",
            name="phrase_only",
        ),
        sa.CheckConstraint(
            "(decision = 'withdrawn') OR (phrase_only IS NOT NULL)",
            name="phrase_only_given",
        ),
        sa.CheckConstraint(
            "(decision = 'reject') = (reason IS NOT NULL)"
            f" AND (reason IS NULL OR reason IN {REASONS})",
            name="reason",
        ),
        sa.CheckConstraint(
            "(decision = 'adjust_span') = (adjusted_span IS NOT NULL)",
            name="adjusted_span",
        ),
        sa.CheckConstraint(
            "(decision = 'adjust_term') = (adjusted_term_id IS NOT NULL)",
            name="adjusted_term",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "guideline_version"],
            [
                f"{SCHEMA}.guideline_versions.project_id",
                f"{SCHEMA}.guideline_versions.version",
            ],
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_single_term_decisions_project_id_group_id_role_id",
        "single_term_decisions",
        ["project_id", "group_id", "role", "id"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_single_term_decisions_batch_id",
        "single_term_decisions",
        ["batch_id"],
        schema=SCHEMA,
    )
    for table in HISTORY:
        op.execute(
            f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE"
            f" ON {SCHEMA}.{table} FOR EACH ROW"
            f" EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(
            f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE"
            f" ON {SCHEMA}.{table} FOR EACH STATEMENT"
            f" EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.{table} TO {APP_ROLE}")
        op.execute(
            f"GRANT USAGE, SELECT ON SEQUENCE {SCHEMA}.{table}_id_seq TO {APP_ROLE}"
        )
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.single_term_batch_state"
        f" TO {APP_ROLE}"
    )
    op.execute(_practice_functions()[1])


def downgrade() -> None:
    op.execute(_practice_functions()[0])
    for table in (
        "single_term_decisions",
        "single_term_batch_state",
        "single_term_batches",
        "single_term_bases",
    ):
        op.drop_table(table, schema=SCHEMA)
    op.drop_column("projects", "single_term_review", schema=SCHEMA)
