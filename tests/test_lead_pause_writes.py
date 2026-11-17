"""Lead pause (issue 464): every write of a task in progress is refused with
one code, reads stay possible, and the pause from a problem report is a
separate cause that is released on its own."""

from __future__ import annotations

from typing import Any

from problem_report_team import act, report
from sqlalchemy import select
from test_translation_review_task import TARGET, assigned
from test_visibility import _envelope, _open

from ontotator.storage.tables import DocumentRow

pytest_plugins = (
    "test_assignment_round_open_api",
    "problem_report_team",
    "test_translation_review_task",
)
WHY = "Source text is being clarified with the clinic"


def _text(app: Any, document_id: str) -> dict[str, str]:
    with app.state.repo.db.transaction() as conn:
        row = conn.execute(
            select(DocumentRow.case_id, DocumentRow.language).where(
                DocumentRow.document_id == document_id
            )
        ).one()
    return {"case_id": row.case_id, "language": row.language}


def _run(lead: Any, key: str, action: str, rows: list[dict[str, str]]) -> dict:
    url = f"/api/v1/projects/{key}/text-pauses/{action}"
    token = lead.post(url, json={"rows": rows, "preview": True}).json()
    body = {"rows": rows, "preview_token": token["preview_token"]}
    if action == "pause":
        body["reason"] = WHY
    applied = lead.post(url, json=body)
    assert applied.status_code == 200, applied.text
    return dict(applied.json())


def _task(client: Any, task_id: int) -> dict[str, Any]:
    return dict(client.get(f"/api/v1/assignments/{task_id}").json())


def _command(client: Any, token: str, revision: int, mutation: str) -> Any:
    return client.post(
        f"/api/v1/workspaces/{token}/commands", json=_envelope(revision, mutation)
    )


def test_annotation_and_consolidation_writes_are_refused_and_reads_stay(team):
    text = _text(team.app, "doc-1")
    opened = _open(team.bob, team.bob_task)
    token = opened["workspace_id"]
    assert opened["read_only"] is False
    assert _command(team.bob, token, 0, "first").status_code == 200

    _run(team.lead, team.key, "pause", [text])

    # The editor was open when the pause landed: the next save is refused
    # with the cause and the reason, and nothing is stored.
    refused = _command(team.bob, token, 1, "second")
    assert refused.status_code == 409, refused.text
    body = refused.json()
    assert body["code"] == "TASK_HELD"
    assert body["details"]["causes"] == ["lead"]
    assert body["details"]["reason"] == WHY == body["details"]["lead_reason"]
    submit = team.bob.post(
        f"/api/v1/workspaces/{token}/submit",
        json={
            "mutation_id": "submit",
            "expected_revision": 1,
            "payload": {"document_checked": True, "command": "submit_workspace"},
        },
    )
    assert submit.status_code == 409 and submit.json()["code"] == "TASK_HELD"
    # Reading stays possible, read-only, with the saved work.
    again = _open(team.bob, team.bob_task)
    assert again["read_only"] is True
    assert again["assignment"]["pause_causes"] == ["lead"]
    assert again["view"]["draft"]["revision"] == 1

    # The lead's consolidation of the same text is work in progress as well.
    review = _task(team.lead, team.lead_task.id)
    assert review["task"] == "review" and review["pause_causes"] == ["lead"]
    # A text that is not paused is untouched.
    other = _open(team.carol, team.carol_task)
    assert other["read_only"] is False
    assert _command(team.carol, other["workspace_id"], 0, "c").status_code == 200

    _run(team.lead, team.key, "release", [text])
    assert _open(team.bob, team.bob_task)["read_only"] is False
    assert _command(team.bob, token, 1, "second").status_code == 200


