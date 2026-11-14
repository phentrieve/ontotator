"""OAuth endpoints for remote MCP clients (issue 388); see ``ontotator.auth.oauth``.

Protocol endpoints, outside ``/api/`` and so outside the session and token
middleware (they authenticate the client themselves), all 404 unless
``ONTOTATOR_MCP_URL`` is set:

- ``GET /.well-known/oauth-authorization-server`` (RFC 8414)
- ``POST /oauth/register`` (RFC 7591, open)
- ``GET /oauth/authorize``: checks the request and sends the browser on to
  the consent page of the web app (``#/oauth/authorize?...``); a bad client
  or redirect URI gets a plain error page and is never redirected
- ``POST /oauth/token``: ``authorization_code`` with PKCE, ``refresh_token``
- ``POST /oauth/revoke`` (RFC 7009)

Consent and connected apps are session-only API routes
(``ontotator.api.token_scopes``): the consent page reads and decides the
request with ``/api/v1/oauth/authorization``; Profile lists and revokes
connections with ``/api/v1/me/connections``.
"""

from __future__ import annotations

import base64
import binascii
import html
import json
from datetime import datetime
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit

from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from ontotator.api.identity import PrincipalDep
from ontotator.api.security import expected_origin
from ontotator.auth.api_tokens import TokenScope
from ontotator.auth.oauth import (
    AUTH_METHODS,
    GRANT_TYPES,
    OAUTH_SCOPES,
    AuthMethod,
    AuthorizationRequest,
    ConnectedApp,
    InvalidAuthorizationLink,
    OAuthError,
    OAuthService,
    redirect_with,
)
from ontotator.domain.errors import DomainError

protocol_router = APIRouter(include_in_schema=False)
consent_router = APIRouter(prefix="/api/v1/oauth", tags=["oauth"])
connections_router = APIRouter(prefix="/api/v1/me/connections", tags=["oauth"])

NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}
FORM = "application/x-www-form-urlencoded"
# The consent page of the web app (hash routing).
CONSENT_PATH = "/#/oauth/authorize"
AUTHORIZE_PARAMS = (
    "response_type",
    "client_id",
    "redirect_uri",
    "code_challenge",
    "code_challenge_method",
    "state",
    "scope",
    "resource",
)


def _service(request: Request) -> OAuthService | None:
    return getattr(request.app.state, "oauth", None)


def issuer(request: Request) -> str:
    """The issuer identifier: the public origin (always set in production)."""
    config = getattr(request.app.state, "config", None)
    public = getattr(config, "public_origin", None)
    return expected_origin(request, public)


def _not_found() -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"code": "OAUTH_NOT_ENABLED", "details": "OAuth is not enabled."},
    )


def _oauth_error(exc: OAuthError, *, basic: bool = False) -> JSONResponse:
    headers = dict(NO_STORE)
    if exc.status == 401 and basic:
        headers["WWW-Authenticate"] = 'Basic realm="ontotator"'
    return JSONResponse(
        status_code=exc.status,
        content={"error": exc.error, "error_description": exc.description},
        headers=headers,
    )


def _single(pairs: list[tuple[str, str]]) -> dict[str, str]:
    """Parameters as a dict; a repeated one is ``invalid_request`` (RFC 6749 3.1)."""
    params: dict[str, str] = {}
    for name, value in pairs:
        if name in params:
            raise OAuthError("invalid_request", f"The parameter {name} is repeated.")
        params[name] = value
    return params


# Metadata


@protocol_router.get("/.well-known/oauth-authorization-server")
def metadata(request: Request) -> Response:
    """RFC 8414 authorization server metadata."""
    if _service(request) is None:
        return _not_found()
    base = issuer(request)
    return JSONResponse(
        {
            "issuer": base,
            "authorization_endpoint": f"{base}/oauth/authorize",
            "token_endpoint": f"{base}/oauth/token",
            "registration_endpoint": f"{base}/oauth/register",
            "revocation_endpoint": f"{base}/oauth/revoke",
            "response_types_supported": ["code"],
            "grant_types_supported": list(GRANT_TYPES),
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": list(AUTH_METHODS),
            "revocation_endpoint_auth_methods_supported": list(AUTH_METHODS),
            "scopes_supported": list(OAUTH_SCOPES),
            "authorization_response_iss_parameter_supported": True,
            "service_documentation": (
                f"{base}/#/help/getting-started"
                "?section=connect-an-ai-assistant-over-the-internet"
            ),
        },
        headers={"Cache-Control": "max-age=300"},
    )


