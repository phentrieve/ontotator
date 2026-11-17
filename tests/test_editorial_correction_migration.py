"""Migration 0043 (issue 453): ``translation_editorial_corrections``, purely
additive. It follows 0042 (uploaded translation versions): one head,
0041 → 0042 → 0043."""

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

REVISION = "0043"
PREVIOUS = "0042"
BEFORE = "0041"
S = "ontotator"


def _table(conn: Connection) -> int:
    found: Any = conn.execute(
        text(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema ="
            f" '{S}' AND table_name = 'translation_editorial_corrections'"
        )
    ).scalar_one()
    return int(found)


def test_one_head_follows_the_version_uploads():
    scripts = ScriptDirectory.from_config(alembic_config())
    assert scripts.get_heads() == [head_revision()]
    revision = scripts.get_revision(REVISION)
    assert revision is not None and revision.down_revision == PREVIOUS
    previous = scripts.get_revision(PREVIOUS)
    assert previous is not None and previous.down_revision == BEFORE


def test_the_table_comes_with_0043_and_goes_with_its_downgrade(tmp_path):
    url = unmigrated_database_url(tmp_path / "editorial-migration.db")
    upgrade(url, BEFORE)
    engine = create_engine(url)
    try:
        upgrade(url, PREVIOUS)
        with engine.begin() as conn:
            assert _table(conn) == 0
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert _table(conn) == 1
            command.downgrade(alembic_config(conn), PREVIOUS)
        with engine.begin() as conn:
            assert (current_revision(conn), _table(conn)) == (PREVIOUS, 0)
            command.downgrade(alembic_config(conn), BEFORE)
        with engine.begin() as conn:
            assert current_revision(conn) == BEFORE
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert (current_revision(conn), _table(conn)) == (REVISION, 1)
    finally:
        engine.dispose()
