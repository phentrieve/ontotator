"""Result shapes and names (#471 points 2, 5, 6; #485 point 6).

Answers an agent can hold: a short form and paging for the long lists, a
list as ``{items, count}``, one way to name a person and a task, and the
texts over a limit by name. The size checks run on a project of 90 texts
and on 52 audit events, the sizes of the review.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from fake_api import PT_A, FakeApi
from mcp import Client
from shapes import build, page, row

from ontotator_mcp.config import Settings
from ontotator_mcp.errors import HINTS
from ontotator_mcp.server import INSTRUCTIONS, build_server
from ontotator_mcp.tooling import api_tasks, listing, people, person
from ontotator_mcp.tools_monitoring import changed_passages

pytestmark = pytest.mark.anyio

P = "/api/v1/projects/{key}"
ROWS = f"{P}/document-rows"
KB = 1024


@pytest.fixture
async def content_client(fake: FakeApi, settings: Settings) -> AsyncIterator[Client]:
    server = build_server(
        replace(settings, read_content=True), transport=httpx.MockTransport(fake)
    )
    async with Client(server) as client:
        yield client


async def size(client: Client, name: str, arguments: dict[str, Any]) -> int:
    """Characters of a tool's answer as the client receives it."""
    result = await client.call_tool(name, arguments)
    assert not result.is_error
    return sum(len(getattr(part, "text", "")) for part in result.content)


def ref(number: int, *, lead: bool = True, login: bool = True) -> dict[str, Any]:
    """A person as the server names them to a lead (or to anyone else);
    without ``login`` as the audit does, which names nobody's login."""
    return build(
        "PersonRefView",
        pseudonym=f"ann-{number:04d}",
        display_name=f"Person Number {number}" if lead else None,
        username=f"person{number}" if lead and login else None,
    )


def full_row(number: int, *, per_text: int = 2, annotators: int = 2) -> dict[str, Any]:
    """A text as the Documents page has it: tasks with people, stages, plan."""
    case = f"EN{100000 + number}"
    document = f"{case}-en-v1"
    made = row(
        case,
        document_id=document,
        work=[
            build(
                "WorkItemView",
                assignment_id=number * 10 + index,
                document_id=document,
                task="annotate",
                status="submitted",
                author_label=f"ann-{index:04d}",
                person=ref(index),
                assigned_by=ref(9),
                pause_causes=[],
            )
            for index in range(1, annotators + 1)
        ],
        final=build(
            "FinalSelectionSummary",
            case_id=case,
            language="en",
            document_id=document,
            submission_id=f"sub-{number:04d}",
            kind="annotation",
            author_label="ann-0001",
            author=ref(1),
        ),
    )
    made["annotations_per_text"] = {
        "effective": per_text,
        "project": 2,
        "override": None if per_text == 2 else per_text,
    }
    made["over_limit"] = annotators > per_text
    made["stages"] = build("RowStagesView")
    made["plan_row"] = build("PlanFlagsView", annotate=True)
    made["next_step"] = build("NextStepView")
    return made


def ninety() -> list[dict[str, Any]]:
    return [full_row(number) for number in range(90)]


def paged(rows: list[dict[str, Any]], per_page: int) -> Any:
    """document-rows in pages of ``per_page`` texts, as the server pages."""
    parts = [rows[i : i + per_page] for i in range(0, len(rows), per_page)] or [[]]

    def answer(request: httpx.Request) -> dict[str, Any]:
        number = int(request.url.params.get("page", "1"))
        body = page(parts[number - 1], number, len(parts))
        return body | {"text_count": len(rows), "group_count": len(rows)}

    return answer


# --- #471.6: list_texts ------------------------------------------------------ #


