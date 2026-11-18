"""Lead pause (issue 464): a lead pauses and releases the work on texts.

The pause belongs to the text (case, language): tasks in progress cannot be
saved, also tasks assigned later; submitted work and final results are
untouched; a pause from a problem report is a separate cause."""

from __future__ import annotations

from typing import Any

import pytest
from auth_harness import log_in
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from work_plan_support import BASE, assign, doc, plan_env, select_final, submit

from ontotator.storage.plan_tables import TextSettingRow
from ontotator.storage.tables import AssignmentRow, AuditEventRow, ProjectRow

PAUSE = f"{BASE}/text-pauses/pause"
RELEASE = f"{BASE}/text-pauses/release"
REOPEN = f"{BASE}/bulk-task-actions/reopen"
WITHDRAW = f"{BASE}/bulk-task-actions/withdraw"
START_ROUND = f"{BASE}/bulk-task-actions/start-round"
C1 = {"case_id": "c1", "language": "en"}
C2 = {"case_id": "c2", "language": "en"}
WHY = "Source text is being clarified with the clinic"


@pytest.fixture
def env(tmp_path):
    return plan_env(tmp_path)


def _post(env: Any, url: str, rows: list[dict[str, str]], **body: Any) -> Any:
    return env.lead.post(url, json={"rows": rows, **body})


def _apply(env: Any, url: str, rows: list[dict[str, str]], **body: Any) -> dict:
    token = _post(env, url, rows, preview=True, **body).json()["preview_token"]
    if url == PAUSE:
        body.setdefault("reason", WHY)
    applied = _post(env, url, rows, preview_token=token, **body)
    assert applied.status_code == 200, applied.text
    return dict(applied.json())


def _client(env: Any, username: str) -> TestClient:
    client = TestClient(env.app)
    log_in(client, username)
    return client


def _tasks(env: Any, username: str) -> dict[int, dict[str, Any]]:
    tasks = _client(env, username).get("/api/v1/me/tasks").json()
    return {task["assignment_id"]: task for task in tasks}


def _row(env: Any, case: str, **params: Any) -> dict[str, Any] | None:
    page = env.lead.get(f"{BASE}/document-rows", params=params).json()
    for group in page["groups"]:
        for row in group["rows"]:
            if (row["case_id"], row["language"]) == (case, "en"):
                return dict(row)
    return None


def _audits(env: Any, action: str) -> list[tuple[str, dict[str, Any]]]:
    with env.db.transaction() as conn:
        return [
            (row.target_id, dict(row.details))
            for row in conn.execute(
                select(AuditEventRow.target_id, AuditEventRow.details)
                .where(AuditEventRow.action == action)
                .order_by(AuditEventRow.id)
            )
        ]


