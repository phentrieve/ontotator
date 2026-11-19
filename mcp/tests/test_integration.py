"""End to end against the real Ontotator app (``tests/live_server.py``).

Needs ``ONTOTATOR_TEST_PG_URL`` (a throwaway PostgreSQL superuser URL) and
``uv``; the app runs in the main project's environment as a subprocess, so
the MCP package never imports Ontotator. Skipped otherwise.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import ToolFailed, call
from mcp import Client

from ontotator_mcp.config import Settings
from ontotator_mcp.server import build_server
from ontotator_mcp.tooling import TOOL_SCOPES

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "tests" / "fixtures"
PROJECT = "mcp-smoke"
START_TIMEOUT = 600.0

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not os.environ.get("ONTOTATOR_TEST_PG_URL") or shutil.which("uv") is None,
        reason="needs ONTOTATOR_TEST_PG_URL and uv",
    ),
]


def _first_line(process: subprocess.Popen[str], timeout: float) -> str:
    found: list[str] = []
    reader = threading.Thread(
        target=lambda: found.append(
            process.stdout.readline() if process.stdout else ""
        ),
        daemon=True,
    )
    reader.start()
    reader.join(timeout)
    if not found or not found[0]:
        raise RuntimeError("The Ontotator test server did not start.")
    return found[0]


@pytest.fixture(scope="module")
def live() -> Iterator[dict[str, str]]:
    env = {
        **os.environ,
        # A worker name of our own: the harness creates and drops only
        # databases named after it, never another run's.
        "PYTEST_XDIST_WORKER": f"mcp{os.getpid()}",
    }
    env.pop("VIRTUAL_ENV", None)
    process = subprocess.Popen(
        [
            "uv",
            "run",
            "--project",
            str(REPO),
            "--locked",
            "python",
            str(Path(__file__).with_name("live_server.py")),
        ],
        cwd=REPO,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        info: dict[str, str] = json.loads(_first_line(process, START_TIMEOUT))
        deadline = time.monotonic() + 60
        while True:
            try:
                httpx.get(f"{info['url']}/api/v1/about", timeout=2)
                break
            except httpx.TransportError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.2)
        yield info
    finally:
        # Closing stdin stops the server, which then drops its databases.
        if process.stdin:
            process.stdin.close()
        try:
            process.wait(timeout=60)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=30)


def _server(
    info: dict[str, str], token: str, *files_dirs: Path, read_content: bool = False
) -> Any:
    settings = Settings(
        url=info["url"],
        token=token,
        poll_interval=0.2,
        files_dirs=tuple(folder.resolve() for folder in files_dirs),
        read_content=read_content,
    )
    return build_server(settings)


def _scenario(info: dict[str, str], name: str) -> dict[str, Any]:
    """A fresh scenario project of the browser tests and its lead's token."""
    made = httpx.post(
        f"{info['url']}/__test_scenario__", params={"name": name}, timeout=300
    )
    made.raise_for_status()
    built: dict[str, Any] = made.json()
    return built


def _whole(result: Any) -> str:
    """Everything a client receives of a tool result, as one string."""
    text = "".join(getattr(part, "text", "") for part in result.content)
    return text + json.dumps(result.structured_content, ensure_ascii=False)


