"""End to end against the real Ontotator app (``tests/live_server.py``).

Needs ``ONTOTATOR_TEST_PG_URL`` (a throwaway PostgreSQL superuser URL) and
``uv``; the app runs in the main project's environment as a subprocess, so
the MCP package never imports Ontotator. Skipped otherwise.
"""

from __future__ import annotations

import json
import os
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
