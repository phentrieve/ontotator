"""The remote MCP service in docker-compose.yml is hardened like the app (issue 388).

The file is read as text (no YAML parser in the environment): the service
block is everything from ``  ontotator_mcp:`` to the next top-level key.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _service(name: str) -> str:
    text = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    match = re.search(rf"^  {name}:\n(.*?)(?=^  \S|^\S)", text, re.M | re.S)
    assert match, f"no service {name}"
    return match.group(1)


def test_the_mcp_service_has_no_port_no_volume_and_the_runtime_hardening() -> None:
    block = _service("ontotator_mcp")
    assert "<<: *runtime" in block  # read_only, cap_drop ALL, no-new-privileges
    assert "ports:" not in block and "expose:" not in block
    assert "volumes:" not in block
    assert "networks: [backend, npm_proxy_network]" in block
    assert 'command: ["--http", "0.0.0.0:8765"]' in block
    assert "profiles: [mcp]" in block  # opt-in
    assert "pids_limit:" in block and "mem_limit:" in block
    # A fixed token or local files would refuse to start; neither is set.
    assert "ONTOTATOR_TOKEN" not in block
    assert "ONTOTATOR_MCP_FILES_DIR" not in block
    assert "ONTOTATOR_MCP_URL: ${ONTOTATOR_MCP_URL:-}" in block


def test_the_app_knows_the_mcp_url_for_oauth() -> None:
    assert "ONTOTATOR_MCP_URL: ${ONTOTATOR_MCP_URL:-}" in _service("ontotator_app")


def test_the_image_ships_the_mcp_command() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "UV_PROJECT_ENVIRONMENT=/opt/ontotator-mcp uv sync --frozen" in dockerfile
    assert "/usr/local/bin/ontotator-mcp" in dockerfile
