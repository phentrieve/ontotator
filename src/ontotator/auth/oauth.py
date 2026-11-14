"""The OAuth 2.1 authorization server for remote MCP clients (issue 388).

A remote MCP client (a claude.ai custom connector, Claude Code, ...) cannot
be handed an API token; it gets one through the authorization code flow of
the MCP authorization spec instead:

1. It registers itself (RFC 7591 dynamic client registration): a name and
   its redirect URIs. Nothing is granted by registering.
2. It sends the user to the authorization endpoint with a PKCE challenge
   (S256 only) and the ``resource`` it wants a token for (RFC 8707). The
   user logs in to Ontotator as usual and consents on the consent page,
   choosing scopes no broader than their own roles allow.
3. It exchanges the single-use, short-lived code with the PKCE verifier for
   an access token and a refresh token, and refreshes from then on; every
   refresh token is used once and replaced (rotation). A refresh token or
   code used a second time revokes the whole grant (theft detection).

Design: the access token **is an Ontotator API token** (an ``api_tokens``
row of kind ``personal`` that names its grant), bound to the one MCP
resource this server issues tokens for (``ONTOTATOR_MCP_URL``). The MCP
server accepts only tokens for its own resource (or plain API tokens) and
forwards them to the Ontotator API, which still checks scope and the
owner's roles on every request. This is deliberate, not token
passthrough: the token's audience is the Ontotator API reached through
that MCP server, which is the only thing it is valid for. It is short-lived
(one hour), never holds the ``admin`` scope, and cannot reach the
session-only routes (tokens, consent, preferences).

Codes, refresh tokens and client secrets are stored only as SHA-256
digests. Revoking a grant (Profile > Connected apps, the client's
revocation endpoint, a new password, deactivation, anonymisation) revokes
its access and refresh tokens at once.
"""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
import unicodedata
from collections.abc import Callable, Iterable, Mapping
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast
from urllib.parse import urlencode, urlsplit, urlunsplit

from sqlalchemy import Connection, exists, func, insert, select, update

from ontotator.auth.api_tokens import TOKEN_PREFIX, TokenScope, new_token
from ontotator.auth.audit import Actor, record_audit
from ontotator.auth.sessions import Principal
from ontotator.auth.tokens import token_digest
from ontotator.domain.errors import DomainError
from ontotator.storage.database import Database
from ontotator.storage.tables import (
    ApiTokenRow,
    OAuthClientRow,
    OAuthCodeRow,
    OAuthGrantRow,
    OAuthRefreshTokenRow,
    ProjectMembershipRow,
    ProjectRow,
    UserRow,
)

OAUTH_SCOPES: tuple[TokenScope, ...] = ("read", "import", "export", "project-admin")
DEFAULT_SCOPES: tuple[TokenScope, ...] = ("read",)
# Scopes beyond read are offered only to someone who leads a project or
# administers the server: nobody else could use them anyway.
ELEVATED_SCOPES: frozenset[str] = frozenset({"import", "export", "project-admin"})
AuthMethod = Literal["none", "client_secret_post", "client_secret_basic"]
AUTH_METHODS: tuple[AuthMethod, ...] = (
    "none",
    "client_secret_post",
    "client_secret_basic",
)
GRANT_TYPES = ("authorization_code", "refresh_token")

CODE_LIFETIME = timedelta(minutes=5)
ACCESS_TOKEN_LIFETIME = timedelta(hours=1)
REFRESH_TOKEN_LIFETIME = timedelta(days=30)
# After this the user consents again, whatever the refreshes.
GRANT_LIFETIME = timedelta(days=90)
# Open registration is rate limited for the whole server.
REGISTRATIONS_PER_HOUR = 100

CLIENT_PREFIX = "otc_"
SECRET_PREFIX = "ots_"
CODE_PREFIX = "otk_"
REFRESH_PREFIX = "otr_"
MAX_SECRET_LENGTH = 128
MAX_REDIRECT_URIS = 5
MAX_URI_LENGTH = 2000
MAX_CLIENT_NAME = 100
MAX_STATE_LENGTH = 1000
# RFC 7636: the S256 challenge is 43 base64url characters; the verifier
# 43 to 128 unreserved characters.
_CHALLENGE = re.compile(r"^[A-Za-z0-9_-]{43}$")
_VERIFIER = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")
_LOOPBACK = ("localhost", "127.0.0.1", "::1")


