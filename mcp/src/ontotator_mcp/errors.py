"""Ontotator API errors as tool errors the model can read and act on.

The API answers a refusal with ``{"code": ..., "details": ...}`` (request
validation with ``{"detail": [...]}``). Each error becomes one
``OntotatorError``: the HTTP status, the code, the server's own text and,
for the codes a script meets most, what to do about it. The token is never
part of a message: should the server echo it back, it is replaced by ``***``.
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx
from mcp.server.mcpserver.exceptions import ToolError

MAX_DETAILS = 4000
REDACTED = "***"

# What the caller can do about a code; the server's own text comes first.
HINTS: dict[str, str] = {
    "NOT_AUTHENTICATED": (
        "Set ONTOTATOR_TOKEN to an API token of this server (Profile > API tokens,"
        " or ontotator admin tokens create)."
    ),
    "TOKEN_INVALID": (
        "The token in ONTOTATOR_TOKEN is unknown, expired or revoked. Create a new"
        " token and restart the MCP server with it."
    ),
    "TOKEN_SCOPE_MISSING": (
        "Create a token that also holds this scope (the tool description names it)"
        " and restart the MCP server with it."
    ),
    "TOKEN_NOT_ALLOWED": (
        "Either the route needs a browser session (annotation, review and"
        " translation review work, token management), or a project token was used"
        " outside its project. Use the web interface, or a personal token."
    ),
    "CREDENTIALS_AMBIGUOUS": "Send only the API token, without a session cookie.",
    "CROSS_SITE_REQUEST": (
        "The server refused the request's origin. Check ONTOTATOR_URL; it must be"
        " the server's public address."
    ),
    "NOT_ALLOWED": (
        "The token's owner lacks the project role for this (the scope only opens"
        " the route; the owner's roles decide)."
    ),
    "ADMIN_REQUIRED": "This needs a system token of a system administrator.",
    "PROJECT_NOT_FOUND": (
        "No such project, or the token's owner is not a member. list_projects"
        " shows the projects the token can see."
    ),
    "PROJECT_BUSY": "The project is busy and nothing was changed. Try again shortly.",
    "VALIDATION_ERROR": "Check the arguments against the tool's input schema.",
    "REVISION_CONFLICT": (
        "Someone changed the same thing in the meantime. Read the current state"
        " again and repeat the call."
    ),
    "EXPORT_EMPTY": (
        "Accept at least one final result first (accept_agreeing_texts, or the"
        " Documents page)."
    ),
    "MEMBER_HAS_ASSIGNMENTS": (
        "Open tasks rest on the roles being removed. Pass revoke_assignments to"
        " withdraw them, or hand them on first with hand_over_open_tasks."
    ),
    "PAYLOAD_TOO_LARGE": "The file exceeds the server's configured upload limit.",
    "REASSIGN_CONFIRMATION_REQUIRED": (
        "The task was already started; pass confirm_started (the new person starts"
        " from the beginning)."
    ),
    "ASSIGNMENT_EXISTS": "The new person already has this task on this text.",
    "USERNAME_TAKEN": "An account with this username exists already.",
    "WORK_PLAN_CONFIRMATION_REQUIRED": (
        "The change withdraws tasks or final results (listed above); pass"
        " withdraw_tasks to apply it anyway."
    ),
    "CONSOLIDATION_OPEN": (
        "A consolidation is open on this text, and a new round would take away a"
        " submission it rests on. Have the consolidation finished, or withdraw"
        " its task (withdraw_task), then repeat the call."
    ),
    "WORKFLOW_REVISION_CONFLICT": (
        "The task or report changed in the meantime. Read the current state again"
        " (the tool's dry run, where it has one) and repeat the call."
    ),
    "EDITORIAL_CORRECTION_NOT_AVAILABLE": (
        "The reason says why (the dry run shows it too). A replacement that is"
        " not found, ambiguous or overlapping names its index."
    ),
    "DOCUMENT_NOT_FOUND": (
        "No such text version in this project, or the token's owner may not read"
        " it. list_texts names the document_id of each text; a case ID is not a"
        " document_id."
    ),
    "VERSION_NOT_FOUND": (
        "No such submission or annotation version of this text, or the token's"
        " owner may not read it. list_annotation_versions and get_text_detail"
        " name the ones on offer; drafts cannot be read."
    ),
    "GUIDELINE_VERSION_CONFLICT": (
        "Another guideline version was published or withdrawn meanwhile; check"
        " list_guidelines and repeat."
    ),
    # The request named no latest version (#486): repeating never helps.
    "GUIDELINE_VERSION_CONFLICT/expected_version_missing": (
        "The request did not say which guideline version it saw as the latest,"
        " although the project has versions; nobody published meanwhile. An"
        " ontotator-mcp older than the Ontotator server sends none: restart the"
        " MCP server after an upgrade (whoami shows both versions). A script"
        " sends expected_latest_version, the latest_version of GET .../guidelines."
    ),
    "GUIDELINE_NOTE_INVALID": (
        "change_note (publish_guideline) and reason (withdraw_guideline) are one"
        " line of at most 280 characters; annotators see it. Shorten it and"
        " repeat the call."
    ),
    "ASSIGNEE_ROLE_MISSING": (
        "The person lacks the project role this task needs ('annotator' for"
        " annotations and translation reviews, 'adjudicator' for a"
        " consolidation). list_people shows the roles; add the role with"
        " set_member_roles, then repeat the call."
    ),
    "ASSIGNEE_INACTIVE": (
        "The person's account is deactivated. Choose another person (list_people)."
    ),
    "NOT_A_MEMBER": (
        "The person is not a member of the project. Add them with"
        " set_member_roles, then repeat the call."
    ),
    "ANNOTATIONS_PER_TEXT_REACHED": (
        "The text already has as many annotators as its annotations per text"
        " allow. Raise the number (set_annotations_per_text for single texts,"
        " update_project_settings for the project) or withdraw one of its tasks"
        " (withdraw_task), then repeat the call."
    ),
    "VARIANT_REVIEW_STALE": (
        "The text version is not the one named: a newer version arrived since"
        " the dry run, or the hash passed is not the text_sha256 the dry run"
        " returned. Run the dry run again and confirm with its text_sha256."
    ),
    "NOT_A_TRANSLATION": (
        "This works on translations only. list_texts gives the document_id of"
        " each translation (is_source false)."
    ),
    "NOT_A_TRANSLATION/not_a_translation": (
        "document_id names a source text; this works on translations only. A"
        " case ID is not a document_id, and for a source text the two can be"
        " the same. list_texts gives the document_id of each translation"
        " (is_source false). A source text gets a new version by importing a package"
        " (upload_texts)."
    ),
    "VERSION_UPLOAD_NOT_AVAILABLE": (
        "No version can follow this one; the dry run (confirm false) names the reason."
    ),
    "VERSION_UPLOAD_NOT_AVAILABLE/not_newest": (
        "document_id is not the newest version of its translation. list_texts"
        " names the newest (document_id, version); repeat the call with it."
    ),
    "VERSION_UPLOAD_NOT_AVAILABLE/discarded": (
        "This version was discarded; no version can follow it. list_texts names"
        " the current version of the translation."
    ),
    "VERSION_UPLOAD_NOT_AVAILABLE/review_open": (
        "A translation review or lead correction of this version is open. Let"
        " it be submitted, or withdraw its task (list_assignments,"
        " withdraw_task), then repeat the call."
    ),
    "VERSION_UPLOAD_NOT_AVAILABLE/unchanged": (
        "The text equals the current version; there is nothing to upload."
    ),
    "BULK_UNDO_STALE": (
        "This undo is no longer available; run the tool's dry run (confirm"
        " false) to see why."
    ),
    "BULK_UNDO_STALE/not_found": (
        "No undo with this undo_id for this token's owner in this project. Pass"
        " the undo.id of the confirmed answer (change_final_results or"
        " set_final_result for undo_change_final_results; reopen_texts or"
        " withdraw_open_tasks for undo_reopen_or_withdraw), with a token of the"
        " lead who made the change."
    ),
    "BULK_UNDO_STALE/expired": (
        "The 60 minutes for this undo are over. Change single texts or tasks"
        " back instead (set_final_result, reopen_task, withdraw_task,"
        " assign_texts)."
    ),
    "BULK_UNDO_STALE/already_undone": (
        "This change was undone already; an undo works once."
    ),
    "BULK_UNDO_STALE/not_undoable": (
        "This action has no undo (a reopened translation review restarted its"
        " draft). Change single tasks back with reopen_task, withdraw_task or"
        " assign_texts."
    ),
    "BULK_UNDO_STALE/changed": (
        "The texts changed since the action; nothing was restored. The dry run"
        " (confirm false) names what is in the way."
    ),
}


def hint_for(code: str | None) -> str | None:
    """What to do about ``code``: the sentence for the code with its reason
    (``CODE/reason``) if there is one, else the one for the code alone."""
    if not code:
        return None
    return HINTS.get(code) or HINTS.get(code.split("/")[0])


class OntotatorError(ToolError):
    """A failed Ontotator call, with the API's status and code when it gave one."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        code: str | None = None,
        details: Any = None,
        refusal: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        # The API's ``details``, for a tool that reports them as a dry run.
        self.details = details
        # The message without the general advice, for a tool that knows
        # better what to do next (``with_advice``).
        self.refusal = refusal or message

    def with_advice(self, advice: str) -> OntotatorError:
        """The same refusal, with ``advice`` in place of the general hint."""
        return OntotatorError(
            sentences([self.refusal, advice]),
            status=self.status,
            code=self.code,
            details=self.details,
        )


