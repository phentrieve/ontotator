"""Migration 0041 (issue 447): "Annotations per text" may be up to 20."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from alembic import command
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.exc import IntegrityError

from ontotator.storage.schema import alembic_config, upgrade

REVISION = "0041"
PREVIOUS = "0040"
S = "ontotator"


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
    url = unmigrated_database_url(tmp_path / "per-text-limit-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    with engine.begin() as conn:
        _project(conn, 5)
        _text(conn, 5)
    assert _refused(engine, _project, 6)
    assert _refused(engine, _text, 6)
    upgrade(url, REVISION)
    try:
        yield engine
    finally:
        engine.dispose()


def test_both_bounds_are_20_and_existing_rows_stay(engine):
    for insert in (_project, _text):
        assert not _refused(engine, insert, 6)
        assert not _refused(engine, insert, 20)
        assert _refused(engine, insert, 21)
        assert _refused(engine, insert, 0)
    with engine.begin() as conn:
        assert (
            _exec(
                conn,
                f"SELECT annotations_per_text FROM {S}.projects WHERE project_key='p5'",
            ).scalar_one()
            == 5
        )


@pytest.mark.parametrize(
    ("insert", "message"),
    [
        (_project, "1 projects have more than 5 annotations per text"),
        (_text, "1 texts have more than 5 annotations per text"),
    ],
)
def test_downgrade_refuses_while_a_value_is_above_5(engine, insert, message):
    with engine.begin() as conn:
        insert(conn, 12)
    with pytest.raises(RuntimeError, match=message), engine.begin() as conn:
        command.downgrade(alembic_config(conn), PREVIOUS)
    # Nothing changed: 20 is still accepted.
    assert not _refused(engine, insert, 20)


def test_downgrade_restores_the_bound_of_5(engine):
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), PREVIOUS)
    for insert in (_project, _text):
        assert _refused(engine, insert, 6)
        assert not _refused(engine, insert, 4)
