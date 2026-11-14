"""Bulk lead actions on the tasks of many texts (issue 336, step 1).

The shared frame of "bulk action with preview" on Documents: a preview lists
what the action changes, what it leaves as it is and why, and a
``preview_token``; applying sends that token and changes every listed task or
none (``PREVIEW_STALE`` with the fresh preview when anything changed, as
``accept-agreeing`` does). Each changed task is audited as the single action
on it (``assignment.reopen``, ``assignment.revoke``) with ``via`` naming the
bulk action, so every text gets its own entries and its History and My tasks
read them as usual.

Step 1 has two actions:

- ``reopen``: the submitted tasks of the selected texts go back to their
  people, with a reason. Texts with a final result are skipped (change the
  final first).
- ``withdraw``: the open tasks of the selected texts are withdrawn (revoked;
  drafts stay). Started tasks only on request; ``over_limit_only`` keeps
  the first "annotators per text" annotations of each version and withdraws
  the open ones above the limit (issue 339 b).

Apply returns an ``undo`` token: while the changed texts stay exactly as the
action left them (assignments, drafts, rounds, final results), Undo restores
the earlier state (``undo``).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, cast

from sqlalchemy import (
    Connection,
    RowMapping,
    and_,
    func,
    or_,
    select,
    tuple_,
    update,
)

from ontotator.application.people import person_refs
from ontotator.application.workflow_warnings import state_digest
from ontotator.assignments.service import AssignmentService
from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.policy import Action, Task
from ontotator.authz.project_authority import require_project_management
from ontotator.domain.errors import DomainError
from ontotator.domain.work_plans import RowKey
from ontotator.projects.assignments import revoke_assignments
from ontotator.storage.database import Database
from ontotator.storage.final_tables import FinalSelectionRow
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.repository import _lock_id
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    DraftRow,
    ProjectRow,
)
from ontotator.storage.workflow_tables import WorkRoundStateRow

BulkAction = Literal["reopen", "withdraw"]
TASKS: tuple[Task, ...] = ("annotate", "translation_review", "review")
_OPEN = ("open", "in_progress", "reopened")

# Why a task stays as it is, with the words the dialog and the MCP tools show.
KEEP_REASONS: dict[str, str] = {
    # Reopen
    "not_submitted": "Not submitted yet.",
    "lead_correction": "A lead correction made a newer version; it is not reopened.",
    "discarded": "The version was discarded.",
    "lead_correction_open": "A lead correction of this version is open.",
    "person_unavailable": "The person is no longer an active member with this role.",
    # Withdraw
    "submitted": "Already submitted; submitted work stays.",
    "started": "Work has started; tick “Also withdraw started tasks” to include it.",
    "paused": "Paused by a problem report; decide the report first.",
    "within_limit": "Within the limit of annotators per text.",
    "lead_correction_task": "A lead correction; remove it in the text card.",
}
# Why a whole text is skipped.
SKIP_REASONS: dict[str, str] = {
    "final_chosen": "Final result chosen: use Change final… first.",
}


@dataclass(frozen=True)
class Options:
    action: BulkAction
    tasks: tuple[Task, ...] = ("annotate",)
    reason: str | None = None
    include_started: bool = False
    over_limit_only: bool = False

    def digest_view(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "tasks": sorted(self.tasks),
            "include_started": self.include_started,
            "over_limit_only": self.over_limit_only,
        }


def _rank(row: RowMapping) -> tuple[int, int]:
    """Which annotations of a version stay within the limit: submitted work
    first, then started work, then the oldest assignment."""
    order = {"submitted": 0, "reopened": 1, "in_progress": 1, "open": 2}
    return (order.get(str(row["status"]), 3), int(row["id"]))


class BulkTaskActionService:
    def __init__(self, db: Database, actor: Actor):
        self.db, self.actor = db, actor

    # --- shared frame ------------------------------------------------------ #

    def _lock(self, conn: Connection, key: str, *, exclusive: bool) -> RowMapping:
        """The project, locked like every assignment change; leads only. A
        preview takes the project lock shared and locks no rows."""
        if exclusive:
            return AssignmentService._prepare(conn, self.actor, key)
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", key)))
        )
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("project", key)))
        )
        project = (
            conn.execute(select(ProjectRow).where(ProjectRow.project_key == key))
            .mappings()
            .one_or_none()
        )
        if project is None:
            raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")
        require_project_management(
            conn, self.actor, key, project["id"], Action.MANAGE_ASSIGNMENTS
        )
        return project

    @staticmethod
    def _rows(
        conn: Connection, pid: int, rows: Sequence[RowKey], *, lock: bool
    ) -> tuple[list[RowKey], list[RowMapping]]:
        """The selected texts that exist, in selection order, and their
        unrevoked assignments (locked), by id."""
        wanted = list(dict.fromkeys(rows))
        if not wanted:
            return [], []
        pairs = [(row.case_id, row.language) for row in wanted]
        known = {
            (case_id, language)
            for case_id, language in conn.execute(
                select(DocumentRow.case_id, DocumentRow.language)
                .where(
                    DocumentRow.project_id == pid,
                    tuple_(DocumentRow.case_id, DocumentRow.language).in_(pairs),
                )
                .distinct()
            ).tuples()
        }
        found = [row for row in wanted if (row.case_id, row.language) in known]
        query = (
            select(
                AssignmentRow,
                DocumentRow.case_id,
                DocumentRow.language,
                DocumentRow.version,
            )
            .join(
                DocumentRow,
                and_(
                    DocumentRow.project_id == AssignmentRow.project_id,
                    DocumentRow.document_id == AssignmentRow.document_id,
                ),
            )
            .where(
                AssignmentRow.project_id == pid,
                AssignmentRow.revoked_at.is_(None),
                tuple_(DocumentRow.case_id, DocumentRow.language).in_(pairs),
            )
            .order_by(AssignmentRow.id)
        )
        if lock:
            query = query.with_for_update(key_share=True, of=AssignmentRow)
        return found, list(conn.execute(query).mappings())

    @staticmethod
    def _finals(conn: Connection, pid: int, rows: Sequence[RowKey]) -> set[RowKey]:
        if not rows:
            return set()
        return {
            RowKey(case_id, language)
            for case_id, language in conn.execute(
                select(FinalSelectionRow.case_id, FinalSelectionRow.language).where(
                    FinalSelectionRow.project_id == pid,
                    tuple_(FinalSelectionRow.case_id, FinalSelectionRow.language).in_(
                        [(row.case_id, row.language) for row in rows]
                    ),
                )
            ).tuples()
        }

    def _plan(
        self,
        conn: Connection,
        project: RowMapping,
        rows: Sequence[RowKey],
        o: Options,
        *,
        lock: bool,
    ) -> dict[str, Any]:
        """What ``o`` would do to ``rows`` now: changed tasks, kept tasks with
        a reason, skipped texts. Pure reads under the caller's locks."""
        pid = int(project["id"])
        found, assignments = self._rows(conn, pid, rows, lock=lock)
        wanted = set(o.tasks)
        changes: list[RowMapping] = []
        kept: list[tuple[RowMapping, str]] = []
        skipped: list[tuple[RowKey, str]] = []
        if o.action == "reopen":
            finals = self._finals(conn, pid, found)
            skipped = [(row, "final_chosen") for row in found if row in finals]
            for item in assignments:
                if item["task"] not in wanted:
                    continue
                if RowKey(item["case_id"], item["language"]) in finals:
                    continue
                refusal = AssignmentService.reopen_refusal(conn, project, item)
                if refusal is None:
                    changes.append(item)
                    continue
                kept.append((item, _reopen_keep(refusal)))
        else:
            keep_ids = (
                self._within_limit(project, assignments) if o.over_limit_only else set()
            )
            for item in assignments:
                # Above the limit: annotations only.
                if item["task"] not in wanted or (
                    o.over_limit_only and item["task"] != "annotate"
                ):
                    continue
                if item["status"] == "submitted":
                    reason = "submitted"
                elif item["lead_correction"]:
                    reason = "lead_correction_task"
                elif item["held"]:
                    reason = "paused"
                elif o.over_limit_only and item["id"] in keep_ids:
                    reason = "within_limit"
                elif item["status"] != "open" and not o.include_started:
                    reason = "started"
                else:
                    changes.append(item)
                    continue
                kept.append((item, reason))
        people = person_refs(
            conn,
            {int(item["user_id"]) for item in [*changes, *(k for k, _ in kept)]},
            viewer_id=self.actor.user_id or 0,
            viewer_is_lead=True,
        )

        def task(item: RowMapping) -> dict[str, Any]:
            return {
                "case_id": item["case_id"],
                "language": item["language"],
                "assignment_id": int(item["id"]),
                "document_id": item["document_id"],
                "version": int(item["version"]),
                "task": item["task"],
                "status": item["status"],
                "person": people[int(item["user_id"])].model_dump(),
            }

        kept_view = [
            task(item) | {"reason": reason, "message": KEEP_REASONS[reason]}
            for item, reason in kept
        ]
        skipped_view = [
            {
                "case_id": row.case_id,
                "language": row.language,
                "reason": reason,
                "message": SKIP_REASONS[reason],
            }
            for row, reason in skipped
        ]
        digest = state_digest(
            {
                "options": o.digest_view(),
                "rows": [[row.case_id, row.language] for row in found],
                "changes": [
                    [item["id"], item["status"], item["updated_at"].isoformat()]
                    for item in changes
                ],
                "kept": [[item["id"], reason] for item, reason in kept],
                "skipped": [[r.case_id, r.language, why] for r, why in skipped],
            }
        )
        return {
            "action": o.action,
            "texts": len(found),
            "changes": [task(item) for item in changes],
            "kept": kept_view,
            "skipped": skipped_view,
            "preview_token": f"sha256:{digest}",
        }

    @staticmethod
    def _within_limit(
        project: RowMapping, assignments: Iterable[RowMapping]
    ) -> set[int]:
        """Annotate assignments within "annotators per text" of their version."""
        limit = int(project["annotations_per_text"])
        by_document: dict[str, list[RowMapping]] = {}
        for item in assignments:
            if item["task"] == "annotate":
                by_document.setdefault(item["document_id"], []).append(item)
        return {
            int(item["id"])
            for items in by_document.values()
            for item in sorted(items, key=_rank)[:limit]
        }

    def run(
        self,
        key: str,
        rows: Sequence[RowKey],
        options: Options,
        *,
        preview: bool,
        preview_token: str | None,
    ) -> dict[str, Any]:
        """Preview, or apply all or nothing (``preview_token`` of the preview
        shown). Apply recomputes the preview under the project lock; a token
        that no longer matches is refused with ``PREVIEW_STALE`` and the
        fresh preview."""
        reason = (options.reason or "").strip() or None
        if options.action == "reopen" and reason is None and not preview:
            raise DomainError("BULK_REASON_REQUIRED")
        with self.db.transaction() as conn:
            project = self._lock(conn, key, exclusive=not preview)
            plan = self._plan(conn, project, rows, options, lock=not preview)
            if preview:
                return plan | {"applied": False, "undo": None}
            if preview_token != plan["preview_token"]:
                raise DomainError(
                    "PREVIEW_STALE",
                    {"preview": plan | {"applied": False, "undo": None}},
                )
            now = datetime.now(UTC)
            ids = [item["assignment_id"] for item in plan["changes"]]
            locked = {
                int(row["id"]): row
                for row in conn.execute(
                    select(AssignmentRow).where(AssignmentRow.id.in_(ids))
                ).mappings()
            }
            via = f"bulk_{options.action}"
            if options.action == "reopen":
                for assignment_id in ids:
                    AssignmentService.reopen_locked(
                        conn,
                        self.actor,
                        project,
                        locked[assignment_id],
                        reason,
                        now,
                        via=via,
                    )
            else:
                revoke_assignments(
                    conn,
                    self.actor,
                    int(project["id"]),
                    [dict(locked[assignment_id]) for assignment_id in ids],
                    now,
                    reason=reason,
                    via=via,
                )
            undo = (
                {
                    "action": options.action,
                    "assignment_ids": ids,
                    "token": f"sha256:{_after_state(conn, int(project['id']), ids)}",
                }
                if ids
                else None
            )
            return plan | {"applied": True, "undo": undo}

    def undo(
        self, key: str, action: BulkAction, assignment_ids: Sequence[int], token: str
    ) -> dict[str, Any]:
        """Undo an applied bulk action while its texts are unchanged since.

        ``token`` is the apply's ``undo.token``: the state of every assignment,
        draft, round and final result of the changed texts right after the
        action. Any change since (a save, a new task, a final result) refuses
        the Undo with ``BULK_UNDO_STALE``; then nothing is undone. Reopened
        tasks are submitted again; withdrawn tasks come back with their
        drafts. Each is audited (``assignment.reopen_undone``,
        ``assignment.restore``).
        """
        ids = sorted(set(assignment_ids))
        if not ids:
            return {"undone": 0}
        with self.db.transaction() as conn:
            project = self._lock(conn, key, exclusive=True)
            pid = int(project["id"])
            rows = list(
                conn.execute(
                    select(AssignmentRow)
                    .where(AssignmentRow.project_id == pid, AssignmentRow.id.in_(ids))
                    .order_by(AssignmentRow.id)
                    .with_for_update(key_share=True)
                ).mappings()
            )
            if (
                len(rows) != len(ids)
                or token != f"sha256:{_after_state(conn, pid, ids)}"
            ):
                raise DomainError("BULK_UNDO_STALE")
            now = datetime.now(UTC)
            for row in rows:
                if action == "reopen":
                    if row["revoked_at"] is not None or row["status"] != "reopened":
                        raise DomainError("BULK_UNDO_STALE")
                    conn.execute(
                        update(AssignmentRow)
                        .where(AssignmentRow.id == row["id"])
                        .values(status="submitted", updated_at=now)
                    )
                    if row["active_round_id"] is not None:
                        conn.execute(
                            update(WorkRoundStateRow)
                            .where(WorkRoundStateRow.round_id == row["active_round_id"])
                            .values(
                                state="submitted",
                                revision=WorkRoundStateRow.revision + 1,
                            )
                        )
                        conn.execute(
                            update(AssignmentRow)
                            .where(AssignmentRow.id == row["id"])
                            .values(
                                workflow_revision=AssignmentRow.workflow_revision + 1
                            )
                        )
                    event = "assignment.reopen_undone"
                else:
                    if row["revoked_at"] is None:
                        raise DomainError("BULK_UNDO_STALE")
                    # The person must still be able to take the task.
                    AssignmentService._require_target(
                        conn, project, int(row["user_id"]), cast(Task, row["task"])
                    )
                    conn.execute(
                        update(AssignmentRow)
                        .where(AssignmentRow.id == row["id"])
                        .values(revoked_at=None, revoked_by=None, updated_at=now)
                    )
                    event = "assignment.restore"
                record_audit(
                    conn,
                    self.actor,
                    event,
                    target_type="assignment",
                    target_id=int(row["id"]),
                    project_id=pid,
                    details={
                        "via": f"bulk_{action}_undo",
                        "document_id": row["document_id"],
                        "task": row["task"],
                    },
                    at=now,
                )
            return {"undone": len(rows)}


