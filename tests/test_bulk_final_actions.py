"""Bulk actions on final results from the Documents selection (issue 336,
step 2): Change final… with the rule "newest submission", and Accept agreeing
results… limited to the selected texts (issues 354, 339)."""

from __future__ import annotations

from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import update
from test_final_panel_api import SEIZURE, finding, span_of, submit_findings
from test_final_withdraw_and_accept_agreeing import (
    ACCEPT,
    _agreeing,
    _audits,
    _finals,
    _statements,
)
from work_plan_support import BASE, assign, doc, plan_env, select_final

from ontotator.storage.tables import ProjectRow

pytest_plugins = ("test_work_rounds",)

CHANGE = f"{BASE}/final-selections/bulk-change"


@pytest.fixture
def env(tmp_path):
    return plan_env(tmp_path)


def rows(*texts: tuple[str, str]) -> list[dict[str, str]]:
    return [{"case_id": case, "language": language} for case, language in texts]


def preview(env: Any, *texts: tuple[str, str], **more: Any) -> dict[str, Any]:
    response = env.lead.post(
        CHANGE, json={"rows": rows(*texts), "preview": True, **more}
    )
    assert response.status_code == 200, response.text
    return dict(response.json())


def _final(env: Any, case: str) -> None:
    """``case`` en: anno's submission is final."""
    target = doc(case, "en")
    submit_findings(env, assign(env, target, "anno", "annotate"), f"{case}-a", [])
    select_final(env, target, f"{case}-a")


def _newer(env: Any, case: str) -> None:
    """``case`` en: anno2 submits after the final was chosen."""
    target = doc(case, "en")
    seizure = span_of(env, target, "Neonatalzeit")
    submit_findings(
        env,
        assign(env, target, "anno2", "annotate"),
        f"{case}-b",
        [finding(f"{case}b1", SEIZURE, seizure)],
    )


def _final_then_newer(env: Any, case: str) -> None:
    _final(env, case)
    _newer(env, case)


def _skips(body: dict[str, Any]) -> list[tuple[str, str, str]]:
    return [(s["case_id"], s["language"], s["reason"]) for s in body["skipped"]]


# --- Change final…: newest submission --------------------------------------- #


def test_preview_of_a_mixed_selection_names_changes_and_skips(env):
    _final_then_newer(env, "c1")
    # c2: the final already is the only (newest) submission.
    submit_findings(env, assign(env, doc("c2", "en"), "anno", "annotate"), "c2-a", [])
    select_final(env, doc("c2", "en"), "c2-a")
    body = preview(env, ("c2", "en"), ("c1", "en"), ("c1", "de"), ("nope", "en"))
    assert body["applied"] is False and body["rule"] == "newest_submission"
    # Texts the project does not have are left out.
    assert (body["texts"], body["change_count"], body["skipped_count"]) == (3, 1, 2)
    [change] = body["changes"]
    assert change == {
        "case_id": "c1",
        "language": "en",
        "expected_revision": 1,
        "from_document_id": doc("c1", "en"),
        "from_submission_id": "c1-a",
        "from_version": 1,
        "document_id": doc("c1", "en"),
        "submission_id": "c1-b",
        "version": 1,
        "kind": "annotation",
        "person": change["person"],
        "eligible_submissions": 2,
    }
    assert change["person"]["display_name"] == "Arne Notator"
    assert _skips(body) == [("c2", "en", "already_newest"), ("c1", "de", "no_final")]
    assert all(skip["message"] for skip in body["skipped"])
    # A preview changes nothing; the same state gives the same token.
    assert _finals(env)[("c1", "en")] == ("c1-a", 1)
    again = preview(env, ("c2", "en"), ("c1", "en"), ("c1", "de"), ("nope", "en"))
    assert again["preview_token"] == body["preview_token"]
    # Counts only, the same token.
    short = preview(
        env,
        ("c2", "en"),
        ("c1", "en"),
        ("c1", "de"),
        ("nope", "en"),
        summary_only=True,
    )
    assert (short["changes"], short["skipped"]) == ([], [])
    assert (short["change_count"], short["skipped_count"]) == (1, 2)
    assert short["skipped_by_reason"] == {"already_newest": 1, "no_final": 1}
    assert short["preview_token"] == body["preview_token"]