class OAuthError(Exception):
    """An OAuth protocol error (RFC 6749 section 5.2 and 4.1.2.1)."""

    def __init__(self, error: str, description: str, status: int = 400) -> None:
        super().__init__(description)
        self.error = error
        self.description = description
        self.status = status


class InvalidAuthorizationLink(Exception):
    """The client or redirect URI of an authorization request is not valid.

    The user must not be redirected anywhere then (RFC 6749 4.1.2.1).
    """


@dataclass(frozen=True)
class Client:
    id: int
    client_id: str
    name: str
    redirect_uris: tuple[str, ...]
    auth_method: AuthMethod


@dataclass(frozen=True)
class AuthorizationRequest:
    """A checked authorization request, as the consent page shows it."""

    client: Client
    redirect_uri: str
    code_challenge: str
    state: str | None
    scopes: tuple[TokenScope, ...]
    resource: str

    def params(self) -> dict[str, str]:
        """The request as authorization endpoint parameters."""
        params = {
            "response_type": "code",
            "client_id": self.client.client_id,
            "redirect_uri": self.redirect_uri,
            "code_challenge": self.code_challenge,
            "code_challenge_method": "S256",
            "scope": " ".join(self.scopes),
            "resource": self.resource,
        }
        if self.state is not None:
            params["state"] = self.state
        return params


@dataclass(frozen=True)
class IssuedTokens:
    access_token: str
    refresh_token: str
    expires_in: int
    scopes: tuple[TokenScope, ...]

    def body(self) -> dict[str, Any]:
        return {
            "access_token": self.access_token,
            "token_type": "Bearer",
            "expires_in": self.expires_in,
            "refresh_token": self.refresh_token,
            "scope": " ".join(self.scopes),
        }


@dataclass(frozen=True)
class ConnectedApp:
    """A grant as its user sees it: Profile > Connected apps."""

    id: int
    client_name: str
    redirect_host: str
    scopes: tuple[TokenScope, ...]
    resource: str
    created_at: datetime
    expires_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    revoked_reason: str | None


def canonical_resource(value: str) -> str:
    """``value`` as an absolute http(s) URL compared exactly (RFC 8707).

    Scheme and host lower-cased, a default port dropped, a trailing ``/``
    removed. Raises ``ValueError`` for anything else, a query or fragment
    included.
    """
    parts = urlsplit(value.strip())
    port = parts.port
    if (
        parts.scheme not in ("http", "https")
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
        or "#" in value
        or "?" in value
    ):
        raise ValueError("not an absolute http(s) URL without query or fragment")
    host = parts.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    if port is not None and port != {"http": 80, "https": 443}[parts.scheme]:
        host = f"{host}:{port}"
    return urlunsplit((parts.scheme, host, parts.path.rstrip("/"), "", ""))


def _loopback(host: str | None) -> bool:
    return host is not None and host.lower() in _LOOPBACK


def check_redirect_uri(uri: str) -> str:
    """A redirect URI a client may register: https, or http on loopback.

    No fragment and no user info (OAuth 2.1 section 2.3.1); compared byte
    for byte later, so it is stored as given.
    """
    if not isinstance(uri, str) or not uri or len(uri) > MAX_URI_LENGTH:
        raise OAuthError("invalid_redirect_uri", "A redirect URI is missing or long.")
    if not uri.isascii() or any(ch.isspace() or ord(ch) < 32 for ch in uri):
        raise OAuthError(
            "invalid_redirect_uri", "A redirect URI must be printable ASCII."
        )
    try:
        parts = urlsplit(uri)
        parts.port  # noqa: B018 - raises for an invalid port
    except ValueError:
        raise OAuthError("invalid_redirect_uri", "A redirect URI is invalid.") from None
    if parts.fragment or "#" in uri:
        raise OAuthError(
            "invalid_redirect_uri", "A redirect URI must not have a fragment."
        )
    if not parts.hostname or parts.username is not None or "@" in parts.netloc:
        raise OAuthError(
            "invalid_redirect_uri", "A redirect URI needs a host and no user info."
        )
    if parts.scheme == "https":
        return uri
    if parts.scheme == "http" and _loopback(parts.hostname):
        return uri
    raise OAuthError(
        "invalid_redirect_uri",
        "A redirect URI must use https, or http on localhost or a loopback address.",
    )


def _clean_name(value: object) -> str:
    if not isinstance(value, str):
        return "Unnamed app"
    cleaned = "".join(ch for ch in value if unicodedata.category(ch)[0] not in ("C",))
    cleaned = " ".join(cleaned.split())[:MAX_CLIENT_NAME]
    return cleaned or "Unnamed app"