async def test_list_texts_of_ninety_texts_is_short_by_default(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", ROWS, paged(ninety(), 90))
    short = await size(mcp_client, "list_texts", {"project": "p"})
    whole = await size(mcp_client, "list_texts", {"project": "p", "fields": ["all"]})
    # The review measured 62 KB for 90 texts; the short form is a fraction.
    assert short < 30 * KB, short
    assert whole > 2 * short, (short, whole)
    result = await call(mcp_client, "list_texts", {"project": "p"})
    assert (result["returned"], result["text_count"]) == (90, 90)
    assert result["next_offset"] is None
    assert set(result["texts"][0]) == {
        "case_id",
        "language",
        "is_source",
        "document_id",
        "version",
        "stages",
        "next_step",
        "annotations_per_text",
        "over_limit",
    }


async def test_list_texts_pages_with_limit_and_offset(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", ROWS, paged(ninety(), 25))
    first = await call(mcp_client, "list_texts", {"project": "p", "limit": 20})
    assert [t["case_id"] for t in first["texts"]][:2] == ["EN100000", "EN100001"]
    assert (first["returned"], first["text_count"]) == (20, 90)
    assert (first["offset"], first["next_offset"]) == (0, 20)
    # Only the page of the server that holds these texts was read.
    assert len(fake.calls_to("GET", ROWS)) == 1
    fake.calls.clear()
    second = await call(
        mcp_client, "list_texts", {"project": "p", "limit": 20, "offset": 20}
    )
    assert second["texts"][0]["case_id"] == "EN100020"
    assert second["next_offset"] == 40
    assert len(fake.calls_to("GET", ROWS)) == 2
    last = await call(
        mcp_client, "list_texts", {"project": "p", "limit": 20, "offset": 80}
    )
    assert (last["returned"], last["next_offset"]) == (10, None)
    beyond = await call(mcp_client, "list_texts", {"project": "p", "offset": 500})
    assert (beyond["texts"], beyond["next_offset"]) == ([], None)


async def test_list_texts_keeps_the_default_limit_and_says_there_is_more(
    fake: FakeApi, mcp_client: Client
) -> None:
    rows = [full_row(number) for number in range(130)]
    fake.on("GET", ROWS, paged(rows, 50))
    result = await call(mcp_client, "list_texts", {"project": "p"})
    assert (result["returned"], result["text_count"]) == (100, 130)
    assert result["next_offset"] == 100


async def test_list_texts_one_page_of_the_server_still_works(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", ROWS, paged(ninety(), 25))
    result = await call(mcp_client, "list_texts", {"project": "p", "page": 2})
    assert result["texts"][0]["case_id"] == "EN100025"
    assert (result["page"], result["page_count"], result["returned"]) == (2, 4, 25)
    [request] = fake.calls_to("GET", ROWS)
    assert request.request.url.params["page"] == "2"


async def test_list_texts_all_fields_names_each_person_three_ways(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", ROWS, paged([full_row(1)], 50))
    result = await call(mcp_client, "list_texts", {"project": "p", "fields": ["all"]})
    [text] = result["texts"]
    one = {
        "username": "person1",
        "display_name": "Person Number 1",
        "pseudonym": "ann-0001",
    }
    assert text["work"][0]["person"] == one
    assert text["final"]["author"] == one
    assert text["work"][0]["task"] == "annotate"


async def test_list_texts_rejects_an_unknown_field(mcp_client: Client) -> None:
    with pytest.raises(ToolFailed):
        await call(mcp_client, "list_texts", {"project": "p", "fields": ["people"]})


# --- #471.2: which texts are over the limit ---------------------------------- #


async def test_list_texts_shows_the_limit_of_each_text_and_filters_over_limit(
    fake: FakeApi, mcp_client: Client
) -> None:
    rows = [full_row(1, per_text=1, annotators=2), full_row(2, per_text=4)]
    fake.on("GET", ROWS, paged(rows, 50))
    result = await call(mcp_client, "list_texts", {"project": "p", "over_limit": True})
    first, second = result["texts"]
    assert (first["annotations_per_text"], first["over_limit"]) == (1, True)
    assert (second["annotations_per_text"], second["over_limit"]) == (4, False)
    [request] = fake.calls_to("GET", ROWS)
    assert request.request.url.params.get_list("flags") == ["over_limit"]
    await call(
        mcp_client,
        "list_texts",
        {"project": "p", "over_limit": True, "paused_by_lead": True},
    )
    sent = fake.calls_to("GET", ROWS)[-1].request.url.params
    assert sent.get_list("flags") == ["lead_paused", "over_limit"]


TARGET = f"{P}/work-plans/annotation-target-preview"


async def test_annotation_target_preview_names_the_texts(
    fake: FakeApi, mcp_client: Client
) -> None:
    over = [
        {"case_id": f"c{number}", "language": "en", "annotators": 3}
        for number in range(3)
    ]
    fake.on("GET", TARGET, {"rows_over_target": 3, "rows": over})
    args = {"project": "p", "annotations_per_text": 2}
    result = await call(mcp_client, "annotation_target_preview", args)
    assert result == {"rows_over_target": 3, "texts": over, "texts_not_listed": 0}
    cut = await call(mcp_client, "annotation_target_preview", args | {"limit": 2})
    assert (cut["rows_over_target"], len(cut["texts"])) == (3, 2)
    assert cut["texts_not_listed"] == 1


async def test_annotation_target_preview_of_an_older_server_says_so(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", TARGET, httpx.Response(200, json={"rows_over_target": 3}))
    result = await call(
        mcp_client,
        "annotation_target_preview",
        {"project": "p", "annotations_per_text": 2},
    )
    assert result["rows_over_target"] == 3 and result["texts"] is None
    assert "older" in result["note"]


# --- #471.6: project_audit and project_overview ------------------------------ #


def audit_page(count: int) -> dict[str, Any]:
    events = [
        build(
            "ProjectAuditEvent",
            id=number,
            action="assignment.create",
            actor=ref(9, login=False),
            target_type="assignment",
            target_id=str(number),
            target_person=ref(number % 4 + 1, login=False),
            api_token={"id": 7, "name": "mcp"},
            details={
                "document_id": f"EN{100000 + number}-en-v1",
                "task": "annotate",
                "reason": "Second annotator for the method comparison. " * 6,
                "before": {"status": None, "people": []},
                "after": {"status": "open", "people": [f"ann-{number:04d}"] * 8},
                "api_token": {"id": 7, "name": "mcp"},
            },
        )
        for number in range(count)
    ]
    return {"events": events, "total": count, "limit": 50, "offset": 0}


async def test_project_audit_of_fifty_two_events_is_short_by_default(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/audit", audit_page(52))
    short = await size(mcp_client, "project_audit", {"project": "p"})
    whole = await size(
        mcp_client, "project_audit", {"project": "p", "include_details": True}
    )
    # The review measured 53 KB for 52 events.
    assert short < 30 * KB, short
    assert whole > 2 * short, (short, whole)
    result = await call(mcp_client, "project_audit", {"project": "p"})
    assert result["total"] == 52
    assert result["events"][0] == {
        "id": 0,
        "at": "2026-11-01T10:00:00Z",
        "action": "assignment.create",
        "actor": {
            "username": None,
            "display_name": "Person Number 9",
            "pseudonym": "ann-0009",
        },
        "api_token": {"id": 7, "name": "mcp"},
        "target_type": "assignment",
        "target_id": "0",
        "target_person": {
            "username": None,
            "display_name": "Person Number 1",
            "pseudonym": "ann-0001",
        },
    }
    # Fewer events per call than before (100).
    [request] = fake.calls_to("GET", f"{P}/audit")[-1:]
    assert request.request.url.params["limit"] == "50"


async def test_project_audit_details_on_request_and_actors_that_are_no_person(
    fake: FakeApi, mcp_client: Client
) -> None:
    events = audit_page(1)
    events["events"][0] |= {
        "actor": None,
        "actor_kind": "system",
        "actor_label": "system",
        "target_person": None,
        "api_token": None,
    }
    fake.on("GET", f"{P}/audit", events)
    result = await call(
        mcp_client, "project_audit", {"project": "p", "include_details": True}
    )
    [event] = result["events"]
    assert (event["actor"], event["actor_label"]) == (None, "system")
    assert event["target_person"] is None
    assert event["api_token"] is None
    assert event["details"]["task"] == "annotate"


def progress() -> dict[str, Any]:
    link = {"stage": ["annotation"], "paused": "no", "annotate": "on"}
    card = {
        "scope": "annotate",
        "done": 3,
        "total": 90,
        "counts": {"to_assign": 1, "in_progress": 2, "submitted": 3},
        "links": {name: link for name in ("to_assign", "in_progress", "submitted")},
    }
    return build(
        "ProjectProgress",
        stages={
            "translation_review": card | {"scope": "review"},
            "annotation": card,
            "final": card,
        },
        workload=[
            {
                "person": ref(1),
                "username": "person1",
                "translation_reviews_open": 0,
                "annotations_open": 2,
                "annotations_waiting": 0,
                "reviews_open": 0,
                "paused": 0,
                "submitted": 11,
                "translation_reviews_submitted": 10,
                "annotations_submitted": 1,
                "reviews_submitted": 0,
            }
        ],
    )


async def test_project_overview_has_no_links_unless_asked(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", f"{P}/progress", progress())
    overview = await call(mcp_client, "project_overview", {"project": "p"})
    assert overview["stages"]["annotation"] == {
        "scope": "annotate",
        "done": 3,
        "total": 90,
        "counts": {"to_assign": 1, "in_progress": 2, "submitted": 3},
    }
    assert "links" not in str(overview)
    linked = await call(
        mcp_client, "project_overview", {"project": "p", "include_links": True}
    )
    assert set(linked["stages"]["annotation"]["links"]) == {
        "to_assign",
        "in_progress",
        "submitted",
    }
    short = await size(mcp_client, "project_overview", {"project": "p"})
    whole = await size(
        mcp_client, "project_overview", {"project": "p", "include_links": True}
    )
    assert short < whole * 0.6, (short, whole)


async def test_project_overview_splits_submitted_by_task_and_names_the_person(
    fake: FakeApi, mcp_client: Client
) -> None:
    """#485.6: 11 submitted was 10 translation reviews and 1 annotation."""
    fake.on("GET", f"{P}/progress", progress())
    overview = await call(mcp_client, "project_overview", {"project": "p"})
    assert overview["workload"] == [
        {
            "username": "person1",
            "display_name": "Person Number 1",
            "pseudonym": "ann-0001",
            "translation_reviews_open": 0,
            "annotations_open": 2,
            "annotations_waiting": 0,
            "reviews_open": 0,
            "paused": 0,
            "submitted": 11,
            "translation_reviews_submitted": 10,
            "annotations_submitted": 1,
            "reviews_submitted": 0,
        }
    ]
    people_view = await call(
        mcp_client, "get_progress", {"project": "p", "view": "people"}
    )
    assert people_view["workload"] == overview["workload"]


# --- #471.6: a list is {items, count} ---------------------------------------- #

LISTS: dict[str, tuple[str, dict[str, Any]]] = {
    "list_projects": ("/api/v1/projects", {}),
    "list_ontologies": ("/api/v1/ontologies", {}),
    "list_ontology_files": ("/api/v1/admin/ontologies/", {}),
    "list_project_templates": ("/api/v1/projects/templates", {}),
    "list_uploads": (f"{P}/uploads", {"project": "p"}),
    "list_people": (f"{P}/members", {"project": "p"}),
    "list_users": ("/api/v1/admin/users/", {}),
    "find_people": (f"{P}/member-candidates", {"project": "p", "query": "ann"}),
    "list_problem_reports": (f"{P}/problem-reports", {"project": "p"}),
    "list_translation_reviews": (f"{P}/translation-reviews", {"project": "p"}),
}


@pytest.mark.parametrize("name", sorted(LISTS))
async def test_an_empty_list_is_an_answer(
    name: str, fake: FakeApi, mcp_client: Client
) -> None:
    template, arguments = LISTS[name]
    fake.on("GET", template, [])
    result = await mcp_client.call_tool(name, arguments)
    assert not result.is_error
    # Before, an empty list was an empty content block.
    assert "".join(getattr(part, "text", "") for part in result.content).strip()
    assert result.structured_content == {"items": [], "count": 0}


async def test_no_tool_returns_a_bare_list(
    mcp_client: Client, content_client: Client
) -> None:
    for client in (mcp_client, content_client):
        for tool in (await client.list_tools()).tools:
            schema = tool.output_schema or {}
            assert schema.get("type") != "array", tool.name
            # A wrapped list shows as {"result": [...]}.
            assert set(schema.get("properties", {})) != {"result"}, tool.name


async def test_a_list_with_content_counts_it(fake: FakeApi, mcp_client: Client) -> None:
    members = [build("Member", username="ann1"), build("Member")]
    fake.on("GET", f"{P}/members", members)
    result = await call(mcp_client, "list_people", {"project": "p"})
    assert result["count"] == 2
    assert result["items"][0]["username"] == "ann1"
    assert listing([]) == {"items": [], "count": 0}


# --- #471.5: one way to name a person ---------------------------------------- #


def test_a_person_has_the_three_names_and_nothing_the_server_did_not_give() -> None:
    assert person(ref(3)) == {
        "username": "person3",
        "display_name": "Person Number 3",
        "pseudonym": "ann-0003",
    }
    # What anyone but a lead gets: the pseudonym alone.
    assert person(ref(3, lead=False)) == {
        "username": None,
        "display_name": None,
        "pseudonym": "ann-0003",
    }
    # A server older than this change has no username in a reference.
    assert person({"pseudonym": "ann-0003", "display_name": "Ana"}) == {
        "username": None,
        "display_name": "Ana",
        "pseudonym": "ann-0003",
    }
    assert person(None) is None and person({}) is None
    assert person({"is_me": True}) is None


def test_people_are_listed_once_each() -> None:
    assert people([ref(2), None, ref(1), ref(2)]) == [person(ref(1)), person(ref(2))]


async def test_list_assignments_names_the_person_three_ways(
    fake: FakeApi, mcp_client: Client
) -> None:
    task = build(
        "AssignmentView",
        id=4,
        username="ana",
        display_name="Ana Weber",
        pseudonym="ann-0004",
        task="review",
    )
    fake.on("GET", f"{P}/assignments", [task])
    result = await call(mcp_client, "list_assignments", {"project": "p"})
    [found] = result["assignments"]
    assert (found["username"], found["display_name"], found["pseudonym"]) == (
        "ana",
        "Ana Weber",
        "ann-0004",
    )


# --- #471.5: 'consolidation' names the task ---------------------------------- #

WITHDRAW = f"{P}/bulk-task-actions/withdraw"
REOPEN = f"{P}/bulk-task-actions/reopen"
TEXTS = [{"case_id": "c1", "language": "en"}]


def test_consolidation_is_the_task_review_of_the_api() -> None:
    assert api_tasks(["consolidation"]) == ["review"]
    assert api_tasks(["annotate", "review", "consolidation"]) == ["annotate", "review"]
    assert api_tasks(["translation_review"]) == ["translation_review"]
    assert api_tasks(None) is None


@pytest.mark.parametrize("name", ["consolidation", "review"])
async def test_bulk_tools_take_consolidation_and_still_review(
    name: str, fake: FakeApi, mcp_client: Client
) -> None:
    preview = build("BulkTaskActionView", preview_token=PT_A)
    fake.on("POST", WITHDRAW, preview)
    fake.on("POST", REOPEN, preview)
    await call(
        mcp_client,
        "withdraw_open_tasks",
        {"project": "p", "texts": TEXTS, "tasks": [name]},
    )
    [sent] = fake.calls_to("POST", WITHDRAW)
    assert sent.json()["tasks"] == ["review"]
    await call(
        mcp_client,
        "reopen_texts",
        {"project": "p", "texts": TEXTS, "tasks": [name, "annotate"], "reason": "r"},
    )
    [sent] = fake.calls_to("POST", REOPEN)
    assert sent.json()["tasks"] == ["review", "annotate"]


async def test_the_task_argument_names_both_words(mcp_client: Client) -> None:
    tools = {tool.name: tool for tool in (await mcp_client.list_tools()).tools}
    for name in ("withdraw_open_tasks", "reopen_texts"):
        described = str(tools[name].input_schema["properties"]["tasks"])
        assert "consolidation" in described and "'review'" in described, name
    assert "consolidation" in INSTRUCTIONS and "'review'" in INSTRUCTIONS


# --- #471.5: a case ID is not a document_id ---------------------------------- #


def _document_arguments(schema: Any, found: list[dict[str, Any]]) -> None:
    """Every property named document_id or target_document_id, nested too."""
    if isinstance(schema, dict):
        for name, value in (schema.get("properties") or {}).items():
            if name in ("document_id", "target_document_id"):
                found.append(value)
        for value in schema.values():
            _document_arguments(value, found)
    elif isinstance(schema, list):
        for value in schema:
            _document_arguments(value, found)


async def test_every_document_id_argument_says_a_case_id_is_not_one(
    mcp_client: Client, content_client: Client
) -> None:
    seen = 0
    for client in (mcp_client, content_client):
        for tool in (await client.list_tools()).tools:
            found: list[dict[str, Any]] = []
            _document_arguments(tool.input_schema, found)
            for argument in found:
                seen += 1
                described = argument.get("description", "").lower()
                assert "case id is not a document_id" in described, tool.name
    assert seen > 20


def test_a_refused_document_id_hints_at_the_case_id() -> None:
    assert "case ID is not a document_id" in HINTS["DOCUMENT_NOT_FOUND"]
    assert (
        "case ID is not a document_id" in HINTS["NOT_A_TRANSLATION/not_a_translation"]
    )
    assert "A case ID is not a\ndocument_id" in INSTRUCTIONS


# --- #485.6: the diff of a translation review -------------------------------- #

MACHINE = (
    "Die Patientin wurde am Montag aufgenommen. Sie erhielt Ibuprofen. "
    "Der Verlauf war unauffaellig, die Entlassung erfolgte am Freitag. " * 30
)
PROPOSED = MACHINE.replace(
    "Sie erhielt Ibuprofen.", "Sie erhielt 5 mg Ibuprofen.", 1
).replace("am Freitag. ", "am Samstag. ", 1)


def test_changed_passages_are_the_words_that_differ() -> None:
    first, second = changed_passages(MACHINE, PROPOSED)
    assert (first["machine"], first["proposed"].strip()) == ("", "5 mg")
    assert first["before"].strip().endswith("Sie erhielt")
    assert len(first["before"]) <= 30 and first["after"].strip().startswith("Ibu")
    assert (second["machine"], second["proposed"]) == ("Freitag", "Samstag")
    assert MACHINE[second["start"] :].startswith("Freitag")
    # Applied from the end, the passages turn the one text into the other.
    text = MACHINE
    for change in (second, first):
        end = change["start"] + len(change["machine"])
        text = text[: change["start"]] + change["proposed"] + text[end:]
    assert text == PROPOSED
    assert changed_passages(MACHINE, MACHINE) == []
    # Offsets count Unicode code points, as the other content tools.
    [emoji] = changed_passages("Fieber 🙂 seit Montag", "Fieber 🙂 seit Dienstag")
    assert (emoji["start"], emoji["machine"]) == (14, "Montag")
    # Two changed words with a space between are one passage.
    [joined] = changed_passages("am ersten Tag danach", "am zweiten Morgen danach")
    assert (joined["machine"], joined["proposed"]) == ("ersten Tag", "zweiten Morgen")


def _reviews(count: int) -> list[dict[str, Any]]:
    return [
        build(
            "TranslationReviewRecord",
            id=number,
            document_id="c1-de-v1",
            decision="accepted_corrected",
            rationale="The dose was missing.",
            proposed_text=PROPOSED,
        )
        for number in range(count)
    ]


async def test_list_translation_reviews_diff_replaces_the_full_text(
    fake: FakeApi, content_client: Client
) -> None:
    fake.on("GET", f"{P}/translation-reviews", _reviews(10))
    fake.on(
        "GET",
        f"{P}/documents/{{doc}}/text",
        build("VariantText", document_id="c1-de-v1", text=MACHINE),
    )
    args = {"project": "p", "include_text": True}
    whole = await size(content_client, "list_translation_reviews", args)
    short = await size(
        content_client, "list_translation_reviews", args | {"diff": True}
    )
    assert short < whole / 2, (short, whole)
    result = await call(
        content_client, "list_translation_reviews", args | {"diff": True}
    )
    assert result["count"] == 10
    review = result["items"][0]
    assert "proposed_text" not in review
    assert review["rationale"] == "The dose was missing."
    assert review["change_count"] == 2
    assert [c["proposed"].strip() for c in review["changes"]] == ["5 mg", "Samstag"]
    # The reviewed text is read once per version, not once per review.
    texts = fake.calls_to("GET", f"{P}/documents/{{doc}}/text")
    assert len(texts) == 2  # one per call with diff
    assert "c1-de-v1" in texts[0].request.url.path


async def test_list_translation_reviews_diff_needs_include_text(
    fake: FakeApi, content_client: Client, mcp_client: Client
) -> None:
    with pytest.raises(ToolFailed, match="include_text"):
        await call(
            content_client, "list_translation_reviews", {"project": "p", "diff": True}
        )
    assert fake.calls == []
    # Without the opt-in the argument does not exist.
    tools = {tool.name: tool for tool in (await mcp_client.list_tools()).tools}
    assert "diff" not in tools["list_translation_reviews"].input_schema["properties"]
    with pytest.raises(ToolFailed, match="Unknown argument"):
        await call(
            mcp_client, "list_translation_reviews", {"project": "p", "diff": True}
        )


async def test_the_upload_note_says_who_reads_it(mcp_client: Client) -> None:
    tools = {tool.name: tool for tool in (await mcp_client.list_tools()).tools}
    note = tools["upload_translation_version"].input_schema["properties"]["note"]
    assert "translation reviewer" in note["description"]
    assert "lead's row" in note["description"]
