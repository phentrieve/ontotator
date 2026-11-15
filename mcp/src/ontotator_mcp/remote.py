"""``ontotator-mcp --http``: the MCP server over Streamable HTTP (issue 388).

Every request must carry the caller's own Ontotator token in
``Authorization: Bearer``. The server checks it with ``GET
/api/v1/me/token`` on the Ontotator instance and then sends that same
token, and only that token, with every API call the request makes. A
token is accepted when it is

- an OAuth access token Ontotator issued for this server (its
  ``resource`` is ``ONTOTATOR_MCP_URL``; a claude.ai connector gets one
  through the OAuth flow announced in the protected resource metadata), or
- a plain API token from Profile > API tokens (no ``resource``), for clients
  that can send a fixed header.

A token issued for another resource is refused. Ontotator still checks
scope and the owner's roles on every call; this server keeps no state and
no token between requests.

Before any of this, a request whose ``Origin`` is not allowed gets 403 and
one for another ``Host`` 421 (DNS rebinding); without a usable token it
gets 401 with ``WWW-Authenticate: Bearer resource_metadata=...``.
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from mcp.server.auth.provider import AccessToken
from mcp.server.auth.routes import (
    build_resource_metadata_url,
    create_protected_resource_routes,
)
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from ontotator_mcp.client import OntotatorClient
from ontotator_mcp.config import HttpSettings
from ontotator_mcp.errors import OntotatorError

logger = logging.getLogger(__name__)

LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "[::1]")
HEALTH_PATH = "/healthz"
MAX_TOKEN_LENGTH = 512
# The token scopes the tools use (``tooling.Scope`` without admin, which an
# OAuth token never holds).
SCOPES = ("read", "import", "export", "project-admin")
# Tokens Ontotator refused are remembered this long (by their SHA-256, at
# most this many), so a stream of junk bearers costs one API call each, not
# one per request.
REFUSED_TTL = 30.0
REFUSED_MAX = 4096


class OntotatorTokenVerifier:
    """Checks a bearer token against the Ontotator instance (``TokenVerifier``)."""

    def __init__(self, api: OntotatorClient, resource: str) -> None:
        self.api = api
        self.resource = resource.rstrip("/")
        # SHA-256 of a refused token -> when to ask Ontotator again. Only
        # refusals are cached: an accepted token is checked on every
        # request, so a revocation takes effect at once.
        self._refused: dict[str, float] = {}

    def _was_refused(self, digest: str) -> bool:
        until = self._refused.get(digest)
        if until is None:
            return False
        if until <= time.monotonic():
            del self._refused[digest]
            return False
        return True

    def _remember_refused(self, digest: str) -> None:
        now = time.monotonic()
        if len(self._refused) >= REFUSED_MAX:
            for key in [k for k, until in self._refused.items() if until <= now]:
                del self._refused[key]
            while len(self._refused) >= REFUSED_MAX:  # still full: drop oldest
                del self._refused[next(iter(self._refused))]
        self._refused[digest] = now + REFUSED_TTL

    async def verify_token(self, token: str) -> AccessToken | None:
        token = token.strip()
        if not token or len(token) > MAX_TOKEN_LENGTH or not token.isascii():
            return None
        digest = hashlib.sha256(token.encode("ascii")).hexdigest()
        if self._was_refused(digest):
            return None
        try:
            response = await self.api.token_record(token)
        except OntotatorError as exc:
            # Ontotator unreachable: refuse, but say why in the log.
            logger.warning("Token check failed: %s", exc)
            return None
        if response.status_code in (401, 403):
            # Unknown, expired or revoked: it cannot become valid later.
            self._remember_refused(digest)
            return None
        if response.status_code != 200:
            return None
        try:
            record: dict[str, Any] = response.json()
        except ValueError:
            return None
        resource = record.get("resource")
        if resource is not None and str(resource).rstrip("/") != self.resource:
            # Issued for another resource (RFC 8707): not ours to use.
            logger.warning("Refused a token issued for another resource.")
            return None
        expires_at: int | None = None
        try:
            expires_at = int(
                datetime.fromisoformat(str(record["expires_at"])).timestamp()
            )
        except (KeyError, ValueError):
            return None
        return AccessToken(
            token=token,
            client_id=f"ontotator-token:{record.get('id')}",
            scopes=[str(scope) for scope in record.get("scopes", [])],
            expires_at=expires_at,
            resource=self.resource,
            subject=str(record.get("owner")) if record.get("owner") else None,
        )


class OriginGuard:
    """Refuse a foreign ``Origin`` (403) or ``Host`` (421) before anything else.

    It runs ahead of authentication, so a page on another site learns
    nothing and causes no token check. A request without ``Origin`` (a
    server-side client such as a claude.ai connector, Claude Code) passes.
    Loopback hosts are always allowed, for the container's health check.

    ``open_paths`` (the protected resource metadata) skip the Origin check,
    not the Host check: a browser-based MCP client on any site must be able
    to read where to authorize, and the document is public.
    """

    def __init__(
        self,
        app: ASGIApp,
        settings: HttpSettings,
        open_paths: frozenset[str] = frozenset(),
    ) -> None:
        self.app = app
        self.open_paths = open_paths
        self.hosts = {host.lower() for host in settings.allowed_hosts}
        self.origins = {origin.lower() for origin in settings.allowed_origins}

    def _host_ok(self, host: str) -> bool:
        host = host.lower()
        if host in self.hosts:
            return True
        name = host.rsplit(":", 1)[0] if not host.endswith("]") else host
        return name in LOOPBACK_HOSTS or host in LOOPBACK_HOSTS

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        origin = headers.get("origin")
        response: Response | None = None
        if (
            origin is not None
            and scope.get("path", "") not in self.open_paths
            and origin.lower().rstrip("/") not in self.origins
        ):
            response = JSONResponse(
                {"error": "forbidden", "error_description": "Origin not allowed."},
                status_code=403,
            )
        elif not self._host_ok(headers.get("host", "")):
            response = JSONResponse(
                {"error": "misdirected", "error_description": "Host not allowed."},
                status_code=421,
            )
        if response is not None:
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def auth_settings(settings: HttpSettings, issuer: str) -> AuthSettings:
    """The resource server settings: Ontotator is the authorization server."""
    return AuthSettings(
        issuer_url=issuer,  # type: ignore[arg-type]
        resource_server_url=settings.public_url,  # type: ignore[arg-type]
        # OntotatorTokenVerifier checks the resource itself: a plain API
        # token (no resource) is accepted, one for another resource is not.
        validate_token_resource=False,
        required_scopes=None,
    )


def http_app(server: MCPServer, settings: HttpSettings) -> ASGIApp:
    """The ASGI app of ``--http``: stateless JSON on ``settings.path``."""

    @server.custom_route(HEALTH_PATH, methods=["GET"])  # type: ignore[untyped-decorator]
    async def health(_request: Request) -> Response:
        return PlainTextResponse("ok")

    security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[*settings.allowed_hosts, *(f"{h}:*" for h in LOOPBACK_HOSTS)],
        allowed_origins=list(settings.allowed_origins),
    )
    app = server.streamable_http_app(
        streamable_http_path=settings.path,
        stateless_http=True,
        json_response=True,
        transport_security=security,
        host=settings.host,
    )
    auth = server.settings.auth
    assert auth is not None and auth.resource_server_url is not None
    # The protected resource metadata (RFC 9728) with the scopes a client
    # may ask for, so a connector asks for all and the user narrows them on
    # the consent page. The SDK's own route lists only required scopes.
    metadata = Starlette(
        routes=create_protected_resource_routes(
            resource_url=auth.resource_server_url,
            authorization_servers=[auth.issuer_url],
            scopes_supported=list(SCOPES),
            resource_name="Ontotator",
        )
    )
    path = urlsplit(str(build_resource_metadata_url(auth.resource_server_url))).path
    return OriginGuard(_Dispatch(app, {path: metadata}), settings, frozenset({path}))


class _Dispatch:
    """``routes[path]`` for exactly that path, ``app`` for everything else."""

    def __init__(self, app: ASGIApp, routes: dict[str, ASGIApp]) -> None:
        self.app = app
        self.routes = routes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        target = (
            self.routes.get(scope.get("path", "")) if scope["type"] == "http" else None
        )
        await (target or self.app)(scope, receive, send)


def run(server: MCPServer, settings: HttpSettings) -> None:
    """Serve ``server`` until stopped."""
    import uvicorn

    uvicorn.run(
        http_app(server, settings),
        host=settings.host,
        port=settings.port,
        log_level="warning",
        # Behind the reverse proxy; client addresses are not used here.
        proxy_headers=False,
        server_header=False,
        timeout_graceful_shutdown=10,
    )
