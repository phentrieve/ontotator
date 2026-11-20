"""Migration 0055 (issue 553): questions are problem reports of kind
``question``. Three columns on ``problem_reports``; existing rows become
kind ``problem``. It follows 0052: one head, up and down."""

from __future__ import annotations

from typing import Any

from alembic import command
from alembic.script import ScriptDirectory
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, create_engine, text

from ontotator.storage.schema import (
    alembic_config,
    current_revision,
    head_revision,
    upgrade,
)

REVISION = "0055"
PREVIOUS = "0052"
S = "ontotator"


def _columns(conn: Connection) -> set[str]:
    return set(
        conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns WHERE"
                f" table_schema = '{S}' AND table_name = 'problem_reports'"
            )
        ).scalars()
    )


def test_one_head_follows_the_typo_fix_carry_migration() -> None:
    scripts = ScriptDirectory.from_config(alembic_config())
    assert scripts.get_heads() == [head_revision()]
    revision = scripts.get_revision(REVISION)
    assert revision is not None and revision.down_revision == PREVIOUS


def test_the_columns_come_with_0055_and_go_with_its_downgrade(tmp_path: Any) -> None:
    url = unmigrated_database_url(tmp_path / "task-questions-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    added = {"kind", "quote", "proposed_text"}
    try:
        with engine.begin() as conn:
            assert not added & _columns(conn)
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert added <= _columns(conn)
            default = conn.execute(
                text(
                    "SELECT column_default FROM information_schema.columns WHERE"
                    f" table_schema = '{S}' AND table_name = 'problem_reports'"
                    " AND column_name = 'kind'"
                )
            ).scalar_one()
            assert "problem" in default
            command.downgrade(alembic_config(conn), PREVIOUS)
        with engine.begin() as conn:
            assert current_revision(conn) == PREVIOUS
            assert not added & _columns(conn)
    finally:
        engine.dispose()
