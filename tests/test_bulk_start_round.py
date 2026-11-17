"""Bulk "Start a round…" on Documents (issue 336 step 3)."""

from __future__ import annotations

import json
from typing import Any

import pytest
from sqlalchemy import delete, event, insert, select, update
from work_plan_support import (
    BASE,
    assign,
    doc,
    plan_env,
    select_final,
    submit,
)

from ontotator.application.bulk_task_actions import SKIP_REASONS
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    ProjectMembershipRow,
    ProjectRow,
    UserRow,
)
from ontotator.storage.workflow_tables import WorkRoundRow, WorkRoundStateRow

START = f"{BASE}/bulk-task-actions/start-round"
ROWS = [{"case_id": "c1", "language": "en"}, {"case_id": "c2", "language": "en"}]


@pytest.fixture
def env(tmp_path):
    made = plan_env(tmp_path)
    with made.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == made.pid)
            .values(annotations_per_text=4)
        )
    return made


def _post(env: Any, **body: Any) -> Any:
    return env.lead.post(START, json={"rows": ROWS, **body})


def _task(env: Any, assignment_id: int) -> Any:
    with env.db.transaction() as conn:
        return conn.execute(
            select(AssignmentRow).where(AssignmentRow.id == assignment_id)
        ).one()


def _set(env: Any, assignment_id: int, **values: Any) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(**values)
        )


def _submitted(env: Any, case: str, user: str, sid: str, *, started: bool = False):
    """A submitted annotation of ``case`` en by ``user``; ``started``: with a
    work round, as a task opened in the editor has one."""
    from auth_harness import logged_in

    task = assign(env, doc(case, "en"), user, "annotate")
    if started:
        made = logged_in(env.app, user).post(
            f"/api/v1/assignments/{task}/rounds",
            json={"request_id": f"first-{task}", "expected_workflow_revision": 0},
        )
        assert made.status_code == 200, made.text
    submit(env, task, sid)
    return task


def _translation(env: Any, case: str, status: str) -> None:
    from ontotator.storage.tables import DocumentRow

    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == doc(case, "de"))
            .values(translation_status=status)
        )


def _rounds(env: Any, assignment_id: int) -> list[tuple[str, str]]:
    with env.db.transaction() as conn:
        return [
            (row.kind, row.state)
            for row in conn.execute(
                select(WorkRoundRow.kind, WorkRoundStateRow.state)
                .join(
                    WorkRoundStateRow,
                    WorkRoundStateRow.round_id == WorkRoundRow.round_id,
                )
                .where(WorkRoundRow.assignment_id == assignment_id)
                .order_by(WorkRoundRow.created_at)
            )
        ]


def _audits(env: Any) -> list[dict[str, Any]]:
    with env.db.transaction() as conn:
        return [
            dict(details)
            for details in conn.execute(
                select(AuditEventRow.details)
                .where(AuditEventRow.action == "round.create")
                .order_by(AuditEventRow.id)
            ).scalars()
            if details.get("via")
        ]


def test_continue_previews_applies_all_or_nothing_and_audits_each_task(env):
    a1 = _submitted(env, "c1", "anno", "s1")
    a2 = _submitted(env, "c1", "anno2", "s2")
    b1 = _submitted(env, "c2", "anno", "s3")
    open_task = assign(env, doc("c2", "en"), "anno2", "annotate")

    found = _post(env, kind="carry_forward", preview=True).json()
    assert found["action"] == "start_round" and found["applied"] is False
    assert [item["assignment_id"] for item in found["changes"]] == [a1, a2, b1]
    assert found["changes"][0]["person"]["display_name"] == "Anne Notator"
    assert [(k["assignment_id"], k["reason"]) for k in found["kept"]] == [
        (open_task, "not_submitted")
    ]
    assert found["skipped"] == [] and found["undo"] is None
    token = found["preview_token"]

    # Another kind is another preview; a preview changes nothing.
    restart = _post(env, kind="clean_restart", preview=True).json()
    assert restart["preview_token"] != token
    assert _rounds(env, a1) == []

    # The texts changed since the preview: nothing is started, fresh preview.
    _set(env, b1, status="reopened")
    stale = _post(env, kind="carry_forward", preview_token=token)
    assert stale.status_code == 409 and stale.json()["code"] == "PREVIEW_STALE"
    fresh = stale.json()["details"]["preview"]
    assert [item["assignment_id"] for item in fresh["changes"]] == [a1, a2]
    assert _rounds(env, a1) == [] and _audits(env) == []

    done = _post(env, kind="carry_forward", preview_token=fresh["preview_token"])
    assert done.status_code == 200, done.text
    result = done.json()
    assert result["applied"] is True and result["undo"] is None
    for task in (a1, a2):
        assert _rounds(env, task) == [("carry_forward", "editable")]
        row = _task(env, task)
        assert (row.status, row.last_submission_id) == ("open", None)
    assert _rounds(env, b1) == []
    assert [
        (a["assignment_id"], a["kind"], a["sources"], a["via"]) for a in _audits(env)
    ] == [
        (a1, "carry_forward", ["s1"], "bulk_start_round"),
        (a2, "carry_forward", ["s2"], "bulk_start_round"),
    ]
    # Applied once: the same token no longer matches.
    again = _post(env, kind="carry_forward", preview_token=fresh["preview_token"])
    assert again.json()["code"] == "PREVIEW_STALE"


