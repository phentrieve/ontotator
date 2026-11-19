"""The opt-in content tools (#442): a text version and submitted annotations."""

from __future__ import annotations

import os
import sys
from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from fake_api import TOKEN, FakeApi, refusal
from mcp import Client, StdioServerParameters
from shapes import build

from ontotator_mcp.config import ConfigError, Settings
from ontotator_mcp.server import build_server
from ontotator_mcp.tools_content import CONTENT_TOOLS

P = "/api/v1/projects/{key}"
DOC = "case/1-en-v2"
EARLIER = "case/1-en-v1"
TEXT = "Fever since Monday. No seizures 🙂 today."
EARLIER_TEXT = "Fever since Sunday."
ENV = {"ONTOTATOR_URL": "https://ontotator.example.org", "ONTOTATOR_TOKEN": TOKEN}

pytestmark = pytest.mark.anyio


@pytest.fixture
async def content_client(fake: FakeApi, settings: Settings) -> AsyncIterator[Client]:
    server = build_server(
        replace(settings, read_content=True), transport=httpx.MockTransport(fake)
    )
    async with Client(server) as client:
        yield client


def _span(part: str, text: str = TEXT) -> dict[str, int]:
    start = text.index(part)
    return {"start": start, "end": start + len(part)}


def _evidence(evidence_id: str, part: str, *, document_id: str = DOC) -> dict[str, Any]:
    text = TEXT if document_id == DOC else EARLIER_TEXT
    mention = build(
        "EvidenceMention", evidence_id=evidence_id, segments=[_span(part, text)]
    )
    return build("EvidenceSnapshot", mention=mention, document_id=document_id)


def _snapshot(
    annotation_id: str, part: str, *, document_id: str = DOC, note: str | None = None
) -> dict[str, Any]:
    annotation = build(
        "Annotation",
        annotation_id=annotation_id,
        document_id=document_id,
        term_id="HP:0001945",
        note=note,
    )
    return build(
        "AnnotationSnapshot",
        annotation=annotation,
        evidence=[_evidence(f"e-{annotation_id}", part, document_id=document_id)],
        document_id=document_id,
    )


def _submission(**fields: Any) -> dict[str, Any]:
    summary = build(
        "SubmissionHistorySummary",
        submission_id="s1",
        document_id=DOC,
        author_label="Annotator A",
    )
    return build(
        "SubmissionHistoryDetail",
        summary=summary,
        **{
            "annotations": [_snapshot("a1", "Fever", note="since Monday")],
            "evidence": [_evidence("e-a1", "Fever")],
            "decisions": [],
        }
        | fields,
    )


def _texts(fake: FakeApi) -> None:
    fake.on(
        "GET",
        f"{P}/documents/{{doc}}/text",
        build("VariantText", document_id=DOC, text=TEXT),
    )


# Opt-in


async def test_the_content_tools_are_absent_by_default(mcp_client: Client) -> None:
    names = {tool.name for tool in (await mcp_client.list_tools()).tools}
    assert names.isdisjoint(CONTENT_TOOLS)
    for name in CONTENT_TOOLS:
        with pytest.raises(ToolFailed, match="Unknown tool"):
            await call(mcp_client, name, {"project": "p", "document_id": DOC})
    # The default instructions keep saying that no tool reads the work.
    instructions = mcp_client.instructions or ""
    assert "no tool reads or writes them" in instructions
    assert "ONTOTATOR_MCP_READ_CONTENT" not in instructions


async def test_the_content_tools_exist_with_the_variable(
    content_client: Client, mcp_client: Client
) -> None:
    listed = {tool.name: tool for tool in (await content_client.list_tools()).tools}
    default = {tool.name for tool in (await mcp_client.list_tools()).tools}
    # Exactly the content tools more; nothing else changes.
    assert set(listed) - default == set(CONTENT_TOOLS)
    assert default <= set(listed)
    for name in CONTENT_TOOLS:
        tool = listed[name]
        assert tool.annotations is not None
        assert tool.annotations.read_only_hint is True, name
        assert "Token scope: 'read'. Read only" in (tool.description or ""), name
        assert "ONTOTATOR_MCP_READ_CONTENT=1" in (tool.description or ""), name
    instructions = content_client.instructions or ""
    assert "ONTOTATOR_MCP_READ_CONTENT=1" in instructions


