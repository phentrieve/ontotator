"""Bulk Reopen and Withdraw open tasks on Documents (issue 336 step 1) and the
filter "More annotators than the limit" (issue 339 b)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import event, insert, select, update
from work_plan_support import (
    BASE,
    assign,
    doc,
    plan_env,
    select_final,
    submit,
    write,
)

from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    ProjectRow,
    TranslationReviewDraftRow,
)

REOPEN = f"{BASE}/bulk-task-actions/reopen"
WITHDRAW = f"{BASE}/bulk-task-actions/withdraw"
UNDO = f"{BASE}/bulk-task-actions/undo"
ROWS = [{"case_id": "c1", "language": "en"}, {"case_id": "c2", "language": "en"}]


@pytest.fixture
def env(tmp_path):
    return plan_env(tmp_path)


def _limit(env: Any, n: int) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(annotations_per_text=n)
        )


def _status(env: Any, assignment_id: int) -> tuple[str, bool]:
    with env.db.transaction() as conn:
        row = conn.execute(
            select(AssignmentRow.status, AssignmentRow.revoked_at).where(
                AssignmentRow.id == assignment_id
            )
        ).one()
    return row.status, row.revoked_at is not None


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


def _undo(env: Any, result: dict[str, Any], who: Any = None) -> Any:
    return (who or env.lead).post(UNDO, json={"undo_id": result["undo"]["id"]})


def _apply(env: Any, url: str, **body: Any) -> dict[str, Any]:
    token = _post(env, url, preview=True, **body).json()["preview_token"]
    extra = {"reason": "Guideline 2.3"} if url == REOPEN else {}
    applied = _post(env, url, preview_token=token, **extra, **body)
    assert applied.status_code == 200, applied.text
    return dict(applied.json())


def _set(env: Any, assignment_id: int, **values: Any) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(**values)
        )


def _review(env: Any, case: str, status: str) -> int:
    """A translation review of ``case`` de by ana, in ``status``, with a draft."""
    write(env, {RowKey(case, "de"): PlanFlags(True, True)})
    review = assign(env, doc(case, "de"), "ana", "translation_review")
    _set(env, review, status=status)
    with env.db.transaction() as conn:
        conn.execute(
            insert(TranslationReviewDraftRow).values(
                assignment_id=review, text="Edited by ana", form={"decision": "x"}
            )
        )
    return review


def _post(env: Any, url: str, **body: Any) -> Any:
    return env.lead.post(url, json={"rows": ROWS, **body})


def test_reopen_preview_groups_apply_all_or_nothing_audit_and_undo(env):
    _limit(env, 2)
    a1 = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, a1, "s1")
    a2 = assign(env, doc("c1", "en"), "anno2", "annotate")  # open: kept
    b1 = assign(env, doc("c2", "en"), "anno", "annotate")
    submit(env, b1, "s2")
    select_final(env, doc("c2", "en"), "s2")  # c2 is skipped

    preview = _post(env, REOPEN, preview=True)
    assert preview.status_code == 200, preview.text
    found = preview.json()
    assert found["applied"] is False and found["texts"] == 2
    assert [item["assignment_id"] for item in found["changes"]] == [a1]
    assert found["changes"][0]["person"]["display_name"] == "Anne Notator"
    assert [(item["assignment_id"], item["reason"]) for item in found["kept"]] == [
        (a2, "not_submitted")
    ]
    assert found["skipped"] == [
        {
            "case_id": "c2",
            "language": "en",
            "reason": "final_chosen",
            "message": "Final result chosen: use Change final… first.",
        }
    ]
    token = found["preview_token"]

    # A reason is required to apply; a wrong token changes nothing.
    missing = _post(env, REOPEN, preview_token=token)
    assert missing.json()["code"] == "BULK_REASON_REQUIRED"
    stale = _post(env, REOPEN, preview_token="sha256:old", reason="Guideline 2.3")
    assert stale.status_code == 409
    assert stale.json()["code"] == "PREVIEW_STALE"
    assert stale.json()["details"]["preview"]["preview_token"] == token
    assert _status(env, a1) == ("submitted", False)

    applied = _post(env, REOPEN, preview_token=token, reason="  Guideline 2.3 ")
    assert applied.status_code == 200, applied.text
    result = applied.json()
    assert result["applied"] is True
    assert _status(env, a1) == ("reopened", False)
    assert _status(env, b1) == ("submitted", False)
    [(target, details)] = _audits(env, "assignment.reopen")
    assert target == str(a1)
    assert details == {"reason": "Guideline 2.3", "via": "bulk_reopen"}
    # The Undo is the server's record: the client gets its id only.
    assert set(result["undo"]) == {"id", "expires_at"}

    # A preview of the Undo lists the task and changes nothing.
    preview = env.lead.post(
        UNDO, json={"undo_id": result["undo"]["id"], "preview": True}
    )
    assert preview.status_code == 200, preview.text
    listed = preview.json()
    assert (listed["applied"], listed["undone"], listed["blocked"]) == (False, 0, None)
    assert (listed["action"], listed["task_count"]) == ("reopen", 1)
    assert listed["undo_id"] == result["undo"]["id"]
    [task] = listed["tasks"]
    assert (task["case_id"], task["language"], task["assignment_id"]) == (
        "c1",
        "en",
        a1,
    )
    assert (task["task"], task["status"]) == ("annotate", "reopened")
    assert task["person"]["display_name"]
    assert _status(env, a1) == ("reopened", False)
    assert _audits(env, "assignment.reopen_undone") == []

    undone = _undo(env, result)
    assert undone.status_code == 200, undone.text
    done = undone.json()
    assert (done["undone"], done["applied"], done["blocked"]) == (1, True, None)
    assert [(t["assignment_id"], t["status"]) for t in done["tasks"]] == [
        (a1, "submitted")
    ]
    assert _status(env, a1) == ("submitted", False)
    assert [d["via"] for _, d in _audits(env, "assignment.reopen_undone")] == [
        "bulk_reopen_undo"
    ]
    # Once undone, the same Undo is stale.
    again = _undo(env, result)
    assert again.status_code == 409
    assert again.json()["code"] == "BULK_UNDO_STALE"
    # ... also in a preview.
    late = env.lead.post(UNDO, json={"undo_id": result["undo"]["id"], "preview": True})
    assert late.status_code == 409
    assert late.json()["details"] == {"reason": "already_undone"}


def test_undo_is_refused_once_the_texts_changed(env):
    _limit(env, 2)
    a1 = assign(env, doc("c1", "en"), "anno", "annotate")
    token = _post(env, WITHDRAW, preview=True).json()["preview_token"]
    result = _post(env, WITHDRAW, preview_token=token).json()
    assert _status(env, a1) == ("open", True)
    # Someone else is assigned in the meantime.
    assign(env, doc("c1", "en"), "anno2", "annotate")
    # The preview says so, names the task and leaves it withdrawn.
    preview = env.lead.post(
        UNDO, json={"undo_id": result["undo"]["id"], "preview": True}
    ).json()
    assert preview["blocked"]["reason"] == "changed"
    assert preview["blocked"]["message"]
    assert [t["assignment_id"] for t in preview["tasks"]] == [a1]
    assert (preview["applied"], preview["action"]) == (False, "withdraw")
    refused = _undo(env, result)
    assert refused.status_code == 409
    assert refused.json()["code"] == "BULK_UNDO_STALE"
    assert _status(env, a1) == ("open", True)


def test_withdraw_keeps_started_submitted_and_within_limit_tasks(env):
    _limit(env, 3)
    started = assign(env, doc("c1", "en"), "anno", "annotate")
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == started)
            .values(status="in_progress")
        )
    fresh = assign(env, doc("c1", "en"), "anno2", "annotate")
    done = assign(env, doc("c2", "en"), "anno", "annotate")
    submit(env, done, "s9")
    review = assign(env, doc("c2", "en"), "adj", "review")

    found = _post(env, WITHDRAW, preview=True).json()
    assert [item["assignment_id"] for item in found["changes"]] == [fresh]
    assert {(item["assignment_id"], item["reason"]) for item in found["kept"]} == {
        (started, "started"),
        (done, "submitted"),
    }
    # Started tasks and other tasks on request.
    wider = _post(
        env, WITHDRAW, preview=True, include_started=True, tasks=["annotate", "review"]
    ).json()
    assert {item["assignment_id"] for item in wider["changes"]} == {
        started,
        fresh,
        review,
    }
    applied = _post(
        env,
        WITHDRAW,
        preview_token=wider["preview_token"],
        include_started=True,
        tasks=["annotate", "review"],
        reason="Scope narrowed",
    )
    assert applied.status_code == 200, applied.text
    assert all(_status(env, i)[1] for i in (started, fresh, review))
    assert _status(env, done) == ("submitted", False)
    audits = _audits(env, "assignment.revoke")
    assert {target for target, _ in audits} == {str(started), str(fresh), str(review)}
    assert {d["via"] for _, d in audits} == {"bulk_withdraw"}
    assert {d["reason"] for _, d in audits} == {"Scope narrowed"}

    # Undo brings the tasks back with their status (drafts were never touched).
    assert _undo(env, applied.json()).status_code == 200
    assert _status(env, started) == ("in_progress", False)
    assert _status(env, review) == ("open", False)
    assert len(_audits(env, "assignment.restore")) == 3


def test_over_limit_filter_and_withdraw_above_the_limit(env):
    _limit(env, 2)
    first = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, first, "s1")
    second = assign(env, doc("c1", "en"), "anno2", "annotate")
    assign(env, doc("c2", "en"), "anno", "annotate")
    _limit(env, 1)

    page = env.lead.get(f"{BASE}/document-rows", params={"flags": "over_limit"})
    assert page.status_code == 200, page.text
    listed = [
        (row["case_id"], row["language"], row["over_limit"])
        for group in page.json()["groups"]
        for row in group["rows"]
    ]
    assert listed == [("c1", "en", True)]
    facets = env.lead.get(f"{BASE}/document-rows").json()["bar"]["facets"]
    assert facets["flags"]["over_limit"] == 1

    found = _post(env, WITHDRAW, preview=True, over_limit_only=True).json()
    assert [item["assignment_id"] for item in found["changes"]] == [second]
    assert {item["reason"] for item in found["kept"]} == {"submitted", "within_limit"}
    applied = _post(
        env, WITHDRAW, preview_token=found["preview_token"], over_limit_only=True
    )
    assert applied.status_code == 200, applied.text
    after = env.lead.get(f"{BASE}/document-rows", params={"flags": "over_limit"})
    assert [row for group in after.json()["groups"] for row in group["rows"]] == []


def _own_limit(env: Any, case: str, value: int | None) -> None:
    response = env.lead.put(
        f"{BASE}/texts/{case}/en/annotations-per-text",
        json={"value": value, "reason": "method comparison"},
    )
    assert response.status_code == 200, response.text


def _over_limit(env: Any) -> list[str]:
    page = env.lead.get(f"{BASE}/document-rows", params={"flags": "over_limit"})
    assert page.status_code == 200, page.text
    return [row["case_id"] for group in page.json()["groups"] for row in group["rows"]]


def test_over_limit_and_withdraw_use_the_texts_own_limit(env):
    """Issue 422: a text's own "Annotators per text" is its limit, for the
    filter and for the withdrawal above the limit, above and below the
    project's value."""
    _limit(env, 2)
    assign(env, doc("c1", "en"), "anno", "annotate")
    c1_second = assign(env, doc("c1", "en"), "anno2", "annotate")
    assign(env, doc("c2", "en"), "anno", "annotate")
    c2_second = assign(env, doc("c2", "en"), "anno2", "annotate")

    # Project limit 1, c2 has its own limit of 2: only c1 is above its limit.
    _limit(env, 1)
    _own_limit(env, "c2", 2)
    assert _over_limit(env) == ["c1"]
    found = _post(env, WITHDRAW, preview=True, over_limit_only=True).json()
    assert [item["assignment_id"] for item in found["changes"]] == [c1_second]
    assert {item["reason"] for item in found["kept"]} == {"within_limit"}
    assert len(found["kept"]) == 3

    # Project limit 2, c2 has its own limit of 1: only c2 is above its limit.
    _limit(env, 2)
    _own_limit(env, "c2", 1)
    assert _over_limit(env) == ["c2"]
    found = _post(env, WITHDRAW, preview=True, over_limit_only=True).json()
    assert [item["assignment_id"] for item in found["changes"]] == [c2_second]

    # Without its own value the text follows the project again.
    _own_limit(env, "c2", None)
    assert _over_limit(env) == []
    found = _post(env, WITHDRAW, preview=True, over_limit_only=True).json()
    assert found["changes"] == []


