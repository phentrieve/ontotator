"""What ``register`` gives every tool: unknown arguments are refused, and a
tool with ``confirm`` says what it acted on (review findings F3 and F4)."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from fake_api import FakeApi, refusal
from mcp import Client
from shapes import build
from test_scopes import _arguments, _flows

from ontotator_mcp.config import Settings
from ontotator_mcp.server import build_server
from ontotator_mcp.tooling import selection_text, unknown_arguments_message

pytestmark = pytest.mark.anyio

P = "/api/v1/projects/{key}"
TEXTS = [{"case_id": "c1", "language": "en"}]
WRONG = [{"case_id": "C1", "language": "en"}, {"case_id": "c1", "language": "xx"}]


def _every_tool(fake: FakeApi, settings: Settings) -> Any:
    """The server with every tool it can have (the content tools too)."""
    return build_server(
        replace(settings, read_content=True), transport=httpx.MockTransport(fake)
    )


async def test_every_tool_refuses_an_argument_it_does_not_have(
    fake: FakeApi, settings: Settings, tmp_path: Path
) -> None:
    _flows(fake)
    arguments = _arguments(tmp_path)
    async with Client(_every_tool(fake, settings)) as client:
        tools = {tool.name: tool for tool in (await client.list_tools()).tools}
        assert set(tools) == set(arguments)
        for name, tool in tools.items():
            schema = tool.input_schema
            assert schema.get("additionalProperties") is False, name
            fake.calls.clear()
            # Valid arguments and one more: the call is refused as a whole.
            with pytest.raises(ToolFailed) as refused:
                await call(client, name, arguments[name] | {"not_an_argument": 1})
            message = str(refused.value)
            assert f"Unknown argument 'not_an_argument' for {name}" in message, name
            valid = ", ".join(schema.get("properties", {})) or "none"
            assert f"Valid arguments: {valid}." in message, name
            assert fake.calls == [], name


async def test_a_misspelt_argument_is_refused_with_the_name_that_was_meant(
    fake: FakeApi, mcp_client: Client
) -> None:
    """``case_id`` for ``case_ids`` ran a dry run over the whole project."""
    with pytest.raises(ToolFailed) as refused:
        await call(
            mcp_client, "accept_agreeing_texts", {"project": "p", "case_id": ["c1"]}
        )
    assert "Unknown argument 'case_id' (did you mean 'case_ids'?)" in str(refused.value)
    assert "Valid arguments: project, case_ids, confirm, preview_token." in str(
        refused.value
    )
    assert fake.calls == []


def test_the_message_names_every_unknown_argument() -> None:
    message = unknown_arguments_message(
        "reopen_texts", ["text", "why"], ["project", "texts", "reason"]
    )
    assert message == (
        "Unknown arguments 'text' (did you mean 'texts'?), 'why' for reopen_texts;"
        " nothing was done. Valid arguments: project, texts, reason."
    )


async def test_every_tool_with_confirm_names_its_selection(
    fake: FakeApi, settings: Settings, tmp_path: Path
) -> None:
    """In the dry run and in the confirmed answer."""
    _flows(fake)
    arguments = _arguments(tmp_path)
    async with Client(_every_tool(fake, settings)) as client:
        confirming = [
            tool.name
            for tool in (await client.list_tools()).tools
            if "confirm" in tool.input_schema.get("properties", {})
        ]
        assert len(confirming) >= 26
        for name in confirming:
            confirmed = arguments[name] | {"confirm": True}
            dry = {
                key: value
                for key, value in confirmed.items()
                if key not in ("confirm", "preview_token")
            }
            for run in (dry, confirmed):
                answer = await call(client, name, run)
                selection = answer["selection"]
                assert isinstance(selection, str) and selection, name
                # The first entry, so that it is read before the lists.
                assert next(iter(answer)) == "selection", name
                if "project" in run:
                    assert "project 'p'" in selection, name


@pytest.mark.parametrize(
    ("arguments", "selection"),
    [
        # A tool that takes case_ids, called without: the whole project.
        ({"project": "p", "case_ids": None}, "all texts of project 'p'"),
        (
            {"project": "p", "case_ids": ["a", "b", "a"]},
            "2 cases (case_ids) of project 'p'",
        ),
        ({"project": "p", "texts": TEXTS}, "1 text of project 'p'"),
        ({"project": "p", "texts": [*TEXTS, *WRONG, *TEXTS]}, "3 texts of project 'p'"),
        # One language: cases, not texts.
        (
            {"project": "p", "language": "de", "case_ids": [], "texts": []},
            "all cases of project 'p', language 'de'",
        ),
        (
            {"project": "p", "case_id": "c", "language": "en", "reason": "x"},
            "project 'p', case_id 'c', language 'en'",
        ),
        (
            {"report_id": "r1", "action": "resume", "assignment_ids": [3, 4]},
            "assignment_ids [3, 4], report_id 'r1'",
        ),
        ({"project": "p", "undo_id": 7, "confirm": True}, "project 'p', undo_id 7"),
    ],
)
def test_selection_text(arguments: dict[str, Any], selection: str) -> None:
    assert selection_text(arguments) == selection


async def test_the_selection_of_accept_agreeing_texts(
    fake: FakeApi, mcp_client: Client
) -> None:
    whole = await call(mcp_client, "accept_agreeing_texts", {"project": "p"})
    assert whole["selection"] == "all texts of project 'p'"
    some = await call(
        mcp_client, "accept_agreeing_texts", {"project": "p", "case_ids": ["c1"]}
    )
    assert some["selection"] == "1 case (case_ids) of project 'p'"


BULK_TOOLS: list[tuple[str, str, str, dict[str, Any]]] = [
    (
        "reopen_texts",
        f"{P}/bulk-task-actions/reopen",
        "BulkTaskActionView",
        {"reason": "Guideline 2.3"},
    ),
    (
        "withdraw_open_tasks",
        f"{P}/bulk-task-actions/withdraw",
        "BulkTaskActionView",
        {},
    ),
    (
        "start_rounds",
        f"{P}/bulk-task-actions/start-round",
        "BulkTaskActionView",
        {"kind": "carry_forward"},
    ),
    (
        "change_final_results",
        f"{P}/final-selections/bulk-change",
        "BulkChangeFinalView",
        {},
    ),
    (
        "change_annotation_modes",
        f"{P}/annotation-mode-changes/bulk",
        "BulkModeChangeView",
        {"mode": "scratch", "reason": "Proposals were wrong"},
    ),
]


@pytest.mark.parametrize(("tool", "route", "view", "extra"), BULK_TOOLS)
async def test_bulk_tools_name_the_texts_the_project_does_not_have(
    fake: FakeApi,
    mcp_client: Client,
    tool: str,
    route: str,
    view: str,
    extra: dict[str, Any],
) -> None:
    """A text that does not exist, or has another letter case or language,
    no longer vanishes: it is in ``unknown_texts`` of the dry run, of the
    applied answer and of a stale answer."""
    found = build(view, texts=1, preview_token="sha256:a", unknown_rows=WRONG)
    arguments = {"project": "p", "texts": [*TEXTS, *WRONG]} | extra
    fake.on("POST", route, found)
    dry = await call(mcp_client, tool, arguments)
    assert dry["applied"] is False
    assert dry["unknown_texts"] == WRONG and dry["unknown_text_count"] == 2
    assert dry["selection"] == "3 texts of project 'p'"
    confirmed = arguments | {"confirm": True, "preview_token": "sha256:a"}
    fake.on("POST", route, found | {"applied": True})
    done = await call(mcp_client, tool, confirmed)
    assert done["applied"] is True and done["unknown_texts"] == WRONG
    fake.on("POST", route, refusal(409, "PREVIEW_STALE", {"preview": found}))
    stale = await call(mcp_client, tool, confirmed)
    assert stale["stale"] is True and stale["unknown_texts"] == WRONG
    # Every text known: an empty list, not a missing entry.
    fake.on("POST", route, found | {"unknown_rows": []})
    assert (await call(mcp_client, tool, arguments))["unknown_texts"] == []


async def test_an_older_server_that_names_no_unknown_texts_is_not_read_as_none(
    fake: FakeApi, mcp_client: Client
) -> None:
    older = build("BulkTaskActionView", texts=0, preview_token="sha256:a")
    older.pop("unknown_rows", None)
    fake.on("POST", f"{P}/bulk-task-actions/withdraw", older)
    dry = await call(
        mcp_client, "withdraw_open_tasks", {"project": "p", "texts": WRONG}
    )
    assert "unknown_texts" not in dry


@pytest.mark.parametrize(("tool", "route", "view", "extra"), BULK_TOOLS)
async def test_a_text_with_a_misspelt_or_extra_key_is_refused(
    fake: FakeApi,
    mcp_client: Client,
    tool: str,
    route: str,
    view: str,
    extra: dict[str, Any],
) -> None:
    """The server ignores an entry's extra key; the tool does not send it."""
    for text in (
        {"case_id": "c1", "lang": "en"},
        {"case_id": "c1", "language": "en", "version": "2"},
    ):
        with pytest.raises(ToolFailed, match=r"lang|version"):
            await call(mcp_client, tool, {"project": "p", "texts": [text]} | extra)
    assert fake.calls == []
