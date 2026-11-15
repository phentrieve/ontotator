"""Settings from the environment: which server, which token, how long to wait."""

from __future__ import annotations

import ipaddress
import math
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

URL_VARIABLE = "ONTOTATOR_URL"
TOKEN_VARIABLE = "ONTOTATOR_TOKEN"
ALLOW_HTTP_VARIABLE = "ONTOTATOR_ALLOW_HTTP"
TIMEOUT_VARIABLE = "ONTOTATOR_TIMEOUT"
JOB_TIMEOUT_VARIABLE = "ONTOTATOR_JOB_TIMEOUT"
FILES_DIR_VARIABLE = "ONTOTATOR_MCP_FILES_DIR"
# Remote mode (--http, issue 388).
PUBLIC_URL_VARIABLE = "ONTOTATOR_MCP_URL"
ORIGINS_VARIABLE = "ONTOTATOR_MCP_ALLOWED_ORIGINS"
ISSUER_VARIABLE = "ONTOTATOR_MCP_ISSUER"


class ConfigError(ValueError):
    """The environment does not describe a usable server and token."""


def _loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _seconds(env: Mapping[str, str], name: str, default: float) -> float:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a number of seconds.") from None
    if not math.isfinite(value) or value <= 0:
        raise ConfigError(f"{name} must be a positive, finite number of seconds.")
    return value


def _folders(env: Mapping[str, str]) -> tuple[Path, ...]:
    """The folders named in ``ONTOTATOR_MCP_FILES_DIR``, resolved; none if unset."""
    raw = env.get(FILES_DIR_VARIABLE, "")
    folders: list[Path] = []
    for entry in raw.split(os.pathsep):
        entry = entry.strip()
        if not entry:
            continue
        folder = Path(entry).expanduser()
        if not folder.is_absolute():
            raise ConfigError(
                f"{FILES_DIR_VARIABLE} must name absolute folders (or start with"
                f" ~); got {entry!r}."
            )
        if not folder.is_dir():
            raise ConfigError(f"{FILES_DIR_VARIABLE}: {folder} is not a folder.")
        folders.append(folder.resolve())
    return tuple(folders)


@dataclass(frozen=True)
class Settings:
    """Where the Ontotator instance is and the API token to use there.

    The token never appears in ``repr`` or in any message.
    """

    url: str
    # None in remote mode: each request brings its caller's own token.
    token: str | None = field(repr=False)
    timeout: float = 60.0
    job_timeout: float = 900.0
    poll_interval: float = 1.0
    # Folders the tools may read and write local files in; empty means none.
    files_dirs: tuple[Path, ...] = ()

    @classmethod
    def from_env(
        cls, env: Mapping[str, str] | None = None, *, remote: bool = False
    ) -> Settings:
        """The settings of ``env``; ``remote`` for ``--http`` (issue 388).

        Remote mode refuses a fixed ``ONTOTATOR_TOKEN`` (every caller would
        act as its owner) and ``ONTOTATOR_MCP_FILES_DIR`` (local files would
        be the server's disk): each request brings its own token.
        """
        env = os.environ if env is None else env
        url = env.get(URL_VARIABLE, "").strip().rstrip("/")
        token = env.get(TOKEN_VARIABLE, "").strip()
        if not url:
            raise ConfigError(
                f"Set {URL_VARIABLE} to the address of the Ontotator instance,"
                " for example https://ontotator.example.org."
            )
        if remote:
            if token:
                raise ConfigError(
                    f"--http does not use {TOKEN_VARIABLE}: every caller sends their"
                    " own token, and a fixed one would let anyone who reaches the"
                    f" server act as its owner. Unset {TOKEN_VARIABLE}."
                )
            if env.get(FILES_DIR_VARIABLE, "").strip():
                raise ConfigError(
                    f"--http does not allow {FILES_DIR_VARIABLE}: remotely, local"
                    " files would be on the server's disk. Unset it."
                )
        elif not token:
            raise ConfigError(
                f"Set {TOKEN_VARIABLE} to an API token of that instance"
                " (Profile > API tokens in Ontotator)."
            )
        if token and any(char.isspace() for char in token):
            raise ConfigError(
                f"{TOKEN_VARIABLE} contains whitespace; paste the token alone."
            )
        try:
            parts = urlsplit(url)
            hostname = parts.hostname
        except ValueError:
            raise ConfigError(f"{URL_VARIABLE} is not a valid URL.") from None
        if parts.scheme not in ("http", "https") or not hostname:
            raise ConfigError(f"{URL_VARIABLE} must be an http(s) URL with a host.")
        if parts.query or parts.fragment:
            raise ConfigError(f"{URL_VARIABLE} must not have a query or fragment.")
        if "@" in parts.netloc:
            raise ConfigError(
                f"{URL_VARIABLE} must not contain a user name or password; the"
                f" API token in {TOKEN_VARIABLE} is the only credential."
            )
        allow_http = env.get(ALLOW_HTTP_VARIABLE, "").strip() == "1"
        if parts.scheme == "http" and not _loopback(hostname) and not allow_http:
            raise ConfigError(
                f"{URL_VARIABLE} uses plain http to another host, which would send"
                f" the token unencrypted. Use https, or set {ALLOW_HTTP_VARIABLE}=1"
                " for a trusted network."
            )
        return cls(
            url=url,
            token=None if remote else token,
            timeout=_seconds(env, TIMEOUT_VARIABLE, 60.0),
            job_timeout=_seconds(env, JOB_TIMEOUT_VARIABLE, 900.0),
            files_dirs=() if remote else _folders(env),
        )


