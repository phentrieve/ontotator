"""Refusals say what happened and what to do next (issues 471 and 486).

A bare code, a code repeated as its own details, or advice that can never
work ("run the dry run again" for a tool without one) costs an agent and
its user a round trip. Each refusal here is one an agent met.
"""

from __future__ import annotations

import re
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from fake_api import PT_A, FakeApi, marked, refusal
from mcp import Client
from shapes import build, panel, submission

from ontotator_mcp.errors import HINTS, api_error, hint_for
from ontotator_mcp.tooling import TOOL_MESSAGES, TOOL_SCOPES, tool_message

pytestmark = pytest.mark.anyio

P = "/api/v1/projects/{key}"
PANEL = f"{P}/document-rows/{{case_id}}/{{language}}/final-panel"
TEXTS = [{"case_id": "c1", "language": "en"}]


def _error(status: int, code: str, details: Any) -> str:
    request = httpx.Request("POST", "https://o.test/api/v1/projects/p/x")
    body = {"code": code, "details": details}
    return str(api_error(httpx.Response(status, json=body, request=request)))


def test_a_code_without_details_is_said_once() -> None:
    """The server repeats the code as the details of a refusal that has none."""
    text = _error(409, "VARIANT_REVIEW_STALE", "VARIANT_REVIEW_STALE")
    assert text.count("VARIANT_REVIEW_STALE") == 1
    assert "Run the dry run again and confirm with its text_sha256." in text


@pytest.mark.parametrize(
    ("code", "details", "next_step"),
    [
        ("ASSIGNEE_ROLE_MISSING", "ASSIGNEE_ROLE_MISSING", "set_member_roles"),
        ("BULK_UNDO_STALE", {"reason": "not_found"}, "undo.id"),
        ("BULK_UNDO_STALE", {"reason": "expired"}, "60 minutes"),
        ("BULK_UNDO_STALE", {"reason": "already_undone"}, "works once"),
        ("NOT_A_TRANSLATION", {"reason": "not_a_translation"}, "source text"),
        ("VERSION_UPLOAD_NOT_AVAILABLE", {"reason": "not_newest"}, "list_texts"),
        ("VERSION_UPLOAD_NOT_AVAILABLE", {"reason": "review_open"}, "withdraw_task"),
        ("VERSION_UPLOAD_NOT_AVAILABLE", {"reason": "unchanged"}, "nothing to upload"),
        ("GUIDELINE_NOTE_INVALID", {"field": "change_note"}, "at most 280"),
        (
            "ANNOTATIONS_PER_TEXT_REACHED",
            {"limit": 2, "assigned": 2},
            "set_annotations_per_text",
        ),
    ],
)
def test_each_bare_refusal_names_the_next_step(
    code: str, details: Any, next_step: str
) -> None:
    assert next_step in _error(409, code, details)


def test_a_missing_expected_version_does_not_read_as_a_conflict() -> None:
    """Issue 486: a client older than the server sends no expected version;
    the answer must not tell it to repeat."""
    missing = _error(
        409,
        "GUIDELINE_VERSION_CONFLICT",
        {"latest_version": 1, "reason": "expected_version_missing"},
    )
    assert "nobody published meanwhile" in missing
    assert "restart the MCP server" in missing
    assert "published or withdrawn meanwhile" not in missing
    conflict = _error(409, "GUIDELINE_VERSION_CONFLICT", {"latest_version": 2})
    assert "published or withdrawn meanwhile" in conflict


def test_a_reason_without_its_own_sentence_gets_the_codes() -> None:
    assert hint_for("BULK_UNDO_STALE/other") == HINTS["BULK_UNDO_STALE"]
    assert hint_for("UNKNOWN_CODE/reason") is None
    assert hint_for(None) is None


