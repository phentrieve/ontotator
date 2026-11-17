"""History of a text names reassignments and mode changes."""

from typing import Any

from sqlalchemy import insert, select
from work_plan_support import BASE, assign, doc, plan_env

from ontotator.assignments.service import AssignmentService
from ontotator.auth.audit import Actor
from ontotator.storage.mode_change_tables import AnnotationModeChangeRow
from ontotator.storage.tables import UserRow


def _changes(env: Any) -> list[dict[str, Any]]:
    response = env.lead.get(f"{BASE}/document-rows/c1/en/submissions")
    assert response.status_code == 200, response.text
    return list(response.json()["changes"])


def test_a_reassignment_shows_who_it_went_from_and_to(tmp_path: Any) -> None:
    env = plan_env(tmp_path)
    first = assign(env, doc("c1", "en"), "anno", "annotate")
    lead = env.app.state.accounts.get_by_username("leader")
    AssignmentService(env.db).reassign(
        Actor(lead.id, "user:leader"), first, username="anno2"
    )
    [change] = _changes(env)
    assert change["kind"] == "reassigned" and change["task"] == "annotate"
    assert change["from_person"]["display_name"] == "Anne Notator"
    assert change["to_person"]["display_name"] == "Arne Notator"


def test_a_mode_change_and_its_restore_keep_the_reason(tmp_path: Any) -> None:
    env = plan_env(tmp_path)
    with env.db.transaction() as conn:
        lead = conn.execute(
            select(UserRow.id).where(UserRow.username == "leader")
        ).scalar_one()
        conn.execute(
            insert(AnnotationModeChangeRow).values(
                project_id=env.pid,
                case_id="c1",
                language="en",
                from_mode="proposals",
                to_mode="scratch",
                reason="The proposals were wrong.",
                changed_by=lead,
            )
        )
    [change] = _changes(env)
    assert (change["kind"], change["to_mode"], change["reason"]) == (
        "mode_changed",
        "scratch",
        "The proposals were wrong.",
    )


def _kinds(env: Any) -> list[str]:
    return [change["kind"] for change in _changes(env)]


def test_a_reopen_names_the_lead_the_person_and_the_reason(tmp_path: Any) -> None:
    """Bulk and single reopen read the same; an undone bulk reopen adds a
    line of its own (issue: review of the lead's History, F1)."""
    from test_bulk_task_actions import REOPEN, UNDO
    from work_plan_support import submit

    env = plan_env(tmp_path)
    first = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, first, "s1")
    rows = [{"case_id": "c1", "language": "en"}]
    token = env.lead.post(REOPEN, json={"rows": rows, "preview": True}).json()[
        "preview_token"
    ]
    applied = env.lead.post(
        REOPEN, json={"rows": rows, "preview_token": token, "reason": "Guideline 2.3"}
    )
    assert applied.status_code == 200, applied.text
    [change] = _changes(env)
    assert change["kind"] == "reopened" and change["reason"] == "Guideline 2.3"
    assert change["assignment_id"] == first and change["task"] == "annotate"
    assert change["by"]["is_me"] is True
    assert change["to_person"]["display_name"] == "Anne Notator"

    undone = env.lead.post(UNDO, json={"undo_id": applied.json()["undo"]["id"]})
    assert undone.status_code == 200, undone.text
    assert _kinds(env) == ["reopened", "reopen_undone"]
    assert _changes(env)[1]["by"]["is_me"] is True

    # The single Reopen… of the text card, with its optional reason.
    single = env.lead.post(
        f"/api/v1/assignments/{first}/reopen", json={"reason": "One finding missing"}
    )
    assert single.status_code == 200, single.text
    last = _changes(env)[-1]
    assert (last["kind"], last["reason"]) == ("reopened", "One finding missing")


def test_a_round_started_by_the_lead_names_the_round_and_the_reason(
    tmp_path: Any,
) -> None:
    from test_bulk_start_round import START, _submitted

    env = plan_env(tmp_path)
    task = _submitted(env, "c1", "anno", "s1", started=True)
    body = {"rows": [{"case_id": "c1", "language": "en"}], "kind": "carry_forward"}
    token = env.lead.post(START, json={**body, "preview": True}).json()["preview_token"]
    done = env.lead.post(
        START, json={**body, "preview_token": token, "reason": "Second pass"}
    )
    assert done.status_code == 200, done.text
    # The first round, made when the annotator opened the task, is no change.
    [change] = _changes(env)
    assert change["kind"] == "round_started" and change["reason"] == "Second pass"
    assert change["assignment_id"] == task and change["round_ordinal"] == 2
    assert change["by"]["is_me"] is True
    assert change["to_person"]["display_name"] == "Anne Notator"


def test_the_final_result_is_named_when_chosen_changed_undone_and_withdrawn(
    tmp_path: Any,
) -> None:
    from test_bulk_final_actions import CHANGE, _final_then_newer

    env = plan_env(tmp_path)
    _final_then_newer(env, "c1")
    [chosen] = _changes(env)
    assert chosen["kind"] == "final_chosen" and chosen["from_result"] is None
    first = chosen["to_result"]["author"]["display_name"]
    assert chosen["by"]["is_me"] is True

    rows = [{"case_id": "c1", "language": "en"}]
    token = env.lead.post(CHANGE, json={"rows": rows, "preview": True}).json()[
        "preview_token"
    ]
    applied = env.lead.post(CHANGE, json={"rows": rows, "preview_token": token})
    assert applied.status_code == 200, applied.text
    changed = _changes(env)[-1]
    assert changed["kind"] == "final_changed"
    assert changed["from_result"]["author"]["display_name"] == first
    second = changed["to_result"]["author"]["display_name"]
    assert second != first and changed["by"]["is_me"] is True

    undone = env.lead.post(
        f"{CHANGE}/undo", json={"undo_id": applied.json()["undo"]["id"]}
    )
    assert undone.status_code == 200, undone.text
    restored = _changes(env)[-1]
    assert restored["kind"] == "final_restored" and restored["by"]["is_me"] is True
    assert restored["from_result"]["author"]["display_name"] == second
    assert restored["to_result"]["author"]["display_name"] == first

    # Confirming the same result again is no change; a withdrawal is one,
    # and the next choice is a first choice again.
    final = env.lead.get(f"{BASE}/document-rows", params={"q": "c1"}).json()
    current = next(
        row["final"]
        for group in final["groups"]
        for row in group["rows"]
        if row["language"] == "en"
    )
    again = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": current["document_id"],
            "submission_id": current["submission_id"],
            "expected_revision": current["revision"],
        },
    )
    assert again.status_code == 200, again.text
    assert _kinds(env) == ["final_chosen", "final_changed", "final_restored"]
    withdrawn = env.lead.post(
        f"{BASE}/final-selections/withdraw",
        json={
            "case_id": "c1",
            "language": "en",
            "expected_revision": again.json()["revision"],
            "reason": "Wrong text",
        },
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert _kinds(env)[-1] == "final_withdrawn"