@pytest.mark.anyio
async def test_setup_import_status_and_export(
    live: dict[str, str], tmp_path: Path
) -> None:
    files = (FIXTURES, tmp_path)
    async with Client(_server(live, live["admin_token"], *files)) as client:
        me = await call(client, "whoami", {})
        assert me["user"]["username"] == "root"
        assert me["token"]["kind"] == "system"
        assert me["token"]["expires_in_days"] <= 1
        assert "warning" in me["token"]
        # The MCP server is the release the app is (#486): no warning.
        assert me["server"]["version"] == me["mcp_server"]["version"]
        assert "warning" not in me

        uploads = await call(
            client, "upload_ontology_files", {"paths": [str(FIXTURES / "hp.json")]}
        )
        assert uploads["local_files"] == [str((FIXTURES / "hp.json").resolve())]
        [uploaded] = uploads["files"]
        sha = uploaded["ontology"]["sha256"]
        assert uploaded["status"] == "added"

        created = await call(
            client,
            "create_project",
            {
                "key": PROJECT,
                "name": "MCP smoke",
                "languages": ["en"],
                "pins": [{"ontology_id": "hp", "sha256": sha}],
                "profile_path": str(FIXTURES / "smoke-profile.json"),
            },
        )
        assert created["name"] == "MCP smoke"
        assert PROJECT in {
            p["project_key"] for p in await call(client, "list_projects", {})
        }

        check = await call(
            client,
            "upload_texts",
            {
                "project": PROJECT,
                "paths": [str(FIXTURES / "smoke-bundle.zip")],
                "format": "ontospan",
            },
        )
        assert check["committable"], check
        committed = await call(
            client,
            "commit_upload",
            {"project": PROJECT, "upload_id": check["upload_id"]},
        )
        assert committed["job"]["status"] == "succeeded", committed

        texts = await call(client, "list_texts", {"project": PROJECT})
        assert sorted(t["case_id"] for t in texts["texts"]) == [
            "smoke-001",
            "smoke-002",
        ]

        await call(
            client,
            "set_member_roles",
            {"project": PROJECT, "username": "ann1", "roles": ["annotator"]},
        )
        people = await call(client, "list_people", {"project": PROJECT})
        assert "ann1" in {p["username"] for p in people}

        # Taking a role away is a dry run until confirmed.
        remove = {"project": PROJECT, "username": "ann1", "roles": []}
        dry = await call(client, "set_member_roles", remove)
        assert dry["applied"] is False
        assert dry["plan"]["removed_roles"] == ["annotator"]
        people = await call(client, "list_people", {"project": PROJECT})
        assert "ann1" in {p["username"] for p in people}
        done = await call(client, "set_member_roles", remove | {"confirm": True})
        assert done["applied"] is True
        people = await call(client, "list_people", {"project": PROJECT})
        assert "ann1" not in {p["username"] for p in people}
        await call(
            client,
            "set_member_roles",
            {"project": PROJECT, "username": "ann1", "roles": ["annotator"]},
        )

        overview = await call(client, "project_overview", {"project": PROJECT})
        assert overview["name"] == "MCP smoke"
        # Issue 457: the server's maximum of annotations per text; none here.
        assert overview["annotations_per_text_max"] is None

        # A cohort joins: accounts, codes in a private file, roles and work.
        codes = tmp_path / "codes.csv"
        joined = await call(
            client,
            "create_users",
            {
                "users": [
                    {"username": "cohort1", "display_name": "Cohort One"},
                    {"username": "ann2", "display_name": "Ann Two"},
                ],
                "project": PROJECT,
                "codes_path": str(codes),
            },
        )
        assert joined["existing"] == ["ann2"]
        assert [u["username"] for u in joined["created"]] == ["cohort1"]
        assert "cohort1" in codes.read_text(encoding="utf-8")
        assert "code" not in json.dumps(joined["codes"][0]).replace("codes", "")
        await call(
            client,
            "set_member_roles",
            {"project": PROJECT, "username": "ann2", "roles": ["annotator"]},
        )
        documents = [t["document_id"] for t in texts["texts"]]
        assigned = await call(
            client,
            "assign_texts",
            {
                "project": PROJECT,
                "assignments": [
                    {"document_id": d, "username": "cohort1"} for d in documents
                ],
                "confirm_language": True,
            },
        )
        assert len(assigned["created"]) == 2, assigned

        # cohort1 leaves: the open tasks go to ann2, then the account closes.
        handover = {
            "project": PROJECT,
            "from_username": "cohort1",
            "to_usernames": ["ann2"],
        }
        dry = await call(client, "hand_over_open_tasks", handover)
        assert dry["plan"]["move_count"] == 2
        moved = await call(client, "hand_over_open_tasks", handover | {"confirm": True})
        assert moved["reassigned_count"] == 2, moved
        tasks = await call(
            client, "list_assignments", {"project": PROJECT, "username": "ann2"}
        )
        assert sorted(t["document_id"] for t in tasks["assignments"]) == sorted(
            documents
        )
        closed = await call(
            client, "update_user", {"username": "cohort1", "active": False}
        )
        assert closed["active"] is False

        # Submissions come only from annotators in the browser.
        with pytest.raises(ToolFailed, match="EXPORT_EMPTY"):
            await call(
                client, "start_export", {"project": PROJECT, "kind": "annotations"}
            )

        for kind in ("edit_log", "translation_reviews"):
            job = await call(client, "start_export", {"project": PROJECT, "kind": kind})
            assert job["status"] == "succeeded", job
            target = tmp_path / f"{kind}.jsonl"
            downloaded = await call(
                client, "download_export", {"job_id": job["id"], "path": str(target)}
            )
            assert downloaded["bytes"] == target.stat().st_size
            assert downloaded["kind"] == kind

        # The exports above are in the project's job list and its audit.
        jobs = await call(
            client, "list_jobs", {"project": PROJECT, "status": ["succeeded"]}
        )
        exports = [job for job in jobs["jobs"] if job["kind"].endswith("_export")]
        kinds = {job["kind"] for job in exports}
        assert {"edit_log_export", "translation_review_export"} <= kinds
        assert all(job["download_path"] for job in exports)
        audit = await call(
            client, "project_audit", {"project": PROJECT, "action": ["project.*"]}
        )
        assert "project.edit_log_export" in {e["action"] for e in audit["events"]}

        check = await call(client, "final_export_check", {"project": PROJECT})
        assert check["final_results"] == 0
        with pytest.raises(ToolFailed, match="EXPORT_EMPTY"):
            await call(
                client,
                "start_export",
                {
                    "project": PROJECT,
                    "kind": "final",
                    "acknowledge_warnings": True,
                    "accept_omissions": True,
                },
            )

        settings = await client.read_resource(
            f"ontotator://projects/{PROJECT}/settings"
        )
        assert '"MCP smoke"' in settings.contents[0].text

    async with Client(_server(live, live["read_token"])) as reader:
        assert await call(reader, "get_project_settings", {"project": PROJECT})
        with pytest.raises(ToolFailed, match="TOKEN_SCOPE_MISSING") as refused:
            await call(reader, "start_export", {"project": PROJECT, "kind": "edit_log"})
        assert "'export' scope" in str(refused.value)
        assert live["read_token"] not in str(refused.value)
        # Without ONTOTATOR_MCP_READ_CONTENT the content tools do not exist.
        with pytest.raises(ToolFailed, match="Unknown tool"):
            await call(
                reader,
                "get_text_version",
                {"project": PROJECT, "document_id": documents[0]},
            )

    # With it, a read token reads a text version; the text only on request (#442).
    content = _server(live, live["read_token"], read_content=True)
    async with Client(content) as reader:
        about = {"project": PROJECT, "document_id": documents[0]}
        version = await call(reader, "get_text_version", about)
        assert version["document_id"] == documents[0]
        assert (version["language"], version["version"]) == ("en", 1)
        assert "text" not in version
        full = await call(reader, "get_text_version", about | {"include_text": True})
        assert full["text"].strip()
        assert full["text_sha256"] == version["text_sha256"]
        # Nothing is submitted (that needs the browser): only the imported
        # tool proposals are offered. Their passages are offsets; with
        # include_text each carries the text it marks.
        [offered] = await call(reader, "list_annotation_versions", about)
        assert offered["kind"] == "proposals"
        one = about | {"kind": "proposals", "version_id": offered["id"]}
        plain = await call(reader, "get_annotation_version", one)
        assert plain["annotations"]
        assert full["text"] not in json.dumps(plain)
        spans = [
            segment
            for evidence in plain["evidence"]
            for segment in evidence["mention"]["segments"]
        ]
        assert spans and all(set(segment) == {"start", "end"} for segment in spans)
        marked = await call(
            reader, "get_annotation_version", one | {"include_text": True}
        )
        for evidence in marked["evidence"]:
            for segment in evidence["mention"]["segments"]:
                expected = full["text"][segment["start"] : segment["end"]]
                assert segment["text"] == expected != ""
        # An unknown id is refused, an open task's work included.
        for tool, extra in (
            ("get_submission", {"submission_id": "sub-unknown"}),
            ("get_annotation_version", {"kind": "own", "version_id": "sub-unknown"}),
        ):
            with pytest.raises(ToolFailed, match="VERSION_NOT_FOUND"):
                await call(reader, tool, about | extra)