def test_apply_changes_every_text_and_audits_each_like_a_single_change(env):
    _final_then_newer(env, "c1")
    _final_then_newer(env, "c2")
    selection = rows(("c1", "en"), ("c2", "en"))
    token = preview(env, ("c1", "en"), ("c2", "en"))["preview_token"]
    applied = env.lead.post(CHANGE, json={"rows": selection, "preview_token": token})
    assert applied.status_code == 200, applied.text
    assert applied.json()["applied"] is True
    assert [c["case_id"] for c in applied.json()["changes"]] == ["c1", "c2"]
    assert _finals(env) == {("c1", "en"): ("c1-b", 2), ("c2", "en"): ("c2-b", 2)}
    audits = _audits(env, "project.final_selection")
    assert [(a["case_id"], a["submission_id"], a.get("via")) for a in audits] == [
        ("c1", "c1-a", None),
        ("c2", "c2-a", None),
        ("c1", "c1-b", "bulk_change_final"),
        ("c2", "c2-b", "bulk_change_final"),
    ]
    # Nothing left to change.
    after = preview(env, ("c1", "en"), ("c2", "en"))
    assert after["change_count"] == 0
    assert {reason for _, _, reason in _skips(after)} == {"already_newest"}
    # Documents shows the new final like a single change.
    page = env.lead.get(f"{BASE}/document-rows", params={"q": "c1"}).json()
    [row] = [
        row
        for group in page["groups"]
        for row in group["rows"]
        if (row["case_id"], row["language"]) == ("c1", "en")
    ]
    assert row["final"]["submission_id"] == "c1-b"


def test_stale_token_changes_nothing_and_returns_the_fresh_preview(env):
    _final_then_newer(env, "c1")
    _final_then_newer(env, "c2")
    selection = rows(("c1", "en"), ("c2", "en"))
    token = preview(env, ("c1", "en"), ("c2", "en"))["preview_token"]
    # Meanwhile another change of c1's final (revision 2, same submission
    # the bulk action would choose).
    changed = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": doc("c1", "en"),
            "submission_id": "c1-b",
            "expected_revision": 1,
        },
    )
    assert changed.status_code == 200, changed.text
    stale = env.lead.post(CHANGE, json={"rows": selection, "preview_token": token})
    assert stale.status_code == 409
    assert stale.json()["code"] == "PREVIEW_STALE"
    fresh = stale.json()["details"]["preview"]
    assert [c["case_id"] for c in fresh["changes"]] == ["c2"]
    assert _skips(fresh) == [("c1", "en", "already_newest")]
    # All or nothing: c2 kept its final.
    assert _finals(env)[("c2", "en")] == ("c2-a", 1)
    # The token names the selection: another selection is stale too.
    other = env.lead.post(
        CHANGE, json={"rows": rows(("c2", "en")), "preview_token": token}
    )
    assert other.status_code == 409
    done = env.lead.post(
        CHANGE, json={"rows": selection, "preview_token": fresh["preview_token"]}
    )
    assert done.json()["applied"] is True
    assert _finals(env)[("c2", "en")] == ("c2-b", 2)


def test_a_final_replaced_by_the_same_revision_number_is_stale(env):
    """The token covers the submission of the final it replaces, not only its
    revision: withdrawn and chosen again gives another revision; a token of
    an older state never applies."""
    _final_then_newer(env, "c1")
    token = preview(env, ("c1", "en"))["preview_token"]
    withdrawn = env.lead.post(
        f"{BASE}/final-selections/withdraw",
        json={
            "case_id": "c1",
            "language": "en",
            "expected_revision": 1,
            "reason": "Again",
        },
    )
    assert withdrawn.status_code == 200, withdrawn.text
    stale = env.lead.post(
        CHANGE, json={"rows": rows(("c1", "en")), "preview_token": token}
    )
    assert stale.json()["code"] == "PREVIEW_STALE"
    assert _skips(stale.json()["details"]["preview"]) == [("c1", "en", "no_final")]
    assert _finals(env) == {}


def test_open_work_and_missing_submissions_are_skipped(env):
    _final_then_newer(env, "c1")
    # A third annotation of c1 is still open.
    assign(env, doc("c1", "en"), "ana", "annotate")
    body = preview(env, ("c1", "en"))
    assert body["changes"] == []
    assert _skips(body) == [("c1", "en", "open_task")]


def test_a_submission_older_than_the_choice_does_not_replace_it(env):
    """Both annotations were there when the lead chose the older one: the
    newest submission is not newer than that choice."""
    _agreeing(env, "c1", "c1")
    select_final(env, doc("c1", "en"), "c1-a")
    body = preview(env, ("c1", "en"))
    assert body["changes"] == []
    assert _skips(body) == [("c1", "en", "not_newer")]
    # A submission after the choice does replace it.
    submit_findings(env, assign(env, doc("c1", "en"), "ana", "annotate"), "c1-c", [])
    [change] = preview(env, ("c1", "en"))["changes"]
    assert (change["submission_id"], change["eligible_submissions"]) == ("c1-c", 3)


def test_own_result_is_skipped_where_the_project_forbids_it(env):
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(adjudicator_not_annotator=True)
        )
    target = doc("c1", "en")
    submit_findings(env, assign(env, target, "anno", "annotate"), "c1-a", [])
    select_final(env, target, "c1-a")
    submit_findings(env, assign(env, target, "leader", "annotate"), "c1-lead", [])
    body = preview(env, ("c1", "en"))
    assert body["changes"] == []
    assert _skips(body) == [("c1", "en", "own_result")]