def pkce_matches(verifier: str, challenge: str) -> bool:
    """RFC 7636 S256: ``BASE64URL(SHA256(verifier)) == challenge``."""
    if not _VERIFIER.fullmatch(verifier):
        return False
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return secrets.compare_digest(computed, challenge)


def _scopes(
    raw: str | None, *, default: tuple[TokenScope, ...]
) -> tuple[TokenScope, ...]:
    if raw is None or not raw.strip():
        return default
    # offline_access (OIDC, SEP-2207) asks for a refresh token, which every
    # grant gets anyway; it is accepted and dropped, never stored.
    given = set(raw.split()) - {"offline_access"}
    if not given:
        return default
    unknown = sorted(given - set(OAUTH_SCOPES))
    if unknown:
        raise OAuthError("invalid_scope", f"Unknown scope(s): {', '.join(unknown)}.")
    return tuple(scope for scope in OAUTH_SCOPES if scope in given)


def redirect_with(redirect_uri: str, params: Mapping[str, str | None]) -> str:
    """``redirect_uri`` with ``params`` added to its query."""
    parts = urlsplit(redirect_uri)
    extra = urlencode(
        {key: value for key, value in params.items() if value is not None}
    )
    query = f"{parts.query}&{extra}" if parts.query else extra
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))


