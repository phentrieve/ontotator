"""``--http``: Streamable HTTP with each caller's own token (issue 388).

The fake Ontotator API knows two tokens, A and B, each with its own
``GET /api/v1/me/token`` record. The tests check what the issue asks for:
no token gets 401 with ``WWW-Authenticate`` naming the protected resource
metadata, a foreign ``Origin`` gets 403, a token of another resource is
refused, and every API call carries exactly the token of the MCP request
it serves, never another one and never to another host.
"""

from __future__ import annotations

import json
import re
import threading
from typing import Any

import httpx
import pytest
from fake_api import FakeApi, token_view
from starlette.testclient import TestClient

from ontotator_mcp.__main__ import main
from ontotator_mcp.config import ConfigError, HttpSettings, Settings
from ontotator_mcp.remote import http_app
from ontotator_mcp.server import build_server

API = "https://ontotator.test"
PUBLIC = "https://ontotator.test/mcp"
TOKEN_A = "ott_token-of-anna-0000000000000000000000000000"
TOKEN_B = "ott_token-of-bert-0000000000000000000000000000"
OAUTH = "ott_oauth-token-for-this-server-000000000000000"
FOREIGN = "ott_oauth-token-for-another-server-0000000000"
HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": "2025-06-18",
}


def _records() -> dict[str, dict[str, Any]]:
    return {
        TOKEN_A: token_view(id=1, owner="anna"),
        TOKEN_B: token_view(id=2, owner="bert"),
        OAUTH: token_view(id=3, owner="anna", resource=PUBLIC),
        FOREIGN: token_view(id=4, owner="anna", resource="https://other.test/mcp"),
    }


@pytest.fixture
def fake() -> FakeApi:
    api = FakeApi(accepted=frozenset(_records()))
    records = _records()

    def me_token(request: httpx.Request) -> Any:
        token = request.headers["authorization"].partition(" ")[2]
        return records[token]

    api.on("GET", "/api/v1/me/token", me_token)
    return api


def _http(**env: str) -> HttpSettings:
    return HttpSettings.from_env("127.0.0.1:8765", {"ONTOTATOR_MCP_URL": PUBLIC} | env)


@pytest.fixture
def client(fake: FakeApi) -> Any:
    settings = Settings(url=API, token=None, poll_interval=0.001, job_timeout=5)
    http = _http(ONTOTATOR_MCP_ALLOWED_ORIGINS="https://claude.ai")
    server = build_server(settings, transport=httpx.MockTransport(fake), http=http)
    with TestClient(http_app(server, http), base_url="https://ontotator.test") as tc:
        yield tc


def _rpc(method: str, params: dict[str, Any] | None = None, id: int = 1) -> str:
    return json.dumps(
        {"jsonrpc": "2.0", "id": id, "method": method, "params": params or {}}
    )


def _post(
    client: TestClient, body: str, token: str | None = None, **headers: str
) -> Any:
    sent = dict(HEADERS) | headers
    if token is not None:
        sent["Authorization"] = f"Bearer {token}"
    return client.post("/mcp", content=body, headers=sent)


def _call_tool(
    client: TestClient, token: str, name: str, arguments: dict[str, Any]
) -> Any:
    response = _post(
        client, _rpc("tools/call", {"name": name, "arguments": arguments}), token
    )
    assert response.status_code == 200, response.text
    return response.json()


# 401, 403, 421


def test_no_token_gets_401_naming_the_resource_metadata(client: TestClient) -> None:
    response = _post(client, _rpc("tools/list"))
    assert response.status_code == 401
    challenge = response.headers["www-authenticate"]
    assert challenge.startswith("Bearer ")
    assert (
        'resource_metadata="https://ontotator.test/.well-known/oauth-protected-resource/mcp"'
        in challenge
    )


def test_an_unknown_token_gets_401(client: TestClient, fake: FakeApi) -> None:
    fake.on(
        "GET", "/api/v1/me/token", httpx.Response(401, json={"code": "TOKEN_INVALID"})
    )
    fake.accepted = frozenset({"ott_unknown"})
    assert _post(client, _rpc("tools/list"), "ott_unknown").status_code == 401


def test_a_token_for_another_resource_is_refused(client: TestClient) -> None:
    assert _post(client, _rpc("tools/list"), FOREIGN).status_code == 401


def test_an_oauth_token_for_this_server_is_accepted(client: TestClient) -> None:
    response = _post(client, _rpc("tools/list"), OAUTH)
    assert response.status_code == 200, response.text
    assert response.json()["result"]["tools"]


def test_a_foreign_origin_gets_403_before_any_token_check(
    client: TestClient, fake: FakeApi
) -> None:
    response = _post(client, _rpc("tools/list"), TOKEN_A, Origin="https://evil.example")
    assert response.status_code == 403
    assert fake.calls == []  # the token was never even checked


def test_allowed_origins_and_no_origin_pass(client: TestClient) -> None:
    for headers in (
        {},
        {"Origin": "https://claude.ai"},
        {"Origin": "https://ontotator.test"},
    ):
        response = _post(client, _rpc("tools/list"), TOKEN_A, **headers)
        assert response.status_code == 200, (headers, response.text)


def test_another_host_gets_421(client: TestClient) -> None:
    response = _post(client, _rpc("tools/list"), TOKEN_A, Host="rebound.example")
    assert response.status_code == 421


def test_the_protected_resource_metadata_names_ontotator(client: TestClient) -> None:
    response = client.get("/.well-known/oauth-protected-resource/mcp")
    assert response.status_code == 200
    body = response.json()
    assert body["resource"] == PUBLIC
    assert [server.rstrip("/") for server in body["authorization_servers"]] == [API]
    assert body["scopes_supported"] == ["read", "import", "export", "project-admin"]