def test_only_1_turns_the_content_tools_on() -> None:
    assert Settings.from_env(ENV).read_content is False
    assert (
        Settings.from_env(ENV | {"ONTOTATOR_MCP_READ_CONTENT": ""}).read_content
        is False
    )
    assert (
        Settings.from_env(ENV | {"ONTOTATOR_MCP_READ_CONTENT": "0"}).read_content
        is False
    )
    assert (
        Settings.from_env(ENV | {"ONTOTATOR_MCP_READ_CONTENT": "1"}).read_content
        is True
    )
    for odd in ("true", "yes", "2"):
        with pytest.raises(ConfigError, match="ONTOTATOR_MCP_READ_CONTENT"):
            Settings.from_env(ENV | {"ONTOTATOR_MCP_READ_CONTENT": odd})


@pytest.mark.parametrize(("value", "present"), [(None, False), ("1", True)])
async def test_the_variable_decides_over_stdio(
    value: str | None, present: bool
) -> None:
    env = {k: v for k, v in os.environ.items() if not k.startswith("ONTOTATOR_")}
    env |= {"ONTOTATOR_URL": "http://127.0.0.1:9", "ONTOTATOR_TOKEN": TOKEN}
    if value is not None:
        env["ONTOTATOR_MCP_READ_CONTENT"] = value
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "ontotator_mcp"], env=env
    )
    async with Client(params) as client:
        names = {tool.name for tool in (await client.list_tools()).tools}
    assert "whoami" in names
    assert (set(CONTENT_TOOLS) <= names) is present
    assert names.isdisjoint(CONTENT_TOOLS) is not present


# get_text_version


async def test_get_text_version_gives_the_version_without_its_text(
    fake: FakeApi, content_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/documents/{{doc}}/variant",
        build(
            "VariantSummary",
            document_id=DOC,
            case_id="case/1",
            language="en",
            version=2,
            origin="correction",
            derived_from=EARLIER,
            translation_status=None,
            text_sha256="b" * 64,
        ),
    )
    version = await call(
        content_client, "get_text_version", {"project": "p", "document_id": DOC}
    )
    assert (version["version"], version["origin"]) == (2, "correction")
    assert version["derived_from"] == EARLIER
    assert version["text_sha256"] == "b" * 64
    assert "text" not in version
    # One request, the text route is not called; the ID is one path segment.
    [request] = fake.calls
    assert request.template == f"{P}/documents/{{doc}}/variant"
    assert "case%2F1-en-v2" in request.request.url.raw_path.decode()


async def test_get_text_version_adds_the_text_on_request(
    fake: FakeApi, content_client: Client
) -> None:
    _texts(fake)
    version = await call(
        content_client,
        "get_text_version",
        {"project": "p", "document_id": DOC, "include_text": True},
    )
    assert version["text"] == TEXT
    assert fake.templates() == [
        ("GET", f"{P}/documents/{{doc}}/variant"),
        ("GET", f"{P}/documents/{{doc}}/text"),
    ]


# Annotation versions


async def test_list_annotation_versions_returns_the_offered_states(
    fake: FakeApi, content_client: Client
) -> None:
    refs = [
        build("VersionRef", kind="submission", id="s1", label="ann-0002 · 2026-11-01"),
        build("VersionRef", kind="proposals", id="7", label="phentrieve 1.4"),
    ]
    fake.on("GET", f"{P}/documents/{{doc}}/annotation-versions", refs)
    found = await call(
        content_client, "list_annotation_versions", {"project": "p", "document_id": DOC}
    )
    assert found["count"] == 2
    assert [(ref["kind"], ref["id"]) for ref in found["items"]] == [
        ("submission", "s1"),
        ("proposals", "7"),
    ]