# Read tools that name something other than a project or one of its texts.
OTHER_ARGUMENTS: dict[str, dict[str, Any]] = {
    "find_people": {"query": "ann"},
    "annotation_target_preview": {"annotations_per_text": 1},
    "get_upload": {"upload_id": 1},
    "get_job": {"job_id": 1},
    "get_problem_report": {"report_id": "none"},
}
# Refused for a lead's personal token or for an ID nothing has; every other
# read tool must answer.
MAY_REFUSE = {
    "list_users",
    "list_ontology_files",
    "get_upload",
    "get_job",
    "get_problem_report",
}


def _needles(text: str) -> list[str]:
    """The sentences of a text, and its first words."""
    sentences = [part.strip() for part in re.split(r"[.]", text)]
    return [text[:30]] + [part for part in sentences if len(part) > 12]


@pytest.mark.anyio
async def test_no_default_tool_returns_text_of_a_project(
    live: dict[str, str],
) -> None:
    """A known sentence and the annotated passages of a project are in no
    answer of a server started without ONTOTATOR_MCP_READ_CONTENT (review
    finding F2). Two projects: two submitted annotations with findings, and
    a translation with submitted translation reviews."""
    annotated = _scenario(live, "consolidation")
    reviewed = _scenario(live, "S3")
    for made in (annotated, reviewed):
        project = made["project"]
        # What must not come back, read with the opt-in: the text of every
        # version, each annotated passage, each reviewer's text.
        needles: list[str] = []
        opted_in = _server(live, made["token"], read_content=True)
        async with Client(opted_in) as content:
            listed = await call(content, "list_texts", {"project": project})
            rows = listed["texts"]
            documents = sorted(
                {row["document_id"] for row in rows}
                | set((made.get("documents") or {}).values())
            )
            for document_id in documents:
                about = {"project": project, "document_id": document_id}
                version = await call(
                    content, "get_text_version", about | {"include_text": True}
                )
                needles += _needles(version["text"])
                for offered in await call(content, "list_annotation_versions", about):
                    found = await call(
                        content,
                        "get_annotation_version",
                        about
                        | {
                            "kind": offered["kind"],
                            "version_id": offered["id"],
                            "include_text": True,
                        },
                    )
                    needles += [
                        segment["text"]
                        for evidence in found["evidence"]
                        for segment in evidence["mention"]["segments"]
                        if " " in segment["text"]
                    ]
            reviews = await call(
                content,
                "list_translation_reviews",
                {"project": project, "include_text": True},
            )
            needles += [n for r in reviews for n in _needles(r["proposed_text"])]
        needles = sorted(set(needles))
        assert len(needles) >= 3, needles
        if made is annotated:
            assert "muscular hypotonia" in needles
        else:
            assert reviews and "Erste Korrektur" in needles

        default = _server(live, made["token"])
        leaks: list[tuple[str, dict[str, Any], list[str]]] = []
        refused: set[str] = set()
        async with Client(default) as client:
            tools = (await client.list_tools()).tools
            calls: list[tuple[str, dict[str, Any]]] = []
            for tool in tools:
                properties = tool.input_schema.get("properties", {})
                assert "include_text" not in properties, tool.name
                if TOOL_SCOPES[tool.name].effect != "read":
                    continue
                arguments = dict(OTHER_ARGUMENTS.get(tool.name, {}))
                if "project" in properties:
                    arguments["project"] = project
                if "document_id" not in properties:
                    calls.append((tool.name, arguments))
                    continue
                # Per text version; where the text is optional, also without.
                if "document_id" not in tool.input_schema.get("required", []):
                    calls.append((tool.name, arguments))
                calls += [
                    (tool.name, arguments | {"document_id": document_id})
                    for document_id in documents
                ]
            # Dry runs of write tools read state too.
            first = rows[0]
            text = {"case_id": first["case_id"], "language": first["language"]}
            calls += [
                ("set_final_result", {"project": project} | text),
                ("accept_agreeing_texts", {"project": project}),
                ("change_final_results", {"project": project, "texts": [text]}),
                (
                    "reopen_texts",
                    {"project": project, "texts": [text], "reason": "Check"},
                ),
                ("withdraw_open_tasks", {"project": project, "texts": [text]}),
            ]
            for name, arguments in calls:
                result = await client.call_tool(name, arguments)
                # A dry run may be refused (nothing to choose from); a read
                # tool may not, or the check would pass on refusals.
                if result.is_error and TOOL_SCOPES[name].effect == "read":
                    refused.add(name)
                answer = _whole(result)
                found = [needle for needle in needles if needle in answer]
                if found:
                    leaks.append((name, arguments, found))
            settings = await client.read_resource(
                f"ontotator://projects/{project}/settings"
            )
            answer = str(settings.contents)
            assert not [needle for needle in needles if needle in answer]
        assert leaks == []
        assert refused <= MAY_REFUSE, refused


