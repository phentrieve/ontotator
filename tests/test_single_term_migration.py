"""Migration 0039 (issue 381): single-term review, purely additive; the
practice and empty-project deletions know its tables.

Every value below is invented for the tests.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from alembic import command
from auth_harness import add_ontology, ensure_user, grant, logged_in
from fastapi import FastAPI
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, create_engine, text
from t1_fixtures import HP_PATH, create_project
from test_auth_api import _app

from ontotator.storage.repository import Repository
from ontotator.storage.schema import alembic_config, upgrade

REVISION = "0039"
PREVIOUS = "0038"
S = "ontotator"
TABLES = (
    "single_term_reviewers",
    "single_term_bases",
    "single_term_batches",
    "single_term_batch_state",
    "single_term_decisions",
)


def _exec(conn: Connection, sql: str, **params: Any) -> Any:
    return conn.execute(text(sql), params)


def _tables(conn: Connection) -> set[str]:
    return set(
        _exec(
            conn,
            "SELECT table_name FROM information_schema.tables"
            " WHERE table_schema = :s AND table_name LIKE 'single_term%'",
            s=S,
        ).scalars()
    )


def _function(conn: Connection, name: str) -> str:
    return str(
        _exec(
            conn,
            "SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n"
            " ON n.oid = p.pronamespace WHERE n.nspname = :s AND p.proname = :f",
            s=S,
            f=name,
        ).scalar_one()
    )


def test_upgrade_adds_columns_and_tables_and_downgrade_restores(tmp_path: Path):
    url = unmigrated_database_url(tmp_path / "single-terms.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            before = {
                name: _function(conn, name)
                for name in ("delete_practice_project", "delete_empty_project")
            }
            _exec(
                conn,
                f"INSERT INTO {S}.projects (project_key, name, manifest,"
                " manifest_sha256, task_profile, task_profile_sha256)"
                " VALUES ('p', 'p', '{}', 'm', '{}', 't')",
            )
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert _tables(conn) == set(TABLES)
            row = _exec(
                conn,
                f"SELECT single_term_review, single_term_negation_cues FROM {S}.projects",
            ).one()
            assert tuple(row) == (False, {})
            assert "single_term_batch_state" in _function(
                conn, "delete_practice_project"
            )
            assert "'single_term_reviewers'" in _function(conn, "delete_empty_project")
            command.downgrade(alembic_config(conn), PREVIOUS)
        with engine.begin() as conn:
            assert _tables(conn) == set()
            columns = _exec(
                conn,
                "SELECT count(*) FROM information_schema.columns WHERE"
                f" table_schema = '{S}' AND table_name = 'projects'"
                " AND column_name LIKE 'single_term%'",
            ).scalar_one()
            assert columns == 0
            for name, definition in before.items():
                assert _function(conn, name) == definition
    finally:
        engine.dispose()


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    app = _app(tmp_path)
    add_ontology(app, HP_PATH)
    create_project(app.state.repo.db, "real")
    return app


def _pid(app: FastAPI, key: str) -> int:
    with app.state.repo.db.transaction() as conn:
        pid = Repository._project_id(conn, key)
    assert pid is not None
    return pid


def _review_rows(conn: Connection, pid: int, user_id: int) -> None:
    """A basis, a batch with its state and a decision, inserted directly."""
    _exec(
        conn,
        f"INSERT INTO {S}.export_selection_snapshots (snapshot_id, project_id,"
        " requester_id, request_id, sha256, payload)"
        " VALUES (:sid, :p, :u, 'r', 'x', '{}')",
        sid=f"snap-{pid}",
        p=pid,
        u=user_id,
    )
    basis = _exec(
        conn,
        f"INSERT INTO {S}.single_term_bases (project_id, snapshot_id,"
        " derivation_sha256, negation_cues, report, created_by)"
        " VALUES (:p, :sid, 'd', '{}', '{}', :u) RETURNING id",
        p=pid,
        sid=f"snap-{pid}",
        u=user_id,
    ).scalar_one()
    batch = _exec(
        conn,
        f"INSERT INTO {S}.single_term_batches (project_id, basis_id, created_by,"
        " reviewer_user_id, role, filter, group_ids)"
        " VALUES (:p, :b, :u, :u, 'primary', '{}', '[]') RETURNING id",
        p=pid,
        b=basis,
        u=user_id,
    ).scalar_one()
    _exec(
        conn,
        f"INSERT INTO {S}.single_term_batch_state (batch_id, state)"
        " VALUES (:b, 'open')",
        b=batch,
    )
    _exec(
        conn,
        f"INSERT INTO {S}.single_term_decisions (project_id, batch_id, basis_id,"
        " group_id, role, language, phrase_norm, term_id, phrase_only, decision,"
        " occurrence_refs, reviewer_user_id, reviewer_pseudonym,"
        " reviewer_independent) VALUES (:p, :bt, :b, 'g', 'primary', 'de',"
        " 'krampfanfälle', 'HP:0001250', 'would_accept', 'accept', '[]', :u,"
        " 'ann-0001', true)",
        p=pid,
        bt=batch,
        b=basis,
        u=user_id,
    )


def test_deleting_a_practice_project_clears_its_review_rows(app: FastAPI) -> None:
    ensure_user(app, "ann")
    assert grant(app, "ann", "real", ["annotator"])
    key = (
        logged_in(app, "ann")
        .post("/api/v1/me/practice")
        .json()["project"]["project_key"]
    )
    pid = _pid(app, key)
    user_id = app.state.accounts.get_by_username("ann").id
    db = app.state.repo.db
    with db.transaction() as conn:
        _review_rows(conn, pid, user_id)
    with db.transaction() as conn:
        counts = _exec(conn, f"SELECT {S}.delete_practice_project(:p)", p=pid)
        deleted = counts.scalar_one()
    assert deleted["single_term_decisions"] == 1
    assert deleted["single_term_batches"] == 1
    with db.transaction() as conn:
        for table in TABLES:
            left = _exec(conn, f"SELECT count(*) FROM {S}.{table}").scalar_one()
            assert left == 0, table


def test_single_term_reviewers_are_setup_of_an_empty_project(app: FastAPI) -> None:
    ensure_user(app, "lea")
    assert grant(app, "lea", "real", ["lead"])
    pid = _pid(app, "real")
    user_id = app.state.accounts.get_by_username("lea").id
    db = app.state.repo.db
    with db.transaction() as conn:
        _exec(
            conn,
            f"INSERT INTO {S}.single_term_reviewers (project_id, user_id)"
            " VALUES (:p, :u)",
            p=pid,
            u=user_id,
        )
    with db.transaction() as conn:
        result = _exec(conn, f"SELECT {S}.delete_empty_project(:p)", p=pid).scalar_one()
    assert result["deleted"] is True, result
    assert result["rows"]["single_term_reviewers"] == 1
