"""A lead's decision on a queried translation, and texts that are not retyped
(issue 485, points 3 and 4).

``decide_translation_query`` closes a translation review submitted as a
query: the reviewer's proposed text becomes the next version, accepted, or
the version is accepted as it is, each with an answer the reviewer reads.
The helpers here also serve ``upload_translation_version``: the changes of
a dry run against the current version, and a text built from a review's
proposed text plus replacements.

Which answers carry text: a dry run always counts the changed passages and
characters. The passages themselves (``diff``) and the reviewer's question
are clinical text that the caller did not send, so they are returned only
when this MCP server runs with ``ONTOTATOR_MCP_READ_CONTENT=1``. The whole
text of a version or of a review is never returned here.
"""

from __future__ import annotations

import difflib
import hashlib
import itertools
import json
import re
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ontotator_mcp.client import OntotatorClient, project_path, seg
from ontotator_mcp.errors import OntotatorError, hint_for, sentences
from ontotator_mcp.models import Replacement
from ontotator_mcp.tooling import register

Project = Annotated[str, Field(description="Project key, e.g. 'ward-7'.")]
Confirm = Annotated[
    bool, Field(description="False: dry run, changes nothing. True: apply.")
]
REFUSED = "QUERY_DECISION_NOT_AVAILABLE"
STALE = "VARIANT_REVIEW_STALE"
PREVIEW_TOKEN = re.compile(r"sha256:[0-9a-f]{64}")
# Words, runs of white space and single other characters: joined, the text.
_TOKEN = re.compile(r"\w+|\s+|[^\w\s]")
# Code points of unchanged text shown on each side of a changed passage.
DIFF_CONTEXT = 30
CONTENT_NOTE = (
    "The changed passages ('diff') are clinical text and are left out: they"
    " are returned when this MCP server runs with ONTOTATOR_MCP_READ_CONTENT=1"
    " (a setting in the MCP client's configuration of ontotator-mcp, not of"
    " the Ontotator server)."
)


def changed_passages(old: str, new: str) -> list[dict[str, Any]]:
    """Where ``new`` differs from ``old``, word by word.

    Each passage names ``old_text`` at ``[old_start, old_end)`` of ``old``
    and ``new_text`` at ``[new_start, new_end)`` of ``new`` (Unicode code
    points, the keys of ``editorial_correction``'s diff), with up to
    DIFF_CONTEXT code points of unchanged text on each side (``before``,
    ``after``). Changes that only white space separates are one passage.
    """
    a, b = _TOKEN.findall(old), _TOKEN.findall(new)
    merged: list[list[int]] = []
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        last = merged[-1] if merged else None
        if last is not None and not "".join(a[last[1] : i1]).strip():
            last[1], last[3] = i2, j2
        else:
            merged.append([i1, i2, j1, j2])

    def offsets(tokens: list[str]) -> list[int]:
        found = [0]
        for token in tokens:
            found.append(found[-1] + len(token))
        return found

    at_old, at_new = offsets(a), offsets(b)
    passages = []
    for i1, i2, j1, j2 in merged:
        old_start, old_end = at_old[i1], at_old[i2]
        new_start, new_end = at_new[j1], at_new[j2]
        passages.append(
            {
                "old_start": old_start,
                "old_end": old_end,
                "new_start": new_start,
                "new_end": new_end,
                "old_text": old[old_start:old_end],
                "new_text": new[new_start:new_end],
                "before": old[max(old_start - DIFF_CONTEXT, 0) : old_start],
                "after": old[old_end : old_end + DIFF_CONTEXT],
            }
        )
    return passages


def change_summary(previous: str, text: str, *, read_content: bool) -> dict[str, Any]:
    """What a text changes against ``previous``: the number of changed
    passages and of the characters in them, the sizes of both texts and,
    with the content opt-in only, the passages (``diff``)."""
    found = changed_passages(previous, text)
    summary: dict[str, Any] = {
        "passages_changed": len(found),
        "inserted_characters": sum(len(item["new_text"]) for item in found),
        "deleted_characters": sum(len(item["old_text"]) for item in found),
        "text_characters": len(text),
        "previous_text_characters": len(previous),
    }
    if read_content:
        summary["diff"] = found
    elif found:
        summary["diff_note"] = CONTENT_NOTE
    return summary


