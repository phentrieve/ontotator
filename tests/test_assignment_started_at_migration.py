"""Migration 0043 (issue 268): ``assignments.started_at``, purely additive,
with a backfill for assignments that already left ``open``."""

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

REVISION = "0043"
PREVIOUS = "0042"
S = "ontotator"
STATUSES = {
    "annotate": "open",
    "review": "in_progress",
    "translation_review": "reopened",
}


def _seed(conn: Connection) -> None:
    conn.execute(
        text(
            f"INSERT INTO {S}.projects (project_key, name, manifest,"
            " manifest_sha256, task_profile, task_profile_sha256)"
            " VALUES ('old', 'old', '{}', 'm', '{}', 't')"
        )
    )
    conn.execute(
        text(
            f"INSERT INTO {S}.users (username, display_name, pseudonym)"
            " VALUES ('ann', 'Ann', 'ann-0001')"
        )
    )
    conn.execute(
        text(
            f"INSERT INTO {S}.documents (project_id, document_id, language, text,"
            " case_id, external_id, version, origin, text_sha256)"
            f" SELECT id, 'd1', 'en', 'x', 'c1', 'c1', 1, 'native', 'h'"
            f" FROM {S}.projects"
        )
    )
    for task, status in STATUSES.items():
        mode = "'scratch'" if task == "annotate" else "NULL"
        conn.execute(
            text(
                f"INSERT INTO {S}.assignments (project_id, document_id, user_id,"
                " task, status, annotation_mode)"
                f" SELECT p.id, 'd1', u.id, :task, :status, {mode}"
                f" FROM {S}.projects p, {S}.users u"
            ),
            {"task": task, "status": status},
        )


def _column(conn: Connection) -> bool:
    return bool(
        conn.execute(
            text(
                "SELECT count(*) FROM information_schema.columns WHERE table_schema"
                f" = '{S}' AND table_name = 'assignments'"
                " AND column_name = 'started_at'"
            )
        ).scalar_one()
    )


def test_one_head_follows_the_version_uploads():
    scripts = ScriptDirectory.from_config(alembic_config())
    # One head; 0044 (editorial corrections) and 0045 (the lead pause) follow.
    assert scripts.get_heads() == [head_revision()]
    revision = scripts.get_revision(REVISION)
    assert revision is not None and revision.down_revision == PREVIOUS


def test_the_column_is_backfilled_and_goes_with_the_downgrade(tmp_path):
    url = unmigrated_database_url(tmp_path / "started-at-migration.db")
    upgrade(url, PREVIOUS)
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            _seed(conn)
            assert not _column(conn)
        upgrade(url, REVISION)
        with engine.begin() as conn:
            started = {
                row.task: (row.started_at, row.updated_at)
                for row in conn.execute(
                    text(f"SELECT task, started_at, updated_at FROM {S}.assignments")
                )
            }
            # Not started stays empty; work that left ``open`` keeps reading
            # as started (a reopened row too: nothing records its saves).
            assert started["annotate"][0] is None
            for task in ("review", "translation_review"):
                assert started[task][0] == started[task][1]
            command.downgrade(alembic_config(conn), PREVIOUS)
        with engine.begin() as conn:
            assert (current_revision(conn), _column(conn)) == (PREVIOUS, False)
        upgrade(url, REVISION)
        with engine.begin() as conn:
            assert (current_revision(conn), _column(conn)) == (REVISION, True)
    finally:
        engine.dispose()