def _text(value: Any) -> str:
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(text) > MAX_DETAILS:
        text = text[:MAX_DETAILS] + " ...(cut)"
    return text


def redact(text: str, token: str | None) -> str:
    """``text`` with every occurrence of ``token`` replaced by ``***``."""
    if not token:
        return text
    return text.replace(token, REDACTED)


def _bearer(request: httpx.Request) -> str | None:
    """The token the request carried, so that a message can leave it out."""
    value = str(request.headers.get("authorization", ""))
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def sentences(parts: list[str]) -> str:
    """The parts as sentences: each ends with one full stop, not two."""
    out = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        out.append(part if part[-1] in ".!?" else part + ".")
    return " ".join(out)


def api_error(response: httpx.Response) -> OntotatorError:
    """The error for a non-success ``response``."""
    request = response.request
    where = f"{request.method} {request.url.path}"
    code: str | None = None
    details: Any = None
    try:
        body = response.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        if isinstance(body.get("code"), str):
            code = body["code"]
            details = body.get("details")
            # A refusal without details repeats its code as the details.
            if details == code:
                details = None
        elif "detail" in body:
            detail = body["detail"]
            code = "VALIDATION_ERROR" if response.status_code == 422 else None
            details = detail
        # A conflict names its reason inside the details (EXPORT_PREFLIGHT_STALE).
        if isinstance(details, dict) and isinstance(details.get("reason"), str):
            code = f"{code}/{details['reason']}" if code else details["reason"]
    elif response.text:
        details = response.text
    head = f"Ontotator refused {where}: HTTP {response.status_code}"
    if code:
        head += f" {code}"
    parts = [head]
    if details not in (None, ""):
        parts.append(_text(details))
    token = _bearer(request)
    refusal = redact(sentences(parts), token)
    hint = hint_for(code)
    if hint is None and response.status_code == 404:
        hint = "Not found, or not visible to the token's owner."
    if hint:
        parts.append(hint)
    message = redact(sentences(parts), token)
    return OntotatorError(
        message,
        status=response.status_code,
        code=code,
        details=details,
        refusal=refusal,
    )


