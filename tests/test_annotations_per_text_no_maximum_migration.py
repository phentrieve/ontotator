"""Migration 0050 (issue 457): "Annotations per text" has no built-in
maximum; the check constraints keep only the minimum of 1."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from alembic import command
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.exc import IntegrityError

from ontotator.storage.schema import alembic_config, upgrade

REVISION = "0050"
S = "ontotator"


def _previous() -> str:
    """The revision 0050 follows (the head when it is merged)."""
    from alembic.script import ScriptDirectory

    revision = ScriptDirectory.from_config(alembic_config()).get_revision(REVISION)
    assert revision is not None and isinstance(revision.down_revision, str)
    return revision.down_revision


def _exec(conn: Connection, sql: str) -> Any:
    return conn.execute(text(sql))


def _project(conn: Connection, value: int) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
        " task_profile, task_profile_sha256, annotations_per_text) VALUES"
        f" ('p{value}', 'P', '{{}}', 'm', '{{}}', 't', {value})",
    )


def _text(conn: Connection, value: int) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.text_settings (project_id, case_id, language,"
        f" annotations_per_text) SELECT min(id), 'c{value}', 'en', {value}"
        f" FROM {S}.projects",
    )


def _refused(engine: Engine, insert: Any, value: int) -> bool:
    try:
        with engine.begin() as conn:
            insert(conn, value)
    except IntegrityError:
        return True
    return False


@pytest.fixture
def engine(tmp_path: Any) -> Iterator[Engine]:
    url = unmigrated_database_url(tmp_path / "per-text-no-maximum-migration.db")
    upgrade(url, _previous())
    engine = create_engine(url)
    with engine.begin() as conn:
        _project(conn, 20)
        _text(conn, 20)
    assert _refused(engine, _project, 21)
    assert _refused(engine, _text, 21)
    upgrade(url, REVISION)
    try:
        yield engine
    finally:
        engine.dispose()


def test_only_the_minimum_is_left_and_existing_rows_stay(engine):
    for insert in (_project, _text):
        assert not _refused(engine, insert, 21)
        assert not _refused(engine, insert, 30)
        assert not _refused(engine, insert, 5000)
        assert _refused(engine, insert, 0)
        assert _refused(engine, insert, -1)
    with engine.begin() as conn:
        for table in ("projects", "text_settings"):
            assert (
                _exec(
                    conn,
                    f"SELECT min(annotations_per_text) FROM {S}.{table}",
                ).scalar_one()
                == 20
            )


@pytest.mark.parametrize(
    ("insert", "message"),
    [
        (_project, "1 projects have more than 20 annotations per text"),
        (_text, "1 texts have more than 20 annotations per text"),
    ],
)
def test_downgrade_refuses_while_a_value_is_above_20(engine, insert, message):
    with engine.begin() as conn:
        insert(conn, 30)
    with pytest.raises(RuntimeError, match=message), engine.begin() as conn:
        command.downgrade(alembic_config(conn), _previous())
    # Nothing changed: a larger value is still accepted.
    assert not _refused(engine, insert, 31)


def test_downgrade_restores_the_bound_of_20(engine):
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), _previous())
    for insert in (_project, _text):
        assert _refused(engine, insert, 21)
        assert not _refused(engine, insert, 19)
