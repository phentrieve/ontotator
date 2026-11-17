"""People tools: accounts for a cohort, and handing work on when someone leaves.

Accounts are server-wide and need a system token (scope ``admin``). Setup
codes are credentials: they are written to a private local file when the
caller names one, and returned in the result only otherwise. Task handover
works with a project token too, since the assignment routes refuse tasks of
other projects themselves.
"""

from __future__ import annotations

import contextlib
import csv
import io
import os
import re
import tempfile
from pathlib import Path
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import OntotatorClient, project_path, seg
from ontotator_mcp.errors import OntotatorError
from ontotator_mcp.models import NewUser, TextRef
from ontotator_mcp.tooling import register
from ontotator_mcp.tools_setup import OPEN_STATES, _cut, unknown_texts

Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
CodesPath = Annotated[
    str | None,
    Field(
        description=(
            "Absolute local CSV file (or starting with ~) for the setup codes,"
            " inside the folders of ONTOTATOR_MCP_FILES_DIR. Without it the"
            " codes are in the result."
        )
    ),
]
CODE_COLUMNS = ("username", "display_name", "email", "code", "expires_at")
# Tasks a lead can hand to someone else (a consolidation opens through its round).
HANDOVER_TASKS = ("annotate", "translation_review")
# Bulk actions on the tasks of many texts (issue 336): their entries listed in full.
MAX_BULK_LISTED = 50
TaskKind = Literal["annotate", "translation_review", "review"]
Texts = Annotated[
    list[TextRef],
    Field(
        min_length=1,
        max_length=10000,
        description=(
            "The texts, each {'case_id': ..., 'language': ...}: at most 10000"
            " per call, of at most 2000 cases (the server's selection cap)."
        ),
    ),
]
Tasks = Annotated[
    list[TaskKind] | None,
    Field(
        description=(
            "Which tasks of the texts: annotate (default), translation_review,"
            " review (consolidation)."
        )
    ),
]
PreviewToken = Annotated[
    str | None,
    Field(
        max_length=80,
        description=(
            "With confirm: the preview_token of the dry run, so exactly the"
            " tasks it listed change."
        ),
    ),
]


def bulk_summary(found: dict[str, Any], applied: bool) -> dict[str, Any]:
    """A bulk action's preview or result, lists cut to MAX_BULK_LISTED, with
    the selected texts the project does not have (``unknown_texts``). An
    applied reopen or withdrawal keeps the server's ``undo`` (id and
    expires_at), which undo_reopen_or_withdraw takes."""

    def brief(item: dict[str, Any]) -> dict[str, Any]:
        person = item.get("person") or {}
        entry = {
            key: item.get(key)
            for key in ("case_id", "language", "assignment_id", "task", "status")
        }
        entry["person"] = person.get("display_name") or person.get("pseudonym")
        if "message" in item:
            entry["why"] = item["message"]
        return entry

    changes = [brief(item) for item in found.get("changes", [])]
    kept = [brief(item) for item in found.get("kept", [])]
    skipped = [
        {key: item.get(key) for key in ("case_id", "language", "message")}
        for item in found.get("skipped", [])
    ]
    return (
        {
            "applied": applied,
            "changed" if applied else "would_change": _cut(changes, MAX_BULK_LISTED),
            "change_count": found.get("change_count", len(changes)),
            "kept": _cut(kept, MAX_BULK_LISTED),
            "kept_count": found.get("kept_count", len(kept)),
            "skipped_texts": _cut(skipped, MAX_BULK_LISTED),
        }
        | unknown_texts(found, MAX_BULK_LISTED)
        | {"preview_token": found.get("preview_token")}
        | ({"undo": found["undo"]} if applied and found.get("undo") else {})
    )


def pause_summary(found: dict[str, Any], applied: bool) -> dict[str, Any]:
    """The preview or result of pausing or releasing texts, lists cut to
    MAX_BULK_LISTED: per text its tasks in progress and their people."""

    def person(item: dict[str, Any]) -> Any:
        ref = item.get("person") or {}
        return ref.get("display_name") or ref.get("pseudonym")

    def text(item: dict[str, Any]) -> dict[str, Any]:
        tasks = item.get("tasks", [])
        entry: dict[str, Any] = {
            "case_id": item.get("case_id"),
            "language": item.get("language"),
            "tasks_in_progress": len(tasks),
            "people": sorted({name for name in map(person, tasks) if name}),
        }
        if item.get("pause"):
            entry["paused_because"] = item["pause"].get("reason")
        still = sum(1 for task in tasks if task.get("paused_by_report"))
        if still and found.get("action") == "release":
            entry["still_paused_by_report"] = still
        return entry

    changes = [text(item) for item in found.get("changes", [])]
    skipped = [
        {key: item.get(key) for key in ("case_id", "language", "message")}
        for item in found.get("skipped", [])
    ]
    return {
        "applied": applied,
        "changed" if applied else "would_change": _cut(changes, MAX_BULK_LISTED),
        "change_count": found.get("change_count", len(changes)),
        "tasks_in_progress": found.get("task_count", 0),
        "still_paused_by_report": found.get("still_paused_count", 0),
        "skipped_texts": _cut(skipped, MAX_BULK_LISTED),
        "skipped_count": found.get("skipped_count", len(skipped)),
        **unknown_texts(found, MAX_BULK_LISTED),
        "preview_token": found.get("preview_token"),
    }