def apply_replacements(text: str, replacements: list[Replacement], where: str) -> str:
    """``text`` with every ``old`` passage replaced by its ``new``.

    Each ``old`` must occur exactly once in ``text`` and no two may overlap;
    otherwise nothing is done and the error names the replacement (its
    position in the list, counted from 1, and its ``old``).
    """
    spans: list[tuple[int, int, str, int]] = []
    for number, item in enumerate(replacements, 1):
        first = text.find(item.old)
        named = f"Replacement {number} (old {item.old!r})"
        if first < 0:
            raise OntotatorError(
                f"{named} does not occur in {where}; nothing was done. Check"
                " the spelling, spaces and line breaks of 'old'."
            )
        if text.find(item.old, first + 1) >= 0:
            raise OntotatorError(
                f"{named} occurs more than once in {where}; nothing was done."
                " Add neighbouring words to 'old' until it occurs exactly once."
            )
        spans.append((first, first + len(item.old), item.new, number))
    spans.sort()
    for (_, end, _, earlier), (start, _, _, number) in itertools.pairwise(spans):
        if start < end:
            raise OntotatorError(
                f"Replacement {number} (old {replacements[number - 1].old!r})"
                f" overlaps replacement {earlier}; nothing was done. Make them"
                " one replacement."
            )
    parts: list[str] = []
    at = 0
    for start, end, new, _ in spans:
        parts += [text[at:start], new]
        at = end
    return "".join([*parts, text[at:]])


async def text_from_review(
    api: OntotatorClient,
    project: str,
    document_id: str,
    review_id: int,
    replacements: list[Replacement] | None,
) -> str:
    """The text review ``review_id`` of ``document_id`` proposed, with the
    replacements applied. Reads the reviews of the version (scope 'read')."""
    reviews: list[dict[str, Any]] = await api.get(
        project_path(project, "documents", seg(document_id), "translation-reviews")
    )
    for review in reviews:
        if review.get("id") == review_id:
            return apply_replacements(
                str(review.get("proposed_text") or ""),
                replacements or [],
                f"the text review {review_id} proposed",
            )
    raise OntotatorError(
        f"Text version {document_id!r} has no submitted translation review"
        f" {review_id} that the token's owner may read; nothing was done."
        " list_translation_reviews with this document_id names the reviews of"
        " the version (id). A review of an earlier version is not taken here."
    )


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def decision_token(*parts: Any) -> str:
    """What a dry run showed, as the token its confirm must name."""
    packed = json.dumps(parts, ensure_ascii=False, separators=(",", ":"))
    return f"sha256:{_sha256(packed)}"


