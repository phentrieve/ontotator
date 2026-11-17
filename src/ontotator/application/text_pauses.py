"""Lead pause: a lead pauses the work on selected texts and releases it
(issue 464).

Two more actions in the shared frame "bulk action with preview" of Documents
(``bulk_task_actions``): the preview lists the texts the action changes with
the tasks it stops or opens, the texts it leaves as they are and why, and a
``preview_token``; applying sends that token and changes every listed text or
none (``PREVIEW_STALE`` with the fresh preview when anything changed). Each
text is audited on its own (``text.pause``, ``text.release``, with ``via``).

What a pause is (``storage.text_pause``): a property of the text, the row of
Documents (case, language) with every version. While it stands, no task of
the text that is in progress can be saved: annotation, translation review
and consolidation alike, also a task assigned, reopened or given a new round
later. The people keep the task in My tasks, marked "Paused by lead" with the
reason, and can read it. Submitted work and final results are untouched and
exported as before.

The pause from a problem report is a separate cause. Releasing a text ends
the lead pause only: a task a report still pauses stays paused until that
report is decided, and deciding a report never releases the lead pause. The
release preview names those tasks.

There is no Undo: "Release texts…" is the way back from a pause and "Pause
texts…" from a release, and neither changes any work.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import Connection, RowMapping

from ontotator.application.bulk_task_actions import BulkTaskActionService
from ontotator.application.people import person_refs
from ontotator.application.workflow_warnings import state_digest
from ontotator.auth.audit import Actor, record_audit
from ontotator.domain.errors import DomainError
from ontotator.domain.work_plans import RowKey
from ontotator.storage.database import Database
from ontotator.storage.text_pause import (
    TextPause,
    paused_texts,
    write_pause,
    write_release,
)

__all__ = ["SKIP_REASONS", "TextPauseAction", "TextPauseService"]

TextPauseAction = Literal["pause", "release"]

# Why a text is left as it is, with the words the dialog and the MCP tools show.
SKIP_REASONS: dict[str, str] = {
    "already_paused": "Already paused by a lead.",
    "not_paused": "Not paused by a lead.",
}


class TextPauseService:
    def __init__(self, db: Database, actor: Actor):
        self.db, self.actor = db, actor
        self._frame = BulkTaskActionService(db, actor)

    def run(
        self,
        key: str,
        rows: Sequence[RowKey],
        action: TextPauseAction,
        *,
        reason: str | None,
        preview: bool,
        preview_token: str | None,
        summary_only: bool = False,
    ) -> dict[str, Any]:
        """Preview, or apply all or nothing (``preview_token`` of the preview
        shown). Apply recomputes the preview under the exclusive project
        lock, which every save of a task takes shared: a save either commits
        before the pause or is refused by it."""
        reason = (reason or "").strip() or None
        if action == "pause" and reason is None and not preview:
            raise DomainError("PAUSE_REASON_REQUIRED")
        with self.db.transaction() as conn:
            project = self._frame._lock(conn, key, exclusive=not preview)
            pid = int(project["id"])
            plan = self._plan(
                conn, pid, rows, action, summary_only=preview and summary_only
            )
            if preview:
                return plan | {"applied": False}
            if preview_token != plan["preview_token"]:
                raise DomainError(
                    "PREVIEW_STALE", {"preview": plan | {"applied": False}}
                )
            now = datetime.now(UTC)
            for change in plan["changes"]:
                case_id, language = change["case_id"], change["language"]
                details: dict[str, Any] = {
                    "case_id": case_id,
                    "language": language,
                    "reason": reason,
                    "assignment_ids": [t["assignment_id"] for t in change["tasks"]],
                    "via": f"bulk_{action}_texts",
                }
                if action == "pause":
                    write_pause(
                        conn,
                        pid,
                        case_id,
                        language,
                        reason=reason or "",
                        actor_id=self.actor.user_id,
                        at=now,
                    )
                else:
                    write_release(conn, pid, case_id, language)
                    details["paused_reason"] = change["pause"]["reason"]
                    details["still_paused_assignment_ids"] = [
                        t["assignment_id"]
                        for t in change["tasks"]
                        if t["paused_by_report"]
                    ]
                record_audit(
                    conn,
                    self.actor,
                    f"text.{action}",
                    target_type="text",
                    target_id=f"{case_id} {language}",
                    project_id=pid,
                    details=details,
                    at=now,
                )
            return plan | {"applied": True}

    def _plan(
        self,
        conn: Connection,
        pid: int,
        rows: Sequence[RowKey],
        action: TextPauseAction,
        *,
        summary_only: bool,
    ) -> dict[str, Any]:
        """What ``action`` would do to ``rows`` now. Pure reads under the
        caller's lock; the number of queries does not grow with the texts."""
        found, assignments = self._frame._rows(conn, pid, rows, lock=False)
        paused = paused_texts(conn, pid, [(r.case_id, r.language) for r in found])
        changing: list[RowKey] = []
        skipped: list[tuple[RowKey, str]] = []
        for row in found:
            is_paused = (row.case_id, row.language) in paused
            if action == "pause" and is_paused:
                skipped.append((row, "already_paused"))
            elif action == "release" and not is_paused:
                skipped.append((row, "not_paused"))
            else:
                changing.append(row)
        wanted = set(changing)
        # The work in progress: what a pause stops and a release opens.
        tasks: dict[RowKey, list[RowMapping]] = {row: [] for row in changing}
        for item in assignments:
            row = RowKey(item["case_id"], item["language"])
            if row in wanted and item["status"] != "submitted":
                tasks[row].append(item)
        in_progress = [item for row in changing for item in tasks[row]]
        digest = state_digest(
            {
                "action": action,
                "rows": [[row.case_id, row.language] for row in found],
                "changes": [
                    [
                        row.case_id,
                        row.language,
                        _stamp(paused.get((row.case_id, row.language))),
                    ]
                    for row in changing
                ],
                "tasks": [
                    [int(item["id"]), item["status"], bool(item["held"])]
                    for item in in_progress
                ],
                "skipped": [[r.case_id, r.language, why] for r, why in skipped],
            }
        )
        result: dict[str, Any] = {
            "action": action,
            "texts": len(found),
            "change_count": len(changing),
            "skipped_count": len(skipped),
            "task_count": len(in_progress),
            # Release: tasks a problem report still pauses afterwards.
            "still_paused_count": (
                sum(1 for item in in_progress if item["held"])
                if action == "release"
                else 0
            ),
            "changes": [],
            "skipped": [],
            "preview_token": f"sha256:{digest}",
        }
        if summary_only:
            return result
        people = person_refs(
            conn,
            {
                *(int(item["user_id"]) for item in in_progress),
                *(
                    pause.paused_by
                    for pause in paused.values()
                    if pause.paused_by is not None
                ),
            },
            viewer_id=self.actor.user_id or 0,
            viewer_is_lead=True,
        )

        def pause_view(row: RowKey) -> dict[str, Any] | None:
            pause = paused.get((row.case_id, row.language))
            if pause is None:
                return None
            return {
                "reason": pause.reason,
                "paused_by": (
                    people[pause.paused_by].model_dump()
                    if pause.paused_by is not None
                    else None
                ),
                "paused_at": pause.paused_at,
            }

        result["changes"] = [
            {
                "case_id": row.case_id,
                "language": row.language,
                # Release: the pause that ends; pause: null.
                "pause": pause_view(row),
                "tasks": [
                    {
                        "assignment_id": int(item["id"]),
                        "document_id": item["document_id"],
                        "version": int(item["version"]),
                        "task": item["task"],
                        "status": item["status"],
                        "person": people[int(item["user_id"])].model_dump(),
                        "paused_by_report": bool(item["held"]),
                    }
                    for item in tasks[row]
                ],
            }
            for row in changing
        ]
        result["skipped"] = [
            {
                "case_id": row.case_id,
                "language": row.language,
                "reason": why,
                "message": SKIP_REASONS[why],
                "pause": pause_view(row),
            }
            for row, why in skipped
        ]
        return result


def _stamp(pause: TextPause | None) -> str | None:
    return None if pause is None else pause.paused_at.isoformat()