def test_pause_preview_apply_all_or_nothing_audit_and_release(env):
    a1 = assign(env, doc("c1", "en"), "anno", "annotate")  # in progress
    b1 = assign(env, doc("c2", "en"), "anno", "annotate")
    submit(env, b1, "s2")  # submitted: untouched

    found = _post(env, PAUSE, [C1, C2], preview=True).json()
    assert (found["applied"], found["texts"], found["change_count"]) == (False, 2, 2)
    assert found["task_count"] == 1 and found["skipped"] == []
    by_text = {c["case_id"]: c for c in found["changes"]}
    assert [t["assignment_id"] for t in by_text["c1"]["tasks"]] == [a1]
    assert by_text["c1"]["tasks"][0]["person"]["display_name"] == "Anne Notator"
    assert by_text["c2"]["tasks"] == []  # only submitted work there
    # The menu asks for the counts only.
    summary = _post(env, PAUSE, [C1, C2], preview=True, summary_only=True).json()
    assert (summary["change_count"], summary["changes"]) == (2, [])
    assert summary["preview_token"] == found["preview_token"]

    token = found["preview_token"]
    missing = _post(env, PAUSE, [C1, C2], preview_token=token)
    assert missing.status_code == 422, missing.text
    assert missing.json()["code"] == "PAUSE_REASON_REQUIRED"
    # Something changed since the preview: nothing is paused.
    a2 = assign(env, doc("c2", "en"), "anno2", "annotate")
    stale = _post(env, PAUSE, [C1, C2], preview_token=token, reason=WHY)
    assert stale.status_code == 409 and stale.json()["code"] == "PREVIEW_STALE"
    fresh = stale.json()["details"]["preview"]
    assert fresh["task_count"] == 2
    assert _row(env, "c1")["lead_pause"] is None

    done = _post(env, PAUSE, [C1, C2], preview_token=fresh["preview_token"], reason=WHY)
    assert done.status_code == 200 and done.json()["applied"] is True
    assert [
        (target, d["via"], d["reason"]) for target, d in _audits(env, "text.pause")
    ] == [
        ("c1 en", "bulk_pause_texts", WHY),
        ("c2 en", "bulk_pause_texts", WHY),
    ]
    assert _audits(env, "text.pause")[1][1]["assignment_ids"] == [a2]
    # No task row changed: the pause is a property of the text.
    with env.db.transaction() as conn:
        assert not any(conn.execute(select(AssignmentRow.held)).scalars())

    again = _post(env, PAUSE, [C1, C2], preview=True).json()
    assert again["change_count"] == 0
    assert {s["reason"] for s in again["skipped"]} == {"already_paused"}
    assert again["skipped"][0]["pause"]["reason"] == WHY

    release = _post(env, RELEASE, [C1, C2], preview=True).json()
    assert (release["change_count"], release["task_count"]) == (2, 2)
    assert release["changes"][0]["pause"]["paused_by"]["is_me"] is True
    released = _apply(env, RELEASE, [C1])
    assert [c["case_id"] for c in released["changes"]] == ["c1"]
    assert [(t, d["via"]) for t, d in _audits(env, "text.release")] == [
        ("c1 en", "bulk_release_texts")
    ]
    assert _row(env, "c1")["lead_pause"] is None
    assert _row(env, "c2")["lead_pause"]["reason"] == WHY
    skipped = _post(env, RELEASE, [C1], preview=True).json()
    assert [s["reason"] for s in skipped["skipped"]] == ["not_paused"]


def test_annotators_cannot_pause_or_release(env):
    assign(env, doc("c1", "en"), "anno", "annotate")
    denied = _client(env, "anno").post(PAUSE, json={"rows": [C1], "preview": True})
    assert denied.status_code in (403, 404), denied.text


def test_my_tasks_marks_the_task_and_documents_shows_the_paused_text(env):
    a1 = assign(env, doc("c1", "en"), "anno", "annotate")
    a2 = assign(env, doc("c1", "en"), "anno2", "annotate")
    submit(env, a2, "s1")
    other = assign(env, doc("c2", "en"), "anno", "annotate")
    before = _row(env, "c1")
    assert before["stages"]["annotation"]["state"] == "in_progress"
    assert before["next_step"]["owner"]["count"] == 1

    _apply(env, PAUSE, [C1])

    mine = _tasks(env, "anno")
    assert mine[a1]["held"] is True and mine[a1]["pause_causes"] == ["lead"]
    assert mine[a1]["hold_reason"] == WHY == mine[a1]["lead_pause_reason"]
    assert mine[other]["held"] is False and mine[other]["pause_causes"] == []
    # Submitted work is not paused.
    theirs = _tasks(env, "anno2")
    assert (theirs[a2]["held"], theirs[a2]["pause_causes"]) == (False, [])
    opened = _client(env, "anno").get(f"/api/v1/assignments/{a1}").json()
    assert opened["held"] and opened["pause_causes"] == ["lead"]

    row = _row(env, "c1")
    assert row["lead_pause"]["reason"] == WHY
    assert row["lead_pause"]["paused_by"]["is_me"] is True
    assert row["lead_pause"]["paused_at"]
    work = {item["assignment_id"]: item for item in row["work"]}
    assert (work[a1]["held"], work[a1]["pause_causes"]) == (True, ["lead"])
    assert (work[a2]["held"], work[a2]["pause_causes"]) == (False, [])
    # The stage cell reads paused with the lead and the reason; the paused
    # task is nobody's turn.
    cell = row["stages"]["annotation"]
    assert (cell["state"], cell["detail"]["note"]) == ("paused", "lead_pause")
    assert cell["detail"]["excerpt"] == WHY
    assert [p["is_me"] for p in cell["detail"]["people"]] == [True]
    assert row["next_step"]["owner"]["count"] == 0
    # The filter lists paused texts only; "Paused tasks" stays the report's.
    assert _row(env, "c1", flags="lead_paused") is not None
    assert _row(env, "c2", flags="lead_paused") is None
    assert _row(env, "c1", paused="yes") is None
    assert (
        _row(env, "c1", waiting_on=before["next_step"]["owner"]["person"]["pseudonym"])
        is None
    )

    _apply(env, RELEASE, [C1])
    after = _row(env, "c1")
    assert after["stages"] == before["stages"]
    assert after["next_step"]["owner"] == before["next_step"]["owner"]
    assert _tasks(env, "anno")[a1]["held"] is False