async def test_get_annotation_version_gives_offsets_and_span_texts_on_request(
    fake: FakeApi, content_client: Client
) -> None:
    _texts(fake)
    state = build(
        "AnnotationVersion",
        ref=build("VersionRef", kind="submission", id="s/1"),
        annotations=[_snapshot("a1", "seizures 🙂")],
        evidence=[_evidence("e-a1", "seizures 🙂")],
    )
    route = f"{P}/documents/{{doc}}/annotation-versions/{{kind}}/{{version_id}}"
    fake.on("GET", route, state)
    arguments = {
        "project": "p",
        "document_id": DOC,
        "kind": "submission",
        "version_id": "s/1",
    }
    plain = await call(content_client, "get_annotation_version", arguments)
    [segment] = plain["evidence"][0]["mention"]["segments"]
    assert segment == _span("seizures 🙂")
    assert fake.templates() == [("GET", route)]
    assert fake.calls[0].request.url.raw_path.decode().endswith("/submission/s%2F1")
    full = await call(
        content_client, "get_annotation_version", arguments | {"include_text": True}
    )
    # Offsets count Unicode code points, as the server does.
    assert full["evidence"][0]["mention"]["segments"] == [
        _span("seizures 🙂") | {"text": "seizures 🙂"}
    ]
    nested = full["annotations"][0]["evidence"][0]["mention"]["segments"]
    assert nested[0]["text"] == "seizures 🙂"
    with pytest.raises(ToolFailed):
        await call(
            content_client, "get_annotation_version", arguments | {"kind": "draft"}
        )


# get_submission


async def test_get_submission_leaves_text_out_by_default(
    fake: FakeApi, content_client: Client
) -> None:
    carried = build(
        "RoundSourceText",
        document_id=EARLIER,
        language="en",
        version=1,
        text=EARLIER_TEXT,
    )
    route = f"{P}/documents/{{doc}}/submissions/{{submission_id}}"
    fake.on("GET", route, _submission(carried_from=carried))
    found = await call(
        content_client,
        "get_submission",
        {"project": "p", "document_id": DOC, "submission_id": "s1"},
    )
    # The route's author label, unchanged (here a blinded consolidator's).
    assert found["summary"]["author_label"] == "Annotator A"
    [annotation] = found["annotations"]
    assert annotation["annotation"]["term_id"] == "HP:0001945"
    assert annotation["annotation"]["note"] == "since Monday"
    assert found["evidence"][0]["mention"]["segments"] == [_span("Fever")]
    assert found["carried_from"] == {
        "document_id": EARLIER,
        "language": "en",
        "version": 1,
    }
    assert TEXT not in str(found) and EARLIER_TEXT not in str(found)
    assert fake.templates() == [("GET", route)]


async def test_get_submission_adds_span_texts_and_the_earlier_text_on_request(
    fake: FakeApi, content_client: Client
) -> None:
    _texts(fake)
    carried = build(
        "RoundSourceText",
        document_id=EARLIER,
        language="en",
        version=1,
        text=EARLIER_TEXT,
    )
    source = _snapshot("a0", "Sunday", document_id=EARLIER)
    carried_input = build(
        "RoundInputView",
        input_id="i1",
        source_ref=build("AnnotationRef", annotation_id="a0"),
        source_snapshot=source,
        target_snapshot=_snapshot("a1", "Monday"),
    )
    route = f"{P}/documents/{{doc}}/submissions/{{submission_id}}"
    fake.on(
        "GET", route, _submission(carried_from=carried, round_inputs=[carried_input])
    )
    found = await call(
        content_client,
        "get_submission",
        {
            "project": "p",
            "document_id": DOC,
            "submission_id": "s1",
            "include_text": True,
        },
    )
    assert found["evidence"][0]["mention"]["segments"] == [
        _span("Fever") | {"text": "Fever"}
    ]
    assert found["carried_from"]["text"] == EARLIER_TEXT
    [item] = found["round_inputs"]
    # A carried input's source lies on the earlier version: its own text.
    old = item["source_snapshot"]["evidence"][0]["mention"]["segments"]
    new = item["target_snapshot"]["evidence"][0]["mention"]["segments"]
    assert (old[0]["text"], new[0]["text"]) == ("Sunday", "Monday")
    assert fake.templates() == [
        ("GET", route),
        ("GET", f"{P}/documents/{{doc}}/text"),
    ]