def test_restart_needs_a_reason_and_a_round_and_closes_the_earlier_round(env):
    with_round = _submitted(env, "c1", "anno", "s1", started=True)
    without = _submitted(env, "c1", "anno2", "s2")

    found = _post(env, kind="clean_restart", preview=True).json()
    assert [item["assignment_id"] for item in found["changes"]] == [with_round]
    assert [(k["assignment_id"], k["reason"]) for k in found["kept"]] == [
        (without, "no_round")
    ]
    token = found["preview_token"]
    missing = _post(env, kind="clean_restart", preview_token=token, reason="  ")
    assert missing.json()["code"] == "BULK_REASON_REQUIRED"
    assert _rounds(env, with_round) == [("ordinary", "editable")]

    done = _post(env, kind="clean_restart", preview_token=token, reason="New tool set")
    assert done.status_code == 200, done.text
    assert _rounds(env, with_round) == [
        ("ordinary", "abandoned"),
        ("clean_restart", "editable"),
    ]
    row = _task(env, with_round)
    assert (row.status, row.last_submission_id) == ("open", None)
    [audit] = _audits(env)
    assert audit["reason"] == "New tool set" and audit["sources"] == []
    assert _task(env, without).status == "submitted"


def test_every_reason_a_task_is_kept_or_a_text_is_skipped(env):
    rows = [
        *ROWS,
        {"case_id": "c1", "language": "de"},
        {"case_id": "c2", "language": "de"},
    ]
    ok = _submitted(env, "c1", "anno", "s1")
    paused = _submitted(env, "c1", "anno2", "s2")
    _set(env, paused, held=True, hold_reason="problem_report")
    gone = _submitted(env, "c1", "ana", "s3")
    with env.db.transaction() as conn:
        user = conn.execute(
            select(UserRow.id).where(UserRow.username == "ana")
        ).scalar_one()
        conn.execute(
            delete(ProjectMembershipRow).where(
                ProjectMembershipRow.project_id == env.pid,
                ProjectMembershipRow.user_id == user,
            )
        )
    not_submitted = assign(env, doc("c1", "en"), "ben", "annotate")
    # c2 en has a final result; c1 de an open consolidation; c2 de is discarded.
    final = _submitted(env, "c2", "anno", "s4")
    select_final(env, doc("c2", "en"), "s4")
    from work_plan_support import write

    from ontotator.domain.work_plans import PlanFlags, RowKey

    write(
        env,
        {
            RowKey("c1", "de"): PlanFlags(False, True),
            RowKey("c2", "de"): PlanFlags(False, True),
        },
    )
    for row in rows[2:]:
        _translation(env, row["case_id"], "accepted")
    consolidated = assign(env, doc("c1", "de"), "anno", "annotate")
    submit(env, consolidated, "s5")
    assign(env, doc("c1", "de"), "adj", "review")
    old = assign(env, doc("c2", "de"), "anno", "annotate")
    submit(env, old, "s6")
    with env.db.transaction() as conn:
        lead = conn.execute(
            select(UserRow.id).where(UserRow.username == "leader")
        ).scalar_one()
        conn.execute(
            insert(DiscardedVariantRow).values(
                project_id=env.pid,
                document_id=doc("c2", "de"),
                reason="test",
                discarded_by=lead,
            )
        )

    found = env.lead.post(
        START, json={"rows": rows, "kind": "carry_forward", "preview": True}
    ).json()
    assert [item["assignment_id"] for item in found["changes"]] == [ok]
    assert {k["assignment_id"]: k["reason"] for k in found["kept"]} == {
        paused: "paused",
        gone: "person_unavailable",
        not_submitted: "not_submitted",
        old: "not_current_version",
    }
    assert all(k["message"] for k in found["kept"])
    assert [
        (s["case_id"], s["language"], s["reason"], s["message"])
        for s in found["skipped"]
    ] == [
        ("c2", "en", "final_result", "Final result chosen: use Withdraw final… first."),
        (
            "c1",
            "de",
            "consolidation_open",
            "A consolidation is open: finish or withdraw it first.",
        ),
    ]
    assert (found["change_count"], found["kept_count"], found["skipped_count"]) == (
        1,
        4,
        2,
    )
    assert final not in [k["assignment_id"] for k in found["kept"]]

    applied = env.lead.post(
        START,
        json={
            "rows": rows,
            "kind": "carry_forward",
            "preview_token": found["preview_token"],
        },
    )
    assert applied.status_code == 200, applied.text
    assert _rounds(env, ok) == [("carry_forward", "editable")]
    for untouched in (paused, gone, final, consolidated, old):
        assert _task(env, untouched).status == "submitted"
        assert _rounds(env, untouched) == []