def test_request_needs_rows_a_token_or_preview_and_a_lead(env):
    _final_then_newer(env, "c1")
    selection = rows(("c1", "en"))
    assert env.lead.post(CHANGE, json={"rows": selection}).status_code == 422
    assert env.lead.post(CHANGE, json={"rows": [], "preview": True}).status_code == 422
    unknown_rule = env.lead.post(
        CHANGE, json={"rows": selection, "preview": True, "rule": "oldest"}
    )
    assert unknown_rule.status_code == 422
    annotator = logged_in(
        env.app, "anno", projects={"proj": ["annotator"]}, assignments=[]
    )
    assert (
        annotator.post(CHANGE, json={"rows": selection, "preview": True}).status_code
        == 403
    )
    token = preview(env, ("c1", "en"))["preview_token"]
    refused = annotator.post(CHANGE, json={"rows": selection, "preview_token": token})
    assert refused.status_code == 403
    assert _finals(env)[("c1", "en")] == ("c1-a", 1)
    # Without a role in the project: no such project.
    outsider = logged_in(env.app, "outsider", assignments=[])
    assert (
        outsider.post(CHANGE, json={"rows": selection, "preview": True}).status_code
        == 404
    )


def test_statements_do_not_grow_with_every_changed_text(env):
    _final_then_newer(env, "c1")
    _final(env, "c2")
    one = _statements(
        env,
        lambda: env.lead.post(
            CHANGE, json={"rows": rows(("c1", "en"), ("c2", "en")), "preview": True}
        ),
    )
    _newer(env, "c2")
    two = _statements(
        env,
        lambda: env.lead.post(
            CHANGE, json={"rows": rows(("c1", "en"), ("c2", "en")), "preview": True}
        ),
    )
    assert two == one


# --- Accept agreeing results… for the selected texts ------------------------- #


def test_accept_agreeing_is_limited_to_the_selected_texts(env):
    _agreeing(env, "c1", "c1")
    _agreeing(env, "c2", "c2")
    select_final(env, doc("c2", "en"), "c2-b")
    selection = rows(("c1", "en"), ("c2", "en"), ("c1", "fr"))
    body = env.lead.post(ACCEPT, json={"preview": True, "rows": selection}).json()
    assert [(t["case_id"], t["language"]) for t in body["texts"]] == [("c1", "en")]
    assert body["already_final"] == 1
    assert body["already_final_rows"] == [{"case_id": "c2", "language": "en"}]
    assert [(s["language"], s["reason"]) for s in body["skipped"]] == [
        ("fr", "not_in_plan")
    ]
    # The whole project: every text, and no list of the final texts.
    whole = env.lead.post(ACCEPT, json={"preview": True}).json()
    assert len(whole["skipped"]) == 4 and whole["already_final_rows"] == []
    assert whole["preview_token"] != body["preview_token"]
    # The token belongs to the selection.
    refused = env.lead.post(ACCEPT, json={"preview_token": body["preview_token"]})
    assert refused.json()["code"] == "PREVIEW_STALE"
    applied = env.lead.post(
        ACCEPT, json={"preview_token": body["preview_token"], "rows": selection}
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["applied"] is True
    assert _finals(env) == {("c1", "en"): ("c1-a", 1), ("c2", "en"): ("c2-b", 1)}


def test_accept_agreeing_takes_rows_or_case_ids(env):
    both = env.lead.post(
        ACCEPT,
        json={"preview": True, "rows": rows(("c1", "en")), "case_ids": ["c1"]},
    )
    assert both.status_code == 422
    assert env.lead.post(ACCEPT, json={"preview": True, "rows": []}).status_code == 422


def test_the_newest_submission_may_be_a_consolidation(rounds):
    """A consolidation submitted after the final was chosen is the newest
    submission (service level: the consolidation fixture has no HTTP client)."""
    from test_final_panel_api import _row_of, _submit_consolidation
    from test_work_rounds import create_consolidation_fixture

    from ontotator.application.final_results import FinalResultService
    from ontotator.domain.work_plans import RowKey

    repo, ontology, reviewer, result, sources, access, actor = (
        create_consolidation_fixture(rounds)
    )
    inputs = [item.submission_id for item in sources]
    key = tuple(_row_of(repo, "doc-1"))
    finals = FinalResultService(repo.db, actor, access)
    finals.select("pkg-1", "doc-1", inputs[1], 0, [])
    consolidation = _submit_consolidation(ontology, reviewer, result).submission_id
    found = finals.change_finals(
        "pkg-1", [RowKey(*key)], preview=True, preview_token=None
    )
    [change] = found["changes"]
    assert (change["kind"], change["submission_id"]) == ("consolidation", consolidation)
    assert (change["from_submission_id"], change["eligible_submissions"]) == (
        inputs[1],
        3,
    )
    assert change["person"]["pseudonym"] == "reviewer"
    applied = finals.change_finals(
        "pkg-1", [RowKey(*key)], preview=False, preview_token=found["preview_token"]
    )
    assert applied["applied"] is True
    again = finals.change_finals(
        "pkg-1", [RowKey(*key)], preview=True, preview_token=None
    )
    assert [s["reason"] for s in again["skipped"]] == ["already_newest"]
