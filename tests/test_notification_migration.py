"""Migration 0057 (issue 557): ``notifications``, purely additive, on a
database that holds data; one head, up and down.

It follows 0052. Draft PR 561 ("Ask the lead") holds 0055, also on 0052; the
order of the two is set when they are merged."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from pg_harness import unmigrated_database_url
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import IntegrityError

from ontotator.storage.schema import alembic_config, head_revision, upgrade

REVISION = "0057"
S = "ontotator"


def _previous() -> str:
    scripts = ScriptDirectory.from_config(alembic_config())
    revision = scripts.get_revision(REVISION)
    assert revision is not None
    previous = revision.down_revision
    assert isinstance(previous, str)
    return previous


@pytest.fixture
def migrated(tmp_path) -> Iterator[Engine]:
    url = unmigrated_database_url(tmp_path / "notification-migration.db")
    upgrade(url, _previous())
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {S}.users (username, display_name, pseudonym)"
                " VALUES ('ann', 'Ann', 'ann-0001')"
            )
        )
        conn.execute(
            text(
                f"INSERT INTO {S}.projects (project_key, name, manifest, manifest_sha256,"
                " task_profile, task_profile_sha256)"
                " SELECT 'p', 'P', '{}'::jsonb, 'm', '{}'::jsonb, 't'"
            )
        )
    upgrade(url, REVISION)
    yield engine
    engine.dispose()


def _insert(conn, kind: str = "task_assigned") -> None:
    conn.execute(
        text(
            f"INSERT INTO {S}.notifications (recipient_id, project_id, kind)"
            f" SELECT u.id, p.id, :kind FROM {S}.users u, {S}.projects p"
        ),
        {"kind": kind},
    )


def test_one_head_and_0057_follows_0055() -> None:
    # Integration branch: 0055 (task questions) and 0057 are chained linearly.
    scripts = ScriptDirectory.from_config(alembic_config())
    assert scripts.get_heads() == [head_revision()]
    assert _previous() == "0055"


def test_existing_rows_stay_and_the_table_starts_empty(migrated):
    with migrated.begin() as conn:
        assert conn.execute(text(f"SELECT count(*) FROM {S}.users")).scalar_one() == 1
        assert (
            conn.execute(text(f"SELECT count(*) FROM {S}.notifications")).scalar_one()
            == 0
        )
        _insert(conn)
        row = conn.execute(
            text(f"SELECT created_at, read_at FROM {S}.notifications")
        ).one()
    assert row.created_at is not None and row.read_at is None


def test_an_unknown_kind_is_refused(migrated):
    with pytest.raises(IntegrityError), migrated.begin() as conn:
        _insert(conn, "something_else")


def test_the_app_role_reads_marks_and_deletes(migrated):
    with migrated.begin() as conn:
        granted = set(
            conn.execute(
                text(
                    "SELECT privilege_type FROM information_schema.role_table_grants"
                    f" WHERE table_schema = '{S}' AND table_name = 'notifications'"
                    " AND grantee = 'ontotator_app'"
                )
            ).scalars()
        )
    assert {"SELECT", "INSERT", "UPDATE", "DELETE"} <= granted


def test_downgrade_removes_only_the_new_table(migrated):
    with migrated.begin() as conn:
        command.downgrade(alembic_config(conn), _previous())
    with migrated.begin() as conn:
        assert (
            conn.execute(text("SELECT to_regclass('ontotator.notifications')"))
        ).scalar_one() is None
        assert conn.execute(text(f"SELECT count(*) FROM {S}.users")).scalar_one() == 1