def test_bulk_actions_are_for_leads_only(env):
    from auth_harness import logged_in

    annotator = logged_in(env.app, "anno")
    response = annotator.post(REOPEN, json={"rows": ROWS, "preview": True})
    assert response.status_code in {403, 404}
    assert env.lead.post(REOPEN, json={"rows": ROWS}).status_code == 422


# --- Undo is the server's record (review of PR 433) ------------------------- #


def test_undo_touches_only_the_tasks_the_action_changed(env):
    """A task reopened singly before the bulk action is not the action's: the
    client cannot name tasks, so the Undo leaves it reopened."""
    _limit(env, 2)
    a1 = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, a1, "s1")
    a2 = assign(env, doc("c1", "en"), "anno2", "annotate")
    submit(env, a2, "s2")
    single = env.lead.post(f"/api/v1/assignments/{a2}/reopen", json={"reason": "x"})
    assert single.status_code == 200, single.text
    result = _apply(env, REOPEN)
    assert [item["assignment_id"] for item in result["changes"]] == [a1]
    # The earlier request shape, with the tasks and the action chosen by the
    # client, is refused outright.
    forged = env.lead.post(
        UNDO,
        json={
            "undo_id": result["undo"]["id"],
            "action": "reopen",
            "assignment_ids": [a1, a2],
        },
    )
    assert forged.status_code == 422
    assert _undo(env, result).json()["undone"] == 1
    assert _status(env, a1) == ("submitted", False)
    assert _status(env, a2) == ("reopened", False)