async def test_hints_and_reasons_name_tools_that_exist(mcp_client: Client) -> None:
    """A sentence that sends the reader to a tool must name a real one."""
    words = set()
    for text in [*HINTS.values(), *TOOL_MESSAGES.values()]:
        words |= set(re.findall(r"\b[a-z]+(?:_[a-z]+)+\b", text))
    arguments = {
        "include_started",
        "change_note",
        "expected_latest_version",
        "latest_version",
        "revoke_assignments",
        "confirm_started",
        "withdraw_tasks",
        "document_id",
        "assignment_id",
        "undo_id",
        "is_source",
        "text_sha256",
        "preview_token",
    }
    unknown = {
        word
        for word in words - arguments
        if word not in TOOL_SCOPES and not word.startswith("ontotator_")
    }
    assert unknown == set()


def test_no_skip_or_keep_reason_names_a_web_button() -> None:
    for text in TOOL_MESSAGES.values():
        assert "…" not in text and "tick" not in text and "text card" not in text


def _consolidation(fake: FakeApi) -> None:
    subs = [
        submission("s3", document_id="c1-en-v1"),
        submission("s4", document_id="c1-en-v1"),
    ]
    fake.on("GET", PANEL, panel(subs, all_match=False))


@pytest.mark.parametrize(
    ("code", "expected", "absent"),
    [
        (
            "WORKFLOW_REVISION_CONFLICT",
            "carla already has an open consolidation task on c1 en",
            "dry run",
        ),
        ("ASSIGNEE_ROLE_MISSING", "Add 'adjudicator' to the person's roles", None),
    ],
)
async def test_start_consolidation_says_why_and_what_next(
    fake: FakeApi, mcp_client: Client, code: str, expected: str, absent: str | None
) -> None:
    """Issue 471: no "run the dry run again" for a tool without one, and no
    code twice."""
    _consolidation(fake)
    fake.on("POST", f"{P}/consolidations", refusal(409, code, code))
    with pytest.raises(ToolFailed) as failed:
        await call(
            mcp_client,
            "start_consolidation",
            {"project": "p", "case_id": "c1", "language": "en", "reviewer": "carla"},
        )
    text = str(failed.value)
    assert expected in text
    assert text.count(code) == 1
    if absent:
        assert absent not in text
    tools = {tool.name: tool for tool in (await mcp_client.list_tools()).tools}
    description = tools["start_consolidation"].description or ""
    assert "A consolidator lacking the role gets it" not in description
    assert "set_member_roles" in description


async def test_assign_texts_flags_refused_rows(
    fake: FakeApi, mcp_client: Client
) -> None:
    """Issue 471: a refused row was a bare code with ``reason: null`` in an
    answer that looked like a success."""
    refused = {
        "document_id": "d",
        "username": "u",
        "code": "ANNOTATIONS_PER_TEXT_REACHED",
        "reason": None,
    }
    fake.on("POST", f"{P}/assignments", {"created": [], "refused": [refused]})
    result = await call(
        mcp_client,
        "assign_texts",
        {"project": "p", "assignments": [{"document_id": "d", "username": "u"}]},
    )
    assert result["warning"].startswith("1 of 1 rows were refused")
    assert "set_annotations_per_text" in result["refused"][0]["hint"]
    fake.on("POST", f"{P}/assignments", {"created": [], "refused": []})
    clean = await call(
        mcp_client,
        "assign_texts",
        {"project": "p", "assignments": [{"document_id": "d", "username": "u"}]},
    )
    assert "warning" not in clean


async def test_skip_and_keep_reasons_name_tools_and_arguments(
    fake: FakeApi, mcp_client: Client
) -> None:
    """Issue 471: the server's sentences name buttons of the web interface."""
    kept = build(
        "BulkKeptTaskView",
        case_id="c1",
        language="en",
        assignment_id=7,
        task="annotate",
        status="in_progress",
        person={"pseudonym": "A1", "display_name": "Tom Reis", "is_me": False},
        reason="started",
        message="Work has started; tick “Also withdraw started tasks” to include it.",
    )
    skipped = build(
        "BulkSkippedTextView",
        case_id="c2",
        language="en",
        reason="final_chosen",
        message="Final result chosen: use Change final… first.",
    )
    # A reason this server has no words for keeps the server's sentence.
    assert tool_message({"reason": "new_reason", "message": "Its own."}) == "Its own."
    preview = build(
        "BulkTaskActionView",
        action="withdraw",
        texts=3,
        changes=[],
        kept=[kept],
        skipped=[skipped],
        preview_token=PT_A,
    )
    fake.on("POST", f"{P}/bulk-task-actions/withdraw", preview)
    dry = await call(
        mcp_client, "withdraw_open_tasks", {"project": "p", "texts": TEXTS}
    )
    assert dry["kept"][0]["why"] == (
        "Work has started; pass include_started=true to include it."
    )
    [first] = dry["skipped_texts"]
    assert "withdraw_final_result" in first["message"]
    assert "Change final" not in first["message"]