PREVIEW_TOKEN = re.compile(r"sha256:[0-9a-f]{64}")


def check_preview_token(token: str | None) -> str:
    """The token a confirm call passed, if it can be one of a dry run.

    A token that is missing, cut or mistyped is refused here, so that the
    answer does not read as "something changed since the dry run".
    """
    if token is None:
        raise OntotatorError(
            "Run the dry run first and pass its preview_token with confirm."
        )
    if not PREVIEW_TOKEN.fullmatch(token):
        raise OntotatorError(
            "This preview_token is not one a dry run returned (it is cut or"
            " mistyped); nothing was changed. Pass the preview_token of the"
            " last dry run exactly as it was returned."
        )
    return token


def stale_note(what: str, done: str = "changed") -> str:
    """The note of a confirm the server refused as stale: the fresh dry run
    follows. A well-formed token of another dry run looks the same to the
    server as a change, so the note names both."""
    return (
        f"{what} changed since the dry run, or the preview_token is not the one"
        f" of the last dry run with the same arguments; nothing was {done}."
        " Check this new dry run and confirm with its preview_token."
    )


def transport_error(
    url: str, exc: httpx.HTTPError, token: str | None = None
) -> OntotatorError:
    """The error for a request that got no answer."""
    kind = type(exc).__name__
    return OntotatorError(
        redact(
            f"Cannot reach Ontotator at {url} ({kind}: {exc}). Check ONTOTATOR_URL"
            " and that the server is running.",
            token,
        )
    )