def test_a_task_assigned_reopened_or_restarted_later_is_paused_from_the_start(env):
    with env.db.transaction() as conn:
        conn.execute(update(ProjectRow).values(annotations_per_text=2))
    done = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, done, "s1")
    _apply(env, PAUSE, [C1])

    # Assigning stays possible; the new task is paused, visibly.
    created = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": doc("c1", "en"), "username": "anno2"}],
            "task": "annotate",
            "confirm_language": True,
        },
    )
    assert created.status_code == 200 and created.json()["refused"] == []
    new = created.json()["created"][0]
    assert new["held"] is True and new["pause_causes"] == ["lead"]
    assert _tasks(env, "anno2")[new["id"]]["hold_reason"] == WHY

    # Reopening submitted work is allowed; the preview says the text is paused.
    preview = _post(env, REOPEN, [C1], preview=True).json()
    assert [(t["assignment_id"], t["text_paused"]) for t in preview["changes"]] == [
        (done, True)
    ]
    _post(
        env, REOPEN, [C1], preview_token=preview["preview_token"], reason="Check again"
    )
    task = _tasks(env, "anno")[done]
    assert (task["status"], task["held"]) == ("reopened", True)
    assert task["pause_causes"] == ["lead"]

    # A paused task is not withdrawn in bulk: release the text first.
    kept = _post(env, WITHDRAW, [C1], preview=True, include_started=True).json()
    assert kept["change_count"] == 0
    assert {item["reason"] for item in kept["kept"]} == {"paused_by_lead"}
    assert kept["kept"][0]["message"] == "Paused by a lead; release the text first."

    _apply(env, RELEASE, [C1])
    assert not _tasks(env, "anno")[done]["held"]
    assert not _tasks(env, "anno2")[new["id"]]["held"]
    assert _post(env, WITHDRAW, [C1], preview=True).json()["change_count"] == 1


def test_start_round_on_a_paused_text_is_marked_in_the_preview(env):
    done = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, done, "s1")
    _apply(env, PAUSE, [C1])
    preview = _post(env, START_ROUND, [C1], preview=True, kind="carry_forward").json()
    assert [t["text_paused"] for t in preview["changes"] + preview["kept"]] == [True]


def test_pause_between_preview_and_apply_makes_a_bulk_action_stale(env):
    done = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, done, "s1")
    token = _post(env, REOPEN, [C1], preview=True).json()["preview_token"]
    _apply(env, PAUSE, [C1])
    stale = _post(env, REOPEN, [C1], preview_token=token, reason="Check again")
    assert stale.status_code == 409 and stale.json()["code"] == "PREVIEW_STALE"
    assert stale.json()["details"]["preview"]["changes"][0]["text_paused"] is True