def test_an_undo_keeps_its_action_its_lead_and_its_time(env, monkeypatch):
    from auth_harness import logged_in

    from ontotator.application import bulk_task_actions

    _limit(env, 2)
    other = assign(env, doc("c2", "en"), "anno2", "annotate")
    _set(env, other, status="reopened")
    a1 = assign(env, doc("c1", "en"), "anno", "annotate")
    result = _apply(env, WITHDRAW, rows=[{"case_id": "c1", "language": "en"}])
    assert _status(env, a1) == ("open", True)
    # A withdrawal's Undo cannot be turned into "mark submitted" of another
    # task: the action and the tasks are the record's.
    assert (
        env.lead.post(
            UNDO,
            json={"undo_id": result["undo"]["id"], "action": "reopen"},
        ).status_code
        == 422
    )
    assert _status(env, other) == ("reopened", False)
    # Another lead, an unknown id and another kind of audit event: refused.
    second = logged_in(env.app, "lead2", projects={"proj": ["lead"]}, assignments=[])
    assert _undo(env, result, second).json()["details"] == {"reason": "not_found"}
    with env.db.transaction() as conn:
        revoke_event = conn.execute(
            select(AuditEventRow.id).where(AuditEventRow.action == "assignment.revoke")
        ).scalar_one()
    for undo_id in (revoke_event, 10**9):
        refused = env.lead.post(UNDO, json={"undo_id": undo_id})
        assert refused.status_code == 409
        assert refused.json()["code"] == "BULK_UNDO_STALE"
    # Expired.
    monkeypatch.setattr(bulk_task_actions, "UNDO_MINUTES", -1)
    late = _apply(
        env,
        WITHDRAW,
        rows=[{"case_id": "c2", "language": "en"}],
        **{"include_started": True},
    )
    assert _undo(env, late).json()["details"] == {"reason": "expired"}
    monkeypatch.undo()
    assert _undo(env, result).json()["undone"] == 1
    assert _status(env, a1) == ("open", False)
    assert _status(env, other) == ("reopened", True)


