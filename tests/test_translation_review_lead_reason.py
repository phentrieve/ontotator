"""The lead's reason reaches the reviewer (user review 2026-11): the reason of
"Request correction…" and of "Reopen…" is in My tasks and in the review."""

from typing import Any

from test_lead_correction import accepted as accepted
from test_lead_correction import lead, target_hash, workflow
from test_translation_review_service import review_env as review_env

from ontotator.assignments.service import AssignmentService

REASON = "Bitte Dosis in Absatz 2 noch einmal prüfen."


def task(env: Any, name: str, assignment_id: int) -> Any:
    tasks = AssignmentService(env.db).my_tasks(env.accesses[name].user_id)
    return next(t for t in tasks if t.assignment_id == assignment_id)


def request_correction(env: Any, name: str) -> int:
    return (
        workflow(env)
        .assign_correction(
            lead(env),
            "proj",
            "target",
            name,
            expected_text_sha256=target_hash(env),
            reason=f"  {REASON} ",
            confirm_language=True,
        )
        .id
    )


def test_an_ordinary_review_has_no_reason_from_the_lead(review_env):
    env = review_env
    opened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert (opened.second_review_at, opened.second_review_reason) == (None, None)
    assert (opened.reopened_at, opened.reopen_reason) == (None, None)
    listed = task(env, "alice", env.ids["alice"])
    assert (listed.second_review_at, listed.second_review_reason) == (None, None)


def test_the_reason_of_a_correction_request_is_in_my_tasks_and_in_the_review(accepted):
    env = accepted
    # Alice had submitted: the request reopens her review (no reopen event).
    assert request_correction(env, "alice") == env.ids["alice"]
    listed = task(env, "alice", env.ids["alice"])
    assert listed.status == "reopened"
    assert listed.second_review_reason == REASON
    assert listed.second_review_at is not None
    assert (listed.reopened_at, listed.reopen_reason) == (None, None)
    opened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert opened.second_review_reason == REASON
    assert opened.second_review_at == listed.second_review_at
    assert (opened.reopened_at, opened.reopen_reason) == (None, None)


def test_the_request_to_another_reviewer_creates_a_task_with_the_reason(accepted):
    env = accepted
    created = request_correction(env, "bob")
    assert created != env.ids["alice"]
    listed = task(env, "bob", created)
    assert (listed.status, listed.second_review_reason) == ("open", REASON)
    # Alice's submitted review is not that request.
    assert task(env, "alice", env.ids["alice"]).second_review_reason is None


def test_a_reopen_names_its_reason_in_the_review_while_the_task_is_reopened(accepted):
    env = accepted
    AssignmentService(env.db).reopen(
        lead(env), env.ids["alice"], "The unit is mg in my copy."
    )
    opened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert opened.reopen_reason == "The unit is mg in my copy."
    assert opened.reopened_at == task(env, "alice", env.ids["alice"]).reopened_at
    assert opened.second_review_reason is None
    # Submitted again: the reopen is over.
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
    again = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert (again.reopened_at, again.reopen_reason) == (None, None)