async def test_a_passage_outside_the_text_keeps_its_offsets(
    fake: FakeApi, content_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/documents/{{doc}}/text",
        build("VariantText", document_id=DOC, text="Fever"),
    )
    fake.on(
        "GET",
        f"{P}/documents/{{doc}}/submissions/{{submission_id}}",
        _submission(evidence=[_evidence("e-a1", "seizures")]),
    )
    found = await call(
        content_client,
        "get_submission",
        {
            "project": "p",
            "document_id": DOC,
            "submission_id": "s1",
            "include_text": True,
        },
    )
    assert found["evidence"][0]["mention"]["segments"] == [_span("seizures")]


# get_consolidation_inputs

TASK = "/api/v1/assignments/{assignment_id}"
ROUNDS = "/api/v1/assignments/{assignment_id}/rounds"
INPUTS = "/api/v1/rounds/{round_id}/inputs"
# Opaque IDs, as the server gives them to a blinded consolidator.
BLIND_SOURCE = "sub-z" + "1" * 16


def _consolidation(fake: FakeApi, *, task: str = "review") -> None:
    fake.on(
        "GET",
        TASK,
        build(
            "AssignmentView",
            id=7,
            project_key="p",
            document_id=DOC,
            task=task,
            status="in_progress",
            username="adj",
            pseudonym="P-adj",
        ),
    )
    fake.on(
        "GET",
        ROUNDS,
        [
            build(
                "WorkRoundView",
                round_id="z" + "2" * 64,
                kind="consolidation",
                state="editable",
                active=True,
                annotator_id="P-adj",
                input_submission_ids=[BLIND_SOURCE],
            )
        ],
    )
    snapshot = _snapshot("a1", "Fever")
    snapshot["annotation"]["provenance"]["actor"]["actor_id"] = "annotator-a"
    fake.on(
        "GET",
        INPUTS,
        [
            build(
                "RoundInputView",
                input_id="input-z" + "3" * 64 + "-e0",
                source_submission_id=BLIND_SOURCE,
                source_ref=build("AnnotationRef", annotation_id="a1"),
                source_snapshot=snapshot,
                target_snapshot=None,
            )
        ],
    )


async def test_consolidation_inputs_are_the_rounds_and_inputs_the_web_reads(
    fake: FakeApi, content_client: Client
) -> None:
    _consolidation(fake)
    found = await call(content_client, "get_consolidation_inputs", {"assignment_id": 7})
    assert found["assignment_id"] == 7
    assert (found["project_key"], found["document_id"]) == ("p", DOC)
    [round_] = found["rounds"]
    assert round_["kind"] == "consolidation"
    assert round_["input_submission_ids"] == [BLIND_SOURCE]
    [item] = round_["inputs"]
    # The route's answer, unchanged: the opaque ids and the blinded author.
    assert item["source_submission_id"] == BLIND_SOURCE
    actor = item["source_snapshot"]["annotation"]["provenance"]["actor"]
    assert actor["actor_id"] == "annotator-a"
    assert item["source_snapshot"]["evidence"][0]["mention"]["segments"] == [
        _span("Fever")
    ]
    # Nothing of the task view the inputs do not need: not even the
    # consolidator's own names.
    for name in ("username", "pseudonym", "display_name", "user_id", "annotator_id"):
        assert name not in found and name not in round_, name
    assert TEXT not in str(found)
    assert fake.templates() == [("GET", TASK), ("GET", ROUNDS), ("GET", INPUTS)]
    # The path names the round as the server gave it.
    assert fake.calls[2].request.url.path == f"/api/v1/rounds/{'z' + '2' * 64}/inputs"


async def test_consolidation_inputs_add_span_texts_on_request(
    fake: FakeApi, content_client: Client
) -> None:
    _consolidation(fake)
    _texts(fake)
    found = await call(
        content_client,
        "get_consolidation_inputs",
        {"assignment_id": 7, "include_text": True},
    )
    [item] = found["rounds"][0]["inputs"]
    assert item["source_snapshot"]["evidence"][0]["mention"]["segments"] == [
        _span("Fever") | {"text": "Fever"}
    ]
    assert fake.templates()[-1] == ("GET", f"{P}/documents/{{doc}}/text")


