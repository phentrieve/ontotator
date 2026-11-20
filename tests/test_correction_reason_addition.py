"""The lead adds to the reason of "Ask a reviewer to correct…" (issue 483,
point 5): append-only, while the review is open, lead of the project only.
The reviewer reads each addition below the reason, the lead in the text card
and in History."""

from typing import Any

import pytest
from auth_harness import HARNESS, logged_in
from pg_harness import owner_engine
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from t1_fixtures import create_project
from test_lead_correction import accepted as accepted
from test_lead_correction import audits, lead, workflow
from test_translation_review_lead_reason import REASON, request_correction, task
from test_translation_review_service import review_env as review_env

from ontotator.application.document_row_submissions import build_submissions
from ontotator.assignments.service import AssignmentService
from ontotator.auth.audit import Actor
from ontotator.domain.errors import DomainError
from ontotator.storage.plan_tables import CorrectionReasonAdditionRow
from ontotator.storage.tables import SCHEMA

NOTE = "Auch Absatz 3: die Einheit ist mg."
CODE = "CORRECTION_REASON_NOT_AVAILABLE"


def path(assignment_id: int) -> str:
    return f"/api/v1/assignments/{assignment_id}/correction-reason"


def stored(env: Any) -> list[Any]:
    table = CorrectionReasonAdditionRow.__table__
    with env.db.transaction() as conn:
        return list(conn.execute(select(table).order_by(table.c.id)).all())


def refusal(env: Any, assignment_id: int, actor: Actor | None = None) -> Any:
    with pytest.raises(DomainError) as refused:
        workflow(env).add_correction_reason(actor or lead(env), assignment_id, NOTE)
    return refused.value.code, (refused.value.details or {}).get("reason")


def test_the_lead_adds_to_the_reason_and_the_reviewer_reads_it(accepted):
    env = accepted
    assignment = request_correction(env, "bob")
    first = workflow(env).add_correction_reason(lead(env), assignment, f"  {NOTE} ")
    second = workflow(env).add_correction_reason(
        lead(env), assignment, "Und Fußnote 2."
    )
    assert first["note"] == NOTE
    rows = stored(env)
    assert [(row.note, row.added_by) for row in rows] == [
        (NOTE, env.accesses["leader"].user_id),
        ("Und Fußnote 2.", env.accesses["leader"].user_id),
    ]
    assert {row.assignment_id for row in rows} == {assignment}
    # The reviewer: My tasks and the review, below the reason as it was sent.
    listed = task(env, "bob", assignment)
    assert listed.second_review_reason == REASON
    assert [(a.note, a.added_at) for a in listed.second_review_additions or ()] == [
        (NOTE, first["added_at"]),
        ("Und Fußnote 2.", second["added_at"]),
    ]
    opened = env.service.open(env.accesses["bob"], assignment)
    assert opened.second_review_reason == REASON
    assert opened.second_review_additions == listed.second_review_additions
    # Audited, with the note and the request's round.
    events = audits(env, "translation.correction_reason_added")
    assert [event["note"] for event in events] == [NOTE, "Und Fußnote 2."]
    assert {event["round_id"] for event in events} == {rows[0].round_id}
    # The request itself is unchanged: one event, the reason as sent.
    assert [e["reason"] for e in audits(env, "translation.correction_requested")] == [
        REASON
    ]


def test_the_lead_reads_the_additions_in_the_text_card_and_in_history(accepted):
    env = accepted
    assignment = request_correction(env, "bob")
    workflow(env).add_correction_reason(lead(env), assignment, NOTE)
    client = logged_in(env.app, "leader")
    page = client.get("/api/v1/projects/proj/document-rows")
    assert page.status_code == 200, page.text
    rows = [row for group in page.json()["groups"] for row in group["rows"]]
    work = next(
        item
        for row in rows
        for item in row["work"]
        if item["assignment_id"] == assignment
    )
    request = work["correction_request"]
    assert request["reason"] == REASON
    assert [a["note"] for a in request["additions"]] == [NOTE]
    assert request["additions"][0]["added_by"]["is_me"] is True
    # Other work carries none.
    others = [
        item["correction_request"]
        for row in rows
        for item in row["work"]
        if item["assignment_id"] != assignment
    ]
    assert set(map(str, others)) == {"None"}
    with env.db.transaction() as conn:
        built = build_submissions(
            conn, "proj", env.pid, "case", "de", env.accesses["leader"].user_id
        )
    lines = [
        (change["kind"], change["reason"])
        for change in built["changes"]
        if change["kind"].startswith("correction_")
    ]
    assert lines == [
        ("correction_requested", REASON),
        ("correction_reason_added", NOTE),
    ]
    added = next(c for c in built["changes"] if c["kind"] == "correction_reason_added")
    assert added["by"]["is_me"] is True
    assert added["to_person"]["pseudonym"] == env.accesses["bob"].pseudonym


