"""Migration 0045 (issue 464): the lead pause of a text, four columns on
``text_settings``, purely additive. It follows 0044 (editorial corrections),
which follows 0043 (when an assignment was started): one head."""

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

REVISION = "0045"
S = "ontotator"
COLUMNS = {"paused", "pause_reason", "paused_by", "paused_at"}


PREVIOUS = "0044"
BEFORE = "0043"


def _previous() -> str:
    revision = ScriptDirectory.from_config(alembic_config()).get_revision(REVISION)
    assert revision is not None and isinstance(revision.down_revision, str)
    return revision.down_revision


def _columns(conn: Connection) -> set[str]:
    found = conn.execute(
        text(
            "SELECT column_name FROM information_schema.columns WHERE table_schema ="
            f" '{S}' AND table_name = 'text_settings'"
        )
    ).scalars()
    return set(found) & COLUMNS


def test_one_head():
    scripts = ScriptDirectory.from_config(alembic_config())
    assert scripts.get_heads() == [head_revision()]
    assert _previous() == PREVIOUS
    previous = scripts.get_revision(PREVIOUS)
    assert previous is not None and previous.down_revision == BEFORE


def test_the_chain_walks_up_to_0045_and_back(tmp_path):
    url = unmigrated_database_url(tmp_path / "lead-pause-chain.db")
    engine = create_engine(url)
    try:
        for step in (BEFORE, PREVIOUS, REVISION):
            upgrade(url, step)
            with engine.begin() as conn:
                assert current_revision(conn) == step
                assert (_columns(conn) == COLUMNS) is (step == REVISION)
        for step in (PREVIOUS, BEFORE):
            with engine.begin() as conn:
                command.downgrade(alembic_config(conn), step)
            with engine.begin() as conn:
                assert (current_revision(conn), _columns(conn)) == (step, set())
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert (current_revision(conn), _columns(conn)) == (REVISION, COLUMNS)
    finally:
        engine.dispose()


def test_texts_start_not_paused_and_the_downgrade_drops_the_columns(tmp_path):
    url = unmigrated_database_url(tmp_path / "lead-pause-migration.db")
    previous = _previous()
    upgrade(url, previous)
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            assert _columns(conn) == set()
            # A text with its own "annotations per text", set before the pause existed.
            pid = conn.execute(
                text(
                    f"INSERT INTO {S}.projects (project_key, name, manifest,"
                    " manifest_sha256, task_profile, task_profile_sha256) VALUES"
                    " ('p', 'P', '{}', 'm', '{}', 't') RETURNING id"
                )
            ).scalar_one()
            conn.execute(
                text(
                    f"INSERT INTO {S}.text_settings (project_id, case_id, language,"
                    " annotations_per_text) VALUES (:pid, 'c1', 'en', 3)"
                ),
                {"pid": pid},
            )
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert _columns(conn) == COLUMNS
            row = conn.execute(
                text(
                    "SELECT annotations_per_text, paused, pause_reason, paused_at"
                    f" FROM {S}.text_settings"
                )
            ).one()
            assert tuple(row) == (3, False, None, None)
            # A pause needs its reason and its time.
            refused = conn.begin_nested()
            try:
                conn.execute(text(f"UPDATE {S}.text_settings SET paused = true"))
                raise AssertionError("a pause without a reason was stored")
            except Exception as error:
                assert "ck_text_settings_pause" in str(error)
                refused.rollback()
            command.downgrade(alembic_config(conn), previous)
        with engine.begin() as conn:
            assert (current_revision(conn), _columns(conn)) == (previous, set())
            kept = conn.execute(
                text(f"SELECT annotations_per_text FROM {S}.text_settings")
            ).scalar_one()
            assert kept == 3
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert (current_revision(conn), _columns(conn)) == (REVISION, COLUMNS)
    finally:
        engine.dispose()
