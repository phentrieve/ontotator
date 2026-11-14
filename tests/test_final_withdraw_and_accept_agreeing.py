"""Withdrawing a final result (#343) and accepting every agreeing text on the
server with a preview (#354)."""

from __future__ import annotations

from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import select
from test_final_panel_api import (
    HYPOTONIA,
    SEIZURE,
    finding,
    span_of,
    submit_findings,
)
from work_plan_support import BASE, assign, doc, plan_env, select_final

from ontotator.storage.final_tables import FinalSelectionRow
from ontotator.storage.tables import AuditEventRow

pytest_plugins = ("test_work_rounds",)

ACCEPT = f"{BASE}/final-selections/accept-agreeing"
WITHDRAW = f"{BASE}/final-selections/withdraw"


@pytest.fixture
def env(tmp_path):
    return plan_env(tmp_path)


def _finals(env: Any) -> dict[tuple[str, str], tuple[str, int]]:
    with env.db.transaction() as conn:
        return {
            (row.case_id, row.language): (row.submission_id, row.revision)
            for row in conn.execute(
                select(FinalSelectionRow).where(FinalSelectionRow.project_id == env.pid)
            )
        }


def _audits(env: Any, action: str) -> list[dict[str, Any]]:
    with env.db.transaction() as conn:
        return [
            dict(details)
            for details in conn.execute(
                select(AuditEventRow.details)
                .where(AuditEventRow.action == action)
                .order_by(AuditEventRow.id)
            ).scalars()
        ]


def _agreeing(env: Any, case: str, sid: str) -> None:
    target = doc(case, "en")
    seizure = span_of(env, target, "Neonatalzeit")
    for user, suffix in (("anno", "a"), ("anno2", "b")):
        submit_findings(
            env,
            assign(env, target, user, "annotate"),
            f"{sid}-{suffix}",
            [finding(f"{sid}{suffix}1", SEIZURE, seizure)],
        )


# --- Withdraw a final result (#343) ---------------------------------------- #


def withdraw(env: Any, revision: int, reason: str = "Re-annotation", who: Any = None):
    return (who or env.lead).post(
        WITHDRAW,
        json={
            "case_id": "c1",
            "language": "en",
            "expected_revision": revision,
            "reason": reason,
        },
    )


def test_withdraw_is_compare_and_set_audited_and_the_revision_continues(env):
    target = doc("c1", "en")
    submit_findings(env, assign(env, target, "anno", "annotate"), "s1", [])
    select_final(env, target, "s1")
    assert withdraw(env, 0).status_code == 422  # expected_revision >= 1
    stale = withdraw(env, 2)
    assert stale.status_code == 409
    assert stale.json()["details"]["current_revision"] == 1
    assert withdraw(env, 1, reason="   ").json()["code"] == "WITHDRAW_REASON_REQUIRED"

    done = withdraw(env, 1, reason="  Guideline 2.3  ")
    assert done.status_code == 200, done.text
    assert done.json() == {
        "case_id": "c1",
        "language": "en",
        "document_id": target,
        "submission_id": "s1",
        "revision": 2,
    }
    assert _finals(env) == {}
    [audit] = _audits(env, "project.final_withdrawn")
    assert (audit["submission_id"], audit["reason"], audit["revision"]) == (
        "s1",
        "Guideline 2.3",
        2,
    )
    # The text card's History names the withdrawal, the lead and the reason.
    history = env.lead.get(f"{BASE}/document-rows/c1/en/submissions").json()
    [change] = [c for c in history["changes"] if c["kind"] == "final_withdrawn"]
    assert change["reason"] == "Guideline 2.3"
    assert change["from_person"]["is_me"] is True
    # Nothing left to withdraw.
    assert withdraw(env, 2).status_code == 409
    preflight = env.lead.post(f"{BASE}/exports/final/preflight").json()
    assert preflight["selections"] == []
    assert {"case_id": "c1", "language": "en"} in preflight["omissions"]
    # The submission stays and can be chosen again; the revision continues
    # from the withdrawal, so a client holding revision 1 cannot overwrite it.
    again = select_final(env, target, "s1")
    assert again["revision"] == 3
    stale_put = env.lead.put(
        f"{BASE}/final-selections",
        json={"document_id": target, "submission_id": "s1", "expected_revision": 1},
    )
    assert stale_put.status_code == 409


def test_only_a_lead_withdraws(env):
    target = doc("c1", "en")
    submit_findings(env, assign(env, target, "anno", "annotate"), "s1", [])
    select_final(env, target, "s1")
    annotator = logged_in(
        env.app, "anno", projects={"proj": ["annotator"]}, assignments=[]
    )
    assert withdraw(env, 1, who=annotator).status_code == 403
    assert _finals(env) == {("c1", "en"): ("s1", 1)}


