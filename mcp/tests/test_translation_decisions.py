"""The lead's decision on a queried translation, and a version uploaded
without retyping the text (issue 485, points 3 and 4).

Dry runs count the changes; the changed passages come back only with
``ONTOTATOR_MCP_READ_CONTENT=1``. A confirm sends exactly what the dry run
showed. All texts are invented.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from fake_api import FakeApi, refusal
from mcp import Client
from shapes import build

from ontotator_mcp.config import Settings
from ontotator_mcp.errors import HINTS
from ontotator_mcp.models import Replacement
from ontotator_mcp.server import build_server
from ontotator_mcp.tools_translation_decisions import (
    apply_replacements,
    changed_passages,
)

pytestmark = pytest.mark.anyio

P = "/api/v1/projects/{key}"
DECISION = f"{P}/documents/{{doc}}/query-decision"
VERSIONS = f"{P}/variants/{{document_id}}/versions"
REVIEWS = f"{P}/documents/{{doc}}/translation-reviews"
CURRENT = "The child has hypotonia. Seizures since birth."
PROPOSED = "The child has muscular hypotonia. Seizures since birth."
QUESTION = "The source says muscular hypotonia. Is the short form meant?"
SHA = "b" * 64


@pytest.fixture
async def content_client(fake: FakeApi, settings: Settings) -> AsyncIterator[Client]:
    """A server started with ONTOTATOR_MCP_READ_CONTENT=1."""
    server = build_server(
        replace(settings, read_content=True), transport=httpx.MockTransport(fake)
    )
    async with Client(server) as client:
        yield client


def _preview(**fields: Any) -> dict[str, Any]:
    review = build(
        "QueriedReviewView",
        id=41,
        assignment_id=7,
        document_id="d",
        version=1,
        rationale=QUESTION,
        categories=["terminology"],
        proposed_text=PROPOSED,
    )
    return build(
        "QueryDecisionPreview",
        document_id="d",
        case_id="c",
        language="de",
        version=1,
        next_version=2,
        translation_status="reviewed",
        text_sha256=SHA,
        text=CURRENT,
        available=True,
        reason=None,
        review=review,
        proposes_changes=True,
    ) | dict(fields)


def _result(kind: str) -> dict[str, Any]:
    return build("QueryDecisionResult", kind=kind, document_id="d2", version=2)


ARGS: dict[str, Any] = {"project": "p", "document_id": "d"}


def test_changed_passages_are_whole_words_with_their_place() -> None:
    [passage] = changed_passages(CURRENT, PROPOSED)
    assert passage["old_text"] == "" and passage["new_text"] == " muscular"
    assert CURRENT[passage["old_start"] : passage["old_end"]] == ""
    assert PROPOSED[passage["new_start"] : passage["new_end"]] == " muscular"
    assert passage["before"] == "The child has"
    assert passage["after"].startswith(" hypotonia.")
    # Neighbouring changed words are one passage; equal texts have none.
    [both] = changed_passages("pulse was regular", "heart rate is regular")
    assert (both["old_text"], both["new_text"]) == ("pulse was", "heart rate is")
    assert changed_passages(CURRENT, CURRENT) == []


def test_a_replacement_must_match_exactly_once() -> None:
    def fix(old: str, new: str) -> Replacement:
        return Replacement(old=old, new=new)

    text = "No fever. No rash. Pulse 80."
    done = apply_replacements(text, [fix("Pulse 80", "Pulse 88")], "the text")
    assert done == "No fever. No rash. Pulse 88."
    for fixes, message in (
        ([fix("Pulse 80", "x"), fix("cough", "x")], "Replacement 2 .*'cough'.*not occ"),
        ([fix("No", "Without")], "Replacement 1 .*'No'.*more than once"),
        ([fix("No fever", "x"), fix("fever. No rash", "y")], "overlaps replacement 1"),
    ):
        with pytest.raises(Exception, match=message):
            apply_replacements(text, fixes, "the text")


async def test_the_dry_run_of_a_decision_counts_the_changes_without_the_text(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", DECISION, _preview())
    dry = await call(
        mcp_client, "decide_translation_query", ARGS | {"decision": "reviewer_text"}
    )
    assert dry["applied"] is False
    plan = dry["plan"]
    assert plan["available"] is True and plan["decision"] == "reviewer_text"
    assert plan["would"] == "Save the text as version 2, a correction of d, accepted."
    change = plan["change"]
    assert change["passages_changed"] == 1
    assert (change["inserted_characters"], change["deleted_characters"]) == (9, 0)
    assert change["text_characters"] == len(PROPOSED)
    assert change["previous_text_characters"] == len(CURRENT)
    assert change["edited_by_replacements"] is False
    # No text of the version, the review or the question; the note says why.
    assert "diff" not in change and "ONTOTATOR_MCP_READ_CONTENT" in change["diff_note"]
    assert plan["review"]["id"] == 41 and plan["review"]["categories"]
    whole = str(dry)
    for content in ("hypotonia", "muscular", "short form"):
        assert content not in whole
    assert dry["preview_token"].startswith("sha256:")
    assert not fake.calls_to("POST", DECISION)


async def test_with_the_content_opt_in_the_dry_run_returns_the_diff_and_the_question(
    fake: FakeApi, content_client: Client
) -> None:
    fake.on("GET", DECISION, _preview())
    dry = await call(
        content_client,
        "decide_translation_query",
        ARGS
        | {
            "decision": "reviewer_text",
            "replacements": [{"old": "since birth", "new": "from birth"}],
        },
    )
    change = dry["plan"]["change"]
    assert change["edited_by_replacements"] is True
    assert [(p["old_text"], p["new_text"].strip()) for p in change["diff"]] == [
        ("", "muscular"),
        ("since", "from"),
    ]
    assert dry["plan"]["review"]["question"] == QUESTION
    # The whole texts stay on the server.
    assert CURRENT not in str(dry) and PROPOSED not in str(dry)
    assert "proposed_text" not in dry["plan"]["review"] and "text" not in dry["plan"]


async def test_the_reviewers_text_is_taken_with_the_dry_runs_token(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", DECISION, _preview())
    fake.on("POST", DECISION, _result("reviewer_text"))
    args = ARGS | {
        "decision": "reviewer_text",
        "answer": " Yes, the long form. ",
        "replacements": [{"old": "since birth", "new": "from birth"}],
    }
    dry = await call(mcp_client, "decide_translation_query", args)
    with pytest.raises(ToolFailed, match="pass its preview_token"):
        await call(mcp_client, "decide_translation_query", args | {"confirm": True})
    with pytest.raises(ToolFailed, match="cut or mistyped"):
        await call(
            mcp_client,
            "decide_translation_query",
            args | {"confirm": True, "preview_token": dry["preview_token"][:-3]},
        )
    assert not fake.calls_to("POST", DECISION)
    done = await call(
        mcp_client,
        "decide_translation_query",
        args | {"confirm": True, "preview_token": dry["preview_token"]},
    )
    assert done["applied"] is True and done["result"]["version"] == 2
    assert done["selection"] == "project 'p', document_id 'd'"
    [sent] = fake.calls_to("POST", DECISION)
    assert sent.json() == {
        "kind": "reviewer_text",
        "expected_text_sha256": SHA,
        "expected_review_id": 41,
        "text": "The child has muscular hypotonia. Seizures from birth.",
        "answer": "Yes, the long form.",
    }


async def test_the_version_is_accepted_as_it_is_with_an_answer(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", DECISION, _preview())
    fake.on("POST", DECISION, _result("unchanged"))
    args = ARGS | {"decision": "unchanged"}
    with pytest.raises(ToolFailed, match="needs an answer"):
        await call(mcp_client, "decide_translation_query", args)
    with pytest.raises(ToolFailed, match="'reviewer_text' only"):
        await call(
            mcp_client,
            "decide_translation_query",
            args | {"answer": "x", "replacements": [{"old": "a", "new": "b"}]},
        )
    assert not fake.calls
    args["answer"] = "The short form is meant."
    dry = await call(mcp_client, "decide_translation_query", args)
    assert dry["plan"]["would"] == "Accept d as it is."
    assert dry["plan"]["reviewer_text_not_taken"]["passages_changed"] == 1
    assert "change" not in dry["plan"]
    done = await call(
        mcp_client,
        "decide_translation_query",
        args | {"confirm": True, "preview_token": dry["preview_token"]},
    )
    assert done["applied"] is True
    [sent] = fake.calls_to("POST", DECISION)
    assert sent.json() == {
        "kind": "unchanged",
        "expected_text_sha256": SHA,
        "expected_review_id": 41,
        "answer": "The short form is meant.",
    }


async def test_a_confirm_that_differs_from_the_dry_run_changes_nothing(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", DECISION, _preview())
    fake.on("POST", DECISION, refusal(409, "VARIANT_REVIEW_STALE", None))
    args = ARGS | {"decision": "reviewer_text"}
    dry = await call(mcp_client, "decide_translation_query", args)
    token = dry["preview_token"]
    confirm = {"confirm": True, "preview_token": token}
    # Another argument than the dry run had.
    for other in (
        {"answer": "Not shown before"},
        {"replacements": [{"old": "child", "new": "boy"}]},
    ):
        again = await call(
            mcp_client, "decide_translation_query", args | other | confirm
        )
        assert again["applied"] is False and "nothing was changed" in again["note"]
        assert again["preview_token"] != token
    assert not fake.calls_to("POST", DECISION)
    # The server names the text or the review as stale: a new dry run.
    late = await call(mcp_client, "decide_translation_query", args | confirm)
    assert late["applied"] is False and late["preview_token"] == token
    assert len(fake.calls_to("POST", DECISION)) == 1
    # A new text or review since the dry run is seen before anything is sent.
    fake.on("GET", DECISION, _preview(text_sha256="c" * 64))
    moved = await call(mcp_client, "decide_translation_query", args | confirm)
    assert moved["applied"] is False and moved["preview_token"] != token
    assert len(fake.calls_to("POST", DECISION)) == 1


@pytest.mark.parametrize(
    ("reason", "advice"),
    [
        ("already_decided", "decided once"),
        ("not_a_query", "start_lead_correction"),
        ("review_open", "withdraw_task"),
        ("not_newest", "names the newest"),
        ("discarded", "was discarded"),
    ],
)
async def test_a_query_that_cannot_be_decided_says_why_and_what_to_do(
    fake: FakeApi, mcp_client: Client, reason: str, advice: str
) -> None:
    review = None if reason == "not_a_query" else _preview()["review"]
    fake.on("GET", DECISION, _preview(available=False, reason=reason, review=review))
    args = ARGS | {"decision": "unchanged", "answer": "As it is."}
    dry = await call(mcp_client, "decide_translation_query", args)
    assert dry["applied"] is False and dry["preview_token"] is None
    assert dry["plan"]["reason"] == reason and advice in dry["plan"]["hint"]
    refused = await call(
        mcp_client,
        "decide_translation_query",
        args | {"confirm": True, "preview_token": "sha256:" + "a" * 64},
    )
    assert refused["applied"] is False and refused["preview_token"] is None
    assert f"cannot be decided ({reason})" in refused["note"]
    assert advice in refused["note"]
    assert not fake.calls_to("POST", DECISION)


async def test_a_reviewers_text_equal_to_the_version_is_not_a_new_version(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", DECISION, _preview())
    dry = await call(
        mcp_client,
        "decide_translation_query",
        ARGS
        | {
            "decision": "reviewer_text",
            "replacements": [{"old": "muscular ", "new": ""}],
        },
    )
    assert dry["plan"]["available"] is False and dry["plan"]["reason"] == "unchanged"
    assert "decision 'unchanged'" in dry["plan"]["hint"]
    assert dry["preview_token"] is None


async def test_a_replacement_that_does_not_fit_is_named(
    fake: FakeApi, mcp_client: Client
) -> None:
    fake.on("GET", DECISION, _preview())
    with pytest.raises(ToolFailed, match=r"Replacement 1 \(old 'adult'\).*reviewer"):
        await call(
            mcp_client,
            "decide_translation_query",
            ARGS
            | {
                "decision": "reviewer_text",
                "replacements": [{"old": "adult", "new": "child"}],
            },
        )


async def test_the_servers_refusals_have_a_sentence_per_reason(
    fake: FakeApi, mcp_client: Client
) -> None:
    reasons = (
        "already_decided",
        "not_a_query",
        "review_open",
        "not_newest",
        "discarded",
        "unchanged",
        "answer_required",
    )
    assert {f"QUERY_DECISION_NOT_AVAILABLE/{reason}" for reason in reasons} <= set(
        HINTS
    )
    fake.on("GET", DECISION, _preview())
    fake.on(
        "POST",
        DECISION,
        refusal(409, "QUERY_DECISION_NOT_AVAILABLE", {"reason": "already_decided"}),
    )
    args = ARGS | {"decision": "reviewer_text"}
    dry = await call(mcp_client, "decide_translation_query", args)
    with pytest.raises(ToolFailed, match="already decided this query"):
        await call(
            mcp_client,
            "decide_translation_query",
            args | {"confirm": True, "preview_token": dry["preview_token"]},
        )
    # A code without a sentence of its own for the reason keeps the general one.
    fake.on(
        "POST",
        DECISION,
        refusal(409, "QUERY_DECISION_NOT_AVAILABLE", {"reason": "new_reason"}),
    )
    with pytest.raises(ToolFailed, match="names the reason"):
        await call(
            mcp_client,
            "decide_translation_query",
            args | {"confirm": True, "preview_token": dry["preview_token"]},
        )
    assert "preview_token" in HINTS["VARIANT_REVIEW_STALE"]


def _upload_preview(text: str) -> dict[str, Any]:
    return build(
        "VersionUploadPreview",
        document_id="d",
        version=1,
        next_version=2,
        available=True,
        reason=None,
        text_sha256=SHA,
        text=text,
        previous_text=CURRENT,
        unchanged=False,
    )


UPLOAD: dict[str, Any] = ARGS | {"method": "manual_correction"}


async def test_the_dry_run_of_an_upload_counts_the_changes_and_gates_the_diff(
    fake: FakeApi, mcp_client: Client, content_client: Client
) -> None:
    fake.on("POST", f"{VERSIONS}/preview", _upload_preview(PROPOSED))
    args = UPLOAD | {"text": PROPOSED}
    dry = await call(mcp_client, "upload_translation_version", args)
    plan = dry["plan"]
    assert plan["passages_changed"] == 1 and plan["inserted_characters"] == 9
    assert "diff" not in plan and "ONTOTATOR_MCP_READ_CONTENT" in plan["diff_note"]
    assert "hypotonia" not in str(dry)
    opted_in = await call(content_client, "upload_translation_version", args)
    [passage] = opted_in["plan"]["diff"]
    assert passage["new_text"] == " muscular" and passage["old_text"] == ""
    assert "diff_note" not in opted_in["plan"]
    assert "text" not in opted_in["plan"] and "previous_text" not in opted_in["plan"]


async def test_an_upload_starts_from_a_reviews_proposed_text(
    fake: FakeApi, mcp_client: Client
) -> None:
    review = build("TranslationReviewRecord", id=41, proposed_text=PROPOSED)
    other = build("TranslationReviewRecord", id=40, proposed_text="Another text.")
    fake.on("GET", REVIEWS, [other, review])
    final = "The child has muscular hypotonia. Seizures from birth."
    fake.on("POST", f"{VERSIONS}/preview", _upload_preview(final))
    fake.on("POST", VERSIONS, build("VersionUploadResult"))
    args = UPLOAD | {
        "from_review_id": 41,
        "replacements": [{"old": "since birth", "new": "from birth"}],
    }
    dry = await call(mcp_client, "upload_translation_version", args)
    assert dry["plan"]["passages_changed"] == 2
    [checked] = fake.calls_to("POST", f"{VERSIONS}/preview")
    assert checked.json() == {"text": final}
    done = await call(
        mcp_client,
        "upload_translation_version",
        args | {"confirm": True, "expected_previous_sha256": SHA},
    )
    assert done["applied"] is True
    [sent] = fake.calls_to("POST", VERSIONS)
    assert sent.json() == {
        "text": final,
        "expected_text_sha256": SHA,
        "method": "manual_correction",
    }


async def test_an_upload_refuses_a_wrong_start(
    fake: FakeApi, mcp_client: Client
) -> None:
    review = build("TranslationReviewRecord", id=41, proposed_text=PROPOSED)
    fake.on("GET", REVIEWS, [review])
    for wrong, message in (
        ({}, "either text or from_review_id"),
        ({"text": "x", "from_review_id": 41}, "either text or from_review_id"),
        (
            {"text": "x", "replacements": [{"old": "a", "new": "b"}]},
            "with from_review_id",
        ),
        ({"from_review_id": 9}, "no submitted translation review 9"),
        (
            {
                "from_review_id": 41,
                "replacements": [
                    {"old": "since birth", "new": "from birth"},
                    {"old": "has", "new": "had"},
                    {"old": "the", "new": "a"},
                ],
            },
            r"Replacement 3 \(old 'the'\) does not occur",
        ),
        (
            {"from_review_id": 41, "replacements": [{"old": "i", "new": "y"}]},
            r"Replacement 1 \(old 'i'\) occurs more than once",
        ),
    ):
        with pytest.raises(ToolFailed, match=message):
            await call(mcp_client, "upload_translation_version", UPLOAD | wrong)
    assert not fake.calls_to("POST", f"{VERSIONS}/preview")
    assert not fake.calls_to("POST", VERSIONS)
