"""Migration 0042 (issue 341 a): ``translation_version_uploads``, purely
additive. It follows 0041 (annotators per text up to 20); both were written
on 0040, so this also holds the order: one head, 0040 → 0041 → 0042."""

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

REVISION = "0042"
PREVIOUS = "0041"
BEFORE = "0040"
S = "ontotator"


def _table(conn: Connection) -> int:
    found: Any = conn.execute(
        text(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema ="
            f" '{S}' AND table_name = 'translation_version_uploads'"
        )
    ).scalar_one()
    return int(found)


def test_one_head_follows_the_annotators_limit():
    scripts = ScriptDirectory.from_config(alembic_config())
    assert scripts.get_heads() == [head_revision()]
    revision = scripts.get_revision(REVISION)
    assert revision is not None and revision.down_revision == PREVIOUS
    previous = scripts.get_revision(PREVIOUS)
    assert previous is not None and previous.down_revision == BEFORE


def test_the_table_comes_with_0042_and_goes_with_its_downgrade(tmp_path):
    url = unmigrated_database_url(tmp_path / "version-upload-migration.db")
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
