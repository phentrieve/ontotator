"""In-app notifications (issue 557): the events, who gets them, read state,
retention, privacy and erasure."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from auth_harness import log_in
from fastapi.testclient import TestClient
from problem_report_team import act, report
from sqlalchemy import func, select, update
from work_plan_support import BASE, assign, doc, plan_env, submit

from ontotator.application import notifications as notices
from ontotator.application.notifications import notify, notify_leads
from ontotator.auth.audit import Actor
from ontotator.storage.notification_tables import NotificationRow

pytest_plugins = ("test_assignment_round_open_api", "problem_report_team")

URL = "/api/v1/me/notifications"
PAUSE = f"{BASE}/text-pauses/pause"
RELEASE = f"{BASE}/text-pauses/release"
C1 = {"case_id": "c1", "language": "en"}


@pytest.fixture
def env(tmp_path):
    return plan_env(tmp_path)


def _client(app: Any, username: str) -> TestClient:
    client = TestClient(app)
    log_in(client, username)
    return client


def _items(client: TestClient) -> list[dict[str, Any]]:
    response = client.get(URL)
    assert response.status_code == 200, response.text
    return list(response.json()["items"])


def _kinds(client: TestClient) -> list[str]:
    return [item["kind"] for item in _items(client)]


def _unread(client: TestClient) -> int:
    response = client.get(f"{URL}/summary")
    assert response.status_code == 200, response.text
    return int(response.json()["unread"])


def _user_id(app: Any, username: str) -> int:
    return int(app.state.accounts.get_by_username(username).id)


def _apply(env: Any, url: str, rows: list[dict[str, str]], **body: Any) -> None:
    token = env.lead.post(url, json={"rows": rows, "preview": True, **body}).json()[
        "preview_token"
    ]
    applied = env.lead.post(url, json={"rows": rows, "preview_token": token, **body})
    assert applied.status_code == 200, applied.text


def test_a_new_task_tells_its_person_and_names_the_text(env):
    task = assign(env, doc("c1", "en"), "anno", "annotate")
    anno = _client(env.app, "anno")
    [item] = _items(anno)
    assert item["kind"] == "task_assigned" and item["read"] is False
    assert (item["assignment_id"], item["task"]) == (task, "annotate")
    assert (item["case_id"], item["language"], item["version"]) == ("c1", "en", 1)
    assert item["project_key"] == "proj" and item["target_id"] is None
    # The lead who assigned it, as an annotator sees a person: the pseudonym only.
    assert item["actor"]["display_name"] is None and item["actor"]["pseudonym"]
    assert _unread(anno) == 1
    # Nobody else hears of it; the lead caused it.
    assert _items(env.lead) == []


def test_reopen_and_release_tell_the_task_owner(env):
    task = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, task, "s1")
    reopened = env.lead.post(
        f"/api/v1/assignments/{task}/reopen", json={"reason": "Check again"}
    )
    assert reopened.status_code == 200, reopened.text
    anno = _client(env.app, "anno")
    assert _kinds(anno) == ["task_reopened", "task_assigned"]
    _apply(env, PAUSE, [C1], reason="Source is being clarified")
    # A pause is shown in My tasks; it is no notification.
    assert _kinds(anno) == ["task_reopened", "task_assigned"]
    _apply(env, RELEASE, [C1])
    assert _kinds(anno) == ["task_released", "task_reopened", "task_assigned"]
    assert _items(anno)[0]["assignment_id"] == task


def test_mark_one_and_mark_all_read(env):
    first = assign(env, doc("c1", "en"), "anno", "annotate")
    assign(env, doc("c2", "en"), "anno", "annotate")
    anno = _client(env.app, "anno")
    items = _items(anno)
    assert [i["assignment_id"] for i in items][-1] == first and _unread(anno) == 2
    one = anno.post(f"{URL}/{items[1]['id']}/read")
    assert one.status_code == 200 and one.json() == {"unread": 1}
    assert [i["read"] for i in _items(anno)] == [False, True]
    # Another person's id changes nothing and says nothing.
    other = env.lead.post(f"{URL}/{items[0]['id']}/read")
    assert other.status_code == 200 and other.json() == {"unread": 0}
    assert _unread(anno) == 1
    # Mark all up to the newest shown: a later one stays unread.
    assign(env, doc("c1", "en"), "anno2", "annotate")
    anno.post(f"{URL}/read-all", json={})
    assign(env, doc("c2", "en"), "anno2", "annotate")
    anno2 = _client(env.app, "anno2")
    newest = _items(anno2)[1]["id"]
    done = anno2.post(f"{URL}/read-all", json={"up_to": newest})
    assert done.status_code == 200 and done.json() == {"unread": 1}
    assert anno2.post(f"{URL}/read-all", json={}).json() == {"unread": 0}


def test_a_text_problem_tells_the_leads_with_names_and_no_text(team):
    created = report(team.bob, team.bob_task.id, reason="Private clinical remark")
    rid = created["report_id"]
    [item] = [i for i in _items(team.lead) if i["kind"] == "text_problem_received"]
    assert item["target_id"] == rid and item["assignment_id"] == team.bob_task.id
    # The lead sees the reporter's name, as on the report page.
    assert item["actor"]["pseudonym"] == "ann-0004"
    assert item["actor"]["display_name"] is not None
    assert "Private clinical remark" not in team.lead.get(URL).text
    # Annotators of the project hear nothing of it.
    assert "text_problem_received" not in _kinds(team.carol)
    # The reporter resumes their own task: no notification to themselves.
    act(team.bob, rid, 1, "resume", "Continue", [team.bob_task.id])
    assert "task_released" not in _kinds(team.bob)


def test_the_lead_releasing_a_reported_task_tells_the_reporter(team):
    rid = report(team.bob, team.bob_task.id)["report_id"]
    act(team.lead, rid, 1, "resume", "Go on", [team.bob_task.id])
    [item] = [i for i in _items(team.bob) if i["kind"] == "task_released"]
    assert item["assignment_id"] == team.bob_task.id and item["target_id"] == rid


def test_leads_inactive_and_erased_people_and_practice_projects(env):
    accounts = env.app.state.accounts
    harness = Actor(None, "test:harness")
    with env.db.transaction() as conn:
        lead_id = _user_id(env.app, "leader")
        # The actor is never told about their own event.
        assert notify_leads(conn, env.pid, "submission_waiting", actor_id=lead_id) == 0
        assert notify_leads(conn, env.pid, "submission_waiting") == 1
    accounts.set_active(harness, "anno", False)
    with env.db.transaction() as conn:
        assert notify(conn, _user_id(env.app, "anno"), env.pid, "task_assigned") == 0


def test_erasure_deletes_the_persons_notifications(env):
    assign(env, doc("c1", "en"), "anno", "annotate")
    anno_id = _user_id(env.app, "anno")
    harness = Actor(None, "test:harness")
    env.app.state.accounts.set_active(harness, "anno", False)
    env.app.state.accounts.anonymise(harness, "anno")
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count()).where(NotificationRow.recipient_id == anno_id)
            ).scalar_one()
            == 0
        )


def test_a_person_who_left_the_project_or_lost_the_task_sees_nothing(env):
    task = assign(env, doc("c1", "en"), "anno", "annotate")
    anno = _client(env.app, "anno")
    assert len(_items(anno)) == 1
    # Handed to someone else: the old entry no longer leads anywhere.
    moved = env.lead.post(
        f"/api/v1/assignments/{task}/reassign", json={"username": "anno2"}
    )
    assert moved.status_code == 200, moved.text
    assert _items(anno) == [] and _unread(anno) == 0
    anno2 = _client(env.app, "anno2")
    assert _kinds(anno2) == ["task_assigned"]
    # One without a task: only the membership hides it.
    with env.db.transaction() as conn:
        notify(conn, _user_id(env.app, "anno2"), env.pid, "submission_waiting")
    assert _kinds(anno2) == ["submission_waiting", "task_assigned"]
    env.app.state.memberships.remove(
        Actor(None, "test:harness"), "proj", "anno2", revoke_assignments=True
    )
    anno2 = _client(env.app, "anno2")
    assert _items(anno2) == [] and _unread(anno2) == 0


def test_retention_keeps_the_newest_and_drops_old_ones(env, monkeypatch):
    monkeypatch.setattr(notices, "MAX_PER_PERSON", 3)
    anno_id = _user_id(env.app, "anno")
    old = datetime.now(UTC) - notices.UNREAD_RETENTION - timedelta(days=1)
    with env.db.transaction() as conn:
        notify(conn, anno_id, env.pid, "submission_waiting", at=old)
        read = notify(conn, anno_id, env.pid, "submission_waiting")
        assert read == 1
        conn.execute(
            update(NotificationRow)
            .where(NotificationRow.recipient_id == anno_id)
            .values(read_at=func.now())
        )
        for _ in range(4):
            notify(conn, anno_id, env.pid, "submission_waiting")
        rows = conn.execute(
            select(NotificationRow.read_at).where(
                NotificationRow.recipient_id == anno_id
            )
        ).all()
    # The too old one went at once; of the rest only the newest three stay.
    assert len(rows) == 3 and all(row.read_at is None for row in rows)


def test_the_routes_are_for_browser_sessions_only():
    from ontotator.api.token_scopes import ROUTE_SCOPES, SESSION

    for method, path in (
        ("GET", URL),
        ("GET", f"{URL}/summary"),
        ("POST", f"{URL}/{{notification_id}}/read"),
        ("POST", f"{URL}/read-all"),
    ):
        assert ROUTE_SCOPES[(method, path)] == SESSION


def test_a_question_to_the_lead_has_its_own_kind(team):
    # Integration of issue 553 (Ask the lead) with issue 557: a question is no
    # text problem, so the leads' bell names it as a question.
    current = team.bob.get(f"/api/v1/assignments/{team.bob_task.id}").json()
    asked = team.bob.post(
        f"/api/v1/assignments/{team.bob_task.id}/problem-reports",
        json={
            "request_id": f"ask-{team.bob_task.id}",
            "expected_workflow_revision": current["workflow_revision"],
            "round_id": current["active_round_id"],
            "reason": "Is the short form meant?",
            "kind": "question",
        },
    )
    assert asked.status_code == 200, asked.text
    kinds = _kinds(team.lead)
    assert "question_received" in kinds and "text_problem_received" not in kinds


def test_the_answer_to_a_question_tells_the_asker(team):
    # Issue 557 with issue 553: the lead's answer rings the asker's bell and
    # leads to the task; the answer text stays in the question.
    current = team.bob.get(f"/api/v1/assignments/{team.bob_task.id}").json()
    asked = team.bob.post(
        f"/api/v1/assignments/{team.bob_task.id}/problem-reports",
        json={
            "request_id": f"ask-answer-{team.bob_task.id}",
            "expected_workflow_revision": current["workflow_revision"],
            "round_id": current["active_round_id"],
            "reason": "Is the short form meant?",
            "kind": "question",
        },
    )
    assert asked.status_code == 200, asked.text
    question = asked.json()
    assert "answer_received" not in _kinds(team.bob)
    act(
        team.lead,
        question["report_id"],
        question["revision"],
        "answer",
        "Yes, the short form.",
    )
    answers = [item for item in _items(team.bob) if item["kind"] == "answer_received"]
    assert len(answers) == 1
    [item] = answers
    assert item["assignment_id"] == team.bob_task.id
    assert item["target_id"] == question["report_id"]
    assert "Yes, the short form." not in str(item)
    # The lead answered; the lead's own bell does not hear of it.
    assert "answer_received" not in _kinds(team.lead)