# --- Accept all agreeing texts (#354) -------------------------------------- #


def test_preview_lists_agreeing_texts_and_skips_with_reasons(env):
    _agreeing(env, "c1", "c1")
    # c2: the two annotators differ.
    target = doc("c2", "en")
    seizure = span_of(env, target, "Neonatalzeit")
    submit_findings(
        env,
        assign(env, target, "anno", "annotate"),
        "c2-a",
        [finding("x", SEIZURE, seizure)],
    )
    submit_findings(
        env,
        assign(env, target, "anno2", "annotate"),
        "c2-b",
        [finding("y", HYPOTONIA, None)],
    )
    response = env.lead.post(ACCEPT, json={"preview": True})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["applied"] is False
    assert body["texts"] == [
        {
            "case_id": "c1",
            "language": "en",
            "document_id": doc("c1", "en"),
            "submission_id": "c1-a",
            "findings": 1,
        }
    ]
    assert [(s["case_id"], s["reason"]) for s in body["skipped"]] == [("c2", "differ")]
    assert body["skipped"][0]["message"]
    assert body["already_final"] == 0
    assert body["preview_token"].startswith("sha256:")
    # A preview changes nothing; the same state gives the same token.
    assert _finals(env) == {}
    again = env.lead.post(ACCEPT, json={"preview": True}).json()
    assert again["preview_token"] == body["preview_token"]
    # Only some cases.
    only = env.lead.post(ACCEPT, json={"preview": True, "case_ids": ["c2"]}).json()
    assert only["texts"] == [] and len(only["skipped"]) == 1
    assert only["preview_token"] != body["preview_token"]


def test_open_work_and_single_submissions_are_skipped(env):
    target = doc("c1", "en")
    submit_findings(env, assign(env, target, "anno", "annotate"), "c1-a", [])
    assign(env, target, "anno2", "annotate")  # still open
    submit_findings(env, assign(env, doc("c2", "en"), "anno", "annotate"), "c2-a", [])
    body = env.lead.post(ACCEPT, json={"preview": True}).json()
    assert body["texts"] == []
    assert [(s["case_id"], s["reason"]) for s in body["skipped"]] == [
        ("c1", "open_task"),
        ("c2", "fewer_than_two"),
    ]


def test_apply_accepts_all_audits_each_and_counts_finals_afterwards(env):
    _agreeing(env, "c1", "c1")
    _agreeing(env, "c2", "c2")
    token = env.lead.post(ACCEPT, json={"preview": True}).json()["preview_token"]
    applied = env.lead.post(ACCEPT, json={"preview_token": token})
    assert applied.status_code == 200, applied.text
    assert applied.json()["applied"] is True
    assert [t["case_id"] for t in applied.json()["texts"]] == ["c1", "c2"]
    assert _finals(env) == {("c1", "en"): ("c1-a", 1), ("c2", "en"): ("c2-a", 1)}
    audits = _audits(env, "project.final_selection")
    assert [(a["case_id"], a["via"]) for a in audits] == [
        ("c1", "accept_agreeing"),
        ("c2", "accept_agreeing"),
    ]
    after = env.lead.post(ACCEPT, json={"preview": True}).json()
    assert (after["texts"], after["already_final"]) == ([], 2)


def test_stale_token_refuses_everything_with_a_fresh_preview(env):
    _agreeing(env, "c1", "c1")
    _agreeing(env, "c2", "c2")
    token = env.lead.post(ACCEPT, json={"preview": True}).json()["preview_token"]
    # A concurrent change: another lead chooses c1 meanwhile.
    select_final(env, doc("c1", "en"), "c1-b")
    stale = env.lead.post(ACCEPT, json={"preview_token": token})
    assert stale.status_code == 409
    assert stale.json()["code"] == "PREVIEW_STALE"
    fresh = stale.json()["details"]["preview"]
    assert [t["case_id"] for t in fresh["texts"]] == ["c2"]
    assert fresh["already_final"] == 1
    # All or nothing: c2 did not become final.
    assert _finals(env) == {("c1", "en"): ("c1-b", 1)}
    assert env.lead.post(ACCEPT, json={"preview_token": fresh["preview_token"]}).json()[
        "applied"
    ]
    assert _finals(env)[("c2", "en")] == ("c2-a", 1)


def test_request_needs_preview_or_token_and_a_lead(env):
    assert env.lead.post(ACCEPT, json={}).status_code == 422
    annotator = logged_in(
        env.app, "anno", projects={"proj": ["annotator"]}, assignments=[]
    )
    assert annotator.post(ACCEPT, json={"preview": True}).status_code == 403