async def test_consolidation_inputs_refuse_a_task_that_is_not_a_consolidation(
    fake: FakeApi, content_client: Client
) -> None:
    _consolidation(fake, task="annotate")
    with pytest.raises(ToolFailed, match="not a consolidation"):
        await call(content_client, "get_consolidation_inputs", {"assignment_id": 7})
    # Nothing but the task itself was read.
    assert fake.templates() == [("GET", TASK)]


async def test_consolidation_inputs_of_someone_elses_task_are_refused(
    fake: FakeApi, content_client: Client
) -> None:
    fake.on("GET", TASK, refusal(404, "ASSIGNMENT_NOT_FOUND", "No such task."))
    with pytest.raises(ToolFailed) as raised:
        await call(content_client, "get_consolidation_inputs", {"assignment_id": 7})
    assert "HTTP 404 ASSIGNMENT_NOT_FOUND" in str(raised.value)
    assert fake.templates() == [("GET", TASK)]


async def test_list_my_tasks_names_each_task_by_its_assignment_id(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on(
        "GET",
        "/api/v1/me/tasks",
        [
            build(
                "TaskSummary",
                assignment_id=7,
                project_key="p",
                document_id=DOC,
                task="review",
                status="open",
            )
        ],
    )
    found = await call(mcp_client, "list_my_tasks", {})
    assert found["count"] == 1
    [task] = found["items"]
    assert (task["assignment_id"], task["task"], task["status"]) == (
        7,
        "review",
        "open",
    )
    assert set(task) == {
        "assignment_id",
        "project_key",
        "document_id",
        "case_id",
        "language",
        "version",
        "task",
        "status",
        "active_round_id",
        "held",
        "updated_at",
    }


# Errors


@pytest.mark.parametrize(
    ("tool", "extra", "route", "code", "hint"),
    [
        (
            "get_submission",
            {"submission_id": "draft-1"},
            f"{P}/documents/{{doc}}/submissions/{{submission_id}}",
            "VERSION_NOT_FOUND",
            "drafts cannot be read",
        ),
        (
            "get_annotation_version",
            {"kind": "own", "version_id": "s9"},
            f"{P}/documents/{{doc}}/annotation-versions/{{kind}}/{{version_id}}",
            "VERSION_NOT_FOUND",
            "list_annotation_versions",
        ),
        (
            "get_text_version",
            {},
            f"{P}/documents/{{doc}}/variant",
            "DOCUMENT_NOT_FOUND",
            "list_texts",
        ),
        (
            "list_annotation_versions",
            {},
            f"{P}/documents/{{doc}}/annotation-versions",
            "DOCUMENT_NOT_FOUND",
            "list_texts",
        ),
    ],
)
async def test_refusals_carry_the_api_code_and_what_to_do(
    fake: FakeApi,
    content_client: Client,
    tool: str,
    extra: dict[str, str],
    route: str,
    code: str,
    hint: str,
) -> None:
    fake.on("GET", route, refusal(404, code, "Not found."))
    with pytest.raises(ToolFailed) as raised:
        await call(content_client, tool, {"project": "p", "document_id": DOC} | extra)
    message = str(raised.value)
    assert f"HTTP 404 {code}" in message
    assert hint in message
    assert TOKEN not in message


async def test_a_token_without_the_read_scope_is_told_so(
    fake: FakeApi, content_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/documents/{{doc}}/submissions/{{submission_id}}",
        refusal(403, "TOKEN_SCOPE_MISSING", "This needs the scope 'read'."),
    )
    with pytest.raises(ToolFailed) as raised:
        await call(
            content_client,
            "get_submission",
            {"project": "p", "document_id": DOC, "submission_id": "s1"},
        )
    assert "HTTP 403 TOKEN_SCOPE_MISSING" in str(raised.value)


async def test_a_failing_text_read_fails_the_tool_instead_of_dropping_the_text(
    fake: FakeApi, content_client: Client
) -> None:
    fake.on(
        "GET",
        f"{P}/documents/{{doc}}/text",
        refusal(404, "DOCUMENT_NOT_FOUND", "Not found."),
    )
    with pytest.raises(ToolFailed, match="DOCUMENT_NOT_FOUND"):
        await call(
            content_client,
            "get_text_version",
            {"project": "p", "document_id": DOC, "include_text": True},
        )
