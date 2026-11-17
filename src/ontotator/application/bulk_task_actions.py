"""Bulk lead actions on the tasks of many texts (issue 336, steps 1 and 3).

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

Step 3 adds ``start_round``: the submitted annotations of the selected texts
get a new work round, as ``POST /assignments/{id}/rounds`` gives one task.
``carry_forward`` continues from the task's submission, ``clean_restart``
starts without the earlier findings (a task from tool proposals on the newest
proposal set) and needs a reason. Only submitted tasks on the text's current
version take a round here; texts with a final result or an open consolidation
are skipped. Each round is audited as ``round.create`` with ``via``. A new
round has no Undo: its draft and inputs are new rows, and the earlier round
is closed.

Undo (reopen and withdraw) is kept on the server: apply records one ``project.bulk_task_action``
audit event with the action, the exact tasks it changed and a digest of the
state it left, and returns only that event's id. The client cannot choose
the action or the tasks of an Undo. ``undo`` works for the lead who applied
the action, in that project, once, within ``UNDO_MINUTES``, and only while
the texts are exactly as the action left them. A reopened translation review
restarts its draft from the current text, which cannot be brought back: an
action that reopened one has no Undo.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast

from sqlalchemy import (
    Connection,
    RowMapping,
    and_,
    func,
    select,
    tuple_,
    update,
)

from ontotator.application.people import person_refs
from ontotator.application.work_plans import _chains, _live, _target
from ontotator.application.workflow_warnings import state_digest
from ontotator.assignments.eligibility import plan_for
from ontotator.assignments.service import AssignmentService
from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.policy import Action, Task
from ontotator.authz.project_authority import require_project_management
from ontotator.domain.annotation_limits import effective_annotation_limit
from ontotator.domain.errors import DomainError
from ontotator.domain.work_plans import RowKey
from ontotator.projects.assignments import revoke_assignments
from ontotator.storage.database import Database
from ontotator.storage.final_tables import FinalSelectionRow
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.repository import _lock_id
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    DraftRow,
    ProjectRow,
    TranslationReviewDraftRow,
    UserRow,
)
from ontotator.storage.text_settings import per_text_overrides
from ontotator.storage.workflow_tables import WorkRoundStateRow

BulkAction = Literal["reopen", "withdraw", "start_round"]
# The rounds a lead starts for a submitted annotation (``WorkRoundService``).
BulkRoundKind = Literal["carry_forward", "clean_restart"]
TASKS: tuple[Task, ...] = ("annotate", "translation_review", "review")
# How long an applied action can be undone.
UNDO_MINUTES = 60
APPLIED = "project.bulk_task_action"
UNDONE = "project.bulk_task_action_undone"

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
    # Start a round
    "not_current_version": "Not on the current version of the text; use the text card.",
    "translation_not_accepted": "The translation is not accepted yet.",
    "no_round": "No work round to restart (older or imported work); use Reopen….",
}
# Why a whole text is skipped.
SKIP_REASONS: dict[str, str] = {
    "final_chosen": "Final result chosen: use Change final… first.",
    # Start a round
    "final_result": "Final result chosen: use Withdraw final… first.",
    "consolidation_open": "A consolidation is open: finish or withdraw it first.",
}


@dataclass(frozen=True)
class Options:
    action: BulkAction
    tasks: tuple[Task, ...] = ("annotate",)
    reason: str | None = None
    include_started: bool = False
    over_limit_only: bool = False
    kind: BulkRoundKind | None = None

    def digest_view(self) -> dict[str, Any]:
        if self.action == "start_round":
            return {"action": self.action, "kind": self.kind}
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


def _availability(conn: Connection, project: RowMapping) -> Any:
    """Whether a task's person can still take it: one membership check per
    person and task kind, however many tasks."""
    may_take: dict[tuple[int, str], bool] = {}

    def available(item: RowMapping) -> bool:
        who = (int(item["user_id"]), str(item["task"]))
        if who not in may_take:
            try:
                AssignmentService._require_target(
                    conn, project, who[0], cast(Task, who[1])
                )
                may_take[who] = True
            except DomainError:
                may_take[who] = False
        return may_take[who]

    return available


def _stale(reason: str) -> DomainError:
    return DomainError("BULK_UNDO_STALE", {"reason": reason})


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
        unrevoked assignments (locked to apply), by id."""
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

    @staticmethod
    def _reopen_keeps(
        conn: Connection, project: RowMapping, items: Sequence[RowMapping]
    ) -> dict[int, str]:
        """Why each of ``items`` cannot be reopened (absent: it can).

        The rules and their order are ``AssignmentService.reopen_refusal``'s,
        asked for all tasks at once: two queries for the versions and one
        membership check per person and task kind, however many tasks.
        """
        pid = int(project["id"])
        submitted = [item for item in items if item["status"] == "submitted"]
        documents = sorted({str(item["document_id"]) for item in submitted})
        discarded: set[str] = set()
        correction_open: set[str] = set()
        if documents:
            discarded = set(
                conn.execute(
                    select(DiscardedVariantRow.document_id).where(
                        DiscardedVariantRow.project_id == pid,
                        DiscardedVariantRow.document_id.in_(documents),
                    )
                ).scalars()
            )
            correction_open = set(
                conn.execute(
                    select(AssignmentRow.document_id).where(
                        AssignmentRow.project_id == pid,
                        AssignmentRow.document_id.in_(documents),
                        AssignmentRow.task == "translation_review",
                        AssignmentRow.lead_correction.is_(True),
                        AssignmentRow.status != "submitted",
                        AssignmentRow.revoked_at.is_(None),
                    )
                ).scalars()
            )
        available = _availability(conn, project)
        keeps: dict[int, str] = {}
        for item in items:
            if item["status"] != "submitted":
                reason = "not_submitted"
            elif item["document_id"] in discarded:
                reason = "discarded"
            elif item["lead_correction"]:
                reason = "lead_correction"
            elif not available(item):
                reason = "person_unavailable"
            elif (
                item["task"] == "translation_review"
                and item["document_id"] in correction_open
            ):
                reason = "lead_correction_open"
            else:
                continue
            keeps[int(item["id"])] = reason
        return keeps

    def _plan(
        self,
        conn: Connection,
        project: RowMapping,
        rows: Sequence[RowKey],
        o: Options,
        *,
        lock: bool,
        summary_only: bool = False,
    ) -> dict[str, Any]:
        """What ``o`` would do to ``rows`` now: changed tasks, kept tasks with
        a reason, skipped texts. Pure reads under the caller's locks; the
        number of queries does not grow with the number of tasks.
        ``summary_only``: counts and the token, no lists."""
        pid = int(project["id"])
        found, assignments = self._rows(conn, pid, rows, lock=lock)
        wanted = set(o.tasks)
        changes: list[RowMapping] = []
        kept: list[tuple[RowMapping, str]] = []
        skipped: list[tuple[RowKey, str]] = []
        if o.action == "reopen":
            finals = self._finals(conn, pid, found)
            skipped = [(row, "final_chosen") for row in found if row in finals]
            candidates = [
                item
                for item in assignments
                if item["task"] in wanted
                and RowKey(item["case_id"], item["language"]) not in finals
            ]
            keeps = self._reopen_keeps(conn, project, candidates)
            for item in candidates:
                why = keeps.get(int(item["id"]))
                if why is None:
                    changes.append(item)
                else:
                    kept.append((item, why))
        elif o.action == "start_round":
            changes, kept, skipped = self._round_plan(
                conn, project, found, assignments, o
            )
        else:
            keep_ids = (
                self._within_limit(conn, project, assignments)
                if o.over_limit_only
                else set()
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
        digest = state_digest(
            {
                "options": o.digest_view(),
                "rows": [[row.case_id, row.language] for row in found],
                "changes": [
                    [
                        item["id"],
                        item["status"],
                        item["updated_at"].isoformat(),
                        *(
                            [item["workflow_revision"], item["last_submission_id"]]
                            if o.action == "start_round"
                            else []
                        ),
                    ]
                    for item in changes
                ],
                "kept": [[item["id"], reason] for item, reason in kept],
                "skipped": [[r.case_id, r.language, why] for r, why in skipped],
            }
        )
        result: dict[str, Any] = {
            "action": o.action,
            "kind": o.kind,
            "texts": len(found),
            "change_count": len(changes),
            "kept_count": len(kept),
            "skipped_count": len(skipped),
            "changes": [],
            "kept": [],
            "skipped": [],
            "preview_token": f"sha256:{digest}",
        }
        if summary_only:
            return result
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

        result["changes"] = [task(item) for item in changes]
        result["kept"] = [
            task(item) | {"reason": reason, "message": KEEP_REASONS[reason]}
            for item, reason in kept
        ]
        result["skipped"] = [
            {
                "case_id": row.case_id,
                "language": row.language,
                "reason": reason,
                "message": SKIP_REASONS[reason],
            }
            for row, reason in skipped
        ]
        return result

    def _round_plan(
        self,
        conn: Connection,
        project: RowMapping,
        found: Sequence[RowKey],
        assignments: Sequence[RowMapping],
        o: Options,
    ) -> tuple[
        list[RowMapping], list[tuple[RowMapping, str]], list[tuple[RowKey, str]]
    ]:
        """Which annotations of ``found`` get a new round (``o.kind``).

        Only a submitted annotation on the text's current version, whose
        person can still take it. The rules a single round has
        (``WorkRoundService.create_in``) hold as well: a paused task takes no
        round, and a restart needs a round to restart. A text with a final
        result or an open consolidation is skipped: the round would take the
        submission away the result or the consolidation rests on.
        """
        pid = int(project["id"])
        finals = self._finals(conn, pid, found)
        # The rule of ``work_rounds.consolidation_open`` (the single round).
        consolidating = {
            RowKey(item["case_id"], item["language"])
            for item in assignments
            if item["task"] == "review" and item["status"] != "submitted"
        }
        skipped = [
            (row, "final_result" if row in finals else "consolidation_open")
            for row in found
            if row in finals or row in consolidating
        ]
        left_out = {row for row, _ in skipped}
        current = _current_versions(conn, pid, found)
        gate = bool(project["annotate_accepted_translations_only"])
        available = _availability(conn, project)
        changes: list[RowMapping] = []
        kept: list[tuple[RowMapping, str]] = []
        for item in assignments:
            row = RowKey(item["case_id"], item["language"])
            if item["task"] != "annotate" or row in left_out:
                continue
            if item["status"] != "submitted" or item["last_submission_id"] is None:
                reason = "not_submitted"
            elif item["held"]:
                reason = "paused"
            elif item["document_id"] not in current:
                reason = "not_current_version"
            elif gate and current[item["document_id"]] not in (None, "accepted"):
                # ``require_annotation_gate``: the task waits for the review.
                reason = "translation_not_accepted"
            elif not available(item):
                reason = "person_unavailable"
            elif o.kind == "clean_restart" and item["active_round_id"] is None:
                reason = "no_round"
            else:
                changes.append(item)
                continue
            kept.append((item, reason))
        return changes, kept, skipped

    def _start_rounds(
        self,
        conn: Connection,
        key: str,
        pid: int,
        o: Options,
        ids: Sequence[int],
        locked: dict[int, RowMapping],
        reason: str | None,
        now: datetime,
    ) -> None:
        """One new round per task, created and audited like a single round
        (``WorkRoundService.create``) with ``via``. A refusal the preview did
        not foresee ends the whole action: nothing is changed."""
        from ontotator.application.work_rounds import WorkRoundService

        rounds = WorkRoundService(self.db)
        owners = dict(
            conn.execute(
                select(UserRow.id, UserRow.pseudonym).where(
                    UserRow.id.in_({int(locked[i]["user_id"]) for i in ids})
                )
            )
            .tuples()
            .all()
        )
        kind = cast(BulkRoundKind, o.kind)
        for assignment_id in ids:
            row = locked[assignment_id]
            sources = (
                [str(row["last_submission_id"])] if kind == "carry_forward" else []
            )
            created = rounds.create_in(
                conn,
                project=key,
                pid=pid,
                actor=self.actor,
                assignment=row,
                kind=kind,
                sources=sources,
                draft_sources=[],
                reason=reason,
                expected_workflow_revision=int(row["workflow_revision"]),
                lead=True,
                owner=owners[int(row["user_id"])],
            )
            record_audit(
                conn,
                self.actor,
                "round.create",
                target_type="work_round",
                target_id=created.round_id,
                project_id=pid,
                details={
                    "kind": kind,
                    "assignment_id": assignment_id,
                    "sources": sources,
                    "reason": reason,
                    "via": "bulk_start_round",
                },
                at=now,
            )

    @staticmethod
    def _within_limit(
        conn: Connection, project: RowMapping, assignments: Iterable[RowMapping]
    ) -> set[int]:
        """Annotate assignments within "annotators per text" of their version
        (the limit of each text from ``effective_annotation_limit``: its own
        value where it has one, else the project's)."""
        overrides = per_text_overrides(conn, int(project["id"]))
        by_document: dict[str, list[RowMapping]] = {}
        for item in assignments:
            if item["task"] == "annotate":
                by_document.setdefault(item["document_id"], []).append(item)
        return {
            int(item["id"])
            for items in by_document.values()
            for item in sorted(items, key=_rank)[
                : effective_annotation_limit(
                    int(project["annotations_per_text"]),
                    overrides,
                    items[0]["case_id"],
                    items[0]["language"],
                )
            ]
        }

    def run(
        self,
        key: str,
        rows: Sequence[RowKey],
        options: Options,
        *,
        preview: bool,
        preview_token: str | None,
        summary_only: bool = False,
    ) -> dict[str, Any]:
        """Preview, or apply all or nothing (``preview_token`` of the preview
        shown). Apply recomputes the preview under the project lock; a token
        that no longer matches is refused with ``PREVIEW_STALE`` and the
        fresh preview."""
        reason = (options.reason or "").strip() or None
        needs_reason = options.action == "reopen" or options.kind == "clean_restart"
        if needs_reason and reason is None and not preview:
            raise DomainError("BULK_REASON_REQUIRED")
        with self.db.transaction() as conn:
            project = self._lock(conn, key, exclusive=not preview)
            plan = self._plan(
                conn,
                project,
                rows,
                options,
                lock=not preview,
                summary_only=preview and summary_only,
            )
            if preview:
                return plan | {"applied": False, "undo": None}
            if preview_token != plan["preview_token"]:
                raise DomainError(
                    "PREVIEW_STALE",
                    {"preview": plan | {"applied": False, "undo": None}},
                )
            pid = int(project["id"])
            now = datetime.now(UTC)
            ids = [item["assignment_id"] for item in plan["changes"]]
            locked = {
                int(row["id"]): row
                for row in conn.execute(
                    select(AssignmentRow).where(AssignmentRow.id.in_(ids))
                ).mappings()
            }
            via = f"bulk_{options.action}"
            if options.action == "start_round":
                self._start_rounds(conn, key, pid, options, ids, locked, reason, now)
                # A new round has no Undo (module docstring).
                return plan | {"applied": True, "undo": None}
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
                    pid,
                    [dict(locked[assignment_id]) for assignment_id in ids],
                    now,
                    reason=reason,
                    via=via,
                )
            undo = self._record(conn, key, pid, options.action, ids, locked, now)
            return plan | {"applied": True, "undo": undo}

    def _record(
        self,
        conn: Connection,
        key: str,
        pid: int,
        action: BulkAction,
        ids: Sequence[int],
        changed: dict[int, RowMapping],
        now: datetime,
    ) -> dict[str, Any] | None:
        """Record the applied action (one audit event) and what its Undo
        needs; returns the Undo's handle, or None when it has none: nothing
        changed, or a translation review was reopened (its draft restarted
        from the current text and the earlier draft is gone)."""
        if not ids:
            return None
        undoable = not (
            action == "reopen"
            and any(changed[i]["task"] == "translation_review" for i in ids)
        )
        expires = now + timedelta(minutes=UNDO_MINUTES)
        details: dict[str, Any] = {
            "action": action,
            "assignment_ids": sorted(ids),
            "undoable": undoable,
        }
        if undoable:
            details |= {
                "state": _after_state(conn, pid, ids),
                "expires_at": expires.isoformat(),
            }
        record_audit(
            conn,
            self.actor,
            APPLIED,
            target_type="project",
            target_id=key,
            project_id=pid,
            details=details,
            at=now,
        )
        if not undoable:
            return None
        # Under the exclusive project lock: the newest such event is this one.
        event_id = conn.execute(
            select(func.max(AuditEventRow.id)).where(
                AuditEventRow.project_id == pid, AuditEventRow.action == APPLIED
            )
        ).scalar_one()
        return {"id": int(event_id), "expires_at": expires}

    def undo(self, key: str, undo_id: int) -> dict[str, Any]:
        """Undo an applied bulk action while its texts are unchanged since.

        ``undo_id`` names the server's record of the action (``_record``):
        the action and the tasks come from there, never from the request. It
        works for the lead who applied it, in this project, once, before it
        expires, and only while every assignment, draft, review draft, round,
        final result, plan row and version of the changed texts is as the
        action left it; otherwise ``BULK_UNDO_STALE`` and nothing is undone.
        Reopened tasks are submitted again; withdrawn tasks come back with
        their drafts, if their text still takes the task. Each is audited
        (``assignment.reopen_undone``, ``assignment.restore``).

        The Undo is a change of its own: ``updated_at`` moves on, and the
        round and workflow revisions of a reopened task are two higher than
        before the action, so a client holding older revisions reloads.
        """
        with self.db.transaction() as conn:
            project = self._lock(conn, key, exclusive=True)
            pid = int(project["id"])
            event = conn.execute(
                select(AuditEventRow).where(
                    AuditEventRow.id == undo_id,
                    AuditEventRow.project_id == pid,
                    AuditEventRow.action == APPLIED,
                )
            ).one_or_none()
            if event is None or event.actor_user_id != self.actor.user_id:
                raise _stale("not_found")
            record = dict(event.details)
            if not record.get("undoable"):
                raise _stale("not_undoable")
            now = datetime.now(UTC)
            if now > datetime.fromisoformat(record["expires_at"]):
                raise _stale("expired")
            if (
                conn.execute(
                    select(AuditEventRow.id).where(
                        AuditEventRow.project_id == pid,
                        AuditEventRow.action == UNDONE,
                        AuditEventRow.details["undo_of"].as_integer() == undo_id,
                    )
                ).first()
                is not None
            ):
                raise _stale("already_undone")
            action: BulkAction = record["action"]
            ids = [int(i) for i in record["assignment_ids"]]
            rows = list(
                conn.execute(
                    select(AssignmentRow, DocumentRow.case_id, DocumentRow.language)
                    .join(
                        DocumentRow,
                        and_(
                            DocumentRow.project_id == AssignmentRow.project_id,
                            DocumentRow.document_id == AssignmentRow.document_id,
                        ),
                    )
                    .where(AssignmentRow.project_id == pid, AssignmentRow.id.in_(ids))
                    .order_by(AssignmentRow.id)
                    .with_for_update(key_share=True, of=AssignmentRow)
                ).mappings()
            )
            if len(rows) != len(ids) or record["state"] != _after_state(conn, pid, ids):
                raise _stale("changed")
            if action == "withdraw":
                self._require_restorable(conn, project, rows)
            for row in rows:
                if action == "reopen":
                    if row["revoked_at"] is not None or row["status"] != "reopened":
                        raise _stale("changed")
                    conn.execute(
                        update(AssignmentRow)
                        .where(AssignmentRow.id == row["id"])
                        .values(
                            status="submitted",
                            started_at=func.coalesce(AssignmentRow.started_at, now),
                            updated_at=now,
                        )
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
                    name = "assignment.reopen_undone"
                else:
                    if row["revoked_at"] is None:
                        raise _stale("changed")
                    conn.execute(
                        update(AssignmentRow)
                        .where(AssignmentRow.id == row["id"])
                        .values(revoked_at=None, revoked_by=None, updated_at=now)
                    )
                    name = "assignment.restore"
                record_audit(
                    conn,
                    self.actor,
                    name,
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
            record_audit(
                conn,
                self.actor,
                UNDONE,
                target_type="project",
                target_id=key,
                project_id=pid,
                details={"undo_of": undo_id, "action": action, "assignment_ids": ids},
                at=now,
            )
            return {"undone": len(rows)}

    @staticmethod
    def _require_restorable(
        conn: Connection, project: RowMapping, rows: Sequence[RowMapping]
    ) -> None:
        """A withdrawn task comes back only where a new one could be given:
        its person can still take it, its text plans the task and its version
        is not discarded. The limit of annotators is not asked again: the
        state digest says the text has exactly the tasks it had."""
        pid = int(project["id"])
        plan = plan_for(
            conn, pid, {RowKey(row["case_id"], row["language"]) for row in rows}
        )
        discarded = set(
            conn.execute(
                select(DiscardedVariantRow.document_id).where(
                    DiscardedVariantRow.project_id == pid,
                    DiscardedVariantRow.document_id.in_(
                        sorted({str(row["document_id"]) for row in rows})
                    ),
                )
            ).scalars()
        )
        checked: set[tuple[int, str]] = set()
        for row in rows:
            flags = plan.get(RowKey(row["case_id"], row["language"]))
            planned = flags is not None and (
                flags.review if row["task"] == "translation_review" else flags.annotate
            )
            if not planned or row["document_id"] in discarded:
                raise _stale("not_in_plan")
            who = (int(row["user_id"]), str(row["task"]))
            if who not in checked:
                try:
                    AssignmentService._require_target(
                        conn, project, who[0], cast(Task, who[1])
                    )
                except DomainError as refusal:
                    raise _stale("person_unavailable") from refusal
                checked.add(who)


def _current_versions(
    conn: Connection, pid: int, rows: Sequence[RowKey]
) -> dict[str, str | None]:
    """The current version of each text of ``rows`` with its translation
    status: the newest counted version, as
    ``text_targets.text_target_document`` finds it for one text (no live
    version: none). Two queries, however many texts."""
    if not rows:
        return {}
    wanted = set(rows)
    chains = {
        row: found
        for row, found in _chains(conn, pid, sorted({r.case_id for r in rows})).items()
        if row in wanted
    }
    versions = [
        v.document_id for found in chains.values() for c in found for v in c.versions
    ]
    discarded = set(
        conn.execute(
            select(DiscardedVariantRow.document_id).where(
                DiscardedVariantRow.project_id == pid,
                DiscardedVariantRow.document_id.in_(versions),
            )
        ).scalars()
    )
    current: dict[str, str | None] = {}
    for found in chains.values():
        live = _live(found, discarded)
        if live:
            latest = max(
                live,
                key=lambda c: (
                    -1 if c.root.position is None else c.root.position,
                    c.root_id,
                ),
            )
            target = _target(latest)
            current[target.document_id] = target.translation_status
    return current


def _after_state(conn: Connection, pid: int, assignment_ids: Sequence[int]) -> str:
    """Digest of everything an Undo would restore over, for the texts the
    action touched: their versions, plan rows and final results, and every
    assignment (with ``updated_at``), annotation draft, translation review
    draft, round and discard of those versions."""
    texts = sorted(
        set(
            conn.execute(
                select(DocumentRow.case_id, DocumentRow.language)
                .join(
                    AssignmentRow,
                    and_(
                        AssignmentRow.project_id == DocumentRow.project_id,
                        AssignmentRow.document_id == DocumentRow.document_id,
                    ),
                )
                .where(
                    AssignmentRow.project_id == pid,
                    AssignmentRow.id.in_(list(assignment_ids)),
                )
            ).tuples()
        )
    )
    if not texts:
        return state_digest({"texts": []})
    # Every version of those texts: a new version changes the digest.
    documents = sorted(
        conn.execute(
            select(DocumentRow.document_id).where(
                DocumentRow.project_id == pid,
                tuple_(DocumentRow.case_id, DocumentRow.language).in_(texts),
            )
        ).scalars()
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
            row.updated_at.isoformat(),
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
    plan = plan_for(conn, pid, {RowKey(*text) for text in texts})
    wanted = set(texts)
    return state_digest(
        {
            "documents": documents,
            "plan": sorted(
                [key.case_id, key.language, flags.review, flags.annotate]
                for key, flags in plan.items()
                if (key.case_id, key.language) in wanted
            ),
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
            "review_drafts": [
                list(row)
                for row in conn.execute(
                    select(
                        TranslationReviewDraftRow.assignment_id,
                        TranslationReviewDraftRow.revision,
                    )
                    .where(
                        TranslationReviewDraftRow.assignment_id.in_(
                            [item[0] for item in assignments]
                        )
                    )
                    .order_by(TranslationReviewDraftRow.assignment_id)
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
                        tuple_(
                            FinalSelectionRow.case_id, FinalSelectionRow.language
                        ).in_(texts),
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
