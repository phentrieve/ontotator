"""Issue 472: "Last change" in My tasks moves when the person saves. A save
leaves ``assignments.updated_at`` as it is (issue 268), so the task summary
takes the later of the assignment's change and the last saved draft."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from test_case_api import SOURCE
from test_translation_review_task import assigned, case_env, command

from ontotator.storage.tables import AssignmentRow

__all__ = ["case_env"]


def last_change(env: Any, assignment_id: int) -> datetime:
    tasks = env.alice.get("/api/v1/me/tasks").json()
    [task] = [item for item in tasks if item["assignment_id"] == assignment_id]
    return datetime.fromisoformat(task["updated_at"])


def row_change(env: Any, assignment_id: int) -> datetime:
    with env.db.transaction() as conn:
        found: datetime = conn.execute(
            select(AssignmentRow.updated_at).where(AssignmentRow.id == assignment_id)
        ).scalar_one()
        return found


def test_last_change_follows_every_saved_annotation_draft(case_env):
    env = case_env
    with env.db.transaction() as conn:
        assignment_id = conn.execute(
            select(AssignmentRow.id).where(
                AssignmentRow.document_id == SOURCE, AssignmentRow.task == "annotate"
            )
        ).scalar_one()
    assigned_at = last_change(env, assignment_id)
    opened = env.alice.post(
        "/api/v1/workspaces/open",
        json={"project_key": "proj", "document_id": SOURCE, "mode": "independent"},
    ).json()
    # Opening the task creates the draft but saves nothing.
    assert last_change(env, assignment_id) == assigned_at
    url = f"/api/v1/workspaces/{opened['workspace_id']}/commands"
    assert env.alice.post(url, json=command()).status_code == 200
    first = last_change(env, assignment_id)
    assert first > assigned_at
    # The second save changes only the draft: the assignment row stays.
    row_before = row_change(env, assignment_id)
    saved = env.alice.post(
        url,
        json={
            "mutation_id": "second-save",
            "expected_revision": 1,
            "payload": {"command": "check_layer", "layer_id": "hpo", "checked": False},
        },
    )
    assert saved.status_code == 200, saved.text
    assert row_change(env, assignment_id) == row_before
    assert last_change(env, assignment_id) > first


def test_last_change_follows_a_saved_translation_review_draft(case_env):
    env = case_env
    row = assigned(env)
    url = f"/api/v1/translation-reviews/{row['id']}"
    text = env.alice.get(url).json()["text"]
    form = {"decision": "accepted_unchanged", "clinical_change": False}
    before = last_change(env, row["id"])
    for revision in (0, 1):
        saved = env.alice.put(
            url + "/draft",
            json={"expected_revision": revision, "text": text, "form": form},
        )
        assert saved.status_code == 200, saved.text
        after = last_change(env, row["id"])
        assert after > before
        before = after