async def _statuses(client: Client, project: str) -> dict[int, str]:
    """Status of every task of the project that is not withdrawn, by its ID."""
    listed = await call(client, "list_assignments", {"project": project, "limit": 500})
    return {item["id"]: item["status"] for item in listed["assignments"]}


@pytest.mark.anyio
async def test_a_bulk_reopen_and_a_withdrawal_can_be_undone(
    live: dict[str, str],
) -> None:
    """reopen_texts and withdraw_open_tasks hand on the server's ``undo``,
    and undo_reopen_or_withdraw takes it (review finding F1)."""
    made = _scenario(live, "S336")
    project = made["project"]
    async with Client(_server(live, made["token"])) as client:
        before = await _statuses(client, project)
        # EN100022 and EN100023: three submitted annotations.
        reopen = {
            "project": project,
            "texts": made["rows"][:2],
            "reason": "Guideline 2.3 changed",
        }
        dry = await call(client, "reopen_texts", reopen)
        assert dry["change_count"] == 3 and "undo" not in dry
        done = await call(
            client,
            "reopen_texts",
            reopen | {"confirm": True, "preview_token": dry["preview_token"]},
        )
        assert done["applied"] is True
        undo_id = done["undo"]["id"]
        assert done["undo"]["expires_at"]
        changed = [item["assignment_id"] for item in done["changed"]]
        reopened = await _statuses(client, project)
        assert [reopened[i] for i in changed] == ["reopened"] * 3

        undo = {"project": project, "undo_id": undo_id}
        would = await call(client, "undo_reopen_or_withdraw", undo)
        assert would["applied"] is False and would["blocked"] is None
        assert would["action"] == "reopen" and would["task_count"] == 3
        assert sorted(t["assignment_id"] for t in would["would_restore"]) == sorted(
            changed
        )
        assert {t["person"] for t in would["would_restore"]} == {"Tom Reis", "R. Roe"}
        # The dry run changed nothing.
        assert await _statuses(client, project) == reopened
        undone = await call(client, "undo_reopen_or_withdraw", undo | {"confirm": True})
        assert undone["applied"] is True
        assert {t["status"] for t in undone["restored"]} == {"submitted"}
        assert await _statuses(client, project) == before
        with pytest.raises(ToolFailed, match="BULK_UNDO_STALE/already_undone"):
            await call(client, "undo_reopen_or_withdraw", undo | {"confirm": True})

        # R. Roe's two tasks that are not started (EN100024, EN100029).
        withdraw = {
            "project": project,
            "texts": [made["rows"][2], made["rows"][7]],
        }
        dry = await call(client, "withdraw_open_tasks", withdraw)
        assert dry["change_count"] == 2
        gone = await call(
            client,
            "withdraw_open_tasks",
            withdraw | {"confirm": True, "preview_token": dry["preview_token"]},
        )
        withdrawn = {item["assignment_id"] for item in gone["changed"]}
        assert not withdrawn & set(await _statuses(client, project))
        back = await call(
            client,
            "undo_reopen_or_withdraw",
            {"project": project, "undo_id": gone["undo"]["id"], "confirm": True},
        )
        assert back["applied"] is True and back["action"] == "withdraw"
        assert await _statuses(client, project) == before

        # Withdrawn again; then one of the texts gets another task: the undo
        # is blocked, says why and changes nothing.
        dry = await call(client, "withdraw_open_tasks", withdraw)
        gone = await call(
            client,
            "withdraw_open_tasks",
            withdraw | {"confirm": True, "preview_token": dry["preview_token"]},
        )
        await call(
            client,
            "assign_texts",
            {
                "project": project,
                "assignments": [
                    {
                        "document_id": made["documents"]["EN100029"],
                        "username": made["users"]["roe"],
                    }
                ],
                "confirm_language": True,
            },
        )
        state = await _statuses(client, project)
        blocked = {"project": project, "undo_id": gone["undo"]["id"]}
        would = await call(client, "undo_reopen_or_withdraw", blocked)
        assert would["blocked"]["reason"] == "changed"
        refused = await call(
            client, "undo_reopen_or_withdraw", blocked | {"confirm": True}
        )
        assert refused["applied"] is False and refused["refused"] is True
        assert await _statuses(client, project) == state

        # A new round has no undo.
        rounds = {
            "project": project,
            "texts": made["rows"][:1],
            "kind": "carry_forward",
        }
        dry = await call(client, "start_rounds", rounds)
        started = await call(
            client,
            "start_rounds",
            rounds | {"confirm": True, "preview_token": dry["preview_token"]},
        )
        assert started["applied"] is True and started["change_count"] == 1
        assert "undo" not in started


