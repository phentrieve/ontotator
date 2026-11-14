"""Bulk Reopen and Withdraw open tasks on Documents (issue 336 step 1) and the
filter "More annotators than the limit" (issue 339 b)."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import select, update
from work_plan_support import BASE, assign, doc, plan_env, select_final, submit

from ontotator.storage.tables import AssignmentRow, AuditEventRow, ProjectRow

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
    assert result["undo"]["assignment_ids"] == [a1]

    undone = env.lead.post(UNDO, json=result["undo"])
    assert undone.status_code == 200, undone.text
    assert undone.json() == {"undone": 1}
    assert _status(env, a1) == ("submitted", False)
    assert [d["via"] for _, d in _audits(env, "assignment.reopen_undone")] == [
        "bulk_reopen_undo"
    ]
    # Once undone, the same Undo is stale.
    again = env.lead.post(UNDO, json=result["undo"])
    assert again.status_code == 409
    assert again.json()["code"] == "BULK_UNDO_STALE"


def test_undo_is_refused_once_the_texts_changed(env):
    _limit(env, 2)
    a1 = assign(env, doc("c1", "en"), "anno", "annotate")
    token = _post(env, WITHDRAW, preview=True).json()["preview_token"]
    result = _post(env, WITHDRAW, preview_token=token).json()
    assert _status(env, a1) == ("open", True)
    # Someone else is assigned in the meantime.
    assign(env, doc("c1", "en"), "anno2", "annotate")
    refused = env.lead.post(UNDO, json=result["undo"])
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
    assert env.lead.post(UNDO, json=applied.json()["undo"]).status_code == 200
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


def test_bulk_actions_are_for_leads_only(env):
    from auth_harness import logged_in

    annotator = logged_in(env.app, "anno")
    response = annotator.post(REOPEN, json={"rows": ROWS, "preview": True})
    assert response.status_code in {403, 404}
    assert env.lead.post(REOPEN, json={"rows": ROWS}).status_code == 422
