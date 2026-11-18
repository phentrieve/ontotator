"""Registering tools with their token scope and effect stated the same way.

Every tool names, in its description, the API token scope it needs and
whether it changes data in Ontotator. The same facts set the MCP tool
annotations (``readOnlyHint``, ``destructiveHint``, ``idempotentHint``) and
fill ``TOOL_SCOPES``, which the README's scope table and the tests use.

Two more things hold for every tool because ``register`` sets them:

- An argument the tool does not have is refused, with a message that names
  it and the arguments the tool has. Without this a misspelt argument
  (``case_id`` for ``case_ids``) was dropped and the tool ran on its
  default, for example the whole project.
- A tool with a ``confirm`` argument says in its answer what it acted on
  (``selection``), in the dry run and when applied.
"""

from __future__ import annotations

import difflib
import functools
import inspect
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any, Literal, TypeVar

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.tools import Tool
from mcp.types import ToolAnnotations
from pydantic import create_model, model_validator

Scope = Literal["read", "import", "export", "project-admin", "admin"]
Effect = Literal["read", "additive", "changes", "destructive", "local"]
F = TypeVar("F", bound=Callable[..., Any])

EFFECT_TEXT: dict[Effect, str] = {
    "read": "Read only: changes nothing.",
    "additive": "CHANGES DATA in Ontotator: adds records; removes nothing.",
    "changes": "CHANGES DATA in Ontotator: overwrites the current values.",
    "destructive": (
        "CHANGES DATA in Ontotator and may remove or withdraw existing work;"
        " read the dry run first."
    ),
    "local": (
        "Changes nothing in Ontotator; WRITES A FILE ON THIS COMPUTER and, with"
        " overwrite, replaces an existing one."
    ),
}


# Why a task is kept or a text skipped, by the server's reason code. The
# server's own sentences name buttons of the web interface ("tick ...",
# "use Change final..."); these name the tool or argument instead (#471).
TOOL_MESSAGES: dict[str, str] = {
    "started": "Work has started; pass include_started=true to include it.",
    "paused": (
        "Paused by a problem report; decide the report first"
        " (list_problem_reports, act_on_problem_report)."
    ),
    "paused_by_lead": "Paused by a lead; release the text first (release_texts).",
    "lead_correction_task": (
        "A lead correction; withdraw it singly with withdraw_task (assignment_id)."
    ),
    "not_current_version": (
        "Not on the current version of the text; decide on the task with"
        " move_task_to_version or handle_text_change."
    ),
    "no_round": (
        "No work round to restart (older or imported work); use reopen_texts"
        " or reopen_task."
    ),
    "final_chosen": ("Final result chosen: withdraw it first (withdraw_final_result)."),
    "final_result": ("Final result chosen: withdraw it first (withdraw_final_result)."),
    "consolidation_open": (
        "A consolidation is open: have it finished, or withdraw its task"
        " (list_assignments, withdraw_task), first."
    ),
    "not_locked": ("No annotation work yet: set the mode with update_work_plan."),
    "no_final": (
        "No final result yet: use accept_agreeing_texts, or choose one with"
        " set_final_result."
    ),
}


def tool_message(item: dict[str, Any]) -> Any:
    """Why ``item`` (a kept task or a skipped text) stays as it is, in the
    words of this server's tools; the server's sentence for other reasons."""
    return TOOL_MESSAGES.get(str(item.get("reason")), item.get("message"))


@dataclass(frozen=True)
class ToolInfo:
    name: str
    # Every one of ``scopes`` is needed; of ``any_of``, one is enough.
    scopes: tuple[Scope, ...]
    effect: Effect
    summary: str
    any_of: tuple[Scope, ...] = ()

    @property
    def label(self) -> str:
        """The scopes as the README's table names them."""
        if self.any_of:
            return " or ".join(self.any_of)
        return ", ".join(self.scopes)


TOOL_SCOPES: dict[str, ToolInfo] = {}


def scope_text(scopes: tuple[Scope, ...], any_of: tuple[Scope, ...] = ()) -> str:
    if any_of:
        names = " or ".join(f"'{scope}'" for scope in any_of)
        return f"Token scope: any one of {names}."
    names = " + ".join(f"'{scope}'" for scope in scopes)
    return f"Token scope: {names}."


def unknown_arguments_message(
    tool: str, unknown: Iterable[str], valid: Iterable[str]
) -> str:
    """Why a call is refused: the arguments the tool does not have, the
    nearest name for each where there is one, and the ones it has."""
    names = list(valid)
    parts = []
    for name in unknown:
        near = difflib.get_close_matches(name, names, n=1)
        parts.append(f"'{name}'" + (f" (did you mean '{near[0]}'?)" if near else ""))
    plural = "s" if len(parts) > 1 else ""
    listed = ", ".join(names) if names else "none"
    return (
        f"Unknown argument{plural} {', '.join(parts)} for {tool}; nothing was done."
        f" Valid arguments: {listed}."
    )


