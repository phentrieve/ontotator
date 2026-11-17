"""Change a text's annotation mode after submitted work, and restore it (#109).

The mode of a text is fixed by its oldest annotation work
(``domain.annotation_modes``). A lead may still change it: the change marks
every live submission of the text (annotation and consolidation) as
discarded, revokes the text's live annotate and review assignments and
stores the new mode as the text's plan override. Nothing is deleted: the
marks live in ``discarded_submissions`` and every state reader skips them
through ``storage.live_submissions``. Restoring the change removes the marks,
reinstates the revoked assignments and puts the previous override back, as
long as no new annotation work has started on the text since.

The preview names whose submitted work is discarded; the change itself must
send the exact submission IDs the lead saw (``expected_submission_ids``), so
the warning and the discard never differ. Writes run under the project lock
like every work-plan write and are audited (``annotation_mode.change``,
``annotation_mode.restore`` beside ``work_plan.update`` and
``assignment.revoke``).

``bulk`` (issue 336, step 4) changes many texts in the shared frame "bulk
action with preview": the preview names, per text, whose submitted work is
discarded and whose assignment is removed, and the texts it leaves as they
are with the reason; applying sends the preview's ``preview_token`` and
changes every listed text or none (``PREVIEW_STALE`` with the fresh
preview). Each text is changed and audited exactly as a single change
(``annotation_mode.change`` with ``via: bulk_change_mode``), so each can be
restored on its own.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import Connection, RowMapping, delete, insert, select, tuple_, update

from ontotator.application.annotation_modes import load_text_mode, locked_text_modes
from ontotator.application.document_row_submissions import lead_pseudonym_refs
from ontotator.application.people import person_refs
from ontotator.application.text_targets import (
    TextRow,
    text_documents,
    text_target_document,
    text_target_documents,
)
from ontotator.application.work_plans import WorkPlanService, _audit_cases, _write
from ontotator.application.workflow_warnings import state_digest
from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.policy import Access
from ontotator.domain.annotation_modes import AnnotationMode
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.work_plans import OFF, RowKey
from ontotator.projects.assignments import revoke_assignments
from ontotator.storage import work_plan_store as store
from ontotator.storage.database import Database
from ontotator.storage.final_tables import FinalSelectionRow
from ontotator.storage.live_submissions import live_submission
from ontotator.storage.mode_change_tables import (
    AnnotationModeChangeRow,
    DiscardedSubmissionRow,
)
from ontotator.storage.proposal_queries import (
    newest_proposal_counts,
    newest_proposal_refs,
)
from ontotator.storage.tables import AssignmentRow, DocumentRow, SubmissionRow

__all__ = ["AnnotationModeChangeService"]

# The tasks whose work rests on the text's annotation mode.
_TASKS = ("annotate", "review")

# Why the bulk change leaves a text as it is, with the words the dialog and
# the MCP tool show. The reasons are the single change's refusals, in its
# order (``_check``).
BULK_SKIP_REASONS: dict[str, str] = {
    # NOT_IN_WORK_PLAN
    "no_current_version": "No version of the text is in use.",
    # ANNOTATION_MODE_NOT_LOCKED
    "not_locked": "No annotation work yet: set the mode with Plan….",
    # ANNOTATION_MODE_UNCHANGED
    "unchanged": "Already annotated this way.",
    # NO_TOOL_PROPOSALS
    "no_proposals": "No tool proposals for this text.",
    # ANNOTATION_MODE_FINAL_SELECTED
    "final_result": "Final result chosen: use Withdraw final… first.",
}


class AnnotationModeChangeService:
    def __init__(self, db: Database, actor: Actor, access: Access):
        self.db, self.actor, self.access = db, actor, access
        self._plans = WorkPlanService(db, actor, access)

    # --- reads ------------------------------------------------------------- #

    def preview(
        self, key: str, case_id: str, language: str, mode: AnnotationMode
    ) -> dict[str, Any]:
        """What changing the text to ``mode`` discards and revokes (no write)."""
        with self.db.transaction() as conn:
            project = self._plans._lock(conn, key, exclusive=False)
            pid = project["id"]
            text, documents, from_mode = self._check(conn, pid, case_id, language, mode)
            return self._preview_view(
                conn, pid, text, documents, from_mode, mode, lock=False
            )

    def list_changes(
        self, key: str, case_id: str | None, language: str | None
    ) -> dict[str, Any]:
        """The mode changes, newest first, with what a restore needs: of one
        text, or of every case or language left out (#352)."""
        with self.db.transaction() as conn:
            project = self._plans._lock(conn, key, exclusive=False)
            pid = project["id"]
            query = select(AnnotationModeChangeRow).where(
                AnnotationModeChangeRow.project_id == pid
            )
            if case_id is not None:
                query = query.where(AnnotationModeChangeRow.case_id == case_id)
            if language is not None:
                query = query.where(AnnotationModeChangeRow.language == language)
            rows = (
                conn.execute(query.order_by(AnnotationModeChangeRow.id.desc()))
                .mappings()
                .all()
            )
            return {
                "case_id": case_id,
                "language": language,
                "changes": [self._change_view(conn, pid, row) for row in rows],
            }

    # --- writes ------------------------------------------------------------ #

    def change(
        self,
        key: str,
        case_id: str,
        language: str,
        mode: AnnotationMode,
        *,
        reason: str,
        expected_revision: int,
        expected_submission_ids: Sequence[str],
    ) -> dict[str, Any]:
        reason = reason.strip()
        if not reason:
            raise DomainError("MODE_CHANGE_REASON_REQUIRED")
        if self.actor.user_id is None:
            # The change and its marks name the lead (NOT NULL user columns).
            raise AccessDenied("NOT_ALLOWED", "Only a signed-in lead can do this.")
        with self.db.transaction() as conn:
            project = self._plans._lock(conn, key, exclusive=True)
            pid = project["id"]
            revisions = store.revisions(conn, pid, [case_id])
            self._plans._require_revisions(revisions, {case_id: expected_revision})
            text, documents, from_mode = self._check(conn, pid, case_id, language, mode)
            preview = self._preview_view(
                conn, pid, text, documents, from_mode, mode, lock=True
            )
            discarded = [item["submission_id"] for item in preview["submissions"]]
            if sorted(discarded) != sorted(set(expected_submission_ids)):
                # The warning the lead confirmed named other work: show it again.
                raise DomainError("MODE_CHANGE_STALE", preview)
            now = datetime.now(UTC)
            change_id, revision = self._apply(conn, pid, preview, reason, now)
            row = self._row(conn, pid, change_id)
            return {"change": self._change_view(conn, pid, row), "revision": revision}

    def _apply(
        self,
        conn: Connection,
        pid: int,
        preview: dict[str, Any],
        reason: str,
        now: datetime,
        *,
        via: str | None = None,
    ) -> tuple[int, int]:
        """Change one text as ``preview`` (``_preview_view``, read under the
        exclusive project lock) says: record the change, mark the submissions
        discarded, revoke the assignments, store the override, audit. Returns
        the change id and the case's new plan revision. ``via`` names a bulk
        action in the audit entry."""
        case_id, language = preview["case_id"], preview["language"]
        from_mode, mode = preview["from_mode"], preview["to_mode"]
        row_key = RowKey(case_id, language)
        discarded = [item["submission_id"] for item in preview["submissions"]]
        previous = store.plan_modes(conn, pid, [row_key]).get(row_key)
        revoked = [item["assignment_id"] for item in preview["assignments"]]
        change_id = conn.execute(
            insert(AnnotationModeChangeRow)
            .values(
                project_id=pid,
                case_id=case_id,
                language=language,
                from_mode=from_mode,
                to_mode=mode,
                previous_override=previous,
                reason=reason,
                revoked_assignment_ids=revoked,
                changed_by=self.actor.user_id,
                changed_at=now,
            )
            .returning(AnnotationModeChangeRow.id)
        ).scalar_one()
        if discarded:
            conn.execute(
                insert(DiscardedSubmissionRow),
                [
                    {
                        "project_id": pid,
                        "submission_id": sid,
                        "change_id": change_id,
                        "reason": reason,
                        "discarded_by": self.actor.user_id,
                        "discarded_at": now,
                    }
                    for sid in discarded
                ],
            )
        revoke_assignments(
            conn,
            self.actor,
            pid,
            [
                {
                    "id": item["assignment_id"],
                    "document_id": item["document_id"],
                    "task": item["task"],
                }
                for item in preview["assignments"]
            ],
            now,
            reason="annotation_mode_change",
        )
        revision = self._write_override(conn, pid, row_key, mode, now)
        details: dict[str, Any] = {
            "change_id": change_id,
            "case_id": case_id,
            "language": language,
            "from_mode": from_mode,
            "to_mode": mode,
            "reason": reason,
            "discarded_submission_ids": sorted(discarded),
            "revoked_assignment_ids": revoked,
            "authors": sorted(
                {item["author"]["pseudonym"] for item in preview["submissions"]}
            ),
        }
        if via is not None:
            details["via"] = via
        record_audit(
            conn,
            self.actor,
            "annotation_mode.change",
            target_type="work_plan",
            target_id=case_id,
            project_id=pid,
            details=details,
            at=now,
        )
        return int(change_id), revision

    def bulk(
        self,
        key: str,
        rows: Sequence[RowKey],
        mode: AnnotationMode,
        *,
        reason: str | None,
        preview: bool,
        preview_token: str | None,
        summary_only: bool = False,
    ) -> dict[str, Any]:
        """Preview the change of ``rows`` to ``mode``, or apply it all or
        nothing (``preview_token`` of the preview shown).

        Apply recomputes the preview under the exclusive project lock; a
        token that no longer matches is refused with ``PREVIEW_STALE`` and
        the fresh preview. ``summary_only`` (preview): counts and the token,
        no lists.
        """
        reason = (reason or "").strip()
        if not preview and not reason:
            raise DomainError("MODE_CHANGE_REASON_REQUIRED")
        if not preview and self.actor.user_id is None:
            raise AccessDenied("NOT_ALLOWED", "Only a signed-in lead can do this.")
        with self.db.transaction() as conn:
            project = self._plans._lock(conn, key, exclusive=not preview)
            pid = project["id"]
            plan = self._bulk_plan(
                conn,
                pid,
                rows,
                mode,
                lock=not preview,
                # Applying needs the lists, whatever the request says.
                summary_only=preview and summary_only,
            )
            if preview:
                return plan | {"applied": False}
            if preview_token != plan["preview_token"]:
                raise DomainError(
                    "PREVIEW_STALE", {"preview": plan | {"applied": False}}
                )
            now = datetime.now(UTC)
            for change in plan["changes"]:
                self._apply(conn, pid, change, reason, now, via="bulk_change_mode")
            return plan | {"applied": True}

    def _bulk_plan(
        self,
        conn: Connection,
        pid: int,
        rows: Sequence[RowKey],
        mode: AnnotationMode,
        *,
        lock: bool,
        summary_only: bool,
    ) -> dict[str, Any]:
        """What changing ``rows`` to ``mode`` would do now: per text the
        preview of a single change, and the texts left as they are with the
        single change's refusal as the reason; selected texts the project
        does not have are named in ``unknown_rows``. Pure reads under the caller's
        lock; the number of queries does not grow with the number of texts."""
        wanted = list(dict.fromkeys(rows))
        pairs = [(row.case_id, row.language) for row in wanted]
        versions: dict[RowKey, list[str]] = {}
        if pairs:
            for case_id, language, document_id in conn.execute(
                select(
                    DocumentRow.case_id, DocumentRow.language, DocumentRow.document_id
                )
                .where(
                    DocumentRow.project_id == pid,
                    tuple_(DocumentRow.case_id, DocumentRow.language).in_(pairs),
                )
                .order_by(DocumentRow.version, DocumentRow.document_id)
            ).tuples():
                versions.setdefault(RowKey(case_id, language), []).append(document_id)
        found = [row for row in wanted if row in versions]
        documents = sorted(doc for row in found for doc in versions[row])
        locked = locked_text_modes(conn, pid, documents) if documents else {}
        targets = text_target_documents(conn, pid, found)
        proposals = newest_proposal_counts(conn, pid) if mode == "proposals" else {}
        finals = (
            {
                RowKey(case_id, language)
                for case_id, language in conn.execute(
                    select(FinalSelectionRow.case_id, FinalSelectionRow.language).where(
                        FinalSelectionRow.project_id == pid,
                        tuple_(
                            FinalSelectionRow.case_id, FinalSelectionRow.language
                        ).in_([(row.case_id, row.language) for row in found]),
                    )
                ).tuples()
            }
            if found
            else set()
        )
        changing: list[RowKey] = []
        skipped: list[tuple[RowKey, str]] = []
        for row in found:
            current = locked.get((row.case_id, row.language))
            if row not in targets:
                why = "no_current_version"
            elif current is None:
                why = "not_locked"
            elif current == mode:
                why = "unchanged"
            elif mode == "proposals" and not proposals.get(targets[row]):
                why = "no_proposals"
            elif row in finals:
                why = "final_result"
            else:
                changing.append(row)
                continue
            skipped.append((row, why))
        by_document = {doc: row for row in changing for doc in versions[row]}
        work = sorted(by_document)
        submissions = self._live_submissions(conn, pid, work) if work else []
        assignments = self._live_assignments(conn, pid, work, lock=lock) if work else []
        revisions = store.revisions(
            conn, pid, sorted({row.case_id for row in changing})
        )
        digest = state_digest(
            {
                "mode": mode,
                "rows": [[row.case_id, row.language] for row in found],
                "changes": [
                    [
                        row.case_id,
                        row.language,
                        locked[(row.case_id, row.language)],
                        revisions[row.case_id],
                    ]
                    for row in changing
                ],
                "submissions": sorted(item.submission_id for item in submissions),
                "assignments": sorted([item.id, item.status] for item in assignments),
                "skipped": [[row.case_id, row.language, why] for row, why in skipped],
            }
        )
        reasons: dict[str, int] = {}
        for _row, why in skipped:
            reasons[why] = reasons.get(why, 0) + 1
        result: dict[str, Any] = {
            "mode": mode,
            "texts": len(found),
            # Selected texts the project does not have, as they were given.
            "unknown_rows": [
                {"case_id": row.case_id, "language": row.language}
                for row in wanted
                if row not in versions
            ],
            "change_count": len(changing),
            "skipped_count": len(skipped),
            "skipped_by_reason": reasons,
            "submission_count": len(submissions),
            "assignment_count": len(assignments),
            "changes": [],
            "skipped": [],
            "preview_token": f"sha256:{digest}",
        }
        if summary_only:
            return result
        viewer = self.actor.user_id if self.actor.user_id is not None else -1
        authors = lead_pseudonym_refs(
            conn, (item.annotator_id for item in submissions), viewer_id=viewer
        )
        people = person_refs(
            conn,
            (item.user_id for item in assignments),
            viewer_id=viewer,
            viewer_is_lead=True,
        )
        views: dict[RowKey, dict[str, Any]] = {
            row: {
                "case_id": row.case_id,
                "language": row.language,
                "from_mode": locked[(row.case_id, row.language)],
                "to_mode": mode,
                "revision": revisions[row.case_id],
                "submissions": [],
                "assignments": [],
            }
            for row in changing
        }
        for item in submissions:
            views[by_document[item.document_id]]["submissions"].append(
                {
                    "submission_id": item.submission_id,
                    "document_id": item.document_id,
                    "mode": item.mode,
                    "recorded_at": item.recorded_at.isoformat(),
                    "author": authors[item.annotator_id],
                }
            )
        for item in assignments:
            views[by_document[item.document_id]]["assignments"].append(
                {
                    "assignment_id": item.id,
                    "document_id": item.document_id,
                    "task": item.task,
                    "status": item.status,
                    "person": people[item.user_id].model_dump(),
                }
            )
        result["changes"] = [views[row] for row in changing]
        result["skipped"] = [
            {
                "case_id": row.case_id,
                "language": row.language,
                "reason": why,
                "message": BULK_SKIP_REASONS[why],
            }
            for row, why in skipped
        ]
        return result

    def restore(
        self, key: str, change_id: int, expected_revision: int
    ) -> dict[str, Any]:
        if self.actor.user_id is None:
            raise AccessDenied("NOT_ALLOWED", "Only a signed-in lead can do this.")
        with self.db.transaction() as conn:
            project = self._plans._lock(conn, key, exclusive=True)
            pid = project["id"]
            row = self._row(conn, pid, change_id, lock=True)
            case_id, language = row["case_id"], row["language"]
            revisions = store.revisions(conn, pid, [case_id])
            self._plans._require_revisions(revisions, {case_id: expected_revision})
            blocked = self._restore_blocked(conn, pid, row, lock=True)
            if blocked is not None:
                raise DomainError(blocked, {"change_id": change_id})
            now = datetime.now(UTC)
            marks = list(
                conn.execute(
                    delete(DiscardedSubmissionRow)
                    .where(
                        DiscardedSubmissionRow.project_id == pid,
                        DiscardedSubmissionRow.change_id == change_id,
                    )
                    .returning(DiscardedSubmissionRow.submission_id)
                ).scalars()
            )
            reinstated = [int(i) for i in row["revoked_assignment_ids"]]
            for assignment_id in reinstated:
                conn.execute(
                    update(AssignmentRow)
                    .where(
                        AssignmentRow.project_id == pid,
                        AssignmentRow.id == assignment_id,
                    )
                    .values(revoked_at=None, revoked_by=None, updated_at=now)
                )
                record_audit(
                    conn,
                    self.actor,
                    "assignment.reinstate",
                    target_type="assignment",
                    target_id=assignment_id,
                    project_id=pid,
                    details={
                        "reason": "annotation_mode_restore",
                        "change_id": change_id,
                    },
                    at=now,
                )
            conn.execute(
                update(AnnotationModeChangeRow)
                .where(AnnotationModeChangeRow.id == change_id)
                .values(restored_at=now, restored_by=self.actor.user_id)
            )
            revision = self._write_override(
                conn,
                pid,
                RowKey(case_id, language),
                cast(AnnotationMode | None, row["previous_override"]),
                now,
            )
            record_audit(
                conn,
                self.actor,
                "annotation_mode.restore",
                target_type="work_plan",
                target_id=case_id,
                project_id=pid,
                details={
                    "change_id": change_id,
                    "case_id": case_id,
                    "language": language,
                    "mode": row["from_mode"],
                    "restored_submission_ids": sorted(marks),
                    "reinstated_assignment_ids": reinstated,
                },
                at=now,
            )
            row = self._row(conn, pid, change_id)
            return {"change": self._change_view(conn, pid, row), "revision": revision}

    # --- helpers ----------------------------------------------------------- #

    @staticmethod
    def _check(
        conn: Connection, pid: int, case_id: str, language: str, mode: AnnotationMode
    ) -> tuple[TextRow, list[str], AnnotationMode]:
        """The text, its documents and its current (locked) mode, or a refusal."""
        text = TextRow(case_id, language)
        documents = text_documents(conn, pid, text)
        if not documents:
            raise DomainError("DOCUMENT_NOT_FOUND")
        target = text_target_document(conn, pid, text)
        current = load_text_mode(conn, pid, target)
        if not current.locked:
            # No work fixes the mode: the plan control changes it directly.
            raise DomainError("ANNOTATION_MODE_NOT_LOCKED", {"mode": current.mode})
        if current.mode == mode:
            raise DomainError("ANNOTATION_MODE_UNCHANGED", {"mode": mode})
        if mode == "proposals" and not newest_proposal_refs(conn, pid, target):
            raise DomainError("NO_TOOL_PROPOSALS")
        final = conn.execute(
            select(FinalSelectionRow.id).where(
                FinalSelectionRow.project_id == pid,
                FinalSelectionRow.case_id == case_id,
                FinalSelectionRow.language == language,
            )
        ).first()
        if final is not None:
            # A chosen final result rests on this work; the mode stays.
            raise DomainError("ANNOTATION_MODE_FINAL_SELECTED")
        return text, documents, current.mode

    def _preview_view(
        self,
        conn: Connection,
        pid: int,
        text: TextRow,
        documents: list[str],
        from_mode: AnnotationMode,
        to_mode: AnnotationMode,
        *,
        lock: bool,
    ) -> dict[str, Any]:
        submissions = self._live_submissions(conn, pid, documents)
        assignments = self._live_assignments(conn, pid, documents, lock=lock)
        viewer = self.actor.user_id if self.actor.user_id is not None else -1
        authors = lead_pseudonym_refs(
            conn, (row.annotator_id for row in submissions), viewer_id=viewer
        )
        people = person_refs(
            conn,
            (row.user_id for row in assignments),
            viewer_id=viewer,
            viewer_is_lead=True,
        )
        return {
            "case_id": text.case_id,
            "language": text.language,
            "from_mode": from_mode,
            "to_mode": to_mode,
            "revision": store.revisions(conn, pid, [text.case_id])[text.case_id],
            "submissions": [
                {
                    "submission_id": row.submission_id,
                    "document_id": row.document_id,
                    "mode": row.mode,
                    "recorded_at": row.recorded_at.isoformat(),
                    "author": authors[row.annotator_id],
                }
                for row in submissions
            ],
            "assignments": [
                {
                    "assignment_id": row.id,
                    "document_id": row.document_id,
                    "task": row.task,
                    "status": row.status,
                    "person": people[row.user_id].model_dump(),
                }
                for row in assignments
            ],
        }

    @staticmethod
    def _live_submissions(
        conn: Connection, pid: int, documents: list[str]
    ) -> list[Any]:
        return list(
            conn.execute(
                select(
                    SubmissionRow.submission_id,
                    SubmissionRow.document_id,
                    SubmissionRow.annotator_id,
                    SubmissionRow.mode,
                    SubmissionRow.recorded_at,
                )
                .where(
                    SubmissionRow.project_id == pid,
                    SubmissionRow.document_id.in_(documents),
                    live_submission(),
                )
                .order_by(SubmissionRow.recorded_at, SubmissionRow.submission_id)
            )
        )

    @staticmethod
    def _live_assignments(
        conn: Connection, pid: int, documents: list[str], *, lock: bool
    ) -> list[Any]:
        query = (
            select(
                AssignmentRow.id,
                AssignmentRow.document_id,
                AssignmentRow.task,
                AssignmentRow.status,
                AssignmentRow.user_id,
            )
            .where(
                AssignmentRow.project_id == pid,
                AssignmentRow.document_id.in_(documents),
                AssignmentRow.task.in_(_TASKS),
                AssignmentRow.revoked_at.is_(None),
            )
            .order_by(AssignmentRow.id)
        )
        if lock:
            query = query.with_for_update(key_share=True)
        return list(conn.execute(query))

    def _write_override(
        self,
        conn: Connection,
        pid: int,
        row_key: RowKey,
        mode: AnnotationMode | None,
        now: datetime,
    ) -> int:
        """Store the text's override, bump the case's plan revision and audit
        it as every plan write (``work_plan.update``); the new revision."""
        current = store.effective_plan(conn, pid, [row_key.case_id])
        flags = {row_key: current.get(row_key, OFF)}
        old_modes = store.plan_modes(conn, pid, [row_key])
        written = _write(conn, self.actor, pid, current, flags, restored={})
        store.write_modes(conn, pid, {row_key: mode})
        _audit_cases(
            conn,
            self.actor,
            pid,
            current,
            flags,
            written,
            now=now,
            old_modes=old_modes,
            new_modes={row_key: mode},
        )
        return written[row_key.case_id]

    @staticmethod
    def _row(
        conn: Connection, pid: int, change_id: int, *, lock: bool = False
    ) -> RowMapping:
        query = select(AnnotationModeChangeRow).where(
            AnnotationModeChangeRow.project_id == pid,
            AnnotationModeChangeRow.id == change_id,
        )
        if lock:
            query = query.with_for_update()
        row = conn.execute(query).mappings().one_or_none()
        if row is None:
            raise DomainError("MODE_CHANGE_NOT_FOUND")
        return row

    @staticmethod
    def _restore_blocked(
        conn: Connection, pid: int, row: RowMapping, *, lock: bool = False
    ) -> str | None:
        """Why the change cannot be restored now, or None."""
        if row["restored_at"] is not None:
            return "MODE_CHANGE_ALREADY_RESTORED"
        newer = conn.execute(
            select(AnnotationModeChangeRow.id).where(
                AnnotationModeChangeRow.project_id == pid,
                AnnotationModeChangeRow.case_id == row["case_id"],
                AnnotationModeChangeRow.language == row["language"],
                AnnotationModeChangeRow.id > row["id"],
                AnnotationModeChangeRow.restored_at.is_(None),
            )
        ).first()
        if newer is not None:
            return "MODE_CHANGE_NOT_LATEST"
        documents = text_documents(conn, pid, TextRow(row["case_id"], row["language"]))
        live = AnnotationModeChangeService._live_submissions(conn, pid, documents)
        assigned = AnnotationModeChangeService._live_assignments(
            conn, pid, documents, lock=lock
        )
        if live or assigned:
            # Work started in the new mode; restoring would mix the modes.
            return "ANNOTATION_MODE_LOCKED"
        return None

    def _change_view(
        self, conn: Connection, pid: int, row: RowMapping
    ) -> dict[str, Any]:
        viewer = self.actor.user_id if self.actor.user_id is not None else -1
        if row["restored_at"] is None:
            marked = select(DiscardedSubmissionRow.submission_id).where(
                DiscardedSubmissionRow.project_id == pid,
                DiscardedSubmissionRow.change_id == row["id"],
            )
            submissions = list(
                conn.execute(
                    select(
                        SubmissionRow.submission_id,
                        SubmissionRow.document_id,
                        SubmissionRow.annotator_id,
                        SubmissionRow.mode,
                        SubmissionRow.recorded_at,
                    )
                    .where(
                        SubmissionRow.project_id == pid,
                        SubmissionRow.submission_id.in_(marked),
                    )
                    .order_by(SubmissionRow.recorded_at, SubmissionRow.submission_id)
                )
            )
        else:
            submissions = []
        authors = lead_pseudonym_refs(
            conn, (s.annotator_id for s in submissions), viewer_id=viewer
        )
        users = [
            row["changed_by"],
            *([row["restored_by"]] if row["restored_by"] else []),
        ]
        people = person_refs(conn, users, viewer_id=viewer, viewer_is_lead=True)
        blocked = self._restore_blocked(conn, pid, row)
        return {
            "change_id": row["id"],
            "case_id": row["case_id"],
            "language": row["language"],
            "from_mode": row["from_mode"],
            "to_mode": row["to_mode"],
            "reason": row["reason"],
            "changed_at": row["changed_at"],
            "changed_by": people[row["changed_by"]].model_dump(),
            "restored_at": row["restored_at"],
            "restored_by": people[row["restored_by"]].model_dump()
            if row["restored_by"]
            else None,
            "revoked_assignment_ids": [int(i) for i in row["revoked_assignment_ids"]],
            "submissions": [
                {
                    "submission_id": s.submission_id,
                    "document_id": s.document_id,
                    "mode": s.mode,
                    "recorded_at": s.recorded_at.isoformat(),
                    "author": authors[s.annotator_id],
                }
                for s in submissions
            ],
            "restorable": blocked is None,
            "restore_blocked": None
            if blocked in (None, "MODE_CHANGE_ALREADY_RESTORED")
            else blocked,
        }
