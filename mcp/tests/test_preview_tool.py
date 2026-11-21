"""preview_change: the dry run of a changing tool, as a read-only tool (#485).

A client that asks before every changing tool can allow this one: it shows
the same dry run and never sends a request that changes data.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from fake_api import FakeApi
from mcp import Client
from test_scopes import _arguments, _flows

from ontotator_mcp.client import changes_nothing
from ontotator_mcp.config import Settings
from ontotator_mcp.server import build_server
from ontotator_mcp.tools_preview import APPLYING, confirm_tools

pytestmark = pytest.mark.anyio


def _dry(arguments: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in arguments.items() if key not in APPLYING}


def _writes(fake: FakeApi) -> list[str]:
    """The requests that were sent and could have changed data."""
    sent = []
    for each in fake.calls:
        body = json.loads(each.request.content) if each.request.content else None
        if not changes_nothing(each.method, each.request.url.path, body):
            sent.append(f"{each.method} {each.template}")
    return sent


async def test_it_is_marked_read_only_and_names_the_tools_it_previews(
    mcp_client: Client,
) -> None:
    tools = {tool.name: tool for tool in (await mcp_client.list_tools()).tools}
    preview = tools["preview_change"]
    assert preview.annotations is not None
    assert preview.annotations.read_only_hint is True
    assert "Read only: changes nothing." in (preview.description or "")
    offered = preview.input_schema["properties"]["tool"]["enum"]
    with_confirm = sorted(
        name
        for name, tool in tools.items()
        if "confirm" in tool.input_schema.get("properties", {})
    )
    assert offered == with_confirm
    assert "accept_translation_version" in offered


async def test_every_dry_run_is_the_tools_own_and_sends_no_change(
    fake: FakeApi, settings: Settings, tmp_path: Path
) -> None:
    _flows(fake)
    server = build_server(
        replace(settings, read_content=True), transport=httpx.MockTransport(fake)
    )
    arguments = _arguments(tmp_path)
    stopped = {}
    async with Client(server) as client:
        for name in confirm_tools(server):
            dry = _dry(arguments[name])
            fake.calls.clear()
            try:
                direct = await call(client, name, dry)
            except ToolFailed:
                direct = None
            direct_writes = _writes(fake)
            fake.calls.clear()
            try:
                previewed = await call(
                    client, "preview_change", {"tool": name, "arguments": dry}
                )
            except ToolFailed as exc:
                # Only a tool that changes data without confirm is stopped.
                assert "preview_change stopped" in str(exc), (name, str(exc))
                assert direct_writes, name
                stopped[name] = direct_writes
                continue
            assert _writes(fake) == [], name
            assert direct_writes == [], name
            assert previewed["preview_of"] == name
            assert "Nothing was changed" in previewed["how_to_apply"]
            rest = {
                key: value
                for key, value in previewed.items()
                if key not in ("preview_of", "how_to_apply")
            }
            assert rest == direct, name
    # set_member_roles adds roles at once; in a preview the PUT is not sent.
    assert set(stopped) == {"set_member_roles"}, stopped


async def test_adding_roles_is_stopped_before_it_is_sent(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        "/api/v1/projects/{key}/members",
        [],
    )
    with pytest.raises(ToolFailed, match="Nothing was sent"):
        await call(
            mcp_client,
            "preview_change",
            {
                "tool": "set_member_roles",
                "arguments": {"project": "p", "username": "u", "roles": ["annotator"]},
            },
        )
    assert [c.method for c in fake.calls if c.method != "GET"] == []


@pytest.mark.parametrize("applying", APPLYING)
async def test_confirm_and_preview_token_are_refused(
    fake: FakeApi, mcp_client: Client, applying: str
) -> None:
    arguments = {
        "project": "p",
        "texts": [{"case_id": "c", "language": "en"}],
        applying: True if applying == "confirm" else "sha256:" + "a" * 64,
    }
    with pytest.raises(ToolFailed, match=f"leave out {applying}"):
        await call(
            mcp_client,
            "preview_change",
            {"tool": "withdraw_open_tasks", "arguments": arguments},
        )
    assert fake.calls == []


async def test_a_tool_without_a_dry_run_is_refused(
    fake: FakeApi, mcp_client: Client
) -> None:
    with pytest.raises(ToolFailed, match="no dry run of 'assign_texts'"):
        await call(
            mcp_client,
            "preview_change",
            {"tool": "assign_texts", "arguments": {"project": "p"}},
        )
    assert fake.calls == []


async def test_the_previewed_tools_own_refusals_come_through(
    mcp_client: Client,
) -> None:
    with pytest.raises(ToolFailed, match="Unknown argument 'case_id'"):
        await call(
            mcp_client,
            "preview_change",
            {
                "tool": "withdraw_open_tasks",
                "arguments": {"project": "p", "case_id": "c"},
            },
        )


def test_what_counts_as_changing_nothing() -> None:
    assert changes_nothing("GET", "/api/v1/projects/p/members", None)
    assert changes_nothing("POST", "/api/v1/projects/p/pins/preview", {"x": 1})
    assert changes_nothing("POST", "/api/v1/projects/p/bulk", {"preview": True})
    assert not changes_nothing("POST", "/api/v1/projects/p/bulk", {"preview": False})
    assert not changes_nothing("PUT", "/api/v1/projects/p/members/u", {"roles": []})
    assert not changes_nothing("DELETE", "/api/v1/projects/p/preview-thing", None)
