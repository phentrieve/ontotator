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


def _server(info: dict[str, str], token: str, *files_dirs: Path) -> Any:
    settings = Settings(
        url=info["url"],
        token=token,
        poll_interval=0.2,
        files_dirs=tuple(folder.resolve() for folder in files_dirs),
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


def _pkce() -> tuple[str, str]:
    import base64
    import hashlib
    import secrets

    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def test_a_remote_client_connects_with_oauth_end_to_end(
    live: dict[str, str],
) -> None:
    """Issue 388: register, log in, consent, exchange, then call a tool remotely."""
    from urllib.parse import parse_qs, urlsplit

    from starlette.testclient import TestClient

    from ontotator_mcp.config import HttpSettings
    from ontotator_mcp.remote import http_app

    base, mcp_url = live["url"], live["mcp_url"]
    redirect = "http://127.0.0.1:33418/callback"
    with httpx.Client(base_url=base, follow_redirects=False) as browser:
        # The client discovers and registers itself.
        meta = browser.get("/.well-known/oauth-authorization-server").json()
        assert meta["code_challenge_methods_supported"] == ["S256"]
        registered = browser.post(
            "/oauth/register",
            json={
                "client_name": "Integration",
                "redirect_uris": [redirect],
                "token_endpoint_auth_method": "none",
                "grant_types": ["authorization_code", "refresh_token"],
            },
        ).json()
        verifier, challenge = _pkce()
        params = {
            "response_type": "code",
            "client_id": registered["client_id"],
            "redirect_uri": redirect,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "scope": "read",
            "resource": mcp_url,
            "state": "s1",
        }
        handed = browser.get("/oauth/authorize", params=params)
        assert handed.status_code == 302
        assert handed.headers["location"].startswith("/#/oauth/authorize?")
        # The user logs in to Ontotator itself and consents.
        login = browser.post(
            "/api/v1/auth/login",
            json={"username": "root", "password": "test-only passphrase"},
            headers={"Origin": base},
        )
        assert login.status_code == 200, login.text
        csrf = {"X-CSRF-Token": login.json()["csrf_token"], "Origin": base}
        shown = browser.get("/api/v1/oauth/authorization", params=params).json()
        decision = browser.post(
            "/api/v1/oauth/authorization",
            json={"params": shown["params"], "approve": True, "scopes": ["read"]},
            headers=csrf,
        ).json()
    query = parse_qs(urlsplit(decision["redirect_to"]).query)
    assert query["state"] == ["s1"]
    tokens = httpx.post(
        f"{base}/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": query["code"][0],
            "redirect_uri": redirect,
            "code_verifier": verifier,
            "client_id": registered["client_id"],
            "resource": mcp_url,
        },
    ).json()
    access = tokens["access_token"]

    settings = Settings(url=base, token=None, poll_interval=0.2)
    http = HttpSettings.from_env("127.0.0.1:1", {"ONTOTATOR_MCP_URL": mcp_url})
    app = http_app(build_server(settings, http=http), http)
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-06-18",
    }
    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "whoami", "arguments": {}},
        }
    )
    origin = mcp_url.rsplit("/", 1)[0]
    with TestClient(app, base_url=origin) as remote:
        refused = remote.post("/mcp", content=body, headers=headers)
        assert refused.status_code == 401
        answer = remote.post(
            "/mcp",
            content=body,
            headers=headers | {"Authorization": f"Bearer {access}"},
        )
        assert answer.status_code == 200, answer.text
        result = answer.json()["result"]
        assert result["isError"] is False, result
        assert result["structuredContent"]["user"]["username"] == "root"
        assert result["structuredContent"]["token"]["scopes"] == ["read"]
        # The client ends its grant: the same token no longer works.
        httpx.post(
            f"{base}/oauth/revoke",
            data={"token": access, "client_id": registered["client_id"]},
        )
        after = remote.post(
            "/mcp",
            content=body,
            headers=headers | {"Authorization": f"Bearer {access}"},
        )
        assert after.status_code == 401


