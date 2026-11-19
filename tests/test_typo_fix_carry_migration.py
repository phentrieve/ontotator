"""Migration 0052 (issue 465): ``typo_fix_carries``, purely additive. It
follows 0051 (additions to the reason of a translation correction); one head,
up and down."""

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

REVISION = "0052"
PREVIOUS = "0051"
S = "ontotator"


def _previous() -> str:
    scripts = ScriptDirectory.from_config(alembic_config())
    revision = scripts.get_revision(REVISION)
    assert revision is not None
    previous = revision.down_revision
    assert isinstance(previous, str)
    return previous


def _table(conn: Connection) -> int:
    found: Any = conn.execute(
        text(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema ="
            f" '{S}' AND table_name = 'typo_fix_carries'"
        )
    ).scalar_one()
    return int(found)


def test_one_head_and_0052_follows_0051() -> None:
    scripts = ScriptDirectory.from_config(alembic_config())
    assert scripts.get_heads() == [head_revision()]
    assert _previous() == PREVIOUS


def test_the_table_comes_with_0052_and_goes_with_its_downgrade(tmp_path: Any) -> None:
    previous = _previous()
    url = unmigrated_database_url(tmp_path / "typo-fix-carry-migration.db")
    upgrade(url, previous)
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            assert _table(conn) == 0
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert _table(conn) == 1
            command.downgrade(alembic_config(conn), previous)
        with engine.begin() as conn:
            assert (current_revision(conn), _table(conn)) == (previous, 0)
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert (current_revision(conn), _table(conn)) == (REVISION, 1)
            # Append-only: a record of a carry is never changed or deleted.
            triggers = conn.execute(
                text(
                    "SELECT count(*) FROM information_schema.triggers WHERE"
                    f" event_object_schema = '{S}' AND event_object_table ="
                    " 'typo_fix_carries'"
                )
            ).scalar_one()
            assert triggers >= 2
    finally:
        engine.dispose()