async def test_the_reason_of_reopen_texts_is_part_of_the_preview_token(
    fake: FakeApi, mcp_client: Client
) -> None:
    """Issue 471: a confirm with another reason than the dry run's was applied."""
    route = f"{P}/bulk-task-actions/reopen"
    fake.on("POST", route, build("BulkTaskActionView", preview_token=PT_A))
    args = {"project": "p", "texts": TEXTS, "reason": "Guideline 2.3 changed"}
    dry = await call(mcp_client, "reopen_texts", args)
    token = dry["preview_token"]
    assert token == marked(PT_A, "Guideline 2.3 changed")
    assert len(token) <= 80
    with pytest.raises(ToolFailed, match="reason is not the one of the dry run"):
        await call(
            mcp_client,
            "reopen_texts",
            args
            | {"reason": "Something else", "confirm": True, "preview_token": token},
        )
    # The server's bare token carries no reason: refused the same way.
    with pytest.raises(ToolFailed, match="reason is not the one of the dry run"):
        await call(
            mcp_client,
            "reopen_texts",
            args | {"confirm": True, "preview_token": PT_A},
        )
    assert len(fake.calls_to("POST", route)) == 1
    await call(
        mcp_client, "reopen_texts", args | {"confirm": True, "preview_token": token}
    )
    assert fake.calls_to("POST", route)[-1].json()["preview_token"] == PT_A


@pytest.mark.parametrize(
    ("tool", "arguments"),
    [
        ("reopen_texts", {"texts": TEXTS, "reason": "Check"}),
        ("withdraw_open_tasks", {"texts": TEXTS}),
        ("start_rounds", {"texts": TEXTS, "kind": "carry_forward"}),
        ("pause_texts", {"texts": TEXTS, "reason": "Check"}),
        ("release_texts", {"texts": TEXTS}),
        ("change_final_results", {"texts": TEXTS}),
        ("accept_agreeing_texts", {}),
        (
            "change_annotation_modes",
            {"texts": TEXTS, "mode": "scratch", "reason": "Wrong proposals"},
        ),
    ],
)
async def test_a_mistyped_preview_token_is_not_called_a_change(
    fake: FakeApi, mcp_client: Client, tool: str, arguments: dict[str, Any]
) -> None:
    """Issue 471: "changed since the dry run" also for a token that was cut
    or mistyped. Such a token is refused before anything is sent."""
    for token in ("sha256:abc", PT_A[:-1], "the token above"):
        with pytest.raises(ToolFailed, match="cut or mistyped"):
            await call(
                mcp_client,
                tool,
                {"project": "p", "confirm": True, "preview_token": token} | arguments,
            )
    with pytest.raises(ToolFailed, match="Run the dry run first"):
        await call(mcp_client, tool, {"project": "p", "confirm": True} | arguments)
    assert fake.calls == []


async def test_a_stale_answer_also_names_a_token_of_another_dry_run(
    fake: FakeApi, mcp_client: Client
) -> None:
    route = f"{P}/final-selections/accept-agreeing"
    fresh = build("AcceptAgreeingView", texts=[], skipped=[], preview_token=PT_A)
    fake.on("POST", route, refusal(409, "PREVIEW_STALE", {"preview": fresh}))
    stale = await call(
        mcp_client,
        "accept_agreeing_texts",
        {"project": "p", "confirm": True, "preview_token": PT_A},
    )
    assert stale["stale"] is True
    assert stale["note"].startswith("Texts changed since the dry run, or the")
    assert "nothing was accepted" in stale["note"]