# Registration


@protocol_router.post("/oauth/register")
async def register(request: Request) -> Response:
    """RFC 7591 dynamic client registration."""
    service = _service(request)
    if service is None:
        return _not_found()
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    if content_type.lower() != "application/json":
        return _oauth_error(
            OAuthError("invalid_client_metadata", "Send the metadata as JSON.")
        )
    try:
        body = json.loads(await request.body())
    except (ValueError, UnicodeDecodeError):
        body = None
    if not isinstance(body, dict):
        return _oauth_error(
            OAuthError("invalid_client_metadata", "The metadata must be an object.")
        )
    try:
        registered = await run_in_threadpool(service.register, body)
    except OAuthError as exc:
        return _oauth_error(exc)
    return JSONResponse(status_code=201, content=registered, headers=NO_STORE)


# Authorization


def _error_page(message: str) -> HTMLResponse:
    """A plain page for a link that must not redirect anywhere."""
    text = html.escape(message)
    page = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>Connection not possible - Ontotator</title></head><body>"
        "<h1>This connection link is not valid</h1>"
        f"<p>{text}</p>"
        "<p>Close this window and start the connection again from your app."
        " Nothing was shared with it.</p></body></html>"
    )
    return HTMLResponse(page, status_code=400, headers=NO_STORE)


@protocol_router.get("/oauth/authorize")
async def authorize(request: Request) -> Response:
    """Check the request, then hand over to the consent page of the web app."""
    service = _service(request)
    if service is None:
        return _not_found()
    try:
        params = _single(parse_qsl(request.url.query, keep_blank_values=True))
    except OAuthError as exc:
        return _error_page(exc.description)
    try:
        _, redirect_uri = await run_in_threadpool(service.check_link, params)
    except InvalidAuthorizationLink as exc:
        return _error_page(str(exc))
    try:
        checked = await run_in_threadpool(service.check_authorization, params)
    except OAuthError as exc:
        return RedirectResponse(
            redirect_with(
                redirect_uri,
                {
                    "error": exc.error,
                    "error_description": exc.description,
                    "state": params.get("state"),
                    "iss": issuer(request),
                },
            ),
            status_code=302,
            headers=NO_STORE,
        )
    return RedirectResponse(
        f"{CONSENT_PATH}?{urlencode(checked.params())}",
        status_code=302,
        headers=NO_STORE,
    )


class AuthorizationParams(BaseModel):
    """The parameters of an authorization request, as the consent page has them."""

    model_config = ConfigDict(extra="forbid")
    response_type: str = Field(max_length=20)
    client_id: str = Field(max_length=200)
    redirect_uri: str = Field(max_length=2000)
    code_challenge: str = Field(max_length=200)
    code_challenge_method: str = Field(max_length=20)
    scope: str | None = Field(default=None, max_length=200)
    resource: str | None = Field(default=None, max_length=2000)
    state: str | None = Field(default=None, max_length=1000)

    def as_dict(self) -> dict[str, str]:
        return {
            name: value
            for name, value in self.model_dump().items()
            if value is not None
        }


class AuthorizationView(BaseModel):
    """What the consent page shows: who asks, for what, and where it goes back."""

    client_name: str
    client_id: str
    redirect_uri: str
    redirect_host: str
    resource: str
    requested_scopes: list[TokenScope]
    # Of the requested scopes, the ones this user may grant.
    allowed_scopes: list[TokenScope]
    params: AuthorizationParams


class AuthorizationDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    params: AuthorizationParams
    approve: bool
    scopes: list[TokenScope] = Field(default_factory=list, max_length=4)


class AuthorizationRedirect(BaseModel):
    """Where the browser goes next: back to the app, with a code or an error."""

    redirect_to: str