@pytest.mark.anyio
async def test_the_sdk_oauth_client_connects_like_a_connector(
    live: dict[str, str],
) -> None:
    """Issue 388: the MCP SDK's own OAuth client, as a connector would use it.

    It discovers everything from the 401 alone (protected resource metadata,
    authorization server metadata), registers dynamically, runs PKCE with
    ``resource``, and calls a tool over Streamable HTTP. The user's part
    (log in, consent) is done here with the session API the consent page uses.
    """
    from urllib.parse import parse_qs, urlsplit

    import httpx2
    import uvicorn
    from mcp.client.auth import OAuthClientProvider
    from mcp.client.streamable_http import streamable_http_client
    from mcp.shared.auth import (
        AuthorizationCodeResult,
        OAuthClientInformationFull,
        OAuthClientMetadata,
        OAuthToken,
    )

    from ontotator_mcp.config import HttpSettings
    from ontotator_mcp.remote import http_app

    base, mcp_url = live["url"], live["mcp_url"]
    port = int(urlsplit(mcp_url).port or 0)
    http = HttpSettings.from_env(f"127.0.0.1:{port}", {"ONTOTATOR_MCP_URL": mcp_url})
    settings = Settings(url=base, token=None, poll_interval=0.2)
    server = uvicorn.Server(
        uvicorn.Config(
            http_app(build_server(settings, http=http), http),
            host="127.0.0.1",
            port=port,
            log_level="warning",
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.05)

    browser = httpx.Client(base_url=base, follow_redirects=False)
    login = browser.post(
        "/api/v1/auth/login",
        json={"username": "root", "password": "test-only passphrase"},
        headers={"Origin": base},
    )
    assert login.status_code == 200, login.text
    csrf = {"X-CSRF-Token": login.json()["csrf_token"], "Origin": base}
    landed: dict[str, str] = {}

    async def consent(authorization_url: str) -> None:
        handed = browser.get(authorization_url)
        assert handed.status_code == 302, handed.text
        params = dict(parse_qs(handed.headers["location"].split("?", 1)[1]))
        flat = {key: value[0] for key, value in params.items()}
        shown = browser.get("/api/v1/oauth/authorization", params=flat).json()
        assert shown["resource"] == mcp_url
        decision = browser.post(
            "/api/v1/oauth/authorization",
            json={
                "params": shown["params"],
                "approve": True,
                "scopes": shown["allowed_scopes"],
            },
            headers=csrf,
        ).json()
        query = parse_qs(urlsplit(decision["redirect_to"]).query)
        landed.update({key: value[0] for key, value in query.items()})

    async def callback() -> AuthorizationCodeResult:
        return AuthorizationCodeResult(
            code=landed["code"], state=landed.get("state"), iss=landed.get("iss")
        )

    class Memory:
        tokens: OAuthToken | None = None
        client: OAuthClientInformationFull | None = None

        async def get_tokens(self) -> OAuthToken | None:
            return self.tokens

        async def set_tokens(self, tokens: OAuthToken) -> None:
            self.tokens = tokens

        async def get_client_info(self) -> OAuthClientInformationFull | None:
            return self.client

        async def set_client_info(self, info: OAuthClientInformationFull) -> None:
            self.client = info

    storage = Memory()
    provider = OAuthClientProvider(
        server_url=mcp_url,
        client_metadata=OAuthClientMetadata(
            client_name="SDK connector",
            redirect_uris=["http://127.0.0.1:33418/callback"],
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            token_endpoint_auth_method="none",
        ),
        storage=storage,
        redirect_handler=consent,
        callback_handler=callback,
    )
    try:
        async with httpx2.AsyncClient(auth=provider, timeout=30) as http_client:
            transport = streamable_http_client(mcp_url, http_client=http_client)
            async with Client(transport) as client:
                me = await call(client, "whoami", {})
        assert me["user"]["username"] == "root"
        assert set(me["token"]["scopes"]) == {
            "read",
            "import",
            "export",
            "project-admin",
        }
        assert storage.tokens is not None and storage.tokens.refresh_token
    finally:
        browser.close()
        server.should_exit = True
        thread.join(timeout=10)
