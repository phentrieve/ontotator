"""Lead tools for re-planning and corrections (issue 346): dry runs, then writes.

Each tool that removes or replaces work sends no write without confirm, and
with confirm sends exactly the revision and the work its dry run read.
"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import ToolFailed, call
from fake_api import PT_A, PT_B, FakeApi, refusal
from mcp import Client
from shapes import build, page, panel, row, submission

pytestmark = pytest.mark.anyio

P = "/api/v1/projects/{key}"
TASK = "/api/v1/assignments/{assignment_id}"
PANEL = f"{P}/document-rows/{{case_id}}/{{language}}/final-panel"
REPORT = "/api/v1/problem-reports/{report_id}"
WRITES = ("POST", "PUT", "PATCH")


def _task(assignment_id: int = 3, **fields: Any) -> dict[str, Any]:
    return build(
        "AssignmentView",
        id=assignment_id,
        username="ann",
        task="annotate",
        status="in_progress",
        revoked_at=None,
        workflow_revision=7,
        **fields,
    )


def _writes(fake: FakeApi) -> list[tuple[str, str]]:
    return [(c.method, c.template) for c in fake.calls if c.method in WRITES]


async def test_a_new_round_is_a_dry_run_until_confirmed(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/assignments", [_task()])
    current = build("WorkRoundView", round_id="r1", kind="ordinary", active=True)
    fake.on("GET", f"{TASK}/rounds", [current])
    sources = [
        build("RoundSourceView", submission_id="s1"),
        build("RoundSourceView", submission_id="s2"),
    ]
    fake.on("GET", f"{TASK}/round-sources", sources)
    args: dict[str, Any] = {"project": "p", "assignment_id": 3, "kind": "carry_forward"}
    with pytest.raises(ToolFailed, match="name source_submission_id"):
        await call(mcp_client, "start_new_round", args)
    args["source_submission_id"] = "s2"
    dry = await call(mcp_client, "start_new_round", args)
    assert dry["applied"] is False
    assert dry["plan"]["current_round"]["round_id"] == "r1"
    assert _writes(fake) == []

    await call(mcp_client, "start_new_round", args | {"confirm": True})
    [created] = fake.calls_to("POST", f"{TASK}/rounds")
    body = created.json()
    assert body["expected_workflow_revision"] == 7
    assert body["kind"] == "carry_forward"
    assert body["source_submission_ids"] == ["s2"]

    restart = {"project": "p", "assignment_id": 3, "kind": "clean_restart"}
    with pytest.raises(ToolFailed, match="needs a reason"):
        await call(mcp_client, "start_new_round", restart | {"confirm": True})


@pytest.mark.parametrize("kind", ["carry_forward", "clean_restart"])
async def test_a_new_round_dry_run_reports_an_open_consolidation(
    fake: FakeApi, mcp_client: Client, kind: str
) -> None:
    """Issue 471: the dry run no longer promises a round the confirm
    refuses. The server marks the submissions (``refused_by``); with it the
    dry run says ``blocked`` and confirm sends nothing."""
    fake.on("GET", f"{P}/assignments", [_task() | {"status": "submitted"}])
    current = build("WorkRoundView", round_id="r1", kind="ordinary", active=True)
    fake.on("GET", f"{TASK}/rounds", [current])
    source = build(
        "RoundSourceView", submission_id="s1", refused_by="CONSOLIDATION_OPEN"
    )
    fake.on("GET", f"{TASK}/round-sources", [source])
    args: dict[str, Any] = {
        "project": "p",
        "assignment_id": 3,
        "kind": kind,
        "reason": "Guideline changed",
    }
    for confirm in (False, True):
        answer = await call(mcp_client, "start_new_round", args | {"confirm": confirm})
        assert answer["applied"] is False
        assert answer["blocked"]["code"] == "CONSOLIDATION_OPEN"
        assert "withdraw_task" in answer["blocked"]["message"]
        assert answer["plan"]["consequence"].startswith("Nothing")
    assert _writes(fake) == []


async def test_a_clean_restart_of_unsubmitted_work_does_not_ask_for_sources(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/assignments", [_task()])
    fake.on("GET", f"{TASK}/rounds", [])
    args = {
        "project": "p",
        "assignment_id": 3,
        "kind": "clean_restart",
        "reason": "Wrong tool set",
    }
    dry = await call(mcp_client, "start_new_round", args)
    assert dry["applied"] is False and "blocked" not in dry
    assert not fake.calls_to("GET", f"{TASK}/round-sources")


async def test_a_new_round_names_an_open_consolidation(
    fake: FakeApi, mcp_client: Client
) -> None:
    """The server refuses a round for a submitted annotation while a
    consolidation of the text is open; the tool passes code and hint on."""
    fake.on("GET", f"{P}/assignments", [_task()])
    current = build("WorkRoundView", round_id="r1", kind="ordinary", active=True)
    fake.on("GET", f"{TASK}/rounds", [current])
    fake.on(
        "GET",
        f"{TASK}/round-sources",
        [build("RoundSourceView", submission_id="s1")],
    )
    message = "A consolidation is open on this text: finish or withdraw it first."
    fake.on("POST", f"{TASK}/rounds", refusal(409, "CONSOLIDATION_OPEN", message))
    args: dict[str, Any] = {
        "project": "p",
        "assignment_id": 3,
        "kind": "carry_forward",
        "confirm": True,
    }
    with pytest.raises(ToolFailed) as failed:
        await call(mcp_client, "start_new_round", args)
    assert "CONSOLIDATION_OPEN" in str(failed.value)
    assert message in str(failed.value)
    assert "withdraw_task" in str(failed.value)


async def test_a_mode_change_discards_exactly_what_its_preview_named(
    fake: FakeApi, mcp_client: Client
) -> None:
    author = build("PersonRefView", pseudonym="ann-0001")
    preview = build(
        "ModeChangePreview",
        case_id="c",
        language="en",
        from_mode="proposals",
        to_mode="scratch",
        revision=5,
        submissions=[
            build("DiscardedSubmissionView", submission_id="s1", author=author)
        ],
        assignments=[],
    )
    fake.on("POST", f"{P}/annotation-mode-changes/preview", preview)
    args = {
        "project": "p",
        "case_id": "c",
        "language": "en",
        "mode": "scratch",
        "reason": "Proposals were wrong",
    }
    dry = await call(mcp_client, "change_annotation_mode", args)
    assert dry["applied"] is False
    assert not fake.calls_to("POST", f"{P}/annotation-mode-changes")
    await call(mcp_client, "change_annotation_mode", args | {"confirm": True})
    [change] = fake.calls_to("POST", f"{P}/annotation-mode-changes")
    assert change.json()["expected_revision"] == 5
    assert change.json()["expected_submission_ids"] == ["s1"]


async def test_a_restore_uses_the_texts_plan_revision(
    fake: FakeApi, mcp_client: Client
) -> None:
    changes = [
        build("ModeChangeView", change_id=1, restorable=False, restore_blocked="X"),
        build("ModeChangeView", change_id=2, restorable=True),
    ]
    fake.on(
        "GET",
        f"{P}/annotation-mode-changes",
        build("ModeChangeList", case_id="c", language="en", changes=changes),
    )
    fake.on(
        "POST", f"{P}/work-plans/bulk/preview", build("BulkPreview", revisions={"c": 9})
    )
    args = {"project": "p", "case_id": "c", "language": "en", "change_id": 1}
    dry = await call(mcp_client, "restore_annotation_mode", args)
    assert dry["applied"] is False and dry["change"]["restore_blocked"] == "X"
    with pytest.raises(ToolFailed, match="cannot be restored"):
        await call(mcp_client, "restore_annotation_mode", args | {"confirm": True})
    assert _writes(fake) == []
    args["change_id"] = 2
    await call(mcp_client, "restore_annotation_mode", args | {"confirm": True})
    restore = f"{P}/annotation-mode-changes/{{change_id}}/restore"
    [restored] = fake.calls_to("POST", restore)
    assert restored.json() == {"expected_revision": 9}


def _final(submission_id: str, revision: int) -> dict[str, Any]:
    return build(
        "FinalSelectionSummary",
        case_id="c",
        language="en",
        document_id="c-en-v1",
        submission_id=submission_id,
        revision=revision,
    )


async def test_set_final_result_replaces_or_confirms_with_the_revision(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/document-rows", page([row("c", final=_final("s1", 3))]))
    cause = build("RowItemView", code="SELECTED_TEXT_CORRECTED", cause_id="k1")
    body = panel(
        [submission("s1", "c-en-v1"), submission("s2", "c-en-v1")], all_match=False
    )
    fake.on("GET", PANEL, body | {"causes": [cause]})
    args = {"project": "p", "case_id": "c", "language": "en", "submission_id": "s2"}
    dry = await call(mcp_client, "set_final_result", args)
    assert dry["applied"] is False
    assert dry["plan"]["replaces_final"] is True
    assert dry["plan"]["revision"] == 3
    assert dry["plan"]["acknowledges"] == []
    assert _writes(fake) == []
    # The final result changed since a dry run that showed revision 2.
    with pytest.raises(ToolFailed, match="changed since the dry run"):
        await call(
            mcp_client,
            "set_final_result",
            args | {"confirm": True, "expected_revision": 2},
        )
    assert _writes(fake) == []
    # The server answers a replaced final result with its Undo handle.
    handle = {"id": 31, "expires_at": "2026-11-17T15:00:00Z"}
    fake.on("PUT", f"{P}/final-selections", _final("s2", 4) | {"undo": handle})
    done = await call(mcp_client, "set_final_result", args | {"confirm": True})
    assert done["applied"] is True and done["undo"] == handle
    assert "undo" not in done["final"]
    [replaced] = fake.calls_to("PUT", f"{P}/final-selections")
    assert replaced.json() == {
        "document_id": "c-en-v1",
        "submission_id": "s2",
        "expected_revision": 3,
        "acknowledged_cause_ids": [],
    }
    fake.calls.clear()
    args["submission_id"] = "s1"
    # A confirmation replaces nothing: no undo in the answer.
    fake.on("PUT", f"{P}/final-selections", _final("s1", 5) | {"undo": None})
    again = await call(mcp_client, "set_final_result", args | {"confirm": True})
    assert again["applied"] is True and "undo" not in again
    [confirmed] = fake.calls_to("PUT", f"{P}/final-selections")
    assert confirmed.json()["acknowledged_cause_ids"] == ["k1"]
    with pytest.raises(ToolFailed, match="is not a submission"):
        await call(mcp_client, "set_final_result", args | {"submission_id": "zz"})


async def test_withdraw_final_result_sends_the_finals_revision(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/document-rows", page([row("c", final=_final("s1", 4))]))
    args = {"project": "p", "case_id": "c", "language": "en", "reason": "Redo"}
    dry = await call(mcp_client, "withdraw_final_result", args)
    assert dry["applied"] is False
    assert dry["plan"]["current_final"]["submission_id"] == "s1"
    assert dry["plan"]["revision"] == 4
    assert _writes(fake) == []
    with pytest.raises(ToolFailed, match="expected_revision"):
        await call(mcp_client, "withdraw_final_result", args | {"confirm": True})
    assert _writes(fake) == []
    args["expected_revision"] = 4
    await call(mcp_client, "withdraw_final_result", args | {"confirm": True})
    [withdrawn] = fake.calls_to("POST", f"{P}/final-selections/withdraw")
    assert withdrawn.json() == {
        "case_id": "c",
        "language": "en",
        "expected_revision": 4,
        "reason": "Redo",
    }
    # Another lead changed the final result after the dry run: the revision
    # of the dry run is sent, and the server's refusal is passed on.
    fake.calls.clear()
    fake.on("GET", f"{P}/document-rows", page([row("c", final=_final("s2", 5))]))
    fake.on(
        "POST",
        f"{P}/final-selections/withdraw",
        refusal(409, "REVISION_CONFLICT", {"current_revision": 5}),
    )
    with pytest.raises(ToolFailed, match="REVISION_CONFLICT"):
        await call(mcp_client, "withdraw_final_result", args | {"confirm": True})
    [stale] = fake.calls_to("POST", f"{P}/final-selections/withdraw")
    assert stale.json()["expected_revision"] == 4
    fake.on("GET", f"{P}/document-rows", page([row("c")]))
    with pytest.raises(ToolFailed, match="has no final result"):
        await call(mcp_client, "withdraw_final_result", args | {"confirm": True})


async def test_undo_and_discard_return_the_work_they_would_withdraw(
    fake: FakeApi, mcp_client: Client
) -> None:
    consequences = {"withdrawn": [{"assignment_id": 8}]}
    fake.on(
        "PUT",
        f"{P}/work-plans/rows",
        refusal(409, "WORK_PLAN_CONFIRMATION_REQUIRED", consequences),
    )
    undo = {
        "rows": [{"case_id": "c", "language": "en", "review": False, "annotate": True}],
        "revisions": {"c": 4},
    }
    args: dict[str, Any] = {"project": "p", "undo": undo}
    dry = await call(mcp_client, "undo_work_plan", args)
    assert dry["applied"] is False and dry["plan"]["row_count"] == 1
    assert _writes(fake) == []
    refused = await call(mcp_client, "undo_work_plan", args | {"confirm": True})
    assert refused["applied"] is False
    assert refused["consequences"] == consequences
    [sent] = fake.calls_to("PUT", f"{P}/work-plans/rows")
    assert sent.json() == {
        "rows": undo["rows"],
        "expected_revisions": {"c": 4},
        "undo": True,
        "confirm": False,
    }
    with pytest.raises(ToolFailed, match="'undo' object"):
        await call(mcp_client, "undo_work_plan", {"project": "p", "undo": {}})

    discard = f"{P}/variants/{{document_id}}/discard"
    args = {"project": "p", "document_id": "d", "reason": "Wrong source"}
    dry = await call(mcp_client, "discard_translation", args)
    assert dry["applied"] is False
    assert not fake.calls_to("POST", discard)
    await call(
        mcp_client,
        "discard_translation",
        args | {"confirm": True, "withdraw_tasks": True},
    )
    [discarded] = fake.calls_to("POST", discard)
    assert discarded.json() == {"reason": "Wrong source", "confirm": True}


async def test_text_changes_send_the_tasks_revision(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/assignments", [_task()])
    preview = build("TextChangePreview", findings=4, placed=3, unplaced=1)
    fake.on("POST", f"{P}/text-changes/preview", preview)
    args = {"project": "p", "assignment_id": 3, "target_document_id": "d2"}
    dry = await call(mcp_client, "move_task_to_version", args)
    assert dry["plan"]["preview"]["placed"] == 3
    assert _writes(fake) == [("POST", f"{P}/text-changes/preview")]
    await call(mcp_client, "move_task_to_version", args | {"confirm": True})
    [moved] = fake.calls_to("POST", f"{TASK}/move-to-version")
    assert moved.json()["expected_workflow_revision"] == 7
    assert moved.json()["target_document_id"] == "d2"

    resolution = args | {"resolution": "finish_then_carry", "confirm": True}
    await call(mcp_client, "handle_text_change", resolution)
    [decided] = fake.calls_to("POST", f"{TASK}/text-change-resolution")
    assert decided.json() == {
        "resolution": "finish_then_carry",
        "target_document_id": "d2",
        "expected_workflow_revision": 7,
    }
    with pytest.raises(ToolFailed, match="no current task 4"):
        await call(mcp_client, "move_task_to_version", args | {"assignment_id": 4})

    carry = f"{P}/submissions/{{submission_id}}/carry"
    args = {"project": "p", "submission_id": "s1", "target_document_id": "d2"}
    await call(mcp_client, "carry_submission", args)
    assert not fake.calls_to("POST", carry)
    await call(
        mcp_client,
        "carry_submission",
        args | {"mode": "other", "username": "bob", "confirm": True},
    )
    [carried] = fake.calls_to("POST", carry)
    assert carried.json()["mode"] == "other"
    assert carried.json()["username"] == "bob"


async def test_carry_dry_run_reports_an_earlier_decision(
    fake: FakeApi, mcp_client: Client
) -> None:
    """Issue 461: already_resolved instead of a preview; confirm is refused."""
    details = {
        "reason": "already_resolved",
        "resolution": "carried",
        "assignment_id": 12,
        "decided_at": "2026-11-17T10:00:00+00:00",
    }
    fake.on(
        "POST",
        f"{P}/text-changes/preview",
        refusal(422, "TEXT_CHANGE_NOT_APPLICABLE", details),
    )
    args = {"project": "p", "submission_id": "s1", "target_document_id": "d2"}
    dry = await call(mcp_client, "carry_submission", args)
    assert dry == {
        "selection": "project 'p', target_document_id 'd2', submission_id 's1'",
        "applied": False,
        "already_resolved": {
            "resolution": "carried",
            "assignment_id": 12,
            "decided_at": "2026-11-17T10:00:00+00:00",
        },
    }
    with pytest.raises(ToolFailed, match="already_resolved"):
        await call(mcp_client, "carry_submission", args | {"confirm": True})
    assert not fake.calls_to("POST", f"{P}/submissions/{{submission_id}}/carry")


async def test_carry_dry_run_passes_other_refusals_on(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "POST",
        f"{P}/text-changes/preview",
        refusal(422, "TEXT_CHANGE_NOT_APPLICABLE", {"reason": "not_ancestor"}),
    )
    args = {"project": "p", "submission_id": "s1", "target_document_id": "d2"}
    with pytest.raises(ToolFailed, match="not_ancestor"):
        await call(mcp_client, "carry_submission", args)


async def test_a_problem_report_action_sends_the_reports_revision(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", REPORT, build("ProblemReportView", report_id="r1", revision=2))
    args: dict[str, Any] = {"report_id": "r1", "action": "restart", "reason": "Empty"}
    dry = await call(mcp_client, "act_on_problem_report", args)
    assert dry["applied"] is False and dry["plan"]["report"]["revision"] == 2
    assert _writes(fake) == []
    await call(mcp_client, "act_on_problem_report", args | {"confirm": True})
    [acted] = fake.calls_to("POST", f"{REPORT}/actions")
    assert acted.json()["expected_revision"] == 2
    assert acted.json()["action"] == "restart"
    with pytest.raises(ToolFailed, match="extend_hold needs"):
        await call(
            mcp_client,
            "act_on_problem_report",
            {"report_id": "r1", "action": "extend_hold", "reason": "x"},
        )


async def test_translation_tools_send_the_versions_text_hash(
    fake: FakeApi, mcp_client: Client
) -> None:
    variant = build("VariantSummary", document_id="d", text_sha256="a" * 64)
    fake.on("GET", f"{P}/documents/{{doc}}/variant", variant)
    await call(
        mcp_client,
        "request_translation_correction",
        {"project": "p", "document_id": "d", "username": "u", "reason": "Dose"},
    )
    [asked] = fake.calls_to(
        "POST", f"{P}/documents/{{doc}}/translation-correction-assignment"
    )
    assert asked.json()["expected_text_sha256"] == "a" * 64
    await call(
        mcp_client, "start_lead_correction", {"project": "p", "document_id": "d"}
    )
    [lead] = fake.calls_to("POST", f"{P}/documents/{{doc}}/lead-correction")
    assert lead.json() == {"expected_text_sha256": "a" * 64, "confirm_language": False}


async def test_accept_translation_version_confirms_with_the_dry_runs_text_hash(
    fake: FakeApi, mcp_client: Client
) -> None:
    accept = f"{P}/variants/{{document_id}}/accept"
    preview = build(
        "AcceptVersionPreview",
        document_id="d",
        acceptable=False,
        reason="review_open",
        text_sha256="b" * 64,
    )
    fake.on("GET", accept, preview)
    args = {"project": "p", "document_id": "d", "reason": "Checked"}
    dry = await call(mcp_client, "accept_translation_version", args)
    assert dry["applied"] is False
    assert dry["plan"]["acceptable"] is False
    assert dry["plan"]["reason"] == "review_open"
    assert dry["plan"]["text_sha256"] == "b" * 64
    assert not fake.calls_to("POST", accept)
    with pytest.raises(ToolFailed, match="expected_text_sha256"):
        await call(mcp_client, "accept_translation_version", args | {"confirm": True})
    assert not fake.calls_to("POST", accept)
    done = await call(
        mcp_client,
        "accept_translation_version",
        args | {"confirm": True, "expected_text_sha256": "b" * 64},
    )
    assert done["applied"] is True
    # The hash is the dry run's, not re-read at confirm.
    assert len(fake.calls_to("GET", accept)) == 1
    [sent] = fake.calls_to("POST", accept)
    assert sent.json() == {"reason": "Checked", "expected_text_sha256": "b" * 64}


async def test_editorial_correction_confirms_with_the_dry_runs_text_hash(
    fake: FakeApi, mcp_client: Client
) -> None:
    """Issue 453: replacements go to the server, which builds the text; the
    dry run returns the diff and the consequences, not the texts."""
    route = f"{P}/documents/{{doc}}/editorial-correction"
    change = build(
        "EditorialChange",
        old_start=7,
        old_end=8,
        new_start=7,
        new_end=7,
        old_text=" ",
        new_text="",
    )
    preview = build(
        "EditorialCorrectionPreview",
        document_id="d",
        version=2,
        next_version=3,
        translation_status="accepted",
        available=True,
        reason=None,
        text_sha256="b" * 64,
        text="Der Patient",
        previous_text="Der Pat ient",
        changed_characters=1,
        number_changes=[],
        diff=[change],
        tasks_following=2,
        findings={"submitted": 3, "needs_check": 1},
        proposals={"sets": 1, "carried": 4, "needs_check": 0},
    )
    fake.on("POST", f"{route}/preview", preview)
    replacements = [{"old": "Pat ient", "new": "Patient"}]
    args = {
        "project": "p",
        "document_id": "d",
        "replacements": replacements,
        "reason": "Space inside a word",
    }
    dry = await call(mcp_client, "editorial_correction", args)
    assert dry["applied"] is False
    plan = dry["plan"]
    assert (plan["available"], plan["next_version"]) == (True, 3)
    assert plan["translation_status"] == "accepted"
    assert plan["text_sha256"] == "b" * 64
    # The diff and the consequences, not the texts.
    assert plan["diff"] == [change]
    assert plan["tasks_following"] == 2
    assert plan["findings"] == {"submitted": 3, "needs_check": 1}
    assert plan["proposals"] == {"sets": 1, "carried": 4, "needs_check": 0}
    assert "text" not in plan and "previous_text" not in plan
    assert (plan["text_characters"], plan["previous_text_characters"]) == (11, 12)
    [checked] = fake.calls_to("POST", f"{route}/preview")
    assert checked.json() == {"replacements": replacements}
    assert not fake.calls_to("POST", route)
    # A stale dry run cannot be confirmed: the hash is required.
    with pytest.raises(ToolFailed, match="expected_text_sha256"):
        await call(mcp_client, "editorial_correction", args | {"confirm": True})
    assert not fake.calls_to("POST", route)
    done = await call(
        mcp_client,
        "editorial_correction",
        args | {"confirm": True, "expected_text_sha256": "b" * 64},
    )
    assert done["applied"] is True
    # The hash is the dry run's, not re-read at confirm.
    assert len(fake.calls_to("POST", f"{route}/preview")) == 1
    [sent] = fake.calls_to("POST", route)
    assert sent.json() == {
        "replacements": replacements,
        "reason": "Space inside a word",
        "expected_text_sha256": "b" * 64,
    }


async def test_editorial_correction_dry_run_says_per_person_what_moves(
    fake: FakeApi, mcp_client: Client
) -> None:
    """Issue 465: the dry run names per person whether the submitted
    annotation moves to the new version by itself, and why not."""
    route = f"{P}/documents/{{doc}}/editorial-correction"
    carry = [
        build(
            "EditorialCarryPerson",
            username="tom",
            display_name="Tom Reis",
            status="submitted",
            carried=True,
            reason=None,
            findings=2,
            needs_check=0,
        ),
        build(
            "EditorialCarryPerson",
            username="ana",
            display_name="Ana Weber",
            status="submitted",
            carried=False,
            reason="findings_need_check",
            findings=3,
            needs_check=1,
        ),
    ]
    fake.on(
        "POST",
        f"{route}/preview",
        build(
            "EditorialCorrectionPreview",
            available=True,
            reason=None,
            annotation_carry=carry,
        ),
    )
    dry = await call(
        mcp_client,
        "editorial_correction",
        {
            "project": "p",
            "document_id": "d",
            "replacements": [{"old": "Pat ient", "new": "Patient"}],
            "reason": "Spacing",
        },
    )
    assert dry["plan"]["annotation_carry"] == carry


async def test_editorial_correction_passes_a_refusal_on_and_shows_number_changes(
    fake: FakeApi, mcp_client: Client
) -> None:
    route = f"{P}/documents/{{doc}}/editorial-correction"
    fake.on(
        "POST",
        f"{route}/preview",
        build(
            "EditorialCorrectionPreview",
            available=True,
            reason=None,
            number_changes=[{"old": "15", "new": "50"}],
        ),
    )
    args = {
        "project": "p",
        "document_id": "d",
        "replacements": [{"old": "15 mg", "new": "50 mg"}],
        "reason": "Dose mistyped",
    }
    dry = await call(mcp_client, "editorial_correction", args)
    # A notice in the dry run; the correction stays available.
    assert dry["plan"]["number_changes"] == [{"old": "15", "new": "50"}]
    assert dry["plan"]["available"] is True
    fake.on(
        "POST",
        route,
        refusal(409, "EDITORIAL_CORRECTION_NOT_AVAILABLE", {"reason": "review_open"}),
    )
    with pytest.raises(ToolFailed, match="review_open"):
        await call(
            mcp_client,
            "editorial_correction",
            args | {"expected_text_sha256": "b" * 64, "confirm": True},
        )
    # Replacements need an 'old' passage and a reason.
    for wrong in (
        {"replacements": [{"old": "", "new": "x"}], "reason": "r"},
        {"replacements": [], "reason": "r"},
        {"replacements": [{"old": "a", "new": "b"}], "reason": ""},
    ):
        with pytest.raises(ToolFailed):
            await call(
                mcp_client,
                "editorial_correction",
                {"project": "p", "document_id": "d"} | wrong,
            )


async def test_upload_translation_version_confirms_with_the_dry_runs_text_hash(
    fake: FakeApi, mcp_client: Client
) -> None:
    """Issue 341 a: one route for the dialog and the tool, the same refusals."""
    versions = f"{P}/variants/{{document_id}}/versions"
    preview = build(
        "VersionUploadPreview",
        document_id="d",
        version=2,
        next_version=3,
        available=True,
        reason=None,
        text_sha256="b" * 64,
        text="Neu",
        previous_text="Alt!",
        unchanged=False,
    )
    fake.on("POST", f"{versions}/preview", preview)
    args = {
        "project": "p",
        "document_id": "d",
        "text": "Neu",
        "method": "machine_translation",
        "provider": "DeepL",
        "model": "deepl-2026-10",
        "made_on": "2026-11-12",
    }
    # A machine translation without its provider fails at the dry run (#471).
    without = {key: value for key, value in args.items() if key != "provider"}
    with pytest.raises(ToolFailed, match="names its provider"):
        await call(mcp_client, "upload_translation_version", without)
    assert not fake.calls_to("POST", f"{versions}/preview")
    dry = await call(mcp_client, "upload_translation_version", args)
    assert dry["applied"] is False
    assert dry["plan"]["available"] is True
    assert dry["plan"]["next_version"] == 3
    assert dry["plan"]["text_sha256"] == "b" * 64
    # The plan carries sizes, not the texts.
    assert "text" not in dry["plan"] and "previous_text" not in dry["plan"]
    assert dry["plan"]["text_characters"] == 3
    assert dry["plan"]["previous_text_characters"] == 4
    [checked] = fake.calls_to("POST", f"{versions}/preview")
    assert checked.json() == {"text": "Neu"}
    assert not fake.calls_to("POST", versions)
    with pytest.raises(ToolFailed, match="expected_previous_sha256"):
        await call(mcp_client, "upload_translation_version", args | {"confirm": True})
    assert not fake.calls_to("POST", versions)
    done = await call(
        mcp_client,
        "upload_translation_version",
        args | {"confirm": True, "expected_previous_sha256": "b" * 64},
    )
    assert done["applied"] is True
    # The hash is the dry run's, not re-read at confirm.
    assert len(fake.calls_to("POST", f"{versions}/preview")) == 1
    [sent] = fake.calls_to("POST", versions)
    assert sent.json() == {
        "text": "Neu",
        "expected_text_sha256": "b" * 64,
        "method": "machine_translation",
        "provider": "DeepL",
        "model": "deepl-2026-10",
        "made_on": "2026-11-12",
    }


async def test_assign_texts_asks_for_a_review_of_an_accepted_translation(
    fake: FakeApi, mcp_client: Client
) -> None:
    await call(
        mcp_client,
        "assign_texts",
        {
            "project": "p",
            "assignments": [{"document_id": "d", "username": "u"}],
            "task": "review_accepted_translation",
        },
    )
    [sent] = fake.calls_to("POST", f"{P}/assignments")
    assert sent.json()["task"] == "translation_review"
    assert sent.json()["review_accepted_translation"] is True


async def test_assign_texts_names_the_correction_for_a_review_accepted_version(
    fake: FakeApi, mcp_client: Client
) -> None:
    def refused(document_id: str, reason: str | None) -> dict[str, Any]:
        return {
            "document_id": document_id,
            "username": "u",
            "code": "NOT_A_TRANSLATION",
            "reason": reason,
        }

    fake.on(
        "POST",
        f"{P}/assignments",
        {
            "created": [],
            "refused": [refused("d", "accepted_by_review"), refused("n", None)],
        },
    )
    result = await call(
        mcp_client,
        "assign_texts",
        {
            "project": "p",
            "assignments": [
                {"document_id": "d", "username": "u"},
                {"document_id": "n", "username": "u"},
            ],
            "task": "review_accepted_translation",
        },
    )
    by_review, other = result["refused"]
    assert "request_translation_correction" in by_review["hint"]
    # Every refused row says what to do next, and the answer says so first.
    assert "translations only" in other["hint"]
    assert next(iter(result)) == "warning"
    assert result["warning"].startswith("2 of 2 rows were refused")
    tools = {tool.name: tool for tool in (await mcp_client.list_tools()).tools}
    schema = tools["assign_texts"].input_schema["properties"]["task"]
    assert "request_translation_correction" in schema["description"]
    correction = tools["request_translation_correction"].description or ""
    assert "accepted" in correction.splitlines()[0]
    assert "rejected or queried translation." not in correction.splitlines()[0]


async def test_a_text_gets_its_own_annotations_per_text(
    fake: FakeApi, mcp_client: Client
) -> None:
    """Issue 422: one idempotent PUT per text; None follows the project again.
    Issue 457: no built-in maximum (30 is sent); the server's own maximum
    comes back as its refusal."""
    template = f"{P}/texts/{{case_id}}/{{language}}/annotations-per-text"
    for value in (4, 30, None):
        await call(
            mcp_client,
            "set_annotations_per_text",
            {
                "project": "p",
                "case_id": "EN100022",
                "language": "de",
                "annotations_per_text": value,
                "reason": "method comparison",
            },
        )
    sent = fake.calls_to("PUT", template)
    assert [c.json() for c in sent] == [
        {"value": 4, "reason": "method comparison"},
        {"value": 30, "reason": "method comparison"},
        {"value": None, "reason": "method comparison"},
    ]
    assert str(sent[0].request.url).endswith(
        "/projects/p/texts/EN100022/de/annotations-per-text"
    )
    with pytest.raises(ToolFailed):
        await call(
            mcp_client,
            "set_annotations_per_text",
            {
                "project": "p",
                "case_id": "c",
                "language": "de",
                "annotations_per_text": 0,
            },
        )
    assert len(fake.calls_to("PUT", template)) == 3
    fake.on(
        "PUT",
        template,
        refusal(
            422,
            "ANNOTATIONS_PER_TEXT_ABOVE_MAXIMUM",
            {
                "maximum": 8,
                "value": 9,
                "setting": "ONTOTATOR_MAX_ANNOTATIONS_PER_TEXT",
            },
        ),
    )
    with pytest.raises(ToolFailed) as raised:
        await call(
            mcp_client,
            "set_annotations_per_text",
            {
                "project": "p",
                "case_id": "c",
                "language": "de",
                "annotations_per_text": 9,
            },
        )
    message = str(raised.value)
    assert "ANNOTATIONS_PER_TEXT_ABOVE_MAXIMUM" in message
    assert '"maximum":8' in message


async def test_tool_texts_state_the_selection_limit(mcp_client: Client) -> None:
    tools = {tool.name: tool for tool in (await mcp_client.list_tools()).tools}
    for name in ("update_work_plan", "distribute_texts"):
        assert "at most 2000" in (tools[name].description or ""), name


async def test_change_annotation_modes_dry_run_confirm_and_stale_token(
    fake: FakeApi, mcp_client: Client
) -> None:
    bulk = f"{P}/annotation-mode-changes/bulk"
    texts = [{"case_id": "c", "language": "en"}, {"case_id": "d", "language": "en"}]
    tom = {"pseudonym": "ann-1", "display_name": "Tom Reis", "is_me": False}
    roe = {"pseudonym": "ann-2", "display_name": None, "is_me": False}

    def preview(token: str, **fields: Any) -> dict[str, Any]:
        change = build(
            "ModeChangePreview",
            case_id="c",
            language="en",
            from_mode="proposals",
            to_mode="scratch",
            submissions=[
                build("DiscardedSubmissionView", submission_id="s1", author=tom)
            ],
            assignments=[
                build("RevokedAssignmentView", status="submitted", person=tom),
                build("RevokedAssignmentView", status="open", person=roe),
            ],
        )
        skipped = build(
            "BulkModeSkippedView",
            case_id="d",
            language="en",
            reason="final_result",
            message="Final result chosen: use Withdraw final… first.",
        )
        return (
            build(
                "BulkModeChangeView",
                mode="scratch",
                applied=False,
                texts=2,
                change_count=1,
                skipped_count=1,
                skipped_by_reason={"final_result": 1},
                submission_count=1,
                assignment_count=2,
                changes=[change],
                skipped=[skipped],
                preview_token=token,
            )
            | fields
        )

    fake.on("POST", bulk, preview(PT_A))
    args = {"project": "p", "texts": texts, "mode": "scratch", "reason": "Wrong model"}
    dry = await call(mcp_client, "change_annotation_modes", args)
    assert dry["applied"] is False and dry["preview_token"] == PT_A
    assert dry["would_change"] == [
        {
            "case_id": "c",
            "language": "en",
            "from_mode": "proposals",
            "discarded_submissions": 1,
            "authors": [
                {"username": None, "display_name": "Tom Reis", "pseudonym": "ann-1"}
            ],
            "withdrawn_tasks": 2,
            "withdrawn_unsubmitted_tasks": [
                {"username": None, "display_name": None, "pseudonym": "ann-2"}
            ],
        }
    ]
    # Issue 472: the counts say what they count, beside the lists of people.
    assert dry["withdrawn_task_count"] == 2
    assert dry["withdrawn_unsubmitted_task_count"] == 1
    assert dry["skipped_texts"][0]["message"].startswith("Final result chosen")
    [post] = fake.calls_to("POST", bulk)
    assert post.json() == {"rows": texts, "mode": "scratch", "preview": True}
    with pytest.raises(ToolFailed):
        await call(mcp_client, "change_annotation_modes", args | {"confirm": True})
    assert len(fake.calls_to("POST", bulk)) == 1
    confirmed = args | {"confirm": True, "preview_token": PT_A}
    fake.on("POST", bulk, preview(PT_A, applied=True))
    done = await call(mcp_client, "change_annotation_modes", confirmed)
    assert done["applied"] is True and done["change_count"] == 1
    assert fake.calls_to("POST", bulk)[-1].json() == {
        "rows": texts,
        "mode": "scratch",
        "preview_token": PT_A,
        "reason": "Wrong model",
    }
    fake.on("POST", bulk, refusal(409, "PREVIEW_STALE", {"preview": preview(PT_B)}))
    stale = await call(mcp_client, "change_annotation_modes", confirmed)
    assert stale["stale"] is True and stale["preview_token"] == PT_B
