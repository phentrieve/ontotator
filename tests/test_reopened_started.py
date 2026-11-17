"""Issue 268: a reopened assignment reads "not started" on Documents until
the first change saved after the reopen (``assignments.started_at``)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from test_case_api import BASE, SOURCE
from test_translation_review_task import assigned, case_env, command

from ontotator.storage.tables import AssignmentRow

__all__ = ["case_env"]


def cell(env: Any, language: str, stage: str) -> dict[str, Any]:
    page = env.lead.get(f"{BASE}/document-rows").json()
    [row] = [
        item
        for group in page["groups"]
        for item in group["rows"]
        if item["language"] == language
    ]
    found: dict[str, Any] = row["stages"][stage]
    return found


def counts(env: Any, language: str, stage: str) -> tuple[int | None, int | None]:
    detail = cell(env, language, stage)["detail"]
    return detail["started"], detail["open_tasks"]


def started_at(env: Any, assignment_id: int) -> Any:
    with env.db.transaction() as conn:
        return conn.execute(
            select(AssignmentRow.started_at).where(AssignmentRow.id == assignment_id)
        ).scalar_one()


def reopen(env: Any, assignment_id: int) -> None:
    response = env.lead.post(f"/api/v1/assignments/{assignment_id}/reopen", json={})
    assert response.status_code == 200, response.text


def test_reopened_translation_review_is_not_started_until_its_first_save(case_env):
    env = case_env
    row = assigned(env)
    assert counts(env, "de", "review") == (0, 1)
    assert started_at(env, row["id"]) is None
    url = f"/api/v1/translation-reviews/{row['id']}"
    text = env.alice.get(url).json()["text"]
    form = {"decision": "accepted_unchanged", "clinical_change": False}
    saved = env.alice.put(
        url + "/draft", json={"expected_revision": 0, "text": text, "form": form}
    )
    assert saved.json() == {"revision": 1}
    assert counts(env, "de", "review") == (1, 1)
    first = started_at(env, row["id"])
    assert first is not None
    env.alice.patch("/api/v1/me/profile", json={"qualification": "Clinical reviewer"})
    submitted = env.alice.post(url + "/submit", json={"expected_revision": 1})
    assert submitted.status_code == 200, submitted.text
    assert started_at(env, row["id"]) == first

    reopen(env, row["id"])
    assert started_at(env, row["id"]) is None
    review = cell(env, "de", "review")
    assert review["state"] == "re_review"
    assert (review["detail"]["started"], review["detail"]["open_tasks"]) == (0, 1)
    # Opening the task saves nothing: still not started.
    revision = env.alice.get(url).json()["draft"]["revision"]
    assert counts(env, "de", "review") == (0, 1)
    saved = env.alice.put(
        url + "/draft",
        json={"expected_revision": revision, "text": text, "form": form},
    )
    assert saved.status_code == 200, saved.text
    assert counts(env, "de", "review") == (1, 1)
    assert started_at(env, row["id"]) is not None
    # The meaning of ``reopened`` stays (My tasks marker and sorting).
    tasks = env.alice.get("/api/v1/me/tasks").json()
    [task] = [item for item in tasks if item["assignment_id"] == row["id"]]
    assert task["status"] == "reopened"


def test_reopened_annotation_is_not_started_until_its_first_save(case_env):
    env = case_env
    opened = env.alice.post(
        "/api/v1/workspaces/open",
        json={"project_key": "proj", "document_id": SOURCE, "mode": "independent"},
    ).json()
    with env.db.transaction() as conn:
        assignment_id = conn.execute(
            select(AssignmentRow.id).where(
                AssignmentRow.document_id == SOURCE, AssignmentRow.task == "annotate"
            )
        ).scalar_one()
    assert counts(env, "en", "annotation") == (0, 1)
    url = f"/api/v1/workspaces/{opened['workspace_id']}"
    assert env.alice.post(url + "/commands", json=command()).status_code == 200
    assert counts(env, "en", "annotation") == (1, 1)
    submitted = env.alice.post(
        url + "/submit",
        json={
            "mutation_id": "submit",
            "expected_revision": 1,
            "payload": {"document_checked": True, "command": "submit_workspace"},
        },
    )
    assert submitted.status_code == 200, submitted.text
    assert started_at(env, assignment_id) is not None

    reopen(env, assignment_id)
    assert started_at(env, assignment_id) is None
    assert counts(env, "en", "annotation") == (0, 1)
    again = env.alice.post(
        "/api/v1/workspaces/open",
        json={"project_key": "proj", "document_id": SOURCE, "mode": "independent"},
    ).json()
    assert again["read_only"] is False
    assert counts(env, "en", "annotation") == (0, 1)
    saved = env.alice.post(
        f"/api/v1/workspaces/{again['workspace_id']}/commands",
        json={
            "mutation_id": "after-reopen",
            "expected_revision": 2,
            "payload": {"command": "check_layer", "layer_id": "hpo", "checked": False},
        },
    )
    assert saved.status_code == 200, saved.text
    assert counts(env, "en", "annotation") == (1, 1)
    assert started_at(env, assignment_id) is not None