def test_report_pause_and_lead_pause_are_released_each_on_its_own(team):
    text = _text(team.app, "doc-1")
    created = report(team.bob, team.bob_task.id, "Text is cut off")
    assert _task(team.bob, team.bob_task.id)["pause_causes"] == ["report"]

    preview = _run(team.lead, team.key, "pause", [text])
    tasks = {t["assignment_id"]: t for t in preview["changes"][0]["tasks"]}
    assert tasks[team.bob_task.id]["paused_by_report"] is True
    both = _task(team.bob, team.bob_task.id)
    assert both["held"] and both["pause_causes"] == ["report", "lead"]
    # The report's reason leads; the lead's is given beside it.
    assert both["hold_reason"] == "Text is cut off"
    assert both["lead_pause_reason"] == WHY

    # Deciding the report does not release the lead pause; the report says so.
    resumed = act(
        team.lead, created["report_id"], 1, "resume", "Fixed", [team.bob_task.id]
    )
    assert resumed["held_assignment_ids"] == []
    assert resumed["text_paused_by_lead"] is True
    after_report = _task(team.bob, team.bob_task.id)
    assert after_report["held"] and after_report["pause_causes"] == ["lead"]
    assert after_report["hold_reason"] == WHY
    token = _open(team.bob, team.bob_task)["workspace_id"]
    refused = _command(team.bob, token, 0, "edit")
    assert refused.status_code == 409
    assert refused.json()["details"]["causes"] == ["lead"]

    _run(team.lead, team.key, "release", [text])
    assert _task(team.bob, team.bob_task.id)["held"] is False
    assert _command(team.bob, token, 0, "edit").status_code == 200


def test_releasing_the_text_does_not_release_the_report(team):
    text = _text(team.app, "doc-1")
    token = _open(team.bob, team.bob_task)["workspace_id"]
    _run(team.lead, team.key, "pause", [text])
    # A paused task can still be reported: reporting is not work on the task.
    created = report(team.bob, team.bob_task.id, "Text is cut off")
    url = f"/api/v1/projects/{team.key}/text-pauses/release"
    preview = team.lead.post(url, json={"rows": [text], "preview": True}).json()
    assert preview["still_paused_count"] == 1

    # A restart starts new work: refused while the lead pause stands.
    refused = act(
        team.lead,
        created["report_id"],
        1,
        "restart",
        "Agreed",
        [team.bob_task.id],
        status=409,
    )
    assert refused["code"] == "TASK_HELD"

    _run(team.lead, team.key, "release", [text])
    still = _task(team.bob, team.bob_task.id)
    assert still["held"] and still["pause_causes"] == ["report"]
    refused = _command(team.bob, token, 0, "edit")
    assert refused.status_code == 409
    assert refused.json()["details"]["causes"] == ["report"]

    resumed = act(
        team.lead, created["report_id"], 1, "resume", "Fixed", [team.bob_task.id]
    )
    assert resumed["text_paused_by_lead"] is False
    assert _task(team.bob, team.bob_task.id)["held"] is False
    assert _command(team.bob, token, 0, "edit").status_code == 200


def test_translation_review_writes_are_refused_and_reads_stay(case_env):
    env = case_env
    row = assigned(env)
    url = f"/api/v1/translation-reviews/{row['id']}"
    saved = env.alice.put(
        url + "/draft",
        json={"expected_revision": 0, "text": "Kept correction", "form": {}},
    )
    assert saved.status_code == 200, saved.text
    text = _text(env.app, TARGET)

    _run(env.lead, "proj", "pause", [text])

    marks = {"source": [], "translation": []}
    for method, path, body in [
        (
            env.alice.put,
            "/draft",
            {"expected_revision": 1, "text": "Overwrite", "form": {}},
        ),
        (env.alice.post, "/submit", {"expected_revision": 1}),
        (env.alice.put, "/checked-sentences", marks),
    ]:
        blocked = method(url + path, json=body)
        assert blocked.status_code == 409, blocked.text
        assert blocked.json()["code"] == "TASK_HELD"
        assert blocked.json()["details"]["causes"] == ["lead"]
    opened = env.alice.get(url).json()
    assert opened["read_only"] is True
    assert opened["draft"]["text"] == "Kept correction"
    # The annotation of the source text is another text: not paused.
    tasks = env.alice.get("/api/v1/me/tasks").json()
    assert {task["task"]: task["held"] for task in tasks} == {
        "translation_review": True,
        "annotate": False,
    }

    _run(env.lead, "proj", "release", [text])
    resumed = env.alice.put(
        url + "/draft",
        json={"expected_revision": 1, "text": "Continued", "form": {}},
    )
    assert resumed.status_code == 200, resumed.text


def test_a_task_never_opened_before_the_pause_can_still_be_read(team):
    text = _text(team.app, "doc-other")
    _run(team.lead, team.key, "pause", [text])
    first = _open(team.carol, team.carol_task)
    assert first["read_only"] is True
    assert first["assignment"]["pause_causes"] == ["lead"]
    refused = _command(team.carol, first["workspace_id"], 0, "edit")
    assert refused.status_code == 409 and refused.json()["code"] == "TASK_HELD"
