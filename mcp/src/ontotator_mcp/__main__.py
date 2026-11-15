"""``ontotator-mcp``: run the MCP server over stdio, or remotely with ``--http``."""

from __future__ import annotations

import argparse
import logging
import sys

from ontotator_mcp import __version__
from ontotator_mcp.config import ConfigError, HttpSettings, Settings

DESCRIPTION = """\
MCP server for an Ontotator instance. By default it speaks MCP over stdio,
so an MCP client (Claude Code, Claude Desktop) starts it; it is not run by
hand. With --http HOST:PORT it serves MCP over Streamable HTTP for remote
clients (a claude.ai connector), each request with its caller's own token.
"""

EPILOG = """\
environment:
  ONTOTATOR_URL            address of the instance (https; plain http only for
                           localhost or with ONTOTATOR_ALLOW_HTTP=1)
  ONTOTATOR_TOKEN          API token (ott_...)
  ONTOTATOR_ALLOW_HTTP     1 allows plain http to another host
  ONTOTATOR_TIMEOUT        seconds per HTTP request (default 60)
  ONTOTATOR_JOB_TIMEOUT    seconds a tool waits for a job (default 900)
  ONTOTATOR_MCP_FILES_DIR  folders the tools may read and write local files
                           in, separated by the path separator; required for
                           any local file access (unset, the file tools refuse
                           and the others still work)

with --http (ONTOTATOR_TOKEN and ONTOTATOR_MCP_FILES_DIR must be unset):
  ONTOTATOR_MCP_URL        the public address clients use, e.g.
                           https://ontotator.example.org/mcp (required)
  ONTOTATOR_MCP_ISSUER     the public origin of the Ontotator instance, announced
                           as the OAuth authorization server (default: the
                           origin of ONTOTATOR_URL; set it when that is an
                           internal address)
  ONTOTATOR_MCP_ALLOWED_ORIGINS
                           further browser origins allowed to call, separated
                           by commas (the public URL's own origin always is)
"""


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="ontotator-mcp",
        description=DESCRIPTION,
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--version", action="version", version=f"ontotator-mcp {__version__}"
    )
    parser.add_argument(
        "--http",
        metavar="HOST:PORT",
        help="serve MCP over Streamable HTTP for remote clients (see below)",
    )
    args = parser.parse_args(argv)
    # stdout carries the MCP protocol; every log line goes to stderr.
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    # Request lines are not secret, but keep the HTTP client quiet anyway.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        settings = Settings.from_env(remote=args.http is not None)
        http = None if args.http is None else HttpSettings.from_env(args.http)
    except ConfigError as exc:
        print(f"ontotator-mcp: {exc}", file=sys.stderr)
        raise SystemExit(2) from None
    # Imported here, so that --help and --version answer without loading MCP.
    from ontotator_mcp.server import build_server

    if http is None:
        build_server(settings).run("stdio")
        return
    from ontotator_mcp.remote import run

    logging.getLogger("ontotator_mcp").setLevel(logging.INFO)
    print(
        f"ontotator-mcp: serving {http.public_url} on {http.host}:{http.port}",
        file=sys.stderr,
    )
    run(build_server(settings, http=http), http)


if __name__ == "__main__":
    main()