def forbid_unknown_arguments(tool: Tool) -> None:
    """Make ``tool`` refuse arguments it does not have, and say so in its
    input schema (``additionalProperties: false``)."""
    base = tool.fn_metadata.arg_model
    valid = [field.alias or name for name, field in base.model_fields.items()]
    name = tool.name

    def refuse_unknown(cls: type[Any], data: Any) -> Any:
        if isinstance(data, dict):
            unknown = [key for key in data if key not in valid]
            if unknown:
                raise ValueError(unknown_arguments_message(name, unknown, valid))
        return data

    # Typed loosely: pydantic's decorator takes the classmethod at run time,
    # its stubs only a plain function.
    before: Any = model_validator(mode="before")
    tool.fn_metadata.arg_model = create_model(
        base.__name__,
        __base__=base,
        __validators__={"refuse_unknown": before(classmethod(refuse_unknown))},
    )
    tool.parameters = {**tool.parameters, "additionalProperties": False}


# Arguments that name what a tool acts on, in the order ``selection`` shows them.
TARGET_ARGUMENTS = (
    "case_id",
    "language",
    "document_id",
    "target_document_id",
    "assignment_id",
    "assignment_ids",
    "submission_id",
    "report_id",
    "change_id",
    "undo_id",
    "username",
    "usernames",
    "from_username",
    "to_usernames",
)


def _count(number: int, noun: str) -> str:
    return f"{number} {noun}" + ("" if number == 1 else "s")


def _text_key(item: Any) -> tuple[Any, Any]:
    """Case and language of one entry of ``texts`` (a model or a mapping)."""
    if isinstance(item, dict):
        return item.get("case_id"), item.get("language")
    return getattr(item, "case_id", None), getattr(item, "language", None)


def selection_text(arguments: dict[str, Any]) -> str:
    """What a call acts on, from its arguments as the tool received them
    (defaults filled in): ``2 texts of project 'p'``, ``all texts of project
    'p'``, ``project 'p', case_id 'c', language 'en'``."""
    project = arguments.get("project")
    where = f"project '{project}'" if project is not None else ""
    texts, cases = arguments.get("texts"), arguments.get("case_ids")
    many = ""
    if texts:
        many = _count(len({_text_key(item) for item in texts}), "text")
    elif cases:
        many = _count(len(set(cases)), "case") + " (case_ids)"
    elif "texts" in arguments or "case_ids" in arguments:
        # A tool for one language selects cases; the others every text.
        many = "all cases" if "language" in arguments else "all texts"
    targets = [
        f"{name} {arguments[name]!r}"
        for name in TARGET_ARGUMENTS
        if arguments.get(name) not in (None, [], "")
    ]
    if many:
        first = f"{many} of {where}" if where else many
        return ", ".join([first, *targets])
    return ", ".join(([where] if where else []) + targets) or "no selection"


def echo_selection(tool: Tool) -> None:
    """Make ``tool`` name what it acted on: its answer gets ``selection``
    first, unless the tool set one itself."""
    fn = tool.fn

    @functools.wraps(fn)
    async def with_selection(**arguments: Any) -> Any:
        result = await fn(**arguments)
        if isinstance(result, dict) and "selection" not in result:
            return {"selection": selection_text(arguments)} | result
        return result

    tool.fn = with_selection


def register(
    server: MCPServer,
    *,
    scopes: Scope | tuple[Scope, ...] = (),
    any_of: tuple[Scope, ...] = (),
    effect: Effect,
    idempotent: bool = False,
    title: str | None = None,
) -> Callable[[F], F]:
    """``@register(server, scopes=..., effect=...)`` on an async tool function."""
    needed = (scopes,) if isinstance(scopes, str) else scopes
    if bool(needed) == bool(any_of):
        raise ValueError("Give either scopes or any_of.")

    def decorator(fn: F) -> F:
        doc = inspect.cleandoc(fn.__doc__ or "")
        summary = doc.split("\n\n", 1)[0].replace("\n", " ")
        description = f"{doc}\n\n{scope_text(needed, any_of)} {EFFECT_TEXT[effect]}"
        read_only = effect == "read"
        annotations = ToolAnnotations(
            title=title,
            read_only_hint=read_only,
            # A local download may replace an existing file (with overwrite).
            destructive_hint=None
            if read_only
            else effect in ("changes", "destructive", "local"),
            idempotent_hint=True if read_only else idempotent,
            open_world_hint=False,
        )
        TOOL_SCOPES[fn.__name__] = ToolInfo(
            fn.__name__, needed, effect, summary, any_of
        )
        server.add_tool(
            fn, name=fn.__name__, description=description, annotations=annotations
        )
        # The server has no public way to hand back the tool it made.
        tool = server._tool_manager.get_tool(fn.__name__)
        if tool is None or tool.fn is not fn:
            raise RuntimeError(f"Tool {fn.__name__} was not registered.")
        forbid_unknown_arguments(tool)
        if "confirm" in tool.parameters.get("properties", {}):
            echo_selection(tool)
        return fn

    return decorator
