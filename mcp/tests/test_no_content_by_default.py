"""Without ``ONTOTATOR_MCP_READ_CONTENT=1`` no tool returns clinical text.

The fake API answers every route with the largest body its schema allows
and puts one known sentence into every field that carries text (a version's
text, a passage, a reviewer's corrected text and rationale, notes). Every
tool the server registers by default runs against it, write tools as a dry
run and confirmed, and with every ``include_...`` switch its input schema
offers turned on; the sentence must be in no answer. With the variable set
the same sentence does come back, which shows the check can fail.
"""

from __future__ import annotations

from dataclasses import replace
from functools import partial
from pathlib import Path
from typing import Any

import httpx
import pytest
from contract import synth_full
from fake_api import FakeApi
from mcp import Client
from test_scopes import _arguments, _flows

from ontotator_mcp.config import Settings
from ontotator_mcp.server import build_server
from ontotator_mcp.tools_content import CONTENT_TOOLS

pytestmark = pytest.mark.anyio

SENTENCE = "The patient had two seizures last week."
# The one answer that carries text by design: the dry run of
# editorial_correction returns the diff of the fixes the caller sent (the
# changed passages with their surroundings), never the whole text (#453).
BY_DESIGN = [("editorial_correction", False)]


async def _answers(
    fake: FakeApi, settings: Settings, folder: Path
) -> dict[tuple[str, bool], str]:
    """Each tool's whole answer (text and structured), by name and whether
    ``confirm`` was sent."""
    _flows(fake)
    server = build_server(settings, transport=httpx.MockTransport(fake))
    answers: dict[tuple[str, bool], str] = {}
    async with Client(server) as client:
        offered = {
            tool.name: tool.input_schema.get("properties", {})
            for tool in (await client.list_tools()).tools
        }
        for name, listed in _arguments(folder).items():
            if name not in offered:
                continue
            # What the tool offers of the listed arguments (include_text exists
            # only with the opt-in), and every switch that adds content.
            arguments = {
                key: value for key, value in listed.items() if key in offered[name]
            } | {key: True for key in offered[name] if key.startswith("include_")}
            runs: list[dict[str, Any]] = [arguments]
            if arguments.get("confirm"):
                runs.append({k: v for k, v in arguments.items() if k != "confirm"})
            for run in runs:
                result = await client.call_tool(name, run)
                answers[(name, bool(run.get("confirm")))] = "".join(
                    getattr(part, "text", "") for part in result.content
                ) + str(result.structured_content)
    return answers


async def test_no_default_tool_returns_text_content(
    settings: Settings, tmp_path: Path
) -> None:
    fake = FakeApi(synth=partial(synth_full, content=SENTENCE))
    answers = await _answers(fake, settings, tmp_path)
    # Every tool registered by default ran, and reached the API.
    ran = {name for name, _ in answers}
    assert ran == set(_arguments(tmp_path)) - set(CONTENT_TOOLS)
    assert len(fake.calls) > len(ran)
    leaking = sorted(key for key, answer in answers.items() if SENTENCE in answer)
    assert leaking == BY_DESIGN


async def test_the_sentence_comes_back_with_the_opt_in(
    settings: Settings, tmp_path: Path
) -> None:
    fake = FakeApi(synth=partial(synth_full, content=SENTENCE))
    answers = await _answers(fake, replace(settings, read_content=True), tmp_path)
    leaking = {name for (name, _), answer in answers.items() if SENTENCE in answer}
    assert {"get_text_version", "get_submission", "list_translation_reviews"} <= leaking