def register_translation_decisions(
    server: MCPServer, api: OntotatorClient, *, read_content: bool
) -> None:
    @register(server, scopes="project-admin", effect="changes")
    async def decide_translation_query(
        project: Project,
        document_id: Annotated[
            str,
            Field(
                description=(
                    "The queried version: the newest version of the translation"
                    " (list_texts, versions). A case ID is not a document_id."
                )
            ),
        ],
        decision: Annotated[
            Literal["reviewer_text", "unchanged"],
            Field(
                description=(
                    "'reviewer_text': the text the reviewer proposed with the"
                    " query becomes the next version, accepted. 'unchanged':"
                    " this version is accepted as it is; needs an answer."
                )
            ),
        ],
        answer: Annotated[
            str | None,
            Field(
                max_length=2000,
                description=(
                    "The answer to the reviewer's question; the reviewer reads"
                    " it at their submitted task. Required for 'unchanged'."
                ),
            ),
        ] = None,
        replacements: Annotated[
            list[Replacement] | None,
            Field(
                description=(
                    "With 'reviewer_text' only: changes to the reviewer's text"
                    " before it is saved. Each 'old' passage must occur exactly"
                    " once in the reviewer's text and is replaced by 'new';"
                    " passages must not overlap."
                )
            ),
        ] = None,
        preview_token: Annotated[
            str | None,
            Field(
                description=(
                    "With confirm: the preview_token of the dry run, so exactly"
                    " the decision that was shown is the one applied."
                )
            ),
        ] = None,
        confirm: Confirm = False,
    ) -> dict[str, Any]:
        """Decide a translation review that was submitted as a query, as the lead, after a dry run.

        Use this for a queried translation: the reviewer proposed a text and
        asked a question, and the version waits for the lead. With
        'reviewer_text' the reviewer's text, with your replacements if you
        give any, becomes the next version, a correction of document_id,
        accepted; waiting annotation tasks follow it. With 'unchanged'
        document_id is accepted as it is. Both are recorded as the lead's
        decision on the query with the answer, not as "reviewed outside
        Ontotator". For a text made or reviewed outside Ontotator use
        upload_translation_version and accept_translation_version instead;
        for typos, editorial_correction.

        The dry run says whether the query can be decided (reason and what
        to do if not: already_decided, not_a_query, review_open, not_newest,
        discarded, unchanged), names the review, the version that would be
        accepted, the work that stays on the current version, and 'change':
        how many passages and characters the text to save changes against
        document_id (for 'unchanged': 'reviewer_text_not_taken', what the
        reviewer's text would have changed). The changed passages ('diff')
        and the reviewer's question are returned only when this MCP server
        runs with ONTOTATOR_MCP_READ_CONTENT=1; the whole text never. Confirm
        with the dry run's preview_token and the same arguments: if the
        text, the review or an argument differs from what the dry run
        showed, nothing is changed and a new dry run is returned. Only the
        token's owner as lead of the project can do this.
        """
        said = (answer or "").strip() or None
        if decision == "unchanged":
            if replacements:
                raise OntotatorError(
                    "replacements change the reviewer's text; they go with"
                    " decision 'reviewer_text' only. Nothing was done."
                )
            if said is None:
                raise OntotatorError(
                    sentences(
                        [
                            "Nothing was done",
                            hint_for(f"{REFUSED}/answer_required") or "",
                        ]
                    )
                )
        path = project_path(project, "documents", seg(document_id), "query-decision")

        async def dry_run() -> tuple[dict[str, Any], str | None, str | None]:
            """The plan, the text to save (``reviewer_text``) and the token."""
            found: dict[str, Any] = await api.get(path)
            current = str(found.pop("text", None) or "")
            review = found.get("review")
            proposed = str((review or {}).pop("proposed_text", None) or "")
            question = (review or {}).pop("rationale", None)
            if review is not None and read_content:
                review["question"] = question
            plan = found | {"decision": decision}
            text: str | None = None
            if review is not None:
                if decision == "reviewer_text":
                    text = apply_replacements(
                        proposed, replacements or [], "the reviewer's text"
                    )
                    plan["change"] = change_summary(
                        current, text, read_content=read_content
                    ) | {"edited_by_replacements": text != proposed}
                    if plan.get("available") and text == current:
                        plan["available"], plan["reason"] = False, "unchanged"
                else:
                    plan["reviewer_text_not_taken"] = change_summary(
                        current, proposed, read_content=read_content
                    )
            if not plan.get("available"):
                plan["hint"] = hint_for(f"{REFUSED}/{plan.get('reason')}")
                return plan, text, None
            if decision == "reviewer_text":
                plan["would"] = (
                    f"Save the text as version {plan.get('next_version')}, a"
                    f" correction of {document_id}, accepted."
                )
            else:
                plan["would"] = f"Accept {document_id} as it is."
            token = decision_token(
                project,
                document_id,
                decision,
                plan.get("text_sha256"),
                (review or {}).get("id"),
                None if text is None else _sha256(text),
                said,
            )
            return plan, text, token

        plan, text, token = await dry_run()
        if not confirm:
            return {"applied": False, "plan": plan, "preview_token": token}
        if preview_token is None:
            raise OntotatorError(
                "Run the dry run first and pass its preview_token with confirm."
            )
        if not PREVIEW_TOKEN.fullmatch(preview_token):
            raise OntotatorError(
                "This preview_token is not one a dry run returned (it is cut or"
                " mistyped); nothing was changed. Pass the preview_token of the"
                " last dry run exactly as it was returned."
            )
        if token is None:
            # As a dry run, so that the answer names the reason and the plan.
            return {
                "applied": False,
                "note": sentences(
                    [
                        f"The query on {document_id} cannot be decided"
                        f" ({plan.get('reason')}); nothing was changed",
                        plan.get("hint") or "",
                    ]
                ),
                "plan": plan,
                "preview_token": None,
            }
        stale = {
            "applied": False,
            "note": "The text, the review or an argument changed since the dry"
            " run, or the preview_token is not the one of the last dry run with"
            " the same arguments; nothing was changed. Check this new dry run"
            " and confirm with its preview_token.",
        }
        if token != preview_token:
            return stale | {"plan": plan, "preview_token": token}
        body: dict[str, Any] = {
            "kind": decision,
            "expected_text_sha256": plan["text_sha256"],
            "expected_review_id": plan["review"]["id"],
        }
        if text is not None:
            body["text"] = text
        if said is not None:
            body["answer"] = said
        try:
            result: dict[str, Any] = await api.post(path, body)
        except OntotatorError as exc:
            if (exc.code or "").split("/")[0] != STALE:
                raise
            plan, _text, token = await dry_run()
            return stale | {"plan": plan, "preview_token": token}
        return {"applied": True, "result": result}