class OAuthService:
    """Clients, consent, codes, tokens and grants for one MCP resource."""

    def __init__(
        self,
        db: Database,
        resource: str,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.db = db
        self.resource = canonical_resource(resource)
        self._now = now

    # Registration (RFC 7591)

    def register(self, metadata: Mapping[str, Any]) -> dict[str, Any]:
        """Register a client from its metadata; the registration response.

        A confidential client's secret is in the response only.
        """
        uris = metadata.get("redirect_uris")
        if not isinstance(uris, list) or not 1 <= len(uris) <= MAX_REDIRECT_URIS:
            raise OAuthError(
                "invalid_redirect_uri",
                f"Give 1 to {MAX_REDIRECT_URIS} redirect_uris.",
            )
        redirect_uris = [check_redirect_uri(uri) for uri in uris]
        method = metadata.get("token_endpoint_auth_method", "client_secret_basic")
        if method not in AUTH_METHODS:
            raise OAuthError(
                "invalid_client_metadata",
                "token_endpoint_auth_method must be one of: " + ", ".join(AUTH_METHODS),
            )
        grant_types = metadata.get("grant_types", ["authorization_code"])
        if (
            not isinstance(grant_types, list)
            or not grant_types
            or not set(grant_types) <= set(GRANT_TYPES)
            or "authorization_code" not in grant_types
        ):
            raise OAuthError(
                "invalid_client_metadata",
                "grant_types must be authorization_code, optionally with"
                " refresh_token.",
            )
        response_types = metadata.get("response_types", ["code"])
        if response_types != ["code"]:
            raise OAuthError(
                "invalid_client_metadata", "response_types must be ['code']."
            )
        if "scope" in metadata and metadata["scope"] is not None:
            if not isinstance(metadata["scope"], str):
                raise OAuthError("invalid_client_metadata", "scope must be a string.")
            try:
                _scopes(metadata["scope"], default=DEFAULT_SCOPES)
            except OAuthError as exc:
                raise OAuthError("invalid_client_metadata", exc.description) from None
        name = _clean_name(metadata.get("client_name"))
        now = self._now()
        client_id = CLIENT_PREFIX + secrets.token_urlsafe(24)
        secret = None if method == "none" else SECRET_PREFIX + secrets.token_urlsafe(32)
        with self.db.transaction() as conn:
            # One registration at a time, so the hourly limit holds.
            conn.execute(
                select(func.pg_advisory_xact_lock(func.hashtext("oauth_register")))
            )
            recent = conn.execute(
                select(func.count())
                .select_from(OAuthClientRow)
                .where(OAuthClientRow.created_at > now - timedelta(hours=1))
            ).scalar_one()
            if recent >= REGISTRATIONS_PER_HOUR:
                raise OAuthError(
                    "temporarily_unavailable",
                    "Too many client registrations; try again later.",
                    status=429,
                )
            row_id = conn.execute(
                insert(OAuthClientRow)
                .values(
                    client_id=client_id,
                    secret_sha256=None if secret is None else token_digest(secret),
                    name=name,
                    redirect_uris=redirect_uris,
                    auth_method=method,
                    created_at=now,
                )
                .returning(OAuthClientRow.id)
            ).scalar_one()
            record_audit(
                conn,
                Actor(None, "oauth:registration"),
                "oauth.client.register",
                target_type="oauth_client",
                target_id=row_id,
                details={
                    "client_id": client_id,
                    "name": name,
                    "redirect_uris": redirect_uris,
                    "auth_method": method,
                },
                at=now,
            )
        body: dict[str, Any] = {
            "client_id": client_id,
            "client_id_issued_at": int(now.timestamp()),
            "client_name": name,
            "redirect_uris": redirect_uris,
            "token_endpoint_auth_method": method,
            "grant_types": list(grant_types),
            "response_types": ["code"],
        }
        if secret is not None:
            body["client_secret"] = secret
            body["client_secret_expires_at"] = 0
        if isinstance(metadata.get("scope"), str):
            body["scope"] = metadata["scope"]
        return body

    def client(self, client_id: str | None) -> Client | None:
        if not client_id or len(client_id) > 200:
            return None
        with self.db.transaction() as conn:
            return _client(conn, client_id)

    def authenticate(
        self,
        client_id: str | None,
        secret: str | None,
        used: AuthMethod,
    ) -> Client:
        """The client of a token or revocation request, or ``invalid_client``.

        The method used must be the one registered; a secret is compared by
        its digest in constant time.
        """
        client = self.client(client_id)
        if client is None:
            raise OAuthError("invalid_client", "Unknown client.", status=401)
        if client.auth_method != used:
            raise OAuthError(
                "invalid_client",
                f"This client authenticates with {client.auth_method}.",
                status=401,
            )
        if used != "none":
            with self.db.transaction() as conn:
                stored = conn.execute(
                    select(OAuthClientRow.secret_sha256).where(
                        OAuthClientRow.id == client.id
                    )
                ).scalar_one()
            if (
                not secret
                or len(secret) > MAX_SECRET_LENGTH
                or stored is None
                or not secrets.compare_digest(token_digest(secret), stored)
            ):
                raise OAuthError(
                    "invalid_client", "The client secret is wrong.", status=401
                )
        return client

    # Authorization and consent

    def check_link(self, params: Mapping[str, str]) -> tuple[Client, str]:
        """The client and redirect URI, or ``InvalidAuthorizationLink``.

        Until both are known to be right, the user is never redirected.
        """
        client = self.client(params.get("client_id"))
        if client is None:
            raise InvalidAuthorizationLink("The app that sent you here is unknown.")
        redirect_uri = params.get("redirect_uri")
        if redirect_uri is None and len(client.redirect_uris) == 1:
            redirect_uri = client.redirect_uris[0]
        if redirect_uri is None or redirect_uri not in client.redirect_uris:
            raise InvalidAuthorizationLink(
                "The app asked to send you back to an address it did not register."
            )
        return client, redirect_uri

    def check_authorization(self, params: Mapping[str, str]) -> AuthorizationRequest:
        """Check an authorization request (after ``check_link`` passed).

        Raises ``OAuthError`` for anything the client is told by redirect.
        """
        client, redirect_uri = self.check_link(params)
        if params.get("response_type") != "code":
            raise OAuthError(
                "unsupported_response_type", "Only response_type=code is supported."
            )
        challenge = params.get("code_challenge")
        if not challenge:
            raise OAuthError("invalid_request", "PKCE is required (code_challenge).")
        if params.get("code_challenge_method") != "S256":
            raise OAuthError(
                "invalid_request", "Only the S256 code_challenge_method is supported."
            )
        if not _CHALLENGE.fullmatch(challenge):
            raise OAuthError("invalid_request", "The code_challenge is malformed.")
        state = params.get("state")
        if state is not None and len(state) > MAX_STATE_LENGTH:
            raise OAuthError("invalid_request", "The state is too long.")
        scopes = _scopes(params.get("scope"), default=DEFAULT_SCOPES)
        raw_resource = params.get("resource")
        resource = self.resource
        if raw_resource is not None:
            try:
                resource = canonical_resource(raw_resource)
            except ValueError:
                raise OAuthError("invalid_target", "The resource is invalid.") from None
            if resource != self.resource:
                raise OAuthError(
                    "invalid_target",
                    "This server issues tokens for its MCP server only.",
                )
        return AuthorizationRequest(
            client=client,
            redirect_uri=redirect_uri,
            code_challenge=challenge,
            state=state,
            scopes=scopes,
            resource=resource,
        )

    def allowed_scopes(self, principal: Principal) -> tuple[TokenScope, ...]:
        """The scopes ``principal`` may grant: read, and more for leads and admins."""
        if principal.is_system_admin:
            return OAUTH_SCOPES
        with self.db.transaction() as conn:
            leads = conn.execute(
                select(
                    exists().where(
                        ProjectMembershipRow.user_id == principal.user_id,
                        ProjectMembershipRow.role == "lead",
                        ProjectMembershipRow.project_id == ProjectRow.id,
                        ProjectRow.practice.is_(False),
                    )
                )
            ).scalar_one()
        if leads:
            return OAUTH_SCOPES
        return tuple(scope for scope in OAUTH_SCOPES if scope not in ELEVATED_SCOPES)

    def approve(
        self,
        principal: Principal,
        request: AuthorizationRequest,
        scopes: Iterable[str],
        *,
        issuer: str,
    ) -> str:
        """The redirect back to the client with a new code, audited.

        ``scopes`` are the ones the user left ticked: a subset of the
        requested ones and of what the user may grant.
        """
        if principal.token is not None or principal.session_id is None:
            raise DomainError(
                "OAUTH_REQUEST_INVALID", "Consent needs a browser session."
            )
        chosen = set(scopes)
        allowed = set(self.allowed_scopes(principal))
        if not chosen or not chosen <= set(request.scopes) or not chosen <= allowed:
            raise DomainError(
                "OAUTH_REQUEST_INVALID",
                "Choose at least one of the requested scopes you may grant.",
            )
        granted = [scope for scope in OAUTH_SCOPES if scope in chosen]
        code = CODE_PREFIX + secrets.token_urlsafe(32)
        now = self._now()
        with self.db.transaction() as conn:
            active = conn.execute(
                select(UserRow.active, UserRow.anonymised_at).where(
                    UserRow.id == principal.user_id
                )
            ).one()
            if not active.active or active.anonymised_at is not None:
                raise DomainError("USER_INACTIVE", "This account is not active.")
            conn.execute(
                insert(OAuthCodeRow).values(
                    code_sha256=token_digest(code),
                    client_id=request.client.id,
                    user_id=principal.user_id,
                    redirect_uri=request.redirect_uri,
                    code_challenge=request.code_challenge,
                    scopes=granted,
                    resource=request.resource,
                    created_at=now,
                    expires_at=now + CODE_LIFETIME,
                )
            )
            record_audit(
                conn,
                Actor.user(principal.user_id, principal.username),
                "oauth.authorize",
                target_type="oauth_client",
                target_id=request.client.id,
                details={
                    "client_id": request.client.client_id,
                    "client_name": request.client.name,
                    "redirect_uri": request.redirect_uri,
                    "scopes": granted,
                    "resource": request.resource,
                },
                at=now,
            )
        return redirect_with(
            request.redirect_uri,
            {"code": code, "state": request.state, "iss": issuer},
        )

    # Token endpoint

    def exchange_code(
        self,
        client: Client,
        code: str | None,
        redirect_uri: str | None,
        verifier: str | None,
        resource: str | None,
    ) -> IssuedTokens:
        """Tokens for a code (grant_type=authorization_code)."""
        if not code or not code.startswith(CODE_PREFIX) or len(code) > 128:
            raise OAuthError("invalid_grant", "The code is invalid.")
        if not verifier:
            raise OAuthError("invalid_request", "code_verifier is required.")
        if not redirect_uri:
            raise OAuthError("invalid_request", "redirect_uri is required.")
        now = self._now()
        with self.db.transaction() as conn:
            row = conn.execute(
                select(OAuthCodeRow)
                .where(OAuthCodeRow.code_sha256 == token_digest(code))
                .with_for_update()
            ).one_or_none()
            if row is None or row.client_id != client.id:
                raise OAuthError("invalid_grant", "The code is invalid.")
            if row.used_at is None:
                return self._redeem(
                    conn, client, row, redirect_uri, verifier, resource, now
                )
            # A second use: the code may have leaked. End what it gave.
            if row.grant_id is not None:
                _revoke_grant(conn, row.grant_id, "code_reused", now)
            record_audit(
                conn,
                Actor(None, "oauth:token"),
                "oauth.code.reuse",
                target_type="oauth_client",
                target_id=client.id,
                details={"client_id": client.client_id, "grant_id": row.grant_id},
                at=now,
            )
        # Committed: the grant stays revoked although the request fails.
        raise OAuthError("invalid_grant", "The code was used.")

    def _redeem(
        self,
        conn: Connection,
        client: Client,
        row: Any,
        redirect_uri: str,
        verifier: str,
        resource: str | None,
        now: datetime,
    ) -> IssuedTokens:
        """The first use of a code: check it and issue the grant's tokens."""
        if now >= row.expires_at:
            raise OAuthError("invalid_grant", "The code has expired.")
        if redirect_uri != row.redirect_uri:
            raise OAuthError("invalid_grant", "redirect_uri does not match.")
        if not pkce_matches(verifier, row.code_challenge):
            raise OAuthError("invalid_grant", "The code_verifier does not match.")
        if resource is not None and _resource(resource) != row.resource:
            raise OAuthError("invalid_target", "resource does not match.")
        user = conn.execute(
            select(UserRow.username, UserRow.active, UserRow.anonymised_at)
            .where(UserRow.id == row.user_id)
            .with_for_update(read=True)
        ).one()
        if not user.active or user.anonymised_at is not None:
            raise OAuthError("invalid_grant", "The account is not active.")
        grant_id = conn.execute(
            insert(OAuthGrantRow)
            .values(
                client_id=client.id,
                user_id=row.user_id,
                scopes=list(row.scopes),
                resource=row.resource,
                created_at=now,
                expires_at=now + GRANT_LIFETIME,
                last_used_at=now,
            )
            .returning(OAuthGrantRow.id)
        ).scalar_one()
        conn.execute(
            update(OAuthCodeRow)
            .where(OAuthCodeRow.id == row.id)
            .values(used_at=now, grant_id=grant_id)
        )
        issued = _issue(
            conn,
            grant_id=grant_id,
            user_id=row.user_id,
            name=client.name,
            scopes=tuple(cast(TokenScope, s) for s in row.scopes),
            refresh_until=now + GRANT_LIFETIME,
            now=now,
        )
        record_audit(
            conn,
            Actor.user(row.user_id, user.username),
            "oauth.grant.create",
            target_type="oauth_grant",
            target_id=grant_id,
            details={
                "client_id": client.client_id,
                "client_name": client.name,
                "scopes": list(row.scopes),
                "resource": row.resource,
            },
            at=now,
        )
        return issued

    def refresh(
        self,
        client: Client,
        refresh_token: str | None,
        scope: str | None,
        resource: str | None,
    ) -> IssuedTokens:
        """New tokens for a refresh token, which is used up (rotation)."""
        if (
            not refresh_token
            or not refresh_token.startswith(REFRESH_PREFIX)
            or len(refresh_token) > 128
        ):
            raise OAuthError("invalid_grant", "The refresh token is invalid.")
        now = self._now()
        with self.db.transaction() as conn:
            issued = self._rotate(conn, client, refresh_token, scope, resource, now)
        if issued is None:
            # Committed: the grant stays revoked although the request fails.
            raise OAuthError("invalid_grant", "The refresh token was used.")
        return issued

    def _rotate(
        self,
        conn: Connection,
        client: Client,
        refresh_token: str,
        scope: str | None,
        resource: str | None,
        now: datetime,
    ) -> IssuedTokens | None:
        """New tokens, or None when a used refresh token revoked its grant."""
        with nullcontext():
            row = conn.execute(
                select(
                    OAuthRefreshTokenRow.id,
                    OAuthRefreshTokenRow.expires_at,
                    OAuthRefreshTokenRow.used_at,
                    OAuthGrantRow.id.label("grant_id"),
                    OAuthGrantRow.client_id,
                    OAuthGrantRow.user_id,
                    OAuthGrantRow.scopes,
                    OAuthGrantRow.resource,
                    OAuthGrantRow.expires_at.label("grant_expires_at"),
                    OAuthGrantRow.revoked_at,
                    UserRow.active,
                    UserRow.anonymised_at,
                )
                .join(OAuthGrantRow, OAuthGrantRow.id == OAuthRefreshTokenRow.grant_id)
                .join(UserRow, UserRow.id == OAuthGrantRow.user_id)
                .where(OAuthRefreshTokenRow.token_sha256 == token_digest(refresh_token))
                .with_for_update(of=[OAuthRefreshTokenRow, OAuthGrantRow])
            ).one_or_none()
            if row is None or row.client_id != client.id:
                raise OAuthError("invalid_grant", "The refresh token is invalid.")
            if row.used_at is not None:
                # Rotation: a used refresh token is either stolen or replayed.
                if row.revoked_at is None:
                    _revoke_grant(conn, row.grant_id, "refresh_reused", now)
                record_audit(
                    conn,
                    Actor(None, "oauth:token"),
                    "oauth.refresh.reuse",
                    target_type="oauth_grant",
                    target_id=row.grant_id,
                    details={"client_id": client.client_id},
                    at=now,
                )
                return None
            if (
                row.revoked_at is not None
                or now >= row.expires_at
                or now >= row.grant_expires_at
                or not row.active
                or row.anonymised_at is not None
            ):
                raise OAuthError(
                    "invalid_grant", "The refresh token is expired or revoked."
                )
            if resource is not None and _resource(resource) != row.resource:
                raise OAuthError("invalid_target", "resource does not match.")
            granted = tuple(cast(TokenScope, s) for s in row.scopes)
            scopes = granted
            if scope is not None and scope.strip():
                scopes = _scopes(scope, default=granted)
                if not set(scopes) <= set(granted):
                    raise OAuthError(
                        "invalid_scope", "A refresh cannot widen the granted scopes."
                    )
            conn.execute(
                update(OAuthRefreshTokenRow)
                .where(OAuthRefreshTokenRow.id == row.id)
                .values(used_at=now)
            )
            conn.execute(
                update(OAuthGrantRow)
                .where(OAuthGrantRow.id == row.grant_id)
                .values(last_used_at=now)
            )
            return _issue(
                conn,
                grant_id=row.grant_id,
                user_id=row.user_id,
                name=client.name,
                scopes=scopes,
                refresh_until=row.grant_expires_at,
                now=now,
            )

    def revoke_token(self, client: Client, token: str | None) -> None:
        """RFC 7009: end the grant behind ``token`` if it is this client's.

        Unknown tokens and other clients' tokens change nothing; the caller
        answers 200 either way.
        """
        if not token or len(token) > 128:
            return
        now = self._now()
        digest = token_digest(token)
        with self.db.transaction() as conn:
            grant_id: int | None = None
            if token.startswith(REFRESH_PREFIX):
                grant_id = conn.execute(
                    select(OAuthRefreshTokenRow.grant_id).where(
                        OAuthRefreshTokenRow.token_sha256 == digest
                    )
                ).scalar_one_or_none()
            elif token.startswith(TOKEN_PREFIX):
                grant_id = conn.execute(
                    select(ApiTokenRow.oauth_grant_id).where(
                        ApiTokenRow.token_sha256 == digest
                    )
                ).scalar_one_or_none()
            if grant_id is None:
                return
            grant = conn.execute(
                select(
                    OAuthGrantRow.client_id,
                    OAuthGrantRow.user_id,
                    OAuthGrantRow.revoked_at,
                )
                .where(OAuthGrantRow.id == grant_id)
                .with_for_update()
            ).one()
            if grant.client_id != client.id or grant.revoked_at is not None:
                return
            _revoke_grant(conn, grant_id, "client_revoked", now)
            record_audit(
                conn,
                Actor(None, f"oauth:client:{client.client_id}"),
                "oauth.grant.revoke",
                target_type="oauth_grant",
                target_id=grant_id,
                details={"client_name": client.name, "by": "client"},
                at=now,
            )

    # Connected apps (Profile)

    def denied(self, request: AuthorizationRequest, *, issuer: str) -> str:
        """The redirect back to the client when the user declines."""
        return redirect_with(
            request.redirect_uri,
            {
                "error": "access_denied",
                "error_description": "The user declined.",
                "state": request.state,
                "iss": issuer,
            },
        )

    def connections(self, user_id: int) -> list[ConnectedApp]:
        """The user's grants, newest first; ended ones of the last 30 days too."""
        now = self._now()
        with self.db.transaction() as conn:
            rows = conn.execute(
                select(
                    OAuthGrantRow.id,
                    OAuthClientRow.name,
                    OAuthClientRow.redirect_uris,
                    OAuthGrantRow.scopes,
                    OAuthGrantRow.resource,
                    OAuthGrantRow.created_at,
                    OAuthGrantRow.expires_at,
                    OAuthGrantRow.last_used_at,
                    OAuthGrantRow.revoked_at,
                    OAuthGrantRow.revoked_reason,
                )
                .join(OAuthClientRow, OAuthClientRow.id == OAuthGrantRow.client_id)
                .where(
                    OAuthGrantRow.user_id == user_id,
                    func.coalesce(OAuthGrantRow.revoked_at, OAuthGrantRow.expires_at)
                    > now - timedelta(days=30),
                )
                .order_by(OAuthGrantRow.created_at.desc(), OAuthGrantRow.id.desc())
            ).all()
        return [
            ConnectedApp(
                id=row.id,
                client_name=row.name,
                redirect_host=urlsplit(row.redirect_uris[0]).hostname or "",
                scopes=tuple(cast(TokenScope, s) for s in row.scopes),
                resource=row.resource,
                created_at=row.created_at,
                expires_at=row.expires_at,
                last_used_at=row.last_used_at,
                revoked_at=row.revoked_at,
                revoked_reason=row.revoked_reason,
            )
            for row in rows
        ]

    def revoke_connection(self, principal: Principal, grant_id: int) -> None:
        """The user ends one of their grants; idempotent, audited once."""
        now = self._now()
        with self.db.transaction() as conn:
            row = conn.execute(
                select(OAuthGrantRow.revoked_at, OAuthClientRow.name)
                .join(OAuthClientRow, OAuthClientRow.id == OAuthGrantRow.client_id)
                .where(
                    OAuthGrantRow.id == grant_id,
                    OAuthGrantRow.user_id == principal.user_id,
                )
                .with_for_update(of=OAuthGrantRow)
            ).one_or_none()
            if row is None:
                raise DomainError(
                    "OAUTH_CONNECTION_NOT_FOUND", "There is no such connected app."
                )
            if row.revoked_at is not None:
                return
            _revoke_grant(conn, grant_id, "revoked", now)
            record_audit(
                conn,
                Actor.user(principal.user_id, principal.username),
                "oauth.grant.revoke",
                target_type="oauth_grant",
                target_id=grant_id,
                details={"client_name": row.name, "by": "user"},
                at=now,
            )


def _resource(value: str) -> str:
    try:
        return canonical_resource(value)
    except ValueError:
        raise OAuthError("invalid_target", "The resource is invalid.") from None


def _client(conn: Connection, client_id: str) -> Client | None:
    row = conn.execute(
        select(
            OAuthClientRow.id,
            OAuthClientRow.client_id,
            OAuthClientRow.name,
            OAuthClientRow.redirect_uris,
            OAuthClientRow.auth_method,
        ).where(OAuthClientRow.client_id == client_id)
    ).one_or_none()
    if row is None:
        return None
    return Client(
        id=row.id,
        client_id=row.client_id,
        name=row.name,
        redirect_uris=tuple(row.redirect_uris),
        auth_method=cast(AuthMethod, row.auth_method),
    )


def _issue(
    conn: Connection,
    *,
    grant_id: int,
    user_id: int,
    name: str,
    scopes: tuple[TokenScope, ...],
    refresh_until: datetime,
    now: datetime,
) -> IssuedTokens:
    """A new access token (an API token of the grant) and refresh token."""
    access = new_token()
    access_until = min(now + ACCESS_TOKEN_LIFETIME, refresh_until)
    conn.execute(
        insert(ApiTokenRow).values(
            token_sha256=token_digest(access),
            name=name,
            kind="personal",
            owner_id=user_id,
            scopes=list(scopes),
            created_at=now,
            expires_at=access_until,
            oauth_grant_id=grant_id,
        )
    )
    refresh = REFRESH_PREFIX + secrets.token_urlsafe(32)
    conn.execute(
        insert(OAuthRefreshTokenRow).values(
            grant_id=grant_id,
            token_sha256=token_digest(refresh),
            created_at=now,
            expires_at=min(now + REFRESH_TOKEN_LIFETIME, refresh_until),
        )
    )
    return IssuedTokens(
        access_token=access,
        refresh_token=refresh,
        expires_in=int((access_until - now).total_seconds()),
        scopes=scopes,
    )


def _revoke_grant(conn: Connection, grant_id: int, reason: str, at: datetime) -> None:
    """End a grant and every access token it issued; refresh tokens die with it."""
    conn.execute(
        update(OAuthGrantRow)
        .where(OAuthGrantRow.id == grant_id, OAuthGrantRow.revoked_at.is_(None))
        .values(revoked_at=at, revoked_reason=reason)
    )
    conn.execute(
        update(ApiTokenRow)
        .where(ApiTokenRow.oauth_grant_id == grant_id, ApiTokenRow.revoked_at.is_(None))
        .values(revoked_at=at, revoked_reason=reason)
    )
