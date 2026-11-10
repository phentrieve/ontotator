"""Queue limit per person and retention of export files (issue 396).

The worker takes the oldest queued job of the whole installation, so one
person may hold at most ``MAX_QUEUED_JOBS_PER_USER`` queued jobs; and an
export's file is deleted ``EXPORT_RETENTION`` after its job finished.
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from auth_harness import logged_in
from proposal_check_support import proposal_env
from sqlalchemy import func, select, update

from ontotator.api.job_routes import EXPORT_KINDS
from ontotator.auth.audit import Actor
from ontotator.domain.errors import DomainError
from ontotator.exchange.archive import expire_archive_files, release_archive_file
from ontotator.exchange.jobs import EXPORT_JOB_KINDS, EXPORT_RETENTION
from ontotator.jobs.queue import MAX_QUEUED_JOBS_PER_USER, QUEUE_RETRY_AFTER_SECONDS
from ontotator.storage.tables import JobRow, StoredFileRow, UserRow

EXPORTS = "/api/v1/projects/proj/exports"
JOBS = "/api/v1/projects/proj/jobs"


def _user(env: Any, username: str) -> Actor:
    with env.db.transaction() as conn:
        user_id = conn.execute(
            select(UserRow.id).where(UserRow.username == username)
        ).scalar_one()
    return Actor.user(user_id, username)


def _export(client: Any, kind: str = "edit_log") -> Any:
    return client.post(EXPORTS, json={"kind": kind})


def _run(env: Any, job_id: int) -> Any:
    queue = env.app.state.jobs
    return queue.run(queue.claim(job_id, "test"), "test")


def _stored_files(env: Any) -> int:
    with env.db.transaction() as conn:
        return int(
            conn.execute(select(func.count()).select_from(StoredFileRow)).scalar_one()
        )


def test_export_kinds_match_the_download_route() -> None:
    assert set(EXPORT_KINDS) == EXPORT_JOB_KINDS


def test_a_fourth_queued_job_of_one_person_is_refused(tmp_path) -> None:
    env = proposal_env(tmp_path)
    queued = []
    for _ in range(MAX_QUEUED_JOBS_PER_USER):
        response = _export(env.lead)
        assert response.status_code == 200, response.text
        queued.append(response.json()["job_id"])

    refused = _export(env.lead, "t1")
    assert refused.status_code == 429, refused.text
    assert refused.json()["code"] == "JOB_QUEUE_LIMIT"
    assert refused.json()["details"]["max"] == MAX_QUEUED_JOBS_PER_USER
    assert refused.headers["Retry-After"] == str(QUEUE_RETRY_AFTER_SECONDS)
    translation = env.lead.post(f"{EXPORTS}/translation-reviews")
    assert translation.status_code == 429, translation.text
    # Nothing was queued for the refusals.
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count()).where(JobRow.status == "queued")
            ).scalar_one()
            == MAX_QUEUED_JOBS_PER_USER
        )

    # Another person's jobs, and the command line's, are not held up.
    other = logged_in(env.app, "leader2", projects={"proj": ["lead"]}, assignments=[])
    assert _export(other).status_code == 200
    env.app.state.jobs.enqueue(
        "edit_log_export",
        {"project": "proj"},
        project_id=env.pid,
        actor=Actor(None, "cli:operator"),
    )
    # A job the system queues for accepted work is never refused.
    env.app.state.jobs.enqueue(
        "edit_log_export",
        {"project": "proj"},
        project_id=env.pid,
        actor=_user(env, "leader"),
        queue_limit=False,
    )

    # Running and finished jobs do not count: once one has started, the next fits.
    with env.db.transaction() as conn:
        conn.execute(
            update(JobRow)
            .where(JobRow.id.in_(queued[:2]))
            .values(status="running", started_at=func.now())
        )
    assert _export(env.lead).status_code == 200


def test_parallel_requests_cannot_both_take_the_last_place(tmp_path) -> None:
    env = proposal_env(tmp_path)
    actor = _user(env, "leader")
    queue = env.app.state.jobs
    for _ in range(MAX_QUEUED_JOBS_PER_USER - 1):
        queue.enqueue("edit_log_export", {"project": "proj"}, actor=actor)
    barrier = threading.Barrier(4)
    outcomes: list[str] = []
    lock = threading.Lock()

    def enqueue() -> None:
        barrier.wait()
        try:
            queue.enqueue("edit_log_export", {"project": "proj"}, actor=actor)
            outcome = "queued"
        except DomainError as exc:
            outcome = exc.code
        with lock:
            outcomes.append(outcome)

    threads = [threading.Thread(target=enqueue) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(30)

    assert sorted(outcomes) == ["JOB_QUEUE_LIMIT"] * 3 + ["queued"]


def test_an_upload_is_refused_before_its_files_are_stored(tmp_path) -> None:
    env = proposal_env(tmp_path)
    for _ in range(MAX_QUEUED_JOBS_PER_USER):
        assert _export(env.lead).status_code == 200
    before = _stored_files(env)

    refused = env.lead.post(
        "/api/v1/projects/proj/uploads",
        data={"kind": "text", "language": "en"},
        files=[("files[]", ("c9.txt", b"A new text.", "text/plain"))],
    )

    assert refused.status_code == 429, refused.text
    assert refused.json()["code"] == "JOB_QUEUE_LIMIT"
    assert _stored_files(env) == before


def test_the_final_export_counts_towards_the_limit(tmp_path) -> None:
    from ontotator.jobs.queue import check_queue_room

    env = proposal_env(tmp_path)
    actor = _user(env, "leader")
    for _ in range(MAX_QUEUED_JOBS_PER_USER):
        assert _export(env.lead).status_code == 200
    with pytest.raises(DomainError) as refused, env.db.transaction() as conn:
        check_queue_room(conn, actor)
    assert refused.value.code == "JOB_QUEUE_LIMIT"
    # The final export inserts its job itself; it checks first.
    response = env.lead.post(
        f"{EXPORTS}/final",
        json={
            "request_id": "r-396",
            "state_digest": "0" * 64,
            "acknowledged_warnings": [],
            "accepted_omissions": [],
        },
    )
    assert response.status_code == 429, response.text
    assert response.json()["code"] == "JOB_QUEUE_LIMIT"


def _age(env: Any, job_id: int, by: timedelta) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(JobRow)
            .where(JobRow.id == job_id)
            .values(finished_at=JobRow.finished_at - by)
        )


def test_an_export_past_its_retention_loses_its_file(tmp_path) -> None:
    env = proposal_env(tmp_path)
    old = _run(env, _export(env.lead).json()["job_id"])
    assert old.status == "succeeded", old.error
    path = env.db.blobs.path(old.result["sha256"])
    assert path.is_file()
    download = f"/api/v1/jobs/{old.id}/download"
    assert env.lead.get(download).status_code == 200

    # Within its retention nothing goes.
    expire_archive_files(env.db)
    assert path.is_file()

    _age(env, old.id, EXPORT_RETENTION + timedelta(minutes=1))
    # The list hides the download before any sweep ran.
    listed = {job["id"]: job for job in env.lead.get(JOBS).json()["jobs"]}
    assert listed[old.id]["download_path"] is None

    gone = env.lead.get(download)
    assert gone.status_code == 410, gone.text
    assert not path.exists()
    job = env.app.state.jobs.get(old.id)
    assert job is not None and job.status == "succeeded"
    assert job.result is not None and job.result["file_deleted_at"]
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(StoredFileRow.sha256).where(
                    StoredFileRow.sha256 == old.result["sha256"]
                )
            ).first()
            is None
        )
    # The job stays visible, without a download.
    listed = {job["id"]: job for job in env.lead.get(JOBS).json()["jobs"]}
    assert listed[old.id]["status"] == "succeeded"
    assert listed[old.id]["download_path"] is None


def test_a_file_shared_with_a_newer_export_stays(tmp_path) -> None:
    env = proposal_env(tmp_path)
    old = _run(env, _export(env.lead).json()["job_id"])
    new = _run(env, _export(env.lead).json()["job_id"])
    # The edit log did not change in between: the same bytes, one file.
    assert old.result["sha256"] == new.result["sha256"]
    _age(env, old.id, EXPORT_RETENTION + timedelta(minutes=1))

    expire_archive_files(env.db)

    assert env.lead.get(f"/api/v1/jobs/{old.id}/download").status_code == 410
    assert env.lead.get(f"/api/v1/jobs/{new.id}/download").status_code == 200
    _age(env, new.id, EXPORT_RETENTION + timedelta(minutes=1))
    expire_archive_files(env.db, datetime.now(UTC))
    assert not env.db.blobs.path(new.result["sha256"]).exists()


def test_the_command_line_releases_the_export_it_wrote_out(tmp_path) -> None:
    env = proposal_env(tmp_path)
    done = _run(env, _export(env.lead).json()["job_id"])

    release_archive_file(env.db, done.id)

    assert not env.db.blobs.path(done.result["sha256"]).exists()
    assert env.lead.get(f"/api/v1/jobs/{done.id}/download").status_code == 410