@pytest.mark.anyio
async def test_a_queried_translation_is_decided_both_ways(
    live: dict[str, str],
) -> None:
    """decide_translation_query against the real routes (issue 485, point 4):
    the reviewer's text becomes the accepted next version, or the version is
    accepted as it is; the changed passages only with the content opt-in."""
    made = _scenario(live, "QUERIED_TRANSLATION_FOR_LEAD")
    project = made["project"]
    taken = f"{made['cases']['take_text']}~de~v1"
    kept = f"{made['cases']['answer_only']}~de~v1"
    rejected = f"{made['cases']['rejected']}~de~v1"
    async with Client(_server(live, made["token"])) as client:
        take = {"project": project, "document_id": taken, "decision": "reviewer_text"}
        shown = await client.call_tool("decide_translation_query", take)
        dry = shown.structured_content
        assert dry is not None and dry["applied"] is False
        plan = dry["plan"]
        assert plan["available"] is True and plan["next_version"] == 2
        assert plan["change"]["passages_changed"] >= 1
        assert plan["change"]["inserted_characters"] > 0
        # Neither the text, the reviewer's words nor the question.
        whole = _whole(shown)
        assert "diff_note" in plan["change"] and '"diff":' not in whole
        assert "muscular" not in whole and "short form" not in whole
        confirm = {"confirm": True, "preview_token": dry["preview_token"]}
        early = await call(
            client,
            "decide_translation_query",
            take | confirm | {"answer": "Yes, the long form."},
        )
        # The answer was not in the dry run: nothing is changed.
        assert early["applied"] is False and "nothing was changed" in early["note"]
        take["answer"] = "Yes, the long form."
        dry = await call(client, "decide_translation_query", take)
        done = await call(
            client,
            "decide_translation_query",
            take | {"confirm": True, "preview_token": dry["preview_token"]},
        )
        assert done["applied"] is True
        result = done["result"]
        assert (result["kind"], result["version"]) == ("reviewer_text", 2)
        assert result["translation_status"] == "accepted"
        assert result["decided_document_id"] == taken and result["edited"] is False
        again = await call(client, "decide_translation_query", take)
        assert again["plan"]["reason"] == "already_decided"
        assert "decided once" in again["plan"]["hint"]
        assert again["preview_token"] is None
        other = await call(
            client, "decide_translation_query", take | {"document_id": rejected}
        )
        assert other["plan"]["reason"] == "not_a_query"
        assert "start_lead_correction" in other["plan"]["hint"]

    async with Client(_server(live, made["token"], read_content=True)) as content:
        keep = {
            "project": project,
            "document_id": kept,
            "decision": "unchanged",
            "answer": "The short form is meant.",
        }
        dry = await call(content, "decide_translation_query", keep)
        assert dry["plan"]["review"]["question"].startswith("The source says")
        not_taken = dry["plan"]["reviewer_text_not_taken"]
        assert any("muscular" in passage["new_text"] for passage in not_taken["diff"])
        done = await call(
            content,
            "decide_translation_query",
            keep | {"confirm": True, "preview_token": dry["preview_token"]},
        )
        assert done["applied"] is True
        kept_result = done["result"]
        assert (kept_result["kind"], kept_result["version"]) == ("unchanged", 1)
        assert kept_result["document_id"] == kept
        assert kept_result["translation_status"] == "accepted"
        for document_id in (kept, result["document_id"]):
            version = await call(
                content,
                "get_text_version",
                {"project": project, "document_id": document_id},
            )
            assert version["translation_status"] == "accepted", document_id


