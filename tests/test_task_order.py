"""The order of a person's tasks (issue 488): ``GET /api/v1/me/tasks`` lists
them by status, then in the order of assignment, never by the text's upload
position; a bulk assignment creates its tasks in the order of its rows."""

from __future__ import annotations

from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import select, update
from work_plan_support import BASE, CASES, LANGUAGES, assign, plan_env, write

from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.storage.tables import AssignmentRow, ProjectRow


@pytest.fixture
def env(tmp_path):
    """Cases c1, c2 with en source and de/fr translations, uploaded in that
    order; annotation is in the plan for every text."""
    env = plan_env(tmp_path, rule_on=False)
    write(
        env,
        {
            RowKey(case, language): PlanFlags(False, True)
            for case in CASES
            for language in ("en", *LANGUAGES)
        },
    )
    return env


def tasks(env: Any, username: str = "anno") -> list[dict[str, Any]]:
    response = logged_in(env.app, username, assignments=[]).get("/api/v1/me/tasks")
    assert response.status_code == 200, response.text
    return list(response.json())


def ids(env: Any, username: str = "anno") -> list[int]:
    return [task["assignment_id"] for task in tasks(env, username)]


def set_status(env: Any, assignment_id: int, status: str) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(status=status)
        )


def move_to_front(env: Any, case_id: str, language: str) -> None:
    response = env.lead.post(
        f"{BASE}/document-rows/move-to-front",
        json={"rows": [{"case_id": case_id, "language": language}]},
    )
    assert response.status_code == 200, response.text


def test_tasks_follow_the_order_of_assignment_not_the_upload_order(env):
    # Upload order: c1-en, c1-de, c1-fr, c2-en, c2-de, c2-fr.
    assigned = [
        assign(env, document_id, "anno", "annotate")
        for document_id in ("c2-fr", "c1-en", "c2-en", "c1-de")
    ]
    assert [task["document_id"] for task in tasks(env)] == [
        "c2-fr",
        "c1-en",
        "c2-en",
        "c1-de",
    ]
    assert ids(env) == assigned == sorted(assigned)


def test_the_status_comes_before_the_order_of_assignment(env):
    first, second, third, fourth = (
        assign(env, document_id, "anno", "annotate")
        for document_id in ("c2-en", "c1-en", "c1-de", "c2-de")
    )
    set_status(env, first, "submitted")
    set_status(env, third, "in_progress")
    set_status(env, fourth, "reopened")
    assert ids(env) == [fourth, third, second, first]
    # Submitted again, a reopened task is back at its place among the
    # submitted ones: a reopen never changes the order of assignment.
    set_status(env, fourth, "submitted")
    set_status(env, second, "submitted")
    assert ids(env) == [third, first, second, fourth]


def test_assign_rows_create_the_tasks_in_their_order_across_languages(env):
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(annotations_per_text=2)
        )
    rows = [
        {"document_id": document_id, "username": username}
        for document_id, username in (
            ("c2-fr", "anno"),
            ("c1-en", "anno2"),
            ("c1-en", "anno"),
            ("c2-de", "anno"),
            ("c2-de", "anno2"),
            ("c1-de", "anno"),
            ("c2-en", "anno"),
        )
    ]
    response = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": rows,
            "task": "annotate",
            "confirm_language": True,
            "confirm_unreviewed_translation": True,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["refused"] == []
    created = response.json()["created"]
    assert [(item["document_id"], item["username"]) for item in created] == [
        (row["document_id"], row["username"]) for row in rows
    ]
    # The stored order (assignment id) is the order of the rows.
    with env.db.transaction() as conn:
        stored = conn.execute(
            select(AssignmentRow.id, AssignmentRow.document_id)
            .where(AssignmentRow.project_id == env.pid)
            .order_by(AssignmentRow.id)
        ).all()
    assert [document_id for _, document_id in stored] == [
        row["document_id"] for row in rows
    ]
    assert [item["id"] for item in created] == [item_id for item_id, _ in stored]
    assert [task["document_id"] for task in tasks(env)] == [
        "c2-fr",
        "c1-en",
        "c2-de",
        "c1-de",
        "c2-en",
    ]
    assert [task["document_id"] for task in tasks(env, "anno2")] == ["c1-en", "c2-de"]


def test_a_reassigned_task_comes_last_for_the_new_person(env):
    other = assign(env, "c2-en", "anno2", "annotate")
    first = assign(env, "c1-en", "anno", "annotate")
    kept = assign(env, "c2-de", "anno2", "annotate")
    response = env.lead.post(
        f"/api/v1/assignments/{first}/reassign",
        json={"username": "anno2", "confirm_language": True},
    )
    assert response.status_code == 200, response.text
    assert ids(env, "anno2") == [other, kept, response.json()["id"]]
    assert ids(env) == []


def test_move_to_front_puts_assigned_tasks_first_and_later_tasks_follow(env):
    first, second, third = (
        assign(env, document_id, "anno", "annotate")
        for document_id in ("c1-en", "c2-en", "c1-de")
    )
    assert ids(env) == [first, second, third]
    move_to_front(env, "c1", "de")
    assert ids(env) == [third, first, second]
    # A later move goes in front of an earlier one.
    move_to_front(env, "c2", "en")
    assert ids(env) == [second, third, first]
    # Tasks assigned after the moves follow the order of assignment, whatever
    # the position of their text: c2-fr is uploaded last, c1-fr before it.
    fourth = assign(env, "c2-fr", "anno", "annotate")
    fifth = assign(env, "c1-fr", "anno", "annotate")
    assert ids(env) == [second, third, first, fourth, fifth]
    # The status still comes first.
    set_status(env, fifth, "in_progress")
    set_status(env, second, "submitted")
    assert ids(env) == [fifth, third, first, fourth, second]


def test_a_move_to_front_before_the_assignment_does_not_reorder(env):
    move_to_front(env, "c2", "en")
    first = assign(env, "c1-en", "anno", "annotate")
    second = assign(env, "c2-en", "anno", "annotate")
    assert ids(env) == [first, second]
    # Another person's later task on a moved text is not put first either.
    move_to_front(env, "c1", "de")
    third = assign(env, "c1-de", "anno", "annotate")
    assert ids(env) == [first, second, third]