def test_final_results_and_export_state_are_untouched(env):
    a1 = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, a1, "s1")
    assign(env, doc("c1", "en"), "anno2", "annotate")  # in progress
    select_final(env, doc("c1", "en"), "s1")
    before = env.lead.post(f"{BASE}/exports/final/preflight").json()
    row = _row(env, "c1")
    _apply(env, PAUSE, [C1, C2])
    assert env.lead.post(f"{BASE}/exports/final/preflight").json() == before
    paused = _row(env, "c1")
    assert paused["final"] == row["final"]
    assert paused["stages"]["final"] == row["stages"]["final"]


def test_the_pause_keeps_the_texts_own_annotators_per_text(env):
    """Both live on ``text_settings``: neither write clears the other."""
    from ontotator.storage.text_settings import per_text_overrides, write_per_text

    with env.db.transaction() as conn:
        write_per_text(conn, env.pid, "c1", "en", 3, reason="pilot", actor_id=None)
    _apply(env, PAUSE, [C1])
    with env.db.transaction() as conn:
        assert per_text_overrides(conn, env.pid) == {("c1", "en"): 3}
        write_per_text(conn, env.pid, "c1", "en", None, reason=None, actor_id=None)
        row = conn.execute(
            select(TextSettingRow).where(TextSettingRow.case_id == "c1")
        ).one()
    assert (row.paused, row.pause_reason) == (True, WHY)
    _apply(env, RELEASE, [C1])
    with env.db.transaction() as conn:
        row = conn.execute(
            select(TextSettingRow).where(TextSettingRow.case_id == "c1")
        ).one()
    # The record of the last pause stays.
    assert (row.paused, row.pause_reason) == (False, WHY)


def test_texts_the_project_does_not_have_are_named(env):
    """A wrong case ID, letter case or language is in ``unknown_rows`` of the
    preview and of the applied answer (pause and release)."""
    wrong = [
        {"case_id": "nope", "language": "en"},
        {"case_id": "C1", "language": "en"},
        {"case_id": "c1", "language": "xx"},
    ]
    rows = [{"case_id": "c1", "language": "en"}, *wrong]
    found = _post(env, PAUSE, rows, preview=True)
    assert found.status_code == 200, found.text
    assert found.json()["texts"] == 1
    assert found.json()["unknown_rows"] == wrong
    applied = _post(
        env, PAUSE, rows, preview_token=found.json()["preview_token"], reason="Check"
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["applied"] is True
    assert applied.json()["unknown_rows"] == wrong
    released = _post(env, RELEASE, rows, preview=True, summary_only=True)
    assert released.json()["unknown_rows"] == wrong
    known = _post(env, RELEASE, rows[:1], preview=True)
    assert known.json()["unknown_rows"] == []


def test_history_keeps_each_pause_and_release(env):
    """Review 2, F6: the row's changes name every pause and its release, with
    the lead, the time and the reason, also after the release."""
    assign(env, doc("c1", "en"), "anno", "annotate")
    _apply(env, PAUSE, [C1, C2])
    _apply(env, RELEASE, [C1], reason="Clarified")
    _apply(env, PAUSE, [C1], reason="Second question")

    def changes(case: str) -> list[tuple[str, str | None, bool]]:
        body = env.lead.get(f"{BASE}/document-rows/{case}/en/submissions").json()
        return [
            (change["kind"], change["reason"], change["by"]["is_me"])
            for change in body["changes"]
            if change["kind"].startswith("text_")
        ]

    assert changes("c1") == [
        ("text_paused", WHY, True),
        ("text_released", "Clarified", True),
        ("text_paused", "Second question", True),
    ]
    # Another text's pause is not this text's history.
    assert changes("c2") == [("text_paused", WHY, True)]
    released = _apply(env, RELEASE, [C2])
    assert released["applied"] is True
    assert changes("c2") == [("text_paused", WHY, True), ("text_released", None, True)]
    # The other language of the case was never paused.
    german = env.lead.get(f"{BASE}/document-rows/c2/de/submissions").json()
    assert [c for c in german["changes"] if c["kind"].startswith("text_")] == []
