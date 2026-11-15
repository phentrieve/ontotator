"""OAuth for remote MCP clients (issue 388): registration, consent, PKCE, tokens.

The authorization server is new security surface; every refusal the
security review listed has a test here: PKCE failures, a wrong
redirect_uri, a reused or expired code, a wrong audience, revoked and
rotated tokens, and tokens kept away from the consent routes.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from auth_harness import HARNESS, PASSWORD, logged_in
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_auth_api import _app
from test_projects_api import create_project

from ontotator.auth import oauth
from ontotator.auth.tokens import token_digest
from ontotator.storage.tables import (
    ApiTokenRow,
    AuditEventRow,
    OAuthClientRow,
    OAuthCodeRow,
    OAuthRefreshTokenRow,
)

ISSUER = "http://testserver"
MCP_URL = "http://testserver/mcp"
REDIRECT = "https://claude.ai/api/mcp/auth_callback"


@pytest.fixture
def app(tmp_path) -> FastAPI:
    return _app(tmp_path, public_origin=ISSUER, mcp_url=MCP_URL)


@pytest.fixture
def lead(app: FastAPI) -> TestClient:
    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin)
    return logged_in(app, "lena", projects={"phenotypes": ["lead"]})


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def _register(app: FastAPI, **metadata: Any) -> dict[str, Any]:
    body = {
        "client_name": "Claude",
        "redirect_uris": [REDIRECT],
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
    } | metadata
    response = TestClient(app).post("/oauth/register", json=body)
    assert response.status_code == 201, response.text
    registered: dict[str, Any] = response.json()
    return registered


def _params(client_id: str, challenge: str, **extra: str) -> dict[str, str]:
    return {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "scope": "read export",
        "resource": MCP_URL,
        "state": "xyz",
    } | extra


def _consent(
    user: TestClient, params: dict[str, str], scopes: list[str] | None = None
) -> dict[str, list[str]]:
    """The user approves; the query of the redirect back to the client."""
    shown = user.get("/api/v1/oauth/authorization", params=params)
    assert shown.status_code == 200, shown.text
    decision = user.post(
        "/api/v1/oauth/authorization",
        json={
            "params": shown.json()["params"],
            "approve": True,
            "scopes": scopes if scopes is not None else ["read", "export"],
        },
    )
    assert decision.status_code == 200, decision.text
    target = urlsplit(decision.json()["redirect_to"])
    assert f"{target.scheme}://{target.netloc}{target.path}" == REDIRECT
    return parse_qs(target.query)


def _token(app: FastAPI, auth: tuple[str, str] | None = None, **form: str) -> Any:
    return TestClient(app).post("/oauth/token", data=form, auth=auth)


def _connected(
    app: FastAPI, user: TestClient, **extra: str
) -> tuple[dict[str, Any], dict[str, Any], str]:
    """A full flow: (client registration, token response, verifier)."""
    client = _register(app)
    verifier, challenge = _pkce()
    query = _consent(user, _params(client["client_id"], challenge, **extra))
    response = _token(
        app,
        grant_type="authorization_code",
        code=query["code"][0],
        redirect_uri=REDIRECT,
        code_verifier=verifier,
        client_id=client["client_id"],
        resource=MCP_URL,
    )
    assert response.status_code == 200, response.text
    return client, response.json(), verifier


def _bearer(app: FastAPI, token: str) -> TestClient:
    return TestClient(app, headers={"Authorization": f"Bearer {token}"})


def _audit(app: FastAPI, action: str) -> list[Any]:
    with app.state.repo.db.transaction() as conn:
        return list(
            conn.execute(select(AuditEventRow).where(AuditEventRow.action == action))
        )


# Metadata and switching off


def test_the_metadata_names_the_endpoints_and_s256_only(app: FastAPI) -> None:
    body = TestClient(app).get("/.well-known/oauth-authorization-server").json()
    assert body["issuer"] == ISSUER
    assert body["authorization_endpoint"] == f"{ISSUER}/oauth/authorize"
    assert body["token_endpoint"] == f"{ISSUER}/oauth/token"
    assert body["registration_endpoint"] == f"{ISSUER}/oauth/register"
    assert body["code_challenge_methods_supported"] == ["S256"]
    assert "admin" not in body["scopes_supported"]
    assert body["grant_types_supported"] == ["authorization_code", "refresh_token"]


def test_without_an_mcp_url_every_oauth_endpoint_is_404(tmp_path) -> None:
    app = _app(tmp_path)
    client = TestClient(app)
    assert client.get("/.well-known/oauth-authorization-server").status_code == 404
    assert client.post("/oauth/register", json={}).status_code == 404
    assert client.get("/oauth/authorize").status_code == 404
    assert client.post("/oauth/token", data={}).status_code == 404
    user = logged_in(app, "root", system_admin=True)
    listed = user.get("/api/v1/me/connections").json()
    assert listed == {"enabled": False, "mcp_url": None, "connections": []}


# Registration


@pytest.mark.parametrize(
    "uri",
    [
        "http://example.org/callback",  # plain http off loopback
        "https://example.org/cb#fragment",
        "https://user@example.org/cb",
        "javascript:alert(1)",
        "custom-scheme://callback",
        "",
    ],
)
def test_registration_refuses_unsafe_redirect_uris(app: FastAPI, uri: str) -> None:
    response = TestClient(app).post(
        "/oauth/register", json={"redirect_uris": [uri], "client_name": "x"}
    )
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_redirect_uri"


def test_registration_accepts_https_and_loopback(app: FastAPI) -> None:
    registered = _register(
        app, redirect_uris=[REDIRECT, "http://localhost:33418/callback"]
    )
    assert registered["client_id"].startswith(oauth.CLIENT_PREFIX)
    assert "client_secret" not in registered
    # An unauthenticated registration writes nothing to the audit trail.
    assert _audit(app, "oauth.client.register") == []


def test_a_confidential_client_gets_a_secret_stored_as_its_digest(
    app: FastAPI,
) -> None:
    registered = _register(app, token_endpoint_auth_method="client_secret_basic")
    secret = registered["client_secret"]
    with app.state.repo.db.transaction() as conn:
        stored = conn.execute(select(OAuthClientRow.secret_sha256)).scalar_one()
    assert stored == token_digest(secret) and secret not in stored


@pytest.mark.parametrize(
    "metadata",
    [
        {"grant_types": ["client_credentials"]},
        {"grant_types": ["refresh_token"]},
        {"response_types": ["token"]},
        {"token_endpoint_auth_method": "private_key_jwt"},
        {"scope": "read admin"},
    ],
)
def test_registration_refuses_unsupported_metadata(
    app: FastAPI, metadata: dict[str, Any]
) -> None:
    response = TestClient(app).post(
        "/oauth/register", json={"redirect_uris": [REDIRECT], **metadata}
    )
    assert response.status_code == 400, response.text
    assert response.json()["error"] == "invalid_client_metadata"


def test_one_address_cannot_use_up_everyones_registrations(app: FastAPI) -> None:
    """The attack: 100 junk registrations locked every real client out."""
    service = app.state.oauth
    junk = {"redirect_uris": ["https://junk.example/cb"]}
    for _ in range(oauth.REGISTRATIONS_PER_ADDRESS_PER_HOUR):
        service.register(junk, client_address="203.0.113.9")
    with pytest.raises(oauth.OAuthError) as refused:
        service.register(junk, client_address="203.0.113.9")
    assert refused.value.status == 429
    # Another address, and the HTTP route (address "testclient"), still work.
    service.register({"redirect_uris": [REDIRECT]}, client_address="198.51.100.7")
    _register(app)
    with app.state.repo.db.transaction() as conn:
        addresses = set(conn.execute(select(OAuthClientRow.registered_from)).scalars())
    assert addresses == {"203.0.113.9", "198.51.100.7", "testclient"}


def test_clients_that_never_got_a_grant_are_deleted_after_a_week(
    app: FastAPI, lead: TestClient
) -> None:
    service = app.state.oauth
    kept, _, _ = _connected(app, lead)  # has a grant: stays for good
    unused = _register(app, client_name="Never used")
    pending = _register(app, client_name="Abandoned consent")
    _, challenge = _pkce()
    _consent(lead, _params(pending["client_id"], challenge))  # a code, no grant
    week = datetime.now(UTC) + oauth.UNUSED_CLIENT_LIFETIME + timedelta(minutes=1)
    service._now = lambda: week
    fresh = _register(app, client_name="Fresh")  # every registration purges
    with app.state.repo.db.transaction() as conn:
        left = set(conn.execute(select(OAuthClientRow.client_id)).scalars())
        codes = conn.execute(select(OAuthCodeRow.client_id)).all()
    assert left == {kept["client_id"], fresh["client_id"]}
    assert unused["client_id"] not in left and len(codes) == 1
    assert service.client(unused["client_id"]) is None


def test_registration_is_rate_limited(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(oauth, "REGISTRATIONS_PER_HOUR", 2)
    _register(app)
    _register(app)
    response = TestClient(app).post(
        "/oauth/register", json={"redirect_uris": [REDIRECT]}
    )
    assert response.status_code == 429


def test_control_characters_are_stripped_from_the_client_name(app: FastAPI) -> None:
    registered = _register(app, client_name="Evil‮\x00 App  ")
    assert registered["client_name"] == "Evil App"


# Authorization endpoint


def test_a_valid_request_goes_on_to_the_consent_page(app: FastAPI) -> None:
    client = _register(app)
    _, challenge = _pkce()
    response = TestClient(app).get(
        "/oauth/authorize",
        params=_params(client["client_id"], challenge),
        follow_redirects=False,
    )
    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith("/#/oauth/authorize?")
    assert parse_qs(location.split("?", 1)[1])["client_id"] == [client["client_id"]]
    assert response.headers["cache-control"] == "no-store"


def test_an_unknown_client_or_redirect_uri_is_never_redirected(app: FastAPI) -> None:
    client = _register(app)
    _, challenge = _pkce()
    for params in (
        _params("otc_unknown", challenge),
        _params(client["client_id"], challenge, redirect_uri="https://evil.example/cb"),
        _params(client["client_id"], challenge, redirect_uri=REDIRECT + "/x"),
    ):
        response = TestClient(app).get(
            "/oauth/authorize", params=params, follow_redirects=False
        )
        assert response.status_code == 400
        assert "location" not in response.headers
        assert "not valid" in response.text


@pytest.mark.parametrize(
    ("extra", "error"),
    [
        ({"code_challenge_method": "plain"}, "invalid_request"),
        ({"code_challenge_method": ""}, "invalid_request"),
        ({"code_challenge": ""}, "invalid_request"),
        ({"code_challenge": "short"}, "invalid_request"),
        ({"response_type": "token"}, "unsupported_response_type"),
        ({"scope": "read admin"}, "invalid_scope"),
        ({"resource": "https://other.example/mcp"}, "invalid_target"),
    ],
)
def test_a_faulty_request_gets_an_error_page_and_no_redirect(
    app: FastAPI, extra: dict[str, str], error: str
) -> None:
    client = _register(app)
    _, challenge = _pkce()
    response = TestClient(app).get(
        "/oauth/authorize",
        params=_params(client["client_id"], challenge, **extra),
        follow_redirects=False,
    )
    assert response.status_code == 400
    assert "location" not in response.headers
    assert error in response.text


def test_the_authorization_endpoint_is_no_open_redirector(app: FastAPI) -> None:
    """Anyone may register any https address; nobody is logged in here."""
    phish = "https://evil.example/phish"
    client = _register(app, redirect_uris=[phish])
    for params in (
        {"client_id": client["client_id"], "response_type": "token"},
        {"client_id": client["client_id"], "redirect_uri": phish},
        {
            "client_id": client["client_id"],
            "redirect_uri": phish,
            "response_type": "code",
            "scope": "nonsense",
        },
    ):
        response = TestClient(app).get(
            "/oauth/authorize", params=params, follow_redirects=False
        )
        assert response.status_code == 400, params
        assert "location" not in response.headers
        assert "evil.example" not in response.text


def test_offline_access_is_accepted_and_dropped(app: FastAPI, lead: TestClient) -> None:
    client = _register(app)
    _, challenge = _pkce()
    shown = lead.get(
        "/api/v1/oauth/authorization",
        params=_params(client["client_id"], challenge, scope="read offline_access"),
    ).json()
    assert shown["requested_scopes"] == ["read"]


def test_a_repeated_parameter_is_refused(app: FastAPI) -> None:
    client = _register(app)
    _, challenge = _pkce()
    query = "&".join(
        f"{key}={value}"
        for key, value in _params(client["client_id"], challenge).items()
    )
    response = TestClient(app).get(
        f"/oauth/authorize?{query}&redirect_uri=https://evil.example/cb",
        follow_redirects=False,
    )
    assert response.status_code == 400 and "location" not in response.headers


# Consent


def test_consent_needs_a_session(app: FastAPI) -> None:
    client = _register(app)
    _, challenge = _pkce()
    response = TestClient(app).get(
        "/api/v1/oauth/authorization", params=_params(client["client_id"], challenge)
    )
    assert response.status_code == 401


def test_the_consent_page_shows_client_redirect_host_and_allowed_scopes(
    app: FastAPI, lead: TestClient
) -> None:
    client = _register(app)
    _, challenge = _pkce()
    shown = lead.get(
        "/api/v1/oauth/authorization",
        params=_params(client["client_id"], challenge, scope="read project-admin"),
    ).json()
    assert shown["client_name"] == "Claude"
    assert shown["redirect_host"] == "claude.ai"
    assert shown["requested_scopes"] == ["read", "project-admin"]
    assert shown["allowed_scopes"] == ["read", "project-admin"]
    assert shown["resource"] == MCP_URL


def test_scopes_are_no_broader_than_the_users_roles(app: FastAPI) -> None:
    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin)
    annotator = logged_in(app, "ann", projects={"phenotypes": ["annotator"]})
    client = _register(app)
    _, challenge = _pkce()
    params = _params(client["client_id"], challenge)
    shown = annotator.get("/api/v1/oauth/authorization", params=params).json()
    assert shown["allowed_scopes"] == ["read"]
    refused = annotator.post(
        "/api/v1/oauth/authorization",
        json={"params": shown["params"], "approve": True, "scopes": ["read", "export"]},
    )
    assert refused.status_code == 422
    assert refused.json()["code"] == "OAUTH_REQUEST_INVALID"
    # Nor more than the client asked for.
    lead = logged_in(app, "lena", projects={"phenotypes": ["lead"]})
    widened = lead.post(
        "/api/v1/oauth/authorization",
        json={"params": shown["params"], "approve": True, "scopes": ["import"]},
    )
    assert widened.status_code == 422


def test_declining_sends_access_denied_back(app: FastAPI, lead: TestClient) -> None:
    client = _register(app)
    _, challenge = _pkce()
    shown = lead.get(
        "/api/v1/oauth/authorization", params=_params(client["client_id"], challenge)
    ).json()
    decision = lead.post(
        "/api/v1/oauth/authorization",
        json={"params": shown["params"], "approve": False},
    ).json()
    query = parse_qs(urlsplit(decision["redirect_to"]).query)
    assert query["error"] == ["access_denied"] and "code" not in query


def test_consent_is_a_write_with_csrf(app: FastAPI, lead: TestClient) -> None:
    client = _register(app)
    _, challenge = _pkce()
    shown = lead.get(
        "/api/v1/oauth/authorization", params=_params(client["client_id"], challenge)
    ).json()
    response = lead.post(
        "/api/v1/oauth/authorization",
        json={"params": shown["params"], "approve": True, "scopes": ["read"]},
        headers={"X-CSRF-Token": "wrong"},
    )
    assert response.status_code == 403


# Token endpoint: the code


def test_the_full_flow_issues_an_api_token_bound_to_the_mcp_server(
    app: FastAPI, lead: TestClient
) -> None:
    _, tokens, _ = _connected(app, lead)
    assert tokens["token_type"] == "Bearer"
    assert tokens["expires_in"] == 3600
    assert tokens["scope"] == "read export"
    assert tokens["access_token"].startswith("ott_")
    assert tokens["refresh_token"].startswith(oauth.REFRESH_PREFIX)
    me = _bearer(app, tokens["access_token"]).get("/api/v1/me/token")
    assert me.status_code == 200, me.text
    assert me.json()["resource"] == MCP_URL
    assert me.json()["owner"] == "lena" and me.json()["scopes"] == ["read", "export"]
    # The token acts as the user, within its scopes.
    projects = _bearer(app, tokens["access_token"]).get("/api/v1/projects")
    assert projects.status_code == 200
    # It is not listed as a personal token.
    assert lead.get("/api/v1/me/tokens").json() == []
    assert len(_audit(app, "oauth.authorize")) == 1
    assert len(_audit(app, "oauth.grant.create")) == 1
    with app.state.repo.db.transaction() as conn:
        stored = conn.execute(select(OAuthCodeRow.code_sha256)).scalar_one()
    assert len(stored) == 64


def _code(app: FastAPI, user: TestClient) -> tuple[dict[str, Any], str, str]:
    client = _register(app)
    verifier, challenge = _pkce()
    query = _consent(user, _params(client["client_id"], challenge))
    return client, query["code"][0], verifier


def test_a_wrong_pkce_verifier_is_refused(app: FastAPI, lead: TestClient) -> None:
    client, code, _ = _code(app, lead)
    other, _ = _pkce()
    for verifier in (other, "too-short", ""):
        response = _token(
            app,
            grant_type="authorization_code",
            code=code,
            redirect_uri=REDIRECT,
            code_verifier=verifier,
            client_id=client["client_id"],
        )
        assert response.status_code == 400
        assert response.json()["error"] in ("invalid_grant", "invalid_request")
    # The challenge itself is not a verifier (no plain method).
    with app.state.repo.db.transaction() as conn:
        challenge = conn.execute(select(OAuthCodeRow.code_challenge)).scalar_one()
    response = _token(
        app,
        grant_type="authorization_code",
        code=code,
        redirect_uri=REDIRECT,
        code_verifier=challenge,
        client_id=client["client_id"],
    )
    assert response.json()["error"] == "invalid_grant"


def test_a_wrong_or_missing_redirect_uri_is_refused(
    app: FastAPI, lead: TestClient
) -> None:
    client, code, verifier = _code(app, lead)
    for redirect in ("https://claude.ai/other", ""):
        response = _token(
            app,
            grant_type="authorization_code",
            code=code,
            redirect_uri=redirect,
            code_verifier=verifier,
            client_id=client["client_id"],
        )
        assert response.status_code == 400
        assert response.json()["error"] in ("invalid_grant", "invalid_request")


def test_a_code_works_only_for_its_client(app: FastAPI, lead: TestClient) -> None:
    _, code, verifier = _code(app, lead)
    thief = _register(app, client_name="Other")
    response = _token(
        app,
        grant_type="authorization_code",
        code=code,
        redirect_uri=REDIRECT,
        code_verifier=verifier,
        client_id=thief["client_id"],
    )
    assert response.json()["error"] == "invalid_grant"


def test_a_reused_code_is_refused_and_revokes_what_it_gave(
    app: FastAPI, lead: TestClient
) -> None:
    client, code, verifier = _code(app, lead)
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT,
        "code_verifier": verifier,
        "client_id": client["client_id"],
    }
    first = _token(app, **form)
    assert first.status_code == 200
    second = _token(app, **form)
    assert second.status_code == 400 and second.json()["error"] == "invalid_grant"
    # The first exchange's tokens are revoked now (RFC 6749 4.1.2).
    access = first.json()["access_token"]
    assert _bearer(app, access).get("/api/v1/me/token").status_code == 401
    refreshed = _token(
        app,
        grant_type="refresh_token",
        refresh_token=first.json()["refresh_token"],
        client_id=client["client_id"],
    )
    assert refreshed.json()["error"] == "invalid_grant"
    assert len(_audit(app, "oauth.code.reuse")) == 1


def test_an_expired_code_is_refused(app: FastAPI, lead: TestClient) -> None:
    client, code, verifier = _code(app, lead)
    later = datetime.now(UTC) + oauth.CODE_LIFETIME + timedelta(seconds=1)
    app.state.oauth._now = lambda: later
    response = _token(
        app,
        grant_type="authorization_code",
        code=code,
        redirect_uri=REDIRECT,
        code_verifier=verifier,
        client_id=client["client_id"],
    )
    assert response.status_code == 400
    assert response.json() == {
        "error": "invalid_grant",
        "error_description": "The code has expired.",
    }


def test_a_token_for_another_resource_is_refused(
    app: FastAPI, lead: TestClient
) -> None:
    client, code, verifier = _code(app, lead)
    response = _token(
        app,
        grant_type="authorization_code",
        code=code,
        redirect_uri=REDIRECT,
        code_verifier=verifier,
        client_id=client["client_id"],
        resource="https://other.example/mcp",
    )
    assert response.json()["error"] == "invalid_target"


def test_an_unknown_grant_type_or_content_type_is_refused(app: FastAPI) -> None:
    client = _register(app)
    response = _token(app, grant_type="password", client_id=client["client_id"])
    assert response.json()["error"] == "unsupported_grant_type"
    as_json = TestClient(app).post(
        "/oauth/token", json={"grant_type": "authorization_code"}
    )
    assert as_json.status_code == 400 and as_json.json()["error"] == "invalid_request"
    unknown = _token(app, grant_type="authorization_code", client_id="otc_nobody")
    assert unknown.status_code == 401 and unknown.json()["error"] == "invalid_client"


def test_a_confidential_client_must_authenticate_as_registered(
    app: FastAPI, lead: TestClient
) -> None:
    client = _register(app, token_endpoint_auth_method="client_secret_basic")
    verifier, challenge = _pkce()
    code = _consent(lead, _params(client["client_id"], challenge))["code"][0]
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT,
        "code_verifier": verifier,
    }
    no_secret = _token(app, client_id=client["client_id"], **form)
    assert no_secret.status_code == 401
    wrong = _token(app, auth=(client["client_id"], "ots_wrong"), **form)
    assert wrong.status_code == 401
    assert wrong.headers["www-authenticate"].startswith("Basic")
    posted = _token(
        app,
        client_id=client["client_id"],
        client_secret=client["client_secret"],
        **form,
    )
    assert posted.status_code == 401  # registered for Basic, not POST
    right = _token(app, auth=(client["client_id"], client["client_secret"]), **form)
    assert right.status_code == 200, right.text


# Refresh, rotation and revocation


def test_a_refresh_rotates_and_a_reused_refresh_token_revokes_the_grant(
    app: FastAPI, lead: TestClient
) -> None:
    client, tokens, _ = _connected(app, lead)
    refreshed = _token(
        app,
        grant_type="refresh_token",
        refresh_token=tokens["refresh_token"],
        client_id=client["client_id"],
    )
    assert refreshed.status_code == 200, refreshed.text
    new = refreshed.json()
    assert new["refresh_token"] != tokens["refresh_token"]
    assert _bearer(app, new["access_token"]).get("/api/v1/me/token").status_code == 200
    # The old refresh token again, after the retry grace: stolen or
    # replayed, so the grant ends.
    later = datetime.now(UTC) + oauth.REFRESH_GRACE + timedelta(seconds=5)
    app.state.oauth._now = lambda: later
    replay = _token(
        app,
        grant_type="refresh_token",
        refresh_token=tokens["refresh_token"],
        client_id=client["client_id"],
    )
    assert replay.json()["error"] == "invalid_grant"
    assert _bearer(app, new["access_token"]).get("/api/v1/me/token").status_code == 401
    again = _token(
        app,
        grant_type="refresh_token",
        refresh_token=new["refresh_token"],
        client_id=client["client_id"],
    )
    assert again.json()["error"] == "invalid_grant"
    assert len(_audit(app, "oauth.refresh.reuse")) == 1


def test_a_refresh_may_narrow_but_never_widen_scopes(
    app: FastAPI, lead: TestClient
) -> None:
    client, tokens, _ = _connected(app, lead)
    widened = _token(
        app,
        grant_type="refresh_token",
        refresh_token=tokens["refresh_token"],
        client_id=client["client_id"],
        scope="read import",
    )
    assert widened.json()["error"] == "invalid_scope"
    narrowed = _token(
        app,
        grant_type="refresh_token",
        refresh_token=tokens["refresh_token"],
        client_id=client["client_id"],
        scope="read",
    )
    assert narrowed.status_code == 200 and narrowed.json()["scope"] == "read"


def test_a_refresh_token_works_only_for_its_client(
    app: FastAPI, lead: TestClient
) -> None:
    _, tokens, _ = _connected(app, lead)
    other = _register(app, client_name="Other")
    response = _token(
        app,
        grant_type="refresh_token",
        refresh_token=tokens["refresh_token"],
        client_id=other["client_id"],
    )
    assert response.json()["error"] == "invalid_grant"


def test_an_expired_access_token_is_refused(app: FastAPI, lead: TestClient) -> None:
    _, tokens, _ = _connected(app, lead)
    later = datetime.now(UTC) + oauth.ACCESS_TOKEN_LIFETIME + timedelta(seconds=1)
    app.state.api_tokens._now = lambda: later
    assert (
        _bearer(app, tokens["access_token"]).get("/api/v1/me/token").status_code == 401
    )


def test_the_client_can_revoke_its_grant(app: FastAPI, lead: TestClient) -> None:
    client, tokens, _ = _connected(app, lead)
    response = TestClient(app).post(
        "/oauth/revoke",
        data={"token": tokens["refresh_token"], "client_id": client["client_id"]},
    )
    assert response.status_code == 200
    assert (
        _bearer(app, tokens["access_token"]).get("/api/v1/me/token").status_code == 401
    )
    assert len(_audit(app, "oauth.grant.revoke")) == 1
    # Unknown tokens are 200 as well and change nothing (RFC 7009).
    unknown = TestClient(app).post(
        "/oauth/revoke", data={"token": "otr_nothing", "client_id": client["client_id"]}
    )
    assert unknown.status_code == 200


def test_another_client_cannot_revoke_a_grant(app: FastAPI, lead: TestClient) -> None:
    _, tokens, _ = _connected(app, lead)
    other = _register(app, client_name="Other")
    TestClient(app).post(
        "/oauth/revoke",
        data={"token": tokens["access_token"], "client_id": other["client_id"]},
    )
    assert (
        _bearer(app, tokens["access_token"]).get("/api/v1/me/token").status_code == 200
    )


def test_profile_lists_and_disconnects_apps(app: FastAPI, lead: TestClient) -> None:
    _, tokens, _ = _connected(app, lead)
    listed = lead.get("/api/v1/me/connections").json()
    assert listed["enabled"] is True and listed["mcp_url"] == MCP_URL
    [connection] = listed["connections"]
    assert connection["client_name"] == "Claude"
    assert connection["redirect_host"] == "claude.ai"
    assert connection["scopes"] == ["read", "export"]
    # Someone else cannot see or end it.
    other = logged_in(app, "otto")
    assert other.get("/api/v1/me/connections").json()["connections"] == []
    foreign = other.post(f"/api/v1/me/connections/{connection['id']}/revoke")
    assert foreign.status_code == 404
    revoked = lead.post(f"/api/v1/me/connections/{connection['id']}/revoke")
    assert revoked.status_code == 200 and revoked.json()["revoked_at"] is not None
    assert (
        _bearer(app, tokens["access_token"]).get("/api/v1/me/token").status_code == 401
    )
    with app.state.repo.db.transaction() as conn:
        reason = conn.execute(
            select(ApiTokenRow.revoked_reason).where(
                ApiTokenRow.oauth_grant_id == connection["id"]
            )
        ).scalar_one()
    assert reason == "revoked"


def test_deactivation_ends_every_grant(app: FastAPI, lead: TestClient) -> None:
    client, tokens, _ = _connected(app, lead)
    app.state.accounts.set_active(HARNESS, "lena", False)
    response = _token(
        app,
        grant_type="refresh_token",
        refresh_token=tokens["refresh_token"],
        client_id=client["client_id"],
    )
    assert response.json()["error"] == "invalid_grant"
    assert (
        _bearer(app, tokens["access_token"]).get("/api/v1/me/token").status_code == 401
    )


def test_a_new_reset_code_ends_every_grant(app: FastAPI, lead: TestClient) -> None:
    client, tokens, _ = _connected(app, lead)
    app.state.accounts.issue_reset_code(HARNESS, "lena")
    response = _token(
        app,
        grant_type="refresh_token",
        refresh_token=tokens["refresh_token"],
        client_id=client["client_id"],
    )
    assert response.json()["error"] == "invalid_grant"


def test_an_access_token_cannot_reach_consent_or_connections(
    app: FastAPI, lead: TestClient
) -> None:
    client, tokens, _ = _connected(app, lead)
    bearer = _bearer(app, tokens["access_token"])
    _, challenge = _pkce()
    shown = bearer.get(
        "/api/v1/oauth/authorization", params=_params(client["client_id"], challenge)
    )
    assert shown.status_code == 403 and shown.json()["code"] == "TOKEN_NOT_ALLOWED"
    assert bearer.get("/api/v1/me/connections").status_code == 403
    assert bearer.get("/api/v1/me/tokens").status_code == 403


def test_refresh_tokens_are_stored_only_as_digests(
    app: FastAPI, lead: TestClient
) -> None:
    _, tokens, _ = _connected(app, lead)
    with app.state.repo.db.transaction() as conn:
        stored = conn.execute(select(OAuthRefreshTokenRow.token_sha256)).scalar_one()
    assert stored == token_digest(tokens["refresh_token"])


def test_pkce_matches_the_rfc_7636_example() -> None:
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert oauth.pkce_matches(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    assert not oauth.pkce_matches(
        verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cN"
    )


@pytest.mark.parametrize(
    ("given", "canonical"),
    [
        ("https://Ex.ORG/mcp/", "https://ex.org/mcp"),
        ("https://ex.org:443/mcp", "https://ex.org/mcp"),
        ("http://127.0.0.1:8765/mcp", "http://127.0.0.1:8765/mcp"),
    ],
)
def test_resources_compare_canonically(given: str, canonical: str) -> None:
    assert oauth.canonical_resource(given) == canonical


def test_a_resource_with_query_or_fragment_is_invalid() -> None:
    for value in ("https://ex.org/mcp?x=1", "https://ex.org/mcp#a", "ftp://ex.org"):
        with pytest.raises(ValueError):
            oauth.canonical_resource(value)


def test_the_mcp_url_setting_must_be_https_in_production() -> None:
    from ontotator.settings import SettingsError, mcp_url

    env = {"ONTOTATOR_MCP_URL": "http://ontotator.example.org/mcp"}
    assert mcp_url(env, production=False) == "http://ontotator.example.org/mcp"
    with pytest.raises(SettingsError, match="https"):
        mcp_url(env, production=True)
    with pytest.raises(SettingsError, match="absolute"):
        mcp_url({"ONTOTATOR_MCP_URL": "https://ex.org/mcp?x=1"}, production=True)
    assert mcp_url({}, production=True) is None


# Consent given before the credentials changed must not become a grant


@pytest.mark.parametrize("change", ["reset_code", "deactivate", "password"])
def test_a_pending_code_dies_with_the_credentials(
    app: FastAPI, lead: TestClient, change: str
) -> None:
    """The attack: consent in a stolen session, exchange after the reset."""
    client, code, verifier = _code(app, lead)
    if change == "reset_code":
        app.state.accounts.issue_reset_code(HARNESS, "lena")
    elif change == "deactivate":
        app.state.accounts.set_active(HARNESS, "lena", False)
    else:
        changed = lead.post(
            "/api/v1/me/password",
            json={
                "current_password": PASSWORD,
                "new_password": "another long passphrase",
            },
        )
        assert changed.status_code in (200, 204), changed.text
    response = _token(
        app,
        grant_type="authorization_code",
        code=code,
        redirect_uri=REDIRECT,
        code_verifier=verifier,
        client_id=client["client_id"],
    )
    assert response.status_code == 400, response.text
    assert response.json()["error"] == "invalid_grant"
    with app.state.repo.db.transaction() as conn:
        assert conn.execute(select(ApiTokenRow.id)).all() == []


# Which address a connection returns to


def test_connected_apps_shows_the_host_the_grant_really_used(
    app: FastAPI, lead: TestClient
) -> None:
    """The attack: register [claude.ai, evil.example], use the second."""
    evil = "https://evil.example/cb"
    client = _register(app, redirect_uris=[REDIRECT, evil])
    verifier, challenge = _pkce()
    params = _params(client["client_id"], challenge, redirect_uri=evil)
    shown = lead.get("/api/v1/oauth/authorization", params=params).json()
    assert shown["redirect_host"] == "evil.example"
    decision = lead.post(
        "/api/v1/oauth/authorization",
        json={"params": shown["params"], "approve": True, "scopes": ["read"]},
    ).json()
    code = parse_qs(urlsplit(decision["redirect_to"]).query)["code"][0]
    exchanged = _token(
        app,
        grant_type="authorization_code",
        code=code,
        redirect_uri=evil,
        code_verifier=verifier,
        client_id=client["client_id"],
    )
    assert exchanged.status_code == 200, exchanged.text
    [connection] = lead.get("/api/v1/me/connections").json()["connections"]
    assert connection["redirect_host"] == "evil.example"


# Conformance


def test_a_loopback_redirect_matches_on_any_port(
    app: FastAPI, lead: TestClient
) -> None:
    client = _register(app, redirect_uris=["http://127.0.0.1/callback"])
    verifier, challenge = _pkce()
    used = "http://127.0.0.1:51004/callback"
    params = _params(client["client_id"], challenge, redirect_uri=used)
    shown = lead.get("/api/v1/oauth/authorization", params=params)
    assert shown.status_code == 200, shown.text
    decision = lead.post(
        "/api/v1/oauth/authorization",
        json={"params": shown.json()["params"], "approve": True, "scopes": ["read"]},
    ).json()
    assert decision["redirect_to"].startswith(used + "?")
    code = parse_qs(urlsplit(decision["redirect_to"]).query)["code"][0]
    exchanged = _token(
        app,
        grant_type="authorization_code",
        code=code,
        redirect_uri=used,
        code_verifier=verifier,
        client_id=client["client_id"],
    )
    assert exchanged.status_code == 200, exchanged.text


@pytest.mark.parametrize(
    "requested",
    [
        "http://127.0.0.1:51004/other",  # another path
        "https://127.0.0.1:51004/callback",  # another scheme
        "http://localhost:51004/callback",  # another loopback name
        "http://127.0.0.1.evil.example:51004/callback",
        "http://127.0.0.1:51004@evil.example/callback",
    ],
)
def test_only_the_port_of_a_loopback_redirect_is_free(requested: str) -> None:
    assert not oauth.registered_redirect(requested, ["http://127.0.0.1/callback"])
    # And never for an https address.
    assert not oauth.registered_redirect(
        "https://claude.ai:8443/cb", ["https://claude.ai/cb"]
    )


def test_no_refresh_token_without_the_refresh_grant_type(
    app: FastAPI, lead: TestClient
) -> None:
    client = _register(app, grant_types=["authorization_code"])
    verifier, challenge = _pkce()
    code = _consent(lead, _params(client["client_id"], challenge))["code"][0]
    response = _token(
        app,
        grant_type="authorization_code",
        code=code,
        redirect_uri=REDIRECT,
        code_verifier=verifier,
        client_id=client["client_id"],
    )
    assert response.status_code == 200, response.text
    assert "refresh_token" not in response.json()
    with app.state.repo.db.transaction() as conn:
        assert conn.execute(select(OAuthRefreshTokenRow.id)).all() == []
    refused = _token(
        app,
        grant_type="refresh_token",
        refresh_token="otr_anything",
        client_id=client["client_id"],
    )
    assert refused.json()["error"] == "unauthorized_client"


def _refresh(app: FastAPI, client: dict[str, Any], token: str) -> Any:
    return _token(
        app,
        grant_type="refresh_token",
        refresh_token=token,
        client_id=client["client_id"],
    )


def test_a_retried_refresh_gets_the_same_answer_within_the_grace(
    app: FastAPI, lead: TestClient
) -> None:
    client, tokens, _ = _connected(app, lead)
    first = _refresh(app, client, tokens["refresh_token"])
    retry = _refresh(app, client, tokens["refresh_token"])
    assert first.status_code == retry.status_code == 200, retry.text
    assert retry.json()["access_token"] == first.json()["access_token"]
    assert retry.json()["refresh_token"] == first.json()["refresh_token"]
    assert _audit(app, "oauth.refresh.reuse") == []
    # Still one chain: one successor row, and it works once.
    with app.state.repo.db.transaction() as conn:
        rows = conn.execute(select(OAuthRefreshTokenRow.used_at)).all()
    assert len(rows) == 2
    assert _refresh(app, client, first.json()["refresh_token"]).status_code == 200


def test_the_grace_does_not_weaken_theft_detection(
    app: FastAPI, lead: TestClient
) -> None:
    client, tokens, _ = _connected(app, lead)
    first = _refresh(app, client, tokens["refresh_token"]).json()
    # The chain moves on; the old token again, even at once, ends the grant.
    second = _refresh(app, client, first["refresh_token"])
    assert second.status_code == 200
    replay = _refresh(app, client, tokens["refresh_token"])
    assert replay.json()["error"] == "invalid_grant"
    assert len(_audit(app, "oauth.refresh.reuse")) == 1
    assert (
        _bearer(app, second.json()["access_token"]).get("/api/v1/me/token").status_code
        == 401
    )


def test_after_the_grace_a_used_refresh_token_revokes_the_grant(
    app: FastAPI, lead: TestClient
) -> None:
    client, tokens, _ = _connected(app, lead)
    first = _refresh(app, client, tokens["refresh_token"]).json()
    later = datetime.now(UTC) + oauth.REFRESH_GRACE + timedelta(seconds=5)
    app.state.oauth._now = lambda: later
    replay = _refresh(app, client, tokens["refresh_token"])
    assert replay.json()["error"] == "invalid_grant"
    assert (
        _refresh(app, client, first["refresh_token"]).json()["error"] == "invalid_grant"
    )


def test_the_successor_cannot_be_computed_from_the_database_or_the_token() -> None:
    old = "otr_" + "a" * 43
    one = oauth._derived(old, "00" * 32, "refresh")
    assert one != oauth._derived(old, "01" * 32, "refresh")
    assert one != oauth._derived(old, "00" * 32, "access")
    assert len(one) == 43


# Issuer and resource configuration


def test_oauth_stays_off_without_a_configured_public_origin(tmp_path) -> None:
    """The issuer must never come from a request's Host header."""
    app = _app(tmp_path, mcp_url=MCP_URL)
    client = TestClient(app, headers={"Host": "evil.example"})
    assert client.get("/.well-known/oauth-authorization-server").status_code == 404
    assert client.post("/oauth/register", json={}).status_code == 404
    assert app.state.oauth is None


def test_the_issuer_ignores_the_host_header(app: FastAPI) -> None:
    body = TestClient(app).get(
        "/.well-known/oauth-authorization-server", headers={"Host": "evil.example"}
    )
    assert body.json()["issuer"] == ISSUER


@pytest.mark.parametrize(
    "value", ["https://mcp.example.org", "https://mcp.example.org/"]
)
def test_an_mcp_url_without_a_path_is_refused(value: str) -> None:
    """The MCP server would default the path and the two sides disagree."""
    from ontotator.config import AppConfig
    from ontotator.settings import SettingsError, mcp_url

    with pytest.raises(SettingsError, match="path"):
        mcp_url({"ONTOTATOR_MCP_URL": value}, production=True)
    with pytest.raises(ValueError):
        AppConfig(workspace_dir=".", mcp_url=value)