def test_a_reopened_translation_review_has_no_undo(env):
    """Reopening restarts the review draft from the current text; the earlier
    draft is gone, so the action offers no Undo."""
    review = _review(env, "c1", "submitted")
    result = _apply(
        env,
        REOPEN,
        rows=[{"case_id": "c1", "language": "de"}],
        tasks=["translation_review"],
    )
    assert [item["assignment_id"] for item in result["changes"]] == [review]
    assert result["undo"] is None
    assert _status(env, review) == ("reopened", False)
    with env.db.transaction() as conn:
        record = conn.execute(
            select(AuditEventRow.id, AuditEventRow.details).where(
                AuditEventRow.action == "project.bulk_task_action"
            )
        ).one()
    assert record.details["undoable"] is False
    refused = env.lead.post(UNDO, json={"undo_id": record.id})
    assert refused.json()["details"] == {"reason": "not_undoable"}
    assert _status(env, review) == ("reopened", False)


def test_undo_is_refused_after_a_save_a_plan_change_or_other_work(env):
    _limit(env, 2)
    rows = [{"case_id": "c1", "language": "de"}]
    # A started translation review is withdrawn; its reviewer's draft moves on.
    review = _review(env, "c1", "in_progress")
    result = _apply(
        env, WITHDRAW, rows=rows, tasks=["translation_review"], include_started=True
    )
    with env.db.transaction() as conn:
        conn.execute(
            update(TranslationReviewDraftRow)
            .where(TranslationReviewDraftRow.assignment_id == review)
            .values(revision=TranslationReviewDraftRow.revision + 1)
        )
    refused = _undo(env, result)
    assert refused.status_code == 409
    assert refused.json()["details"] == {"reason": "changed"}
    assert _status(env, review) == ("in_progress", True)

    # A reopened annotation is saved again (the assignment's updated_at).
    a1 = assign(env, doc("c1", "en"), "anno", "annotate")
    submit(env, a1, "s1")
    reopened = _apply(env, REOPEN, rows=[{"case_id": "c1", "language": "en"}])
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == a1)
            .values(updated_at=AssignmentRow.updated_at + timedelta(seconds=5))
        )
    assert _undo(env, reopened).json()["details"] == {"reason": "changed"}
    assert _status(env, a1) == ("reopened", False)

    # A withdrawn task does not come back once its text left the plan.
    b1 = assign(env, doc("c2", "en"), "anno", "annotate")
    withdrawn = _apply(env, WITHDRAW, rows=[{"case_id": "c2", "language": "en"}])
    write(env, {RowKey("c2", "en"): PlanFlags(False, False)})
    blocked = env.lead.post(
        UNDO, json={"undo_id": withdrawn["undo"]["id"], "preview": True}
    ).json()["blocked"]
    assert blocked["reason"] == "changed"
    assert _undo(env, withdrawn).status_code == 409
    assert _status(env, b1) == ("open", True)