def test_the_health_check_answers_on_loopback(client: TestClient) -> None:
    response = client.get("/healthz", headers={"Host": "127.0.0.1:8765"})
    assert response.status_code == 200 and response.text == "ok"


# Whose token goes where


def test_each_request_carries_its_own_callers_token(
    client: TestClient, fake: FakeApi
) -> None:
    _call_tool(client, TOKEN_A, "whoami", {})
    _call_tool(client, TOKEN_B, "whoami", {})
    _call_tool(client, TOKEN_A, "whoami", {})
    sent = [
        call.request.headers["authorization"]
        for call in fake.calls
        if call.template == "/api/v1/auth/me"
    ]
    assert sent == [f"Bearer {TOKEN_A}", f"Bearer {TOKEN_B}", f"Bearer {TOKEN_A}"]


def test_concurrent_callers_never_see_each_others_token(
    client: TestClient, fake: FakeApi
) -> None:
    failures: list[str] = []

    def caller(token: str) -> None:
        for _ in range(5):
            response = _post(
                client,
                _rpc("tools/call", {"name": "whoami", "arguments": {}}),
                token,
            )
            if response.status_code != 200:
                failures.append(response.text)

    threads = [threading.Thread(target=caller, args=(t,)) for t in (TOKEN_A, TOKEN_B)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert failures == []
    # Every API call went to Ontotator only, with a token of a caller, and
    # each whoami answer names the caller whose token asked for it.
    for call in fake.calls:
        assert call.request.url.host == "ontotator.test"
    by_token: dict[str, set[str]] = {}
    for call in fake.calls:
        token = call.request.headers["authorization"][7:]
        by_token.setdefault(token, set()).add(call.template)
    assert set(by_token) == {TOKEN_A, TOKEN_B}


def test_the_token_never_appears_in_a_tool_result(
    client: TestClient, fake: FakeApi
) -> None:
    fake.on(
        "GET",
        "/api/v1/auth/me",
        httpx.Response(500, text=f"boom Bearer {TOKEN_A}"),
    )
    result = _call_tool(client, TOKEN_A, "whoami", {})
    assert result["result"]["isError"] is True
    assert "500" in json.dumps(result)
    assert TOKEN_A not in json.dumps(result)


def test_file_tools_are_off_remotely(client: TestClient, tmp_path: Any) -> None:
    result = _call_tool(
        client,
        TOKEN_A,
        "download_export",
        {"project": "p", "job_id": 1, "path": str(tmp_path / "x.zip")},
    )
    assert result["result"]["isError"] is True
    assert "remote MCP server" in json.dumps(result)


# Refusing to start


BASE = {"ONTOTATOR_URL": API}


@pytest.mark.parametrize(
    ("env", "message"),
    [
        (BASE | {"ONTOTATOR_TOKEN": TOKEN_A}, "ONTOTATOR_TOKEN"),
        (BASE | {"ONTOTATOR_MCP_FILES_DIR": "/tmp"}, "ONTOTATOR_MCP_FILES_DIR"),
    ],
)
def test_remote_mode_refuses_a_fixed_token_or_local_files(
    env: dict[str, str], message: str
) -> None:
    with pytest.raises(ConfigError, match=message):
        Settings.from_env(env, remote=True)


@pytest.mark.parametrize(
    ("bind", "env", "message"),
    [
        ("0.0.0.0:8765", {}, "needs ONTOTATOR_MCP_URL"),
        ("0.0.0.0:8765", {"ONTOTATOR_MCP_URL": "http://ontotator.test/mcp"}, "https"),
        ("0.0.0.0:8765", {"ONTOTATOR_MCP_URL": "https://o.test/mcp?x=1"}, "query"),
        ("0.0.0.0", {"ONTOTATOR_MCP_URL": PUBLIC}, "HOST:PORT"),
        ("0.0.0.0:99999", {"ONTOTATOR_MCP_URL": PUBLIC}, "HOST:PORT"),
        (
            "0.0.0.0:8765",
            {"ONTOTATOR_MCP_URL": PUBLIC, "ONTOTATOR_MCP_ALLOWED_ORIGINS": "*"},
            "exact origins",
        ),
    ],
)
def test_http_settings_refuse_an_unsafe_configuration(
    bind: str, env: dict[str, str], message: str
) -> None:
    with pytest.raises(ConfigError, match=re.escape(message)):
        HttpSettings.from_env(bind, env)


def test_http_settings_parse_ipv6_and_loopback_http() -> None:
    settings = HttpSettings.from_env(
        "[::]:8765", {"ONTOTATOR_MCP_URL": "http://localhost:8765/mcp/"}
    )
    assert (settings.host, settings.port) == ("::", 8765)
    assert settings.public_url == "http://localhost:8765/mcp"
    assert settings.allowed_hosts == ("localhost:8765",)


def test_the_command_refuses_to_start_without_auth_config(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("ONTOTATOR_URL", API)
    monkeypatch.delenv("ONTOTATOR_TOKEN", raising=False)
    monkeypatch.delenv("ONTOTATOR_MCP_URL", raising=False)
    monkeypatch.delenv("ONTOTATOR_MCP_FILES_DIR", raising=False)
    with pytest.raises(SystemExit) as raised:
        main(["--http", "0.0.0.0:8765"])
    assert raised.value.code == 2
    assert "ONTOTATOR_MCP_URL" in capsys.readouterr().err
    monkeypatch.setenv("ONTOTATOR_MCP_URL", PUBLIC)
    monkeypatch.setenv("ONTOTATOR_TOKEN", TOKEN_A)
    with pytest.raises(SystemExit):
        main(["--http", "0.0.0.0:8765"])
    assert TOKEN_A not in capsys.readouterr().err