@pytest.mark.anyio
async def test_a_version_is_uploaded_from_a_reviews_proposed_text(
    live: dict[str, str],
) -> None:
    """upload_translation_version with from_review_id and replacements
    (issue 485, point 3): the text is the review's, not retyped."""
    made = _scenario(live, "QUERIED_TRANSLATION_FOR_LEAD")
    project = made["project"]
    document_id = f"{made['cases']['take_text']}~de~v1"
    async with Client(_server(live, made["token"])) as client:
        [review] = await call(
            client,
            "list_translation_reviews",
            {"project": project, "document_id": document_id},
        )
        fixes = [{"old": "muscular hypotonia", "new": "low muscle tone"}]
        upload = {
            "project": project,
            "document_id": document_id,
            "method": "manual_correction",
            "from_review_id": review["id"],
            "replacements": fixes,
        }
        shown = await client.call_tool("upload_translation_version", upload)
        dry = shown.structured_content
        assert dry is not None and dry["applied"] is False
        plan = dry["plan"]
        assert plan["available"] is True and plan["passages_changed"] >= 1
        assert "diff" not in plan and "low muscle tone" not in _whole(shown)
        with pytest.raises(ToolFailed, match=r"Replacement 1 \(old 'no such words'\)"):
            await call(
                client,
                "upload_translation_version",
                upload | {"replacements": [{"old": "no such words", "new": "x"}]},
            )
        done = await call(
            client,
            "upload_translation_version",
            upload | {"confirm": True, "expected_previous_sha256": plan["text_sha256"]},
        )
        assert done["applied"] is True and done["result"]["version"] == 2
    async with Client(_server(live, made["token"], read_content=True)) as content:
        stored = await call(
            content,
            "get_text_version",
            {
                "project": project,
                "document_id": done["result"]["document_id"],
                "include_text": True,
            },
        )
        assert "low muscle tone" in stored["text"]
        assert "muscular" not in stored["text"]


