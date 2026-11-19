"""Migration 0051 (issue 483): ``translation_correction_reason_additions``,
purely additive. It follows 0049 (the lead's decisions on queries): one
head, up and down."""

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

REVISION = "0051"
PREVIOUS = "0049"
S = "ontotator"


def _table(conn: Connection) -> int:
    found: Any = conn.execute(
        text(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema ="
            f" '{S}' AND table_name = 'translation_correction_reason_additions'"
        )
    ).scalar_one()
    return int(found)


def test_one_head_follows_the_query_decision_migration() -> None:
    scripts = ScriptDirectory.from_config(alembic_config())
    # One head; a later migration follows this one.
    assert scripts.get_heads() == [head_revision()]
    revision = scripts.get_revision(REVISION)
    assert revision is not None and revision.down_revision == PREVIOUS


def test_the_table_comes_with_0051_and_goes_with_its_downgrade(tmp_path: Any) -> None:
    url = unmigrated_database_url(tmp_path / "correction-reason-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            assert _table(conn) == 0
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert _table(conn) == 1
            command.downgrade(alembic_config(conn), PREVIOUS)
        with engine.begin() as conn:
            assert (current_revision(conn), _table(conn)) == (PREVIOUS, 0)
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert (current_revision(conn), _table(conn)) == (REVISION, 1)
            # Append-only: an addition is never changed or deleted.
            triggers = conn.execute(
                text(
                    "SELECT count(*) FROM information_schema.triggers WHERE"
                    f" event_object_schema = '{S}' AND event_object_table ="
                    " 'translation_correction_reason_additions'"
                )
            ).scalar_one()
            assert triggers >= 2
    finally:
        engine.dispose()
