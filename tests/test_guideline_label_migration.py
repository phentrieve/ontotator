"""Migration 0048 (issue 487): a project's own label of a guideline version,
one nullable column on ``guideline_versions``, purely additive."""

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

REVISION = "0048"
S = "ontotator"


def _previous() -> str:
    revision = ScriptDirectory.from_config(alembic_config()).get_revision(REVISION)
    assert revision is not None and isinstance(revision.down_revision, str)
    return revision.down_revision


def _has_label(conn: Connection) -> bool:
    found = conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns WHERE table_schema ="
            f" '{S}' AND table_name = 'guideline_versions'"
            " AND column_name = 'label'"
        )
    ).first()
    return found is not None


def test_one_head():
    scripts = ScriptDirectory.from_config(alembic_config())
    assert scripts.get_heads() == [head_revision()]
    assert scripts.get_revision(REVISION) is not None


def test_versions_start_without_a_label_and_the_downgrade_drops_it(tmp_path):
    url = unmigrated_database_url(tmp_path / "guideline-label-migration.db")
    previous = _previous()
    upgrade(url, previous)
    engine = create_engine(url)
    insert = (
        f"INSERT INTO {S}.guideline_versions (project_id, version, kind,"
        " body_sha256, size_bytes, created_by, created_by_label{extra})"
        " VALUES (:pid, :version, 'markdown', 'h', 1, :uid, 'P-1'{value})"
    )
    try:
        with engine.begin() as conn:
            assert not _has_label(conn)
            pid = conn.execute(
                text(
                    f"INSERT INTO {S}.projects (project_key, name, manifest,"
                    " manifest_sha256, task_profile, task_profile_sha256) VALUES"
                    " ('p', 'P', '{}', 'm', '{}', 't') RETURNING id"
                )
            ).scalar_one()
            uid = conn.execute(
                text(
                    f"INSERT INTO {S}.users (username, display_name, pseudonym) VALUES"
                    " ('lead', 'Lead', 'P-1') RETURNING id"
                )
            ).scalar_one()
            # A version published before labels existed.
            conn.execute(
                text(insert.format(extra="", value="")),
                {"pid": pid, "version": 1, "uid": uid},
            )
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert _has_label(conn)
            stored = conn.execute(
                text(f"SELECT version, label FROM {S}.guideline_versions")
            ).all()
            assert [tuple(row) for row in stored] == [(1, None)]
            conn.execute(
                text(insert.format(extra=", label", value=", '3.1'")),
                {"pid": pid, "version": 2, "uid": uid},
            )
            # A label is never empty and at most 40 characters.
            for bad in ("", "x" * 41):
                refused = conn.begin_nested()
                try:
                    conn.execute(
                        text(insert.format(extra=", label", value=", :label")),
                        {"pid": pid, "version": 3, "uid": uid, "label": bad},
                    )
                    raise AssertionError("an invalid label was stored")
                except Exception as error:
                    assert "ck_guideline_versions_label" in str(error)
                    refused.rollback()
        with engine.begin() as conn:
            command.downgrade(alembic_config(conn), previous)
        with engine.begin() as conn:
            assert (current_revision(conn), _has_label(conn)) == (previous, False)
            kept = conn.execute(
                text(f"SELECT version FROM {S}.guideline_versions ORDER BY version")
            ).scalars()
            assert list(kept) == [1, 2]
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert (current_revision(conn), _has_label(conn)) == (REVISION, True)
    finally:
        engine.dispose()