def _reopen_keep(refusal: DomainError) -> str:
    details = refusal.details if isinstance(refusal.details, dict) else {}
    if refusal.code == "ASSIGNMENT_NOT_SUBMITTED":
        return "not_submitted"
    if refusal.code == "NOT_IN_WORK_PLAN":
        return "discarded"
    if refusal.code == "LEAD_CORRECTION_NOT_AVAILABLE":
        return "lead_correction"
    if refusal.code == "ASSIGNMENT_EXISTS" and details.get("reason") == (
        "lead_correction_open"
    ):
        return "lead_correction_open"
    return "person_unavailable"


def _after_state(conn: Connection, pid: int, assignment_ids: Sequence[int]) -> str:
    """Digest of everything an Undo would restore over: every assignment and
    draft of the versions the action touched, their rounds, and the final
    results of their texts."""
    documents = sorted(
        set(
            conn.execute(
                select(AssignmentRow.document_id).where(
                    AssignmentRow.project_id == pid,
                    AssignmentRow.id.in_(list(assignment_ids)),
                )
            ).scalars()
        )
    )
    texts = sorted(
        set(
            conn.execute(
                select(DocumentRow.case_id, DocumentRow.language).where(
                    DocumentRow.project_id == pid,
                    DocumentRow.document_id.in_(documents),
                )
            ).tuples()
        )
    )
    assignments = [
        [
            row.id,
            row.document_id,
            row.user_id,
            row.task,
            row.status,
            None if row.revoked_at is None else row.revoked_at.isoformat(),
            row.held,
            row.workflow_revision,
            row.active_round_id,
            row.last_submission_id,
        ]
        for row in conn.execute(
            select(AssignmentRow)
            .where(
                AssignmentRow.project_id == pid,
                AssignmentRow.document_id.in_(documents),
            )
            .order_by(AssignmentRow.id)
        )
    ]
    rounds = sorted({str(item[8]) for item in assignments if item[8] is not None})
    return state_digest(
        {
            "assignments": assignments,
            "drafts": [
                list(row)
                for row in conn.execute(
                    select(
                        DraftRow.document_id,
                        DraftRow.annotator_id,
                        DraftRow.mode,
                        DraftRow.revision,
                    )
                    .where(
                        DraftRow.project_id == pid, DraftRow.document_id.in_(documents)
                    )
                    .order_by(DraftRow.id)
                ).tuples()
            ],
            "rounds": [
                list(row)
                for row in conn.execute(
                    select(
                        WorkRoundStateRow.round_id,
                        WorkRoundStateRow.state,
                        WorkRoundStateRow.revision,
                    )
                    .where(WorkRoundStateRow.round_id.in_(rounds))
                    .order_by(WorkRoundStateRow.round_id)
                ).tuples()
            ],
            "finals": [
                list(row)
                for row in conn.execute(
                    select(
                        FinalSelectionRow.case_id,
                        FinalSelectionRow.language,
                        FinalSelectionRow.revision,
                    )
                    .where(
                        FinalSelectionRow.project_id == pid,
                        or_(
                            *[
                                and_(
                                    FinalSelectionRow.case_id == case_id,
                                    FinalSelectionRow.language == language,
                                )
                                for case_id, language in texts
                            ]
                        )
                        if texts
                        else FinalSelectionRow.id.is_(None),
                    )
                    .order_by(FinalSelectionRow.case_id, FinalSelectionRow.language)
                ).tuples()
            ],
            "discarded": sorted(
                conn.execute(
                    select(DiscardedVariantRow.document_id).where(
                        DiscardedVariantRow.project_id == pid,
                        DiscardedVariantRow.document_id.in_(documents),
                    )
                ).scalars()
            ),
        }
    )
