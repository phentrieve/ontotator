"""Migration 0058: ``projects.hide_term_id_prefix``, purely additive, after 0057."""

from __future__ import annotations

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

REVISION = "0058"
PREVIOUS = "0057"
S = "ontotator"


def _has_column(conn: Connection) -> bool:
    found = conn.execute(
        text(
            "SELECT column_name FROM information_schema.columns WHERE table_schema ="
            f" '{S}' AND table_name = 'projects'"
            " AND column_name = 'hide_term_id_prefix'"
        )
    ).scalars()
    return bool(list(found))


def test_one_head():
    scripts = ScriptDirectory.from_config(alembic_config())
    assert scripts.get_heads() == [head_revision()]
    revision = scripts.get_revision(REVISION)
    assert revision is not None and revision.down_revision == PREVIOUS


def test_the_column_comes_and_goes(tmp_path):
    url = unmigrated_database_url(tmp_path / "hide-prefix.db")
    engine = create_engine(url)
    try:
        upgrade(url, PREVIOUS)
        with engine.begin() as conn:
            assert not _has_column(conn)
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert current_revision(conn) == REVISION
            assert _has_column(conn)
        with engine.begin() as conn:
            command.downgrade(alembic_config(conn), PREVIOUS)
        with engine.begin() as conn:
            assert (current_revision(conn), _has_column(conn)) == (PREVIOUS, False)
    finally:
        engine.dispose()