def test_refused_after_submit_withdrawal_and_without_a_request(accepted):
    env = accepted
    # Alice's ordinary review, submitted and never requested for correction.
    assert refusal(env, env.ids["alice"]) == (CODE, "not_a_correction_request")
    # Bob's annotation task is no translation review.
    with env.db.transaction() as conn:
        annotate = conn.execute(
            text(
                f"SELECT id FROM {SCHEMA}.assignments WHERE task = 'annotate'"
                " AND revoked_at IS NULL ORDER BY id LIMIT 1"
            )
        ).scalar_one()
    assert refusal(env, annotate) == (CODE, "not_a_correction_request")
    # The request reopened Alice's review; submitted again, it is over.
    assert request_correction(env, "alice") == env.ids["alice"]
    workflow(env).add_correction_reason(lead(env), env.ids["alice"], NOTE)
    opened = env.service.open(env.accesses["alice"], env.ids["alice"])
    revision = env.service.save_draft(
        env.accesses["alice"],
        env.ids["alice"],
        expected_revision=opened.draft.revision,
        text=opened.text,
        form={
            "decision": "accepted_unchanged",
            "clinical_change": False,
            "rationale": "Checked again.",
        },
    )
    env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    assert refusal(env, env.ids["alice"]) == (CODE, "submitted")
    # The reviewer still reads what was added while the review was open.
    assert [
        a.note
        for a in task(env, "alice", env.ids["alice"]).second_review_additions or ()
    ] == [NOTE]
    assert len(stored(env)) == 1


def test_refused_for_a_withdrawn_request_and_an_empty_note(accepted):
    env = accepted
    assignment = request_correction(env, "bob")
    with pytest.raises(DomainError) as empty:
        workflow(env).add_correction_reason(lead(env), assignment, "   ")
    assert (empty.value.code, empty.value.details) == (
        CODE,
        {"reason": "note_required"},
    )
    AssignmentService(env.db).revoke(HARNESS, assignment)
    assert refusal(env, assignment) == (CODE, "withdrawn")
    assert stored(env) == []
    assert audits(env, "translation.correction_reason_added") == []


def test_only_the_lead_of_the_project_adds(accepted):
    env = accepted
    assignment = request_correction(env, "bob")
    body = {"note": NOTE}
    for name in ("alice", "bob"):
        refused = logged_in(env.app, name).post(path(assignment), json=body)
        assert refused.status_code == 403, (name, refused.text)
    # The lead of another project finds no such task here.
    create_project(env.db, "other")
    foreign = logged_in(env.app, "otherlead", projects={"other": ["lead"]})
    refused = foreign.post(path(assignment), json=body)
    assert refused.status_code in (403, 404), refused.text
    assert stored(env) == []
    # Without a login nothing is added.
    anonymous = logged_in(env.app, "leader")
    anonymous.cookies.clear()
    assert anonymous.post(path(assignment), json=body).status_code == 401
    # The lead: added, 200 with the saved addition; refusals are 409.
    client = logged_in(env.app, "leader")
    saved = client.post(path(assignment), json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["note"] == NOTE
    assert saved.json()["assignment_id"] == assignment
    refused = client.post(path(env.ids["alice"]), json=body)
    assert refused.status_code == 409, refused.text
    assert refused.json() == {
        "code": CODE,
        "details": {"reason": "not_a_correction_request"},
    }
    assert client.post(path(assignment), json={"note": ""}).status_code == 422
    assert client.post(path(987654), json=body).status_code == 404


def test_an_addition_belongs_to_its_request_only(accepted):
    env = accepted
    # Alice's submitted review is asked to correct again: a new round.
    assert request_correction(env, "alice") == env.ids["alice"]
    workflow(env).add_correction_reason(lead(env), env.ids["alice"], NOTE)
    opened = env.service.open(env.accesses["alice"], env.ids["alice"])
    revision = env.service.save_draft(
        env.accesses["alice"],
        env.ids["alice"],
        expected_revision=opened.draft.revision,
        text=opened.text,
        form={
            "decision": "accepted_unchanged",
            "clinical_change": False,
            "rationale": "Checked.",
        },
    )
    env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    request_correction(env, "alice")
    # The new request starts without the earlier request's addition.
    assert task(env, "alice", env.ids["alice"]).second_review_additions is None


def test_an_addition_is_never_changed(accepted):
    env = accepted
    assignment = request_correction(env, "bob")
    workflow(env).add_correction_reason(lead(env), assignment, NOTE)
    table = f"{SCHEMA}.translation_correction_reason_additions"
    for statement in (f"UPDATE {table} SET note = 'x'", f"DELETE FROM {table}"):
        with pytest.raises(DBAPIError), env.db.engine.begin() as conn:
            conn.execute(text(statement))
        with pytest.raises(DBAPIError), owner_engine(env.db).begin() as conn:
            conn.execute(text(statement))
    assert [row.note for row in stored(env)] == [NOTE]