def _checked(
    service: OAuthService, params: AuthorizationParams
) -> AuthorizationRequest:
    try:
        return service.check_authorization(params.as_dict())
    except InvalidAuthorizationLink as exc:
        raise DomainError("OAUTH_REQUEST_INVALID", str(exc)) from None
    except OAuthError as exc:
        raise DomainError("OAUTH_REQUEST_INVALID", exc.description) from None


def _enabled(request: Request) -> OAuthService:
    service = _service(request)
    if service is None:
        raise DomainError("OAUTH_NOT_ENABLED", "OAuth is not enabled on this server.")
    return service


@consent_router.get("/authorization")
def authorization(
    request: Request,
    principal: PrincipalDep,
    response_type: str = Query(max_length=20),
    client_id: str = Query(max_length=200),
    redirect_uri: str = Query(max_length=2000),
    code_challenge: str = Query(max_length=200),
    code_challenge_method: str = Query(max_length=20),
    scope: str | None = Query(default=None, max_length=200),
    resource: str | None = Query(default=None, max_length=2000),
    state: str | None = Query(default=None, max_length=1000),
) -> AuthorizationView:
    """The authorization request the consent page asks the user about."""
    service = _enabled(request)
    params = AuthorizationParams(
        response_type=response_type,
        client_id=client_id,
        redirect_uri=redirect_uri,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        scope=scope,
        resource=resource,
        state=state,
    )
    checked = _checked(service, params)
    allowed = service.allowed_scopes(principal)
    return AuthorizationView(
        client_name=checked.client.name,
        client_id=checked.client.client_id,
        redirect_uri=checked.redirect_uri,
        redirect_host=urlsplit(checked.redirect_uri).hostname or "",
        resource=checked.resource,
        requested_scopes=list(checked.scopes),
        allowed_scopes=[scope for scope in checked.scopes if scope in allowed],
        params=AuthorizationParams.model_validate(checked.params()),
    )


@consent_router.post("/authorization")
def decide_authorization(
    body: AuthorizationDecision, request: Request, principal: PrincipalDep
) -> AuthorizationRedirect:
    """Approve (with the scopes left ticked) or decline the request.

    Approving creates a single-use code valid for five minutes, audited as
    ``oauth.authorize``; the browser follows ``redirect_to`` back to the app.
    """
    service = _enabled(request)
    checked = _checked(service, body.params)
    if not body.approve:
        return AuthorizationRedirect(
            redirect_to=service.denied(checked, issuer=issuer(request))
        )
    return AuthorizationRedirect(
        redirect_to=service.approve(
            principal, checked, body.scopes, issuer=issuer(request)
        )
    )


# Token and revocation


def _client_credentials(
    request: Request, form: dict[str, str]
) -> tuple[str | None, str | None, AuthMethod]:
    """The client id, secret and authentication method of a token request."""
    header = request.headers.get("authorization")
    if header is not None:
        scheme, _, value = header.partition(" ")
        if scheme.lower() != "basic":
            raise OAuthError("invalid_client", "Use HTTP Basic or no header.", 401)
        if "client_secret" in form:
            raise OAuthError(
                "invalid_request", "Use one client authentication method only."
            )
        try:
            decoded = base64.b64decode(value.strip(), validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError):
            raise OAuthError(
                "invalid_client", "Malformed Basic credentials.", 401
            ) from None
        client_id, sep, secret = decoded.partition(":")
        if not sep:
            raise OAuthError("invalid_client", "Malformed Basic credentials.", 401)
        # RFC 6749 2.3.1: both are form-urlencoded before Basic encoding.
        client_id, secret = (
            unquote(client_id.replace("+", " ")),
            unquote(secret.replace("+", " ")),
        )
        if form.get("client_id") not in (None, client_id):
            raise OAuthError("invalid_client", "client_id does not match.", 401)
        return client_id, secret, "client_secret_basic"
    if "client_secret" in form:
        return form.get("client_id"), form["client_secret"], "client_secret_post"
    return form.get("client_id"), None, "none"


