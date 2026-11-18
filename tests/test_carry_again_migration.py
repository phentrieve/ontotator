"""Migration 0047 (issue 461): a submission may be carried to one version
more than once. The unique constraint on (project, submission, target) of
``text_change_resolutions`` becomes a plain index; no row changes. It follows
0046 (the typo fix after a review): one head."""

from __future__ import annotations

from typing import Any

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from pg_harness import unmigrated_database_url
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.exc import IntegrityError

from ontotator.storage.schema import (
    alembic_config,
    current_revision,
    head_revision,
    upgrade,
)

# Renumbering only touches these two constants.
REVISION = "0047"
PREVIOUS = "0046"
S = "ontotator"
UNIQUE = "uq_text_change_resolutions_submission_target"
INDEX = "ix_text_change_resolutions_submission_target"


def _exec(conn: Connection, sql: str, **params: Any) -> Any:
    return conn.execute(text(sql), params)


def _seed(conn: Connection) -> None:
    """A text v1 with its correction v2 and a submission on v1."""
    _exec(
        conn,
        f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
        " task_profile, task_profile_sha256) VALUES ('p', 'P', '{}', 'm', '{}', 't')",
    )
    _exec(
        conn,
        f"INSERT INTO {S}.users (username, display_name, pseudonym)"
        " VALUES ('ann', 'Ann', 'ann-0001')",
    )
    for doc, version, derived in (("v1", 1, None), ("v2", 2, "v1")):
        _exec(
            conn,
            f"INSERT INTO {S}.documents (project_id, document_id, language, text,"
            " case_id, external_id, version, origin, derived_from, text_sha256)"
            " SELECT id, :doc, 'en', 'x', 'c1', 'c1', :version,"
            " CASE WHEN :version = 1 THEN 'native' ELSE 'correction' END, :derived,"
            f" 'h' FROM {S}.projects",
            doc=doc,
            version=version,
            derived=derived,
        )
    _exec(
        conn,
        f"INSERT INTO {S}.submissions (project_id, submission_id, local_key,"
        " origin_key, document_id, annotator_id, mode, draft_revision, payload,"
        " created_at) SELECT id, 's1', 'k', 'k', 'v1', 'ann-0001', 'independent',"
        f" 1, '{{}}', '2026-11-18T10:00:00Z' FROM {S}.projects",
    )


def _carried(conn: Connection) -> None:
    _exec(
        conn,
        f"INSERT INTO {S}.text_change_resolutions (project_id, case_id, language,"
        " from_document_id, to_document_id, submission_id, resolution)"
        f" SELECT id, 'c1', 'en', 'v1', 'v2', 's1', 'carried' FROM {S}.projects",
    )


def _count(conn: Connection) -> int:
    return int(
        _exec(conn, f"SELECT count(*) FROM {S}.text_change_resolutions").scalar_one()
    )


def _has(conn: Connection) -> tuple[bool, bool]:
    """Whether the unique constraint and the plain index exist."""
    unique = _exec(
        conn, "SELECT 1 FROM pg_constraint WHERE conname = :name", name=UNIQUE
    ).first()
    index = _exec(
        conn,
        "SELECT 1 FROM pg_indexes WHERE schemaname = :s AND indexname = :name",
        s=S,
        name=INDEX,
    ).first()
    return unique is not None, index is not None


def test_one_head_follows_the_lead_pause():
    scripts = ScriptDirectory.from_config(alembic_config())
    assert scripts.get_heads() == [head_revision()] == [REVISION]
    revision = scripts.get_revision(REVISION)
    assert revision is not None and revision.down_revision == PREVIOUS


def test_a_second_carry_row_is_stored_and_the_first_is_kept(tmp_path):
    url = unmigrated_database_url(tmp_path / "carry-again-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            _seed(conn)
            _carried(conn)
            assert _has(conn) == (True, False)
        with pytest.raises(IntegrityError, match=UNIQUE), engine.begin() as conn:
            _carried(conn)
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert current_revision(conn) == REVISION
            assert _has(conn) == (False, True)
            # The existing row is untouched; a second one is stored beside it.
            assert _count(conn) == 1
            _carried(conn)
            assert _count(conn) == 2
        # Two decisions for one target: the unique constraint cannot return.
        with (
            pytest.raises(RuntimeError, match="Cannot downgrade"),
            engine.begin() as conn,
        ):
            command.downgrade(alembic_config(conn), PREVIOUS)
        with engine.begin() as conn:
            assert current_revision(conn) == REVISION
            assert (_has(conn), _count(conn)) == ((False, True), 2)
    finally:
        engine.dispose()


def test_the_downgrade_restores_the_unique_constraint(tmp_path):
    url = unmigrated_database_url(tmp_path / "carry-again-downgrade.db")
    upgrade(url, REVISION)
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            _seed(conn)
            _carried(conn)
            command.downgrade(alembic_config(conn), PREVIOUS)
        with engine.begin() as conn:
            assert current_revision(conn) == PREVIOUS
            assert (_has(conn), _count(conn)) == ((True, False), 1)
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert (_has(conn), _count(conn)) == ((False, True), 1)
    finally:
        engine.dispose()