# A copy of ontotator.exchange.spreadsheet (#386): this package is installed on
# its own and does not depend on the server. Keep the two in step.
ESCAPED_START = ("=", "+", "-", "@", "\t", "\r", "'")
_NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", re.ASCII)


def spreadsheet_cell(value: Any) -> Any:
    """``value`` as a CSV cell no spreadsheet runs as a formula.

    A text that starts with ``=``, ``+``, ``-``, ``@``, a tab or a carriage
    return (a display name such as ``=HYPERLINK(...)``) gets a leading
    apostrophe, so Excel and LibreOffice show it as text; so does one that
    starts with an apostrophe, so removing one leading apostrophe gives back
    the value. Plain numbers such as ``-1`` stay unchanged.
    """
    if (
        isinstance(value, str)
        and value.startswith(ESCAPED_START)
        and _NUMBER.fullmatch(value) is None
    ):
        return "'" + value
    return value


def codes_target(api: OntotatorClient, path: str, overwrite: bool | None) -> Path:
    """The checked codes file; called before any code is issued, so none is lost.

    ``overwrite`` None: the tool never replaces a file (create_users).
    """
    target = api.local_path(path)
    if target.is_dir():
        raise OntotatorError(f"{target} is a directory; name a file.")
    if target.exists() and not overwrite:
        hint = "" if overwrite is None else " or pass overwrite"
        raise OntotatorError(f"{target} exists already. Choose another path{hint}.")
    if not target.parent.is_dir():
        raise OntotatorError(f"The folder {target.parent} does not exist.")
    return target


def write_codes(
    api: OntotatorClient,
    path: str,
    rows: list[dict[str, Any]],
    overwrite: bool | None,
) -> str:
    """Write ``rows`` as CSV readable by the user only; the absolute path."""
    target = codes_target(api, path, overwrite)
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CODE_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(
        {key: spreadsheet_cell(value) for key, value in row.items()} for row in rows
    )
    handle, partial = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".part", dir=target.parent
    )
    try:
        os.chmod(partial, 0o600)
        with os.fdopen(handle, "w", encoding="utf-8", newline="") as out:
            out.write(buffer.getvalue())
        os.replace(partial, target)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(partial)
        raise
    return str(Path(target).resolve())


def _codes(
    api: OntotatorClient,
    issued: list[dict[str, Any]],
    codes_path: str | None,
    overwrite: bool | None,
) -> dict[str, Any]:
    """Where the codes went: a local file, or the result itself."""
    if not issued:
        return {"codes": []}
    if codes_path is None:
        return {
            "codes": issued,
            "note": (
                "The setup codes are credentials: hand each one to its person"
                " only. Pass codes_path to write them to a local file instead."
            ),
        }
    written = write_codes(api, codes_path, issued, overwrite)
    return {
        "codes_file": written,
        "codes": [
            {"username": row["username"], "expires_at": row["expires_at"]}
            for row in issued
        ],
    }


def assignment_summary(item: dict[str, Any]) -> dict[str, Any]:
    return {
        key: item.get(key)
        for key in (
            "id",
            "document_id",
            "username",
            "task",
            "status",
            "annotation_mode",
            "lead_correction",
            "revoked_at",
            "last_submission_id",
        )
    }


