"""preview_change: the dry run of a changing tool, as a tool that reads only.

A tool with ``confirm`` does a dry run without it, but it is one tool with
one description ("CHANGES DATA") and ``readOnlyHint: false``. A client that
asks or refuses before each changing tool cannot tell the dry run from the
change, and once refused the dry run of ``accept_translation_version`` (#485).
The MCP tool annotations cannot say "read only without confirm".

So one more tool, marked read only, runs the dry run of any of them. It is
one tool, not a ``preview_...`` twin of each: the descriptions and the
arguments stay in one place. It never applies anything:

- ``confirm`` and ``preview_token`` are refused;
- while it runs, the API client sends only requests that change nothing
  (``dry_run_only``): a tool that would change data without ``confirm`` (for
  example ``set_member_roles`` when it only adds roles) is stopped before the
  request is sent.
"""

from __future__ import annotations

from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import dry_run_only
from ontotator_mcp.errors import OntotatorError
from ontotator_mcp.tooling import TOOL_SCOPES, register

# Arguments of the previewed tool that would apply its change.
APPLYING = ("confirm", "preview_token")


def confirm_tools(server: MCPServer) -> list[str]:
    """The registered tools that do a dry run without ``confirm``, by name.

    A tool that writes a local file is left out: its dry run is not the
    question here, and a preview must never write.
    """
    return sorted(
        tool.name
        for tool in server._tool_manager.list_tools()
        if "confirm" in tool.parameters.get("properties", {})
        and TOOL_SCOPES[tool.name].effect != "local"
    )


def register_preview(server: MCPServer) -> None:
    """Register ``preview_change``; call it after every other tool."""
    names = confirm_tools(server)

    @register(
        server,
        effect="read",
        scope_note="the scopes of the tool it previews (see that tool)",
    )
    async def preview_change(
        tool: Annotated[
            str,
            Field(
                description=(
                    "The tool whose dry run to show: one that has a 'confirm' argument."
                ),
            ),
        ],
        arguments: Annotated[
            dict[str, Any],
            Field(
                description=(
                    "That tool's arguments, as for its dry run: without"
                    " 'confirm' and 'preview_token'."
                )
            ),
        ],
    ) -> dict[str, Any]:
        """Show the dry run of a changing tool without changing anything.

        Every tool with a 'confirm' argument does a dry run when 'confirm' is
        left out. This tool runs that same dry run and is marked read only,
        so an MCP client that asks before every changing tool can allow it.
        The answer is the tool's own dry run, with 'preview_of'. To apply it,
        call that tool itself with the same arguments, confirm=true and the
        dry run's 'preview_token' where it has one.

        It never applies a change: 'confirm' and 'preview_token' are refused,
        and a request that would change data is stopped before it is sent (a
        few tools change data without 'confirm', for example
        set_member_roles when it only adds roles).
        """
        if tool not in names:
            raise OntotatorError(
                f"preview_change has no dry run of '{tool}'; nothing was done."
                f" Tools with a dry run: {', '.join(names)}."
            )
        applying = [name for name in APPLYING if name in arguments]
        if applying:
            raise OntotatorError(
                f"preview_change never applies a change: leave out"
                f" {' and '.join(applying)}; nothing was done. To apply, call"
                f" {tool} itself."
            )
        with dry_run_only(tool):
            result = await server.call_tool(tool, arguments)
        answer = getattr(result, "structured_content", None)
        if getattr(result, "is_error", False) or not isinstance(answer, dict):
            return result  # type: ignore[return-value]
        return {
            "preview_of": tool,
            **answer,
            "how_to_apply": (
                f"Nothing was changed. To apply, call {tool} with the same"
                " arguments and confirm=true"
                + (
                    ", passing this answer's preview_token."
                    if "preview_token" in _keys(answer)
                    else "."
                )
            ),
        }

    # The names in the input schema too, so a client offers them.
    registered = server._tool_manager.get_tool("preview_change")
    assert registered is not None
    properties = registered.parameters["properties"]
    properties["tool"] = {**properties["tool"], "enum": names}


def _keys(value: Any) -> set[str]:
    """Every key of ``value`` and of the mappings inside it."""
    if isinstance(value, dict):
        return set(value).union(*(_keys(item) for item in value.values()))
    if isinstance(value, list):
        return set().union(*(_keys(item) for item in value))
    return set()