async def _form(request: Request) -> dict[str, str]:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    if content_type.lower() != FORM:
        raise OAuthError("invalid_request", f"Send the request as {FORM}.")
    try:
        raw = (await request.body()).decode("ascii")
    except UnicodeDecodeError:
        raise OAuthError("invalid_request", "The request is not ASCII.") from None
    return _single(parse_qsl(raw, keep_blank_values=True, strict_parsing=False))


@protocol_router.post("/oauth/token")
async def token(request: Request) -> Response:
    """The token endpoint: a code with its PKCE verifier, or a refresh token."""
    service = _service(request)
    if service is None:
        return _not_found()
    basic = request.headers.get("authorization") is not None
    try:
        form = await _form(request)
        client_id, secret, method = _client_credentials(request, form)
        client = await run_in_threadpool(
            service.authenticate, client_id, secret, method
        )
        grant_type = form.get("grant_type")
        if grant_type == "authorization_code":
            issued = await run_in_threadpool(
                service.exchange_code,
                client,
                form.get("code"),
                form.get("redirect_uri"),
                form.get("code_verifier"),
                form.get("resource"),
            )
        elif grant_type == "refresh_token":
            issued = await run_in_threadpool(
                service.refresh,
                client,
                form.get("refresh_token"),
                form.get("scope"),
                form.get("resource"),
            )
        else:
            raise OAuthError(
                "unsupported_grant_type",
                "grant_type must be authorization_code or refresh_token.",
            )
    except OAuthError as exc:
        return _oauth_error(exc, basic=basic)
    return JSONResponse(issued.body(), headers=NO_STORE)


@protocol_router.post("/oauth/revoke")
async def revoke(request: Request) -> Response:
    """RFC 7009: the client ends a grant by one of its tokens; always 200."""
    service = _service(request)
    if service is None:
        return _not_found()
    basic = request.headers.get("authorization") is not None
    try:
        form = await _form(request)
        client_id, secret, method = _client_credentials(request, form)
        client = await run_in_threadpool(
            service.authenticate, client_id, secret, method
        )
        await run_in_threadpool(service.revoke_token, client, form.get("token"))
    except OAuthError as exc:
        return _oauth_error(exc, basic=basic)
    return Response(status_code=200, headers=NO_STORE)


# Connected apps (Profile)


class ConnectionView(BaseModel):
    """An app the user connected with OAuth (a grant), without any token."""

    id: int
    client_name: str
    redirect_host: str
    scopes: list[TokenScope]
    resource: str
    created_at: datetime
    expires_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    revoked_reason: str | None

    @classmethod
    def of(cls, app: ConnectedApp) -> ConnectionView:
        return cls(
            id=app.id,
            client_name=app.client_name,
            redirect_host=app.redirect_host,
            scopes=list(app.scopes),
            resource=app.resource,
            created_at=app.created_at,
            expires_at=app.expires_at,
            last_used_at=app.last_used_at,
            revoked_at=app.revoked_at,
            revoked_reason=app.revoked_reason,
        )


class Connections(BaseModel):
    """Profile > Connected apps; ``enabled`` is false without ``ONTOTATOR_MCP_URL``."""

    enabled: bool
    mcp_url: str | None
    connections: list[ConnectionView]


@connections_router.get("")
def list_connections(request: Request, principal: PrincipalDep) -> Connections:
    """The user's connected apps, newest first (ended ones for 30 days)."""
    service = _service(request)
    if service is None:
        return Connections(enabled=False, mcp_url=None, connections=[])
    return Connections(
        enabled=True,
        mcp_url=service.resource,
        connections=[
            ConnectionView.of(app) for app in service.connections(principal.user_id)
        ],
    )


@connections_router.post("/{grant_id}/revoke")
def revoke_connection(
    grant_id: int, request: Request, principal: PrincipalDep
) -> ConnectionView:
    """Disconnect an app: its access and refresh tokens stop working at once."""
    service = _enabled(request)
    service.revoke_connection(principal, grant_id)
    found = next(
        (app for app in service.connections(principal.user_id) if app.id == grant_id),
        None,
    )
    if found is None:  # revoked more than 30 days ago
        raise DomainError(
            "OAUTH_CONNECTION_NOT_FOUND", "There is no such connected app."
        )
    return ConnectionView.of(found)