def test_summary_only_preview_and_a_flat_number_of_queries(env):
    _limit(env, 2)
    for case in ("c1", "c2"):
        for user in ("anno", "anno2"):
            submit(env, assign(env, doc(case, "en"), user, "annotate"), f"{case}{user}")
    summary = _post(env, REOPEN, preview=True, summary_only=True).json()
    assert (summary["change_count"], summary["kept_count"], summary["texts"]) == (
        4,
        0,
        2,
    )
    assert summary["changes"] == summary["kept"] == summary["skipped"] == []
    full = _post(env, REOPEN, preview=True).json()
    assert full["preview_token"] == summary["preview_token"]
    assert len(full["changes"]) == full["change_count"] == 4

    def statements(rows: list[dict[str, str]]) -> int:
        seen: list[str] = []

        def count(conn, cursor, statement, *args):
            seen.append(statement)

        event.listen(env.db.engine, "before_cursor_execute", count)
        try:
            found = env.lead.post(REOPEN, json={"rows": rows, "preview": True}).json()
        finally:
            event.remove(env.db.engine, "before_cursor_execute", count)
        assert found["change_count"] == 2 * len(rows)
        return len(seen)

    # Two tasks or four: the same number of statements.
    assert statements(ROWS[:1]) == statements(ROWS)