@pytest.mark.anyio
async def test_wrong_input_is_named_not_ignored(live: dict[str, str]) -> None:
    """A misspelt argument is refused, and a text the project does not have
    is named by every bulk tool (review findings F3 and F4)."""
    made = _scenario(live, "S336F")
    project = made["project"]
    known = {"case_id": "EN100022", "language": "en"}
    wrong = [
        {"case_id": "EN999999", "language": "en"},
        {"case_id": "EN100023", "language": "de"},
        {"case_id": "en100022", "language": "en"},
    ]
    async with Client(_server(live, made["token"])) as client:
        # ``case_id`` for ``case_ids`` ran a dry run over the whole project.
        with pytest.raises(ToolFailed, match="did you mean 'case_ids'"):
            await call(
                client,
                "accept_agreeing_texts",
                {"project": project, "case_id": ["EN100029"]},
            )
        whole = await call(client, "accept_agreeing_texts", {"project": project})
        assert whole["selection"] == f"all texts of project '{project}'"
        assert len(whole["would_accept"]) == 2
        one = await call(
            client,
            "accept_agreeing_texts",
            {"project": project, "case_ids": ["EN100029", "EN999999"]},
        )
        assert one["selection"] == f"2 cases (case_ids) of project '{project}'"
        assert one["would_accept"] == [] and one["unknown_case_ids"] == ["EN999999"]

        about = {"project": project, "texts": [known, *wrong]}
        for tool, extra in (
            ("reopen_texts", {"reason": "Check"}),
            ("withdraw_open_tasks", {}),
            ("start_rounds", {"kind": "carry_forward"}),
            ("pause_texts", {"reason": "Check"}),
            ("release_texts", {}),
            ("change_final_results", {}),
            ("change_annotation_modes", {"mode": "proposals", "reason": "Check"}),
        ):
            dry = await call(client, tool, about | extra)
            assert dry["applied"] is False, tool
            assert dry["unknown_texts"] == wrong, tool
            assert dry["selection"] == f"4 texts of project '{project}'", tool
            # Only unknown texts: nothing to do, and the answer says why.
            none = await call(
                client, tool, {"project": project, "texts": wrong} | extra
            )
            assert none["change_count"] == 0 and none["unknown_texts"] == wrong, tool

        # The applied answer names them too. EN100026: R. Roe's open task.
        withdraw = {
            "project": project,
            "texts": [{"case_id": "EN100026", "language": "en"}, *wrong],
        }
        dry = await call(client, "withdraw_open_tasks", withdraw)
        assert dry["change_count"] == 1
        done = await call(
            client,
            "withdraw_open_tasks",
            withdraw | {"confirm": True, "preview_token": dry["preview_token"]},
        )
        assert done["applied"] is True and done["unknown_texts"] == wrong
        assert done["selection"] == f"4 texts of project '{project}'"