def test_start_round_is_for_leads_of_the_project_only(env):
    from auth_harness import logged_in

    body = {"rows": ROWS, "kind": "carry_forward", "preview": True}
    assert logged_in(env.app, "anno").post(START, json=body).status_code in {403, 404}
    assert logged_in(env.app, "adj").post(START, json=body).status_code in {403, 404}
    other = env.lead.post(
        "/api/v1/projects/other/bulk-task-actions/start-round", json=body
    )
    assert other.status_code == 404
    # Neither a preview nor a token: refused; an unknown kind too.
    assert (
        env.lead.post(START, json={"rows": ROWS, "kind": "carry_forward"}).status_code
        == 422
    )
    assert _post(env, kind="ordinary", preview=True).status_code == 422
    from ontotator.api.token_scopes import requirement

    found = requirement("POST", START)
    assert found is not None and found.scope == "project-admin"


def test_summary_only_and_statements_do_not_grow_with_the_tasks(env):
    for case in ("c1", "c2"):
        for user in ("anno", "anno2"):
            _submitted(env, case, user, f"{case}{user}")
    summary = _post(env, kind="carry_forward", preview=True, summary_only=True).json()
    assert (summary["change_count"], summary["texts"]) == (4, 2)
    assert summary["changes"] == summary["kept"] == summary["skipped"] == []
    full = _post(env, kind="carry_forward", preview=True).json()
    assert full["preview_token"] == summary["preview_token"]

    def statements(rows: list[dict[str, str]], **body: Any) -> tuple[int, Any]:
        seen: list[str] = []

        def count(conn, cursor, statement, *args):
            seen.append(statement)

        event.listen(env.db.engine, "before_cursor_execute", count)
        try:
            found = env.lead.post(
                START, json={"rows": rows, "kind": "carry_forward", **body}
            )
        finally:
            event.remove(env.db.engine, "before_cursor_execute", count)
        assert found.status_code == 200, found.text
        return len(seen), found.json()

    # A preview of two tasks or four: the same number of statements.
    one, first = statements(ROWS[:1], preview=True)
    two, _ = statements(ROWS, preview=True)
    assert one == two
    # Applying costs a fixed number of statements per new round.
    apply_one, _ = statements(ROWS[:1], preview_token=first["preview_token"])
    second = statements(ROWS[1:], preview=True)[1]
    apply_two, _ = statements(ROWS[1:], preview_token=second["preview_token"])
    assert apply_one == apply_two
    per_round = (apply_one - one) / 2
    assert per_round <= 60, per_round


def test_a_task_waiting_for_the_translation_review_is_kept(env):
    from work_plan_support import write

    from ontotator.domain.work_plans import PlanFlags, RowKey

    write(env, {RowKey("c1", "de"): PlanFlags(False, True)})
    _translation(env, "c1", "accepted")
    task = assign(env, doc("c1", "de"), "anno", "annotate")
    submit(env, task, "s1")
    _translation(env, "c1", "reviewed")
    rows = [{"case_id": "c1", "language": "de"}]
    body = {"rows": rows, "kind": "carry_forward", "preview": True}
    found = env.lead.post(START, json=body).json()
    assert found["changes"] == []
    assert [(k["assignment_id"], k["reason"]) for k in found["kept"]] == [
        (task, "translation_not_accepted")
    ]


def _single(env: Any, client: Any, assignment_id: int, **body: Any) -> Any:
    return client.post(
        f"/api/v1/assignments/{assignment_id}/rounds",
        json={
            "request_id": f"single-{assignment_id}-{body.get('kind')}",
            "expected_workflow_revision": _task(env, assignment_id).workflow_revision,
            **body,
        },
    )