def handover_plan(
    assignments: list[dict[str, Any]],
    successors: list[str],
    *,
    include_started: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Open tasks to hand on, round robin over ``successors``, and those kept.

    Unstarted tasks move; started ones (in progress or reopened) only with
    ``include_started``, since the successor then starts again. Lead
    corrections and consolidations stay: the web interface handles those.
    """
    moves: list[dict[str, Any]] = []
    kept: list[dict[str, Any]] = []
    for item in sorted(assignments, key=lambda row: int(row.get("id") or 0)):
        if item.get("revoked_at") or item.get("status") not in OPEN_STATES:
            continue
        reason = None
        if item.get("task") not in HANDOVER_TASKS:
            reason = "a consolidation; start a new one with start_consolidation"
        elif item.get("lead_correction"):
            reason = "a lead correction; it stays the lead's own"
        elif item.get("status") != "open" and not include_started:
            reason = "already started; pass include_started to move it anyway"
        if reason is not None:
            kept.append(assignment_summary(item) | {"reason": reason})
            continue
        target = successors[len(moves) % len(successors)]
        moves.append(assignment_summary(item) | {"to": target})
    return moves, kept


def register_people(server: MCPServer, api: OntotatorClient) -> None:
    # No overwrite: the tool stays additive (#385), and an earlier codes file
    # may hold the only copy of other people's codes.
    @register(server, scopes="admin", effect="additive", idempotent=True)
    async def create_users(
        users: Annotated[list[NewUser], Field(min_length=1, max_length=200)],
        project: Annotated[
            str | None,
            Field(
                description=(
                    "Also make each new person a member of this project with"
                    " the person's roles (default: annotator)."
                )
            ),
        ] = None,
        codes_path: CodesPath = None,
    ) -> dict[str, Any]:
        """Create accounts for a cohort, each with a one-time setup code.

        Usernames the server already has are skipped and reported in
        ``existing``, so the call can be repeated safely; a failure of one
        person is reported in ``refused`` and the others go on. Each person
        sets a password with the setup code (valid 7 days unless the
        server sets another time; expires_at says until when) on the login
        page; issue_setup_codes renews lapsed ones. With codes_path the
        codes are WRITTEN TO A LOCAL CSV FILE (readable by the user only)
        inside the folders of ONTOTATOR_MCP_FILES_DIR instead of being
        returned; an existing file is never replaced. Needs a system token.
        """
        known = {
            str(item.get("username", "")).lower()
            for item in await api.get("/api/v1/admin/users/")
        }
        if codes_path is not None:
            # Refuse a bad path before creating anyone.
            codes_target(api, codes_path, None)
        existing: list[str] = []
        created: list[dict[str, Any]] = []
        refused: list[dict[str, Any]] = []
        issued: list[dict[str, Any]] = []
        for person in users:
            if person.username.lower() in known:
                existing.append(person.username)
                continue
            body: dict[str, Any] = {
                "username": person.username,
                "display_name": person.display_name,
                "email": person.email,
                "languages": person.languages,
                "qualification": person.qualification,
            }
            if project is not None:
                body["projects"] = [
                    {"project_key": project, "roles": person.roles or ["annotator"]}
                ]
            try:
                answer = await api.post("/api/v1/admin/users/", body)
            except OntotatorError as exc:
                refused.append(
                    {"username": person.username, "code": exc.code, "error": str(exc)}
                )
                continue
            known.add(person.username.lower())
            user = answer.get("user") or {}
            created.append(
                {
                    "username": user.get("username"),
                    "pseudonym": user.get("pseudonym"),
                    "projects": user.get("projects", []),
                }
            )
            issued.append(
                {
                    "username": user.get("username"),
                    "display_name": user.get("display_name"),
                    "email": user.get("email"),
                    "code": answer.get("code"),
                    "expires_at": answer.get("expires_at"),
                }
            )
        return {
            "created": created,
            "existing": existing,
            "refused": refused,
        } | _codes(api, issued, codes_path, None)

    @register(server, scopes="admin", effect="changes")
    async def issue_setup_codes(
        usernames: Annotated[list[str], Field(min_length=1, max_length=200)],
        include_active_accounts: Annotated[
            bool,
            Field(
                description=(
                    "Also reset people who already set a password: their"
                    " sessions end, their API tokens are revoked, and the old"
                    " password stops working once they use the code."
                )
            ),
        ] = False,
        codes_path: CodesPath = None,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """New one-time codes for people whose setup code lapsed.

        By default only accounts that never set a password get one (a
        renewed invitation); others are reported in ``skipped``. A new code
        replaces unused earlier ones. With codes_path the codes are WRITTEN
        TO A LOCAL CSV FILE (readable by the user only) inside the folders
        of ONTOTATOR_MCP_FILES_DIR instead of being returned. Needs a system
        token. Resetting active accounts needs codes_path, so a reset code
        for a working account never enters the conversation with the model.
        """
        if include_active_accounts and codes_path is None:
            raise OntotatorError(
                "include_active_accounts needs codes_path: a reset code of an"
                " active account is written to a local file, never returned."
            )
        accounts = {
            str(item.get("username", "")).lower(): item
            for item in await api.get("/api/v1/admin/users/")
        }
        if codes_path is not None:
            codes_target(api, codes_path, overwrite)
        skipped: list[dict[str, Any]] = []
        refused: list[dict[str, Any]] = []
        issued: list[dict[str, Any]] = []
        for username in usernames:
            account = accounts.get(username.lower())
            if account is None:
                skipped.append({"username": username, "reason": "no such user"})
                continue
            if not account.get("active", True):
                skipped.append({"username": username, "reason": "deactivated"})
                continue
            if not account.get("setup_pending") and not include_active_accounts:
                skipped.append(
                    {
                        "username": username,
                        "reason": "already set a password; pass"
                        " include_active_accounts to reset it",
                    }
                )
                continue
            try:
                answer = await api.post(
                    f"/api/v1/admin/users/{seg(account['username'])}/reset-code"
                )
            except OntotatorError as exc:
                refused.append(
                    {"username": username, "code": exc.code, "error": str(exc)}
                )
                continue
            issued.append(
                {
                    "username": account.get("username"),
                    "display_name": account.get("display_name"),
                    "email": account.get("email"),
                    "code": answer.get("code"),
                    "expires_at": answer.get("expires_at"),
                }
            )
        return {"skipped": skipped, "refused": refused} | _codes(
            api, issued, codes_path, overwrite
        )

    @register(server, scopes="admin", effect="changes", idempotent=True)
    async def update_user(
        username: str,
        active: Annotated[
            bool | None,
            Field(
                description=(
                    "False deactivates the account: the person is logged out,"
                    " every API token of theirs is revoked, and their work"
                    " stays. True activates it again."
                )
            ),
        ] = None,
        display_name: str | None = None,
        email: str | None = None,
        languages: Annotated[
            list[str] | None,
            Field(description="The complete new list of working languages."),
        ] = None,
        qualification: str | None = None,
    ) -> dict[str, Any]:
        """Change an account: deactivate or activate it, or its name, e-mail, languages.

        Fields not given keep their value. Deactivate someone who leaves
        after handing on their open tasks (hand_over_open_tasks); open tasks
        of a deactivated person stay assigned until then. Needs a system
        token.
        """
        changes: dict[str, Any] = {
            key: value
            for key, value in {
                "active": active,
                "display_name": display_name,
                "email": email,
                "languages": languages,
                "qualification": qualification,
            }.items()
            if value is not None
        }
        if not changes:
            raise OntotatorError("Name at least one field to change.")
        user: dict[str, Any] = await api.patch(
            f"/api/v1/admin/users/{seg(username)}", changes
        )
        return user

    @register(server, scopes="project-admin", effect="read")
    async def find_people(
        project: Project,
        query: Annotated[
            str,
            Field(
                min_length=3,
                description=(
                    "Part of a name or username of someone sharing a project"
                    " with the token's owner, or an exact username or e-mail."
                ),
            ),
        ],
    ) -> list[dict[str, Any]]:
        """Active accounts outside the project that set_member_roles can add.

        As the People page's search: at most ten results; a lead finds
        people who share a project with them by part of the name, anybody
        else only by exact username or e-mail.
        """
        found: list[dict[str, Any]] = await api.get(
            project_path(project, "member-candidates"), q=query
        )
        return found

    @register(server, scopes="read", effect="read")
    async def list_assignments(
        project: Project,
        username: Annotated[
            str | None, Field(description="Only this person's tasks.")
        ] = None,
        document_id: Annotated[
            str | None, Field(description="Only tasks on this text version.")
        ] = None,
        status: Annotated[
            list[Literal["open", "in_progress", "submitted", "reopened"]] | None,
            Field(description="Only tasks in these states; all if empty."),
        ] = None,
        include_revoked: bool = False,
        limit: Annotated[int, Field(ge=1, le=1000)] = 200,
    ) -> dict[str, Any]:
        """The project's tasks with their IDs, person, text version and state.

        Gives the assignment_id that reassign_task, withdraw_task,
        remove_task and reopen_task need.
        """
        listed: list[dict[str, Any]] = await api.get(
            project_path(project, "assignments"),
            username=username,
            document_id=document_id,
            include_revoked=include_revoked or None,
        )
        if status:
            listed = [item for item in listed if item.get("status") in status]
        return {
            "assignments": [assignment_summary(item) for item in listed[:limit]],
            "count": len(listed),
            "truncated": len(listed) > limit,
        }

    @register(server, scopes="project-admin", effect="changes")
    async def reassign_task(
        assignment_id: int,
        username: Annotated[
            str, Field(description="Login name of the project member taking it.")
        ],
        confirm_started: Annotated[
            bool,
            Field(
                description=(
                    "Needed for a task already started or submitted: the new"
                    " person starts from the beginning."
                )
            ),
        ] = False,
        confirm_language: bool = False,
        confirm_unreviewed_translation: bool = False,
    ) -> dict[str, Any]:
        """Hand one task to another project member; the old task is withdrawn.

        Refused with REASSIGN_CONFIRMATION_REQUIRED for a started task
        unless confirm_started. A consolidation cannot be reassigned.
        """
        moved: dict[str, Any] = await api.post(
            f"/api/v1/assignments/{seg(assignment_id)}/reassign",
            {
                "username": username,
                "confirm_started": confirm_started,
                "confirm_language": confirm_language,
                "confirm_unreviewed_translation": confirm_unreviewed_translation,
            },
        )
        return assignment_summary(moved)

    @register(server, scopes="project-admin", effect="destructive")
    async def withdraw_task(
        assignment_id: int, reason: str | None = None
    ) -> dict[str, Any]:
        """Withdraw a task: it leaves the person's list; submitted work stays.

        Unlike remove_task, the draft is not discarded.
        """
        revoked: dict[str, Any] = await api.post(
            f"/api/v1/assignments/{seg(assignment_id)}/revoke", {"reason": reason}
        )
        return assignment_summary(revoked)

    @register(server, scopes="project-admin", effect="destructive")
    async def remove_task(assignment_id: int) -> dict[str, Any]:
        """Remove an unsubmitted annotation task AND DISCARD ITS DRAFT.

        Frees the text's slot, so assigning the person again starts empty.
        Refused for submitted work (withdraw_task instead).
        """
        removed: dict[str, Any] = await api.post(
            f"/api/v1/assignments/{seg(assignment_id)}/remove"
        )
        return assignment_summary(removed)

    @register(server, scopes="project-admin", effect="changes")
    async def reopen_task(
        assignment_id: int, reason: str | None = None
    ) -> dict[str, Any]:
        """Reopen a submitted task so its person can change the submission.

        A translation review of a version in which a lead fixed typos since
        (editorial_correction) is refused with
        VARIANT_REVIEW_STALE/typos_fixed; the details name the fixed
        version. Assign a review of the text again instead: it is a review
        of that newest version.
        """
        reopened: dict[str, Any] = await api.post(
            f"/api/v1/assignments/{seg(assignment_id)}/reopen", {"reason": reason}
        )
        return assignment_summary(reopened)

    async def _bulk(
        project: str,
        action: str,
        body: dict[str, Any],
        confirm: bool,
        preview_token: str | None,
    ) -> dict[str, Any]:
        """Dry run, or apply with the dry run's token; a stale token answers
        with the fresh dry run (``stale``)."""
        path = project_path(project, "bulk-task-actions", action)
        body = body | {"rows": [text.model_dump() for text in body["rows"]]}
        if not confirm:
            preview: dict[str, Any] = await api.post(path, body | {"preview": True})
            return bulk_summary(preview, False)
        if preview_token is None:
            raise OntotatorError(
                "Run the dry run first and pass its preview_token with confirm."
            )
        try:
            applied: dict[str, Any] = await api.post(
                path, body | {"preview_token": preview_token}
            )
        except OntotatorError as exc:
            fresh = (
                exc.details.get("preview") if isinstance(exc.details, dict) else None
            )
            if exc.code != "PREVIEW_STALE" or not isinstance(fresh, dict):
                raise
            return bulk_summary(fresh, False) | {
                "stale": True,
                "note": "Tasks changed since the dry run; nothing was changed."
                " Check this new dry run and confirm with its preview_token.",
            }
        return bulk_summary(applied, True)

    @register(server, scopes="project-admin", effect="changes")
    async def reopen_texts(
        project: Project,
        texts: Texts,
        reason: Annotated[
            str,
            Field(
                min_length=1,
                max_length=2000,
                description="Why, e.g. 'Guideline 2.3 changed'; the people see it.",
            ),
        ],
        tasks: Tasks = None,
        confirm: Annotated[
            bool, Field(description="False: dry run. True: reopen the listed tasks.")
        ] = False,
        preview_token: PreviewToken = None,
    ) -> dict[str, Any]:
        """Reopen the submitted tasks of many texts, after a dry run.

        Like reopen_task for each task: its person gets it back in My tasks
        with the reason. Texts with a final result are skipped (change it
        first); unsubmitted tasks are kept. The dry run lists both, the
        texts the project does not have (unknown_texts: another spelling,
        letter case or language; nothing happens to them) and a
        preview_token; confirm with it: every listed task is reopened, or
        none when anything changed since (then the answer is a fresh dry run,
        ``stale``). The confirmed answer carries ``undo`` (id and
        expires_at): undo_reopen_or_withdraw takes that id and submits the
        tasks again, for 60 minutes and while nothing else changed on the
        texts. There is no ``undo`` when a translation review was reopened
        (its draft restarted from the current text) or nothing changed.
        """
        body = {"rows": texts, "reason": reason} | ({"tasks": tasks} if tasks else {})
        return await _bulk(project, "reopen", body, confirm, preview_token)

    @register(server, scopes="project-admin", effect="destructive")
    async def withdraw_open_tasks(
        project: Project,
        texts: Texts,
        tasks: Tasks = None,
        include_started: Annotated[
            bool,
            Field(description="Also tasks in progress or reopened (drafts stay)."),
        ] = False,
        over_limit_only: Annotated[
            bool,
            Field(
                description=(
                    "Only annotations above annotators per text (a text's own value,"
                    " else the project's):"
                    " submitted, then started, then the earliest stay."
                )
            ),
        ] = False,
        reason: Annotated[str | None, Field(max_length=2000)] = None,
        confirm: Annotated[
            bool, Field(description="False: dry run. True: withdraw the listed tasks.")
        ] = False,
        preview_token: PreviewToken = None,
    ) -> dict[str, Any]:
        """Withdraw the open tasks of many texts, after a dry run.

        Like withdraw_task for each task: it leaves the person's list; drafts
        and submitted work stay. By default only tasks not yet started;
        paused tasks and lead corrections are kept; texts the project does
        not have are named (unknown_texts). Confirm with the dry
        run's preview_token: all listed tasks are withdrawn, or none when
        anything changed since (a fresh dry run, ``stale``). The confirmed
        answer carries ``undo`` (id and expires_at): undo_reopen_or_withdraw
        takes that id and brings the tasks back with their drafts, for 60
        minutes and while nothing else changed on the texts.
        """
        body: dict[str, Any] = {
            "rows": texts,
            "include_started": include_started,
            "over_limit_only": over_limit_only,
        }
        if tasks:
            body["tasks"] = tasks
        if reason:
            body["reason"] = reason
        return await _bulk(project, "withdraw", body, confirm, preview_token)

    @register(server, scopes="project-admin", effect="changes")
    async def undo_reopen_or_withdraw(
        project: Project,
        undo_id: Annotated[
            int,
            Field(
                ge=1,
                description=(
                    "``undo.id`` of the confirmed reopen_texts or"
                    " withdraw_open_tasks answer."
                ),
            ),
        ],
        confirm: Annotated[
            bool,
            Field(description="False: dry run. True: bring the tasks back."),
        ] = False,
    ) -> dict[str, Any]:
        """Undo a reopen_texts or withdraw_open_tasks, after a dry run.

        The server kept which tasks the action changed; this names only that
        record. It works once, with the token of the lead who applied the
        action, within 60 minutes. The dry run lists the tasks that would
        come back (would_restore): reopened tasks are submitted again,
        withdrawn tasks return to their people with their drafts. It also
        says what is in the way (blocked, with the reason): something
        changed on the texts since (a task, draft, round, final result, plan
        row or version), a text no longer plans the task, or a person left
        the project. With confirm every task comes back, or none: a blocked
        undo changes nothing (the answer is then the dry run, ``refused``).
        An undo that is unknown, expired or already used is refused with
        BULK_UNDO_STALE. start_rounds and a reopened translation review
        have no undo.
        """
        path = project_path(project, "bulk-task-actions", "undo")

        def summary(found: dict[str, Any], applied: bool) -> dict[str, Any]:
            tasks = [
                {
                    key: item.get(key)
                    for key in ("case_id", "language", "assignment_id", "task")
                }
                | {
                    "status": item.get("status"),
                    "person": (item.get("person") or {}).get("display_name")
                    or (item.get("person") or {}).get("pseudonym"),
                }
                for item in found.get("tasks", [])
            ]
            return {
                "applied": applied,
                "undo_id": found.get("undo_id"),
                "action": found.get("action"),
                "expires_at": found.get("expires_at"),
                "restored" if applied else "would_restore": _cut(
                    tasks, MAX_BULK_LISTED
                ),
                "task_count": found.get("task_count", len(tasks)),
                "blocked": found.get("blocked"),
            }

        preview: dict[str, Any] = await api.post(
            path, {"undo_id": undo_id, "preview": True}
        )
        if not confirm:
            return summary(preview, False)
        if preview.get("blocked"):
            return summary(preview, False) | {
                "refused": True,
                "note": "The texts changed since the action (blocked); nothing"
                " was restored. reopen_task, withdraw_task and assign_texts"
                " change one task.",
            }
        applied: dict[str, Any] = await api.post(path, {"undo_id": undo_id})
        return summary(applied, True)

    @register(server, scopes="project-admin", effect="destructive")
    async def start_rounds(
        project: Project,
        texts: Texts,
        kind: Annotated[
            Literal["carry_forward", "clean_restart"],
            Field(
                description=(
                    "carry_forward: the new round starts with what the person"
                    " submitted. clean_restart: it has none of the earlier findings;"
                    " a task from tool proposals starts on the newest proposals."
                )
            ),
        ],
        reason: Annotated[
            str | None,
            Field(max_length=2000, description="Required for clean_restart."),
        ] = None,
        confirm: Annotated[
            bool, Field(description="False: dry run. True: start the listed rounds.")
        ] = False,
        preview_token: PreviewToken = None,
    ) -> dict[str, Any]:
        """Start a new work round for the submitted annotations of many texts,
        after a dry run. THERE IS NO UNDO.

        Each person gets the task back and must submit again; the earlier
        submission no longer counts. Only submitted annotations on a text's
        current version take a round; texts with a final result or an open
        consolidation are skipped, other tasks are kept (the dry run says
        why); texts the project does not have are named (unknown_texts).
        Confirm with the dry run's preview_token: every listed task
        gets its round, or none when anything changed since (a fresh dry
        run, ``stale``). No tool takes a round back: the answer has no
        ``undo``, and undo_reopen_or_withdraw does not apply.
        """
        if confirm and kind == "clean_restart" and not (reason or "").strip():
            raise OntotatorError("A clean_restart needs a reason.")
        body: dict[str, Any] = {"rows": texts, "kind": kind}
        if reason:
            body["reason"] = reason
        return await _bulk(project, "start-round", body, confirm, preview_token)

    async def _pause(
        project: str,
        action: str,
        body: dict[str, Any],
        confirm: bool,
        preview_token: str | None,
    ) -> dict[str, Any]:
        """Dry run, or apply with the dry run's token; a stale token answers
        with the fresh dry run (``stale``)."""
        path = project_path(project, "text-pauses", action)
        body = body | {"rows": [text.model_dump() for text in body["rows"]]}
        if not confirm:
            preview: dict[str, Any] = await api.post(path, body | {"preview": True})
            return pause_summary(preview, False)
        if preview_token is None:
            raise OntotatorError(
                "Run the dry run first and pass its preview_token with confirm."
            )
        try:
            applied: dict[str, Any] = await api.post(
                path, body | {"preview_token": preview_token}
            )
        except OntotatorError as exc:
            fresh = (
                exc.details.get("preview") if isinstance(exc.details, dict) else None
            )
            if exc.code != "PREVIEW_STALE" or not isinstance(fresh, dict):
                raise
            return pause_summary(fresh, False) | {
                "stale": True,
                "note": "The texts changed since the dry run; nothing was changed."
                " Check this new dry run and confirm with its preview_token.",
            }
        return pause_summary(applied, True)

    @register(server, scopes="project-admin", effect="changes")
    async def pause_texts(
        project: Project,
        texts: Texts,
        reason: Annotated[
            str,
            Field(
                min_length=1,
                max_length=2000,
                description=(
                    "Why, e.g. 'Source text is being clarified'; the people see"
                    " it in My tasks and in the task."
                ),
            ),
        ],
        confirm: Annotated[
            bool, Field(description="False: dry run. True: pause the listed texts.")
        ] = False,
        preview_token: PreviewToken = None,
    ) -> dict[str, Any]:
        """Pause the work on many texts, after a dry run.

        A paused text keeps its tasks: the people still see them in My
        tasks, marked "Paused by lead" with the reason, and can read them,
        but no task in progress can be saved (annotation, translation review,
        consolidation). A task assigned, reopened or given a round later is
        paused from the start. Submitted work and final results are untouched
        and exported as before. A pause from a problem report is a separate
        cause and stays as it is. The dry run lists the texts with their
        tasks in progress, the texts already paused, the texts the project
        does not have (unknown_texts) and a preview_token;
        confirm with it: every listed text is paused, or none when anything
        changed since (a fresh dry run, ``stale``). release_texts is the way
        back.
        """
        return await _pause(
            project, "pause", {"rows": texts, "reason": reason}, confirm, preview_token
        )

    @register(server, scopes="project-admin", effect="changes")
    async def release_texts(
        project: Project,
        texts: Texts,
        reason: Annotated[str | None, Field(max_length=2000)] = None,
        confirm: Annotated[
            bool, Field(description="False: dry run. True: release the listed texts.")
        ] = False,
        preview_token: PreviewToken = None,
    ) -> dict[str, Any]:
        """Release texts a lead paused (pause_texts), after a dry run.

        Their tasks in progress can be saved again. A task that a problem
        report pauses as well stays paused until that report is decided
        (``still_paused_by_report``); deciding a report never releases a
        lead pause. Texts that are not paused are skipped; texts the
        project does not have are named (unknown_texts). Confirm with the
        dry run's preview_token: every listed text is released, or none when
        anything changed since (a fresh dry run, ``stale``).
        """
        body: dict[str, Any] = {"rows": texts}
        if reason:
            body["reason"] = reason
        return await _pause(project, "release", body, confirm, preview_token)

    @register(server, scopes=("read", "project-admin"), effect="destructive")
    async def hand_over_open_tasks(
        project: Project,
        from_username: Annotated[
            str, Field(description="The person leaving, or pausing their work.")
        ],
        to_usernames: Annotated[
            list[str],
            Field(
                min_length=1,
                max_length=50,
                description="Project members taking the tasks, in turn.",
            ),
        ],
        include_started: Annotated[
            bool,
            Field(
                description=(
                    "Also move tasks already started; the successor starts"
                    " them from the beginning."
                )
            ),
        ] = False,
        confirm_language: bool = False,
        confirm: Annotated[
            bool, Field(description="False: dry run. True: reassign as planned.")
        ] = False,
    ) -> dict[str, Any]:
        """Hand a person's open tasks to others in turn, after a dry run.

        The dry run lists each task with its successor, and the tasks that
        stay (consolidations, lead corrections, started tasks without
        include_started) with the reason. With confirm each planned task is
        reassigned; a refusal of one task (for example the successor
        already has that text) is reported and the others go on. Submitted
        work stays with its author.
        """
        # The server keeps usernames trimmed and in lower case.
        leaving = from_username.strip().lower()
        if leaving in {name.strip().lower() for name in to_usernames}:
            raise OntotatorError("The person leaving cannot take their own tasks.")
        assigned: list[dict[str, Any]] = await api.get(
            project_path(project, "assignments"), username=leaving
        )
        assigned = [a for a in assigned if a.get("username") == leaving]
        moves, kept = handover_plan(
            assigned, to_usernames, include_started=include_started
        )
        plan = {
            "from": from_username,
            "moves": _cut(moves),
            "move_count": len(moves),
            "kept": _cut(kept),
            "kept_count": len(kept),
        }
        if not confirm or not moves:
            return {"applied": False, "plan": plan}
        done: list[dict[str, Any]] = []
        refused: list[dict[str, Any]] = []
        for move in moves:
            try:
                new = await api.post(
                    f"/api/v1/assignments/{seg(move['id'])}/reassign",
                    {
                        "username": move["to"],
                        "confirm_started": include_started,
                        "confirm_language": confirm_language,
                        "confirm_unreviewed_translation": False,
                    },
                )
            except OntotatorError as exc:
                refused.append(
                    {
                        "assignment_id": move["id"],
                        "to": move["to"],
                        "code": exc.code,
                        "error": str(exc),
                    }
                )
                continue
            done.append(
                {
                    "assignment_id": move["id"],
                    "new_assignment_id": new.get("id"),
                    "document_id": new.get("document_id"),
                    "to": new.get("username"),
                }
            )
        return {
            "applied": True,
            "plan": plan,
            "reassigned": _cut(done),
            "reassigned_count": len(done),
            "refused": _cut(refused),
        }

    @register(server, scopes="read", effect="read")
    async def list_problem_reports(
        project: Project,
        document_id: Annotated[
            str | None, Field(description="Only reports on this text version.")
        ] = None,
        limit: Annotated[int, Field(ge=1, le=500)] = 100,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> list[dict[str, Any]]:
        """Problem reports annotators filed in the project.

        An open report pauses work and is a warning of the final export;
        the lead decides on it in the web interface.
        """
        listed: list[dict[str, Any]] = await api.get(
            project_path(project, "problem-reports"),
            document_id=document_id,
            limit=limit,
            offset=offset,
        )
        return listed
