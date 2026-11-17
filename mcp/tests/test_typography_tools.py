"""``list_typography_hints``: positions always, text only with the content tools."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from fake_api import FakeApi
from mcp import Client
from shapes import build

from ontotator_mcp.config import Settings
from ontotator_mcp.server import build_server

pytestmark = pytest.mark.anyio

P = "/api/v1/projects/{key}"
DOC = "case-1~de~v2"
FACE = "\N{GRINNING FACE}"  # one code point, two UTF-16 units
TEXT = f"{FACE} Kein Fieber,kein Husten  seit gestern."
HINTS = [
    {"rule": "MISSING_SPACE_AFTER_PUNCTUATION", "start": 13, "end": 14},
    {"rule": "DOUBLE_SPACE", "start": 25, "end": 27},
]
WORDS = ("Fieber", "Husten", "gestern")


@pytest.fixture
async def content_client(fake: FakeApi, settings: Settings) -> AsyncIterator[Client]:
    server = build_server(
        replace(settings, read_content=True), transport=httpx.MockTransport(fake)
    )
    async with Client(server) as client:
        yield client


def _routes(fake: FakeApi) -> None:
    fake.on(
        "GET",
        f"{P}/documents/{{doc}}/typography-hints",
        build(
            "VersionTypographyHints",
            document_id=DOC,
            total=2,
            counts={"MISSING_SPACE_AFTER_PUNCTUATION": 1, "DOUBLE_SPACE": 1},
            hints=[dict(hint) for hint in HINTS],
            truncated=False,
        ),
    )
    fake.on(
        "GET",
        f"{P}/documents/{{doc}}/text",
        build("VariantText", document_id=DOC, text=TEXT),
    )
    fake.on(
        "GET",
        f"{P}/typography-hints",
        build(
            "ProjectTypographyHints",
            texts=[
                build(
                    "TextTypographyCounts",
                    document_id=DOC,
                    case_id="case-1",
                    language="de",
                    version=2,
                    total=2,
                    counts={"DOUBLE_SPACE": 2},
                )
            ],
            scanned=100,
            next_after="case-9~de~v1",
        ),
    )


async def _tool(client: Client) -> Any:
    tools = {tool.name: tool for tool in (await client.list_tools()).tools}
    return tools["list_typography_hints"]


async def test_the_tool_is_read_only_and_always_there(
    mcp_client: Client, content_client: Client
) -> None:
    for client in (mcp_client, content_client):
        tool = await _tool(client)
        assert tool.annotations is not None
        assert tool.annotations.read_only_hint is True
        assert "Token scope: 'read'. Read only" in (tool.description or "")


async def test_without_the_content_tools_it_returns_positions_only(
    fake: FakeApi, mcp_client: Client
) -> None:
    _routes(fake)
    result = await call(
        mcp_client, "list_typography_hints", {"project": "p", "document_id": DOC}
    )
    assert result["hints"] == HINTS
    assert result["total"] == 2 and result["truncated"] is False
    # The text route is never called, and no word of the text comes back.
    assert fake.templates() == [("GET", f"{P}/documents/{{doc}}/typography-hints")]
    assert not any(word in str(result) for word in WORDS)


async def test_without_the_content_tools_text_cannot_be_asked_for(
    fake: FakeApi, mcp_client: Client
) -> None:
    _routes(fake)
    tool = await _tool(mcp_client)
    assert "include_text" not in tool.input_schema["properties"]
    assert "ONTOTATOR_MCP_READ_CONTENT=1" in (tool.description or "")
    # A client that sends the argument anyway gets no text.
    try:
        result = await call(
            mcp_client,
            "list_typography_hints",
            {"project": "p", "document_id": DOC, "include_text": True},
        )
    except ToolFailed:
        result = None
    assert ("GET", f"{P}/documents/{{doc}}/text") not in fake.templates()
    assert not any(word in str(result) for word in WORDS)


async def test_with_the_content_tools_text_comes_only_on_request(
    fake: FakeApi, content_client: Client
) -> None:
    _routes(fake)
    tool = await _tool(content_client)
    assert tool.input_schema["properties"]["include_text"]["default"] is False
    plain = await call(
        content_client, "list_typography_hints", {"project": "p", "document_id": DOC}
    )
    assert plain["hints"] == HINTS
    assert ("GET", f"{P}/documents/{{doc}}/text") not in fake.templates()
    result = await call(
        content_client,
        "list_typography_hints",
        {"project": "p", "document_id": DOC, "include_text": True},
    )
    # Positions are code points: the emoji before them counts once.
    assert [hint["text"] for hint in result["hints"]] == [",", "  "]
    assert (
        result["hints"][0]["context"]
        == f"{FACE} Kein Fieber,kein Husten  seit gestern."
    )
    assert result["hints"][1]["context"].startswith(f"{FACE} Kein Fieber,kein Husten  ")
    assert [
        {key: hint[key] for key in ("rule", "start", "end")} for hint in result["hints"]
    ] == HINTS


async def test_the_project_list_is_one_page_of_counts(
    fake: FakeApi, mcp_client: Client, content_client: Client
) -> None:
    _routes(fake)
    for client in (mcp_client, content_client):
        fake.calls.clear()
        result = await call(
            client,
            "list_typography_hints",
            {"project": "p", "after": "case-1~de~v1", "all_versions": True},
        )
        assert result["scanned"] == 100
        assert result["next_after"] == "case-9~de~v1"
        assert result["texts"][0]["counts"] == {"DOUBLE_SPACE": 2}
        assert fake.templates() == [("GET", f"{P}/typography-hints")]
        query = dict(fake.calls[0].request.url.params)
        assert query == {"after": "case-1~de~v1", "versions": "all"}
    fake.calls.clear()
    await call(mcp_client, "list_typography_hints", {"project": "p"})
    assert dict(fake.calls[0].request.url.params) == {}