@dataclass(frozen=True)
class HttpSettings:
    """Where ``--http`` listens and how it is reached (issue 388).

    ``public_url`` is the address MCP clients use, e.g.
    https://ontotator.example.org/mcp: the OAuth resource identifier, the
    one Host the server answers to and the base of its protected resource
    metadata. ``allowed_origins`` are the browser origins that may call it;
    a request without ``Origin`` (a server-side client) is allowed.
    ``issuer`` is the public origin of the Ontotator instance, announced as
    the OAuth authorization server (``ONTOTATOR_MCP_ISSUER``); None means
    the origin of ``ONTOTATOR_URL``, which is right unless that is an
    internal address.
    """

    host: str
    port: int
    public_url: str
    path: str
    allowed_hosts: tuple[str, ...]
    allowed_origins: tuple[str, ...]
    issuer: str | None = None

    @classmethod
    def from_env(cls, bind: str, env: Mapping[str, str] | None = None) -> HttpSettings:
        env = os.environ if env is None else env
        host, port = _bind(bind)
        raw = env.get(PUBLIC_URL_VARIABLE, "").strip()
        if not raw:
            raise ConfigError(
                f"--http needs {PUBLIC_URL_VARIABLE}, the address clients use, for"
                " example https://ontotator.example.org/mcp. It names the OAuth"
                " resource every token is checked against; without it the server"
                " does not start."
            )
        try:
            parts = urlsplit(raw)
            hostname = parts.hostname
            public_port = parts.port
        except ValueError:
            raise ConfigError(f"{PUBLIC_URL_VARIABLE} is not a valid URL.") from None
        if (
            parts.scheme not in ("http", "https")
            or not hostname
            or parts.query
            or parts.fragment
            or "@" in parts.netloc
        ):
            raise ConfigError(
                f"{PUBLIC_URL_VARIABLE} must be an http(s) URL with a host and"
                " without user, query or fragment."
            )
        if parts.scheme == "http" and not _loopback(hostname):
            raise ConfigError(
                f"{PUBLIC_URL_VARIABLE} must be https (plain http only on"
                " localhost): bearer tokens would travel unencrypted."
            )
        # The Ontotator app binds tokens to this URL as it is written
        # (``ontotator.auth.oauth.canonical_mcp_url``, the same rules): a
        # default path here would make the two disagree on the resource.
        path = parts.path.rstrip("/")
        if not path:
            raise ConfigError(
                f"{PUBLIC_URL_VARIABLE} needs a path such as /mcp, for example"
                " https://ontotator.example.org/mcp."
            )
        netloc = hostname.lower()
        if ":" in netloc:
            netloc = f"[{netloc}]"
        default = {"http": 80, "https": 443}[parts.scheme]
        if public_port is not None and public_port != default:
            netloc = f"{netloc}:{public_port}"
        public_url = f"{parts.scheme}://{netloc}{path}"
        origins = [f"{parts.scheme}://{netloc}"]
        for entry in env.get(ORIGINS_VARIABLE, "").split(","):
            entry = entry.strip().rstrip("/")
            if not entry:
                continue
            try:
                origin = urlsplit(entry)
                origin.port  # noqa: B018 - raises for an invalid port
            except ValueError:
                raise ConfigError(
                    f"{ORIGINS_VARIABLE}: {entry!r} is invalid."
                ) from None
            if (
                origin.scheme not in ("http", "https")
                or not origin.hostname
                or origin.path
                or origin.query
                or "*" in entry
            ):
                raise ConfigError(
                    f"{ORIGINS_VARIABLE} takes exact origins such as"
                    f" https://claude.ai, separated by commas; got {entry!r}."
                )
            origins.append(entry.lower())
        return cls(
            host=host,
            port=port,
            public_url=public_url,
            issuer=_issuer(env),
            path=path,
            allowed_hosts=(netloc,),
            allowed_origins=tuple(dict.fromkeys(origins)),
        )


def _issuer(env: Mapping[str, str]) -> str | None:
    """``ONTOTATOR_MCP_ISSUER`` as an origin, or None when it is unset."""
    raw = env.get(ISSUER_VARIABLE, "").strip().rstrip("/")
    if not raw:
        return None
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError:
        raise ConfigError(f"{ISSUER_VARIABLE} is not a valid URL.") from None
    if (
        parts.scheme not in ("http", "https")
        or not parts.hostname
        or parts.path
        or parts.query
        or parts.fragment
        or "@" in parts.netloc
    ):
        raise ConfigError(
            f"{ISSUER_VARIABLE} must be the public origin of the Ontotator"
            " instance, for example https://ontotator.example.org."
        )
    if parts.scheme == "http" and not _loopback(parts.hostname):
        raise ConfigError(
            f"{ISSUER_VARIABLE} must be https (plain http only on localhost)."
        )
    host = parts.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    if port is not None and port != {"http": 80, "https": 443}[parts.scheme]:
        host = f"{host}:{port}"
    return f"{parts.scheme}://{host}"


def _bind(value: str) -> tuple[str, int]:
    """``HOST:PORT`` (``[::1]:PORT`` for IPv6) of ``--http``."""
    host, sep, port = value.rpartition(":")
    if not sep or not host or not port.isdigit() or not 0 < int(port) < 65536:
        raise ConfigError(
            f"--http takes HOST:PORT, for example 0.0.0.0:8765; got {value!r}."
        )
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    return host, int(port)