@pytest.mark.parametrize("kind", ["carry_forward", "clean_restart"])
def test_single_round_refuses_where_the_bulk_action_skips_an_open_consolidation(
    env, kind
):
    """The single call and the bulk action agree: no new round for a
    submitted annotation while a consolidation of the text is open."""
    from auth_harness import logged_in

    task = _submitted(env, "c1", "anno", "s1", started=True)
    other = _submitted(env, "c2", "anno", "s2", started=True)
    review = assign(env, doc("c1", "en"), "adj", "review")
    body: dict[str, Any] = {"kind": kind}
    if kind == "carry_forward":
        body["source_submission_ids"] = ["s1"]
    else:
        body["reason"] = "Guideline changed"

    found = _post(env, kind=kind, preview=True).json()
    assert [(s["case_id"], s["reason"], s["message"]) for s in found["skipped"]] == [
        ("c1", "consolidation_open", SKIP_REASONS["consolidation_open"])
    ]
    assert [item["assignment_id"] for item in found["changes"]] == [other]

    for client in (env.lead, logged_in(env.app, "anno")):
        refused = _single(env, client, task, **body)
        if kind == "clean_restart" and client is not env.lead:
            # An annotator never restarts on their own.
            assert refused.status_code == 403, refused.text
            continue
        assert refused.status_code == 409, refused.text
        assert refused.json() == {
            "code": "CONSOLIDATION_OPEN",
            "details": "A consolidation is open on this text: finish or withdraw"
            " it first.",
        }
    assert _task(env, task).status == "submitted"
    assert [kind_ for kind_, _ in _rounds(env, task)] == ["ordinary"]

    # A text without a consolidation takes the round, single as in bulk.
    if kind == "carry_forward":
        body["source_submission_ids"] = ["s2"]
    made = _single(env, env.lead, other, **body)
    assert made.status_code == 200, made.text

    # Once the consolidation task is withdrawn, the single call works.
    revoked = env.lead.post(f"/api/v1/assignments/{review}/revoke", json={})
    assert revoked.status_code == 200, revoked.text
    if kind == "carry_forward":
        body["source_submission_ids"] = ["s1"]
    made = _single(env, env.lead, task, **body)
    assert made.status_code == 200, made.text
    assert _rounds(env, task)[-1] == (kind, "editable")


def test_round_sources_say_that_an_open_consolidation_refuses_the_carry(env):
    """The owner is told before trying: the sources of a submitted annotation
    name the refusal while a consolidation of the text is open, and nothing
    about who consolidates."""
    from auth_harness import logged_in

    task = _submitted(env, "c1", "anno", "s1", started=True)
    other = _submitted(env, "c2", "anno", "s2", started=True)
    review = assign(env, doc("c1", "en"), "adj", "review")
    owner = logged_in(env.app, "anno")

    def sources(client, assignment_id: int) -> list[dict[str, Any]]:
        answer = client.get(f"/api/v1/assignments/{assignment_id}/round-sources")
        assert answer.status_code == 200, answer.text
        return list(answer.json())

    for client in (owner, env.lead):
        listed = sources(client, task)
        assert [(s["submission_id"], s["refused_by"]) for s in listed] == [
            ("s1", "CONSOLIDATION_OPEN")
        ]
        assert "adj" not in json.dumps(listed)
    assert [s["refused_by"] for s in sources(owner, other)] == [None]

    revoked = env.lead.post(f"/api/v1/assignments/{review}/revoke", json={})
    assert revoked.status_code == 200, revoked.text
    assert [s["refused_by"] for s in sources(owner, task)] == [None]


def test_single_round_for_unsubmitted_work_ignores_an_open_consolidation(env):
    """Only a submitted annotation is behind a consolidation: a restart of
    work that was never submitted takes nothing away from it."""
    from auth_harness import logged_in

    task = assign(env, doc("c1", "en"), "anno", "annotate")
    first = logged_in(env.app, "anno").post(
        f"/api/v1/assignments/{task}/rounds",
        json={"request_id": "first", "expected_workflow_revision": 0},
    )
    assert first.status_code == 200, first.text
    assign(env, doc("c1", "en"), "adj", "review")
    made = _single(env, env.lead, task, kind="clean_restart", reason="Start again")
    assert made.status_code == 200, made.text


def test_texts_the_project_does_not_have_are_named(env):
    wrong = [{"case_id": "nope", "language": "en"}, {"case_id": "C1", "language": "en"}]
    found = env.lead.post(
        START,
        json={"rows": [ROWS[0], *wrong], "kind": "carry_forward", "preview": True},
    )
    assert found.status_code == 200, found.text
    assert found.json()["texts"] == 1
    assert found.json()["unknown_rows"] == wrong
