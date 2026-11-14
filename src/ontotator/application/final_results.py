"""Lead-selected immutable results and transactional final export preflight."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Connection, delete, func, insert, select, update

from ontotator.application import document_row_panel
from ontotator.application.document_row_page import build_row, page_context
from ontotator.application.document_row_panel import row_comparison
from ontotator.application.document_rows import load_facts
from ontotator.application.final_causes import (
    ACKNOWLEDGEABLE_CODES,
    authorize_final_results,
    derive_final_state,
)
from ontotator.application.translation_reviews import TranslationReviewRecord
from ontotator.application.workflow_warnings import state_digest
from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.policy import Access
from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.errors import AccessDenied, DomainError, RevisionConflict
from ontotator.domain.results import latest_submissions
from ontotator.domain.work_plans import RowKey
from ontotator.domain.workspace import Submission
from ontotator.exchange.final_content import freeze_content
from ontotator.exchange.final_export import agreement_units
from ontotator.exchange.final_export_guide import submission_kind
from ontotator.exchange.final_tables import ANNOTATION_KINDS, agreement_report
from ontotator.exchange.human_inputs import human_input_closure
from ontotator.jobs.queue import check_queue_room
from ontotator.storage import work_plan_store
from ontotator.storage.database import Database
from ontotator.storage.final_tables import (
    ExportSelectionSnapshotRow,
    FinalSelectionEventRow,
    FinalSelectionRow,
)
from ontotator.storage.live_submissions import live_submission
from ontotator.storage.tables import (
    DocumentRow,
    JobRow,
    ProjectRow,
    SubmissionRow,
    TranslationReviewRow,
    UserRow,
)
from ontotator.storage.workflow_tables import ReviewObligationResolutionRow

# The job of each final export format; both read the same frozen snapshot.
FINAL_JOB_KINDS = {
    "t1": "final_t1_export",
    "phenopacket": "final_phenopacket_export",
}


def _pseudonym(conn: Connection, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    return conn.execute(
        select(UserRow.pseudonym).where(UserRow.id == user_id)
    ).scalar_one_or_none()


def _conflict(conn: Connection, old: Any) -> dict[str, Any]:
    """409 details naming the current selection's revision, author and time."""
    if not old:
        return {"current_revision": 0, "selected_by": None, "updated_at": None}
    return {
        "current_revision": old["revision"],
        "selected_by": _pseudonym(conn, old["actor_id"]),
        "updated_at": old["updated_at"].isoformat(),
    }


def _withdrawn_revision(conn: Connection, pid: int, doc: Any) -> int:
    """The last revision a withdrawn final of this text had (#343), else 0.

    The events keep every selection and withdrawal with its revision; while
    the slot has a row, its revision is the current one instead.
    """
    payload = FinalSelectionEventRow.payload
    last = conn.execute(
        select(func.max(payload["revision"].as_integer())).where(
            FinalSelectionEventRow.project_id == pid,
            payload["case_id"].astext == doc.case_id,
            payload["language"].astext == doc.language,
        )
    ).scalar_one_or_none()
    return int(last or 0)


# Why accept_agreeing leaves a text out (#354), with the words the MCP tool
# and a later Documents dialog show.
AGREEING_SKIPS = {
    "open_task": "Other work on the text is still open.",
    "fewer_than_two": "Fewer than two submissions to compare.",
    "consolidation": "The text has a consolidation; accept it on Documents.",
    # Also when only the caller's own submission would match and the project
    # does not let them accept their own work.
    "differ": "No result you may accept agrees in full; consolidate or choose"
    " on Documents.",
}


class FinalResultService:
    def __init__(self, db: Database, actor: Actor, access: Access):
        self.db, self.actor, self.access = db, actor, access
        self.repo = ScopedRepository(db, access, actor)

    def _authorize(self, conn: Connection, key: str, *, exclusive: bool = False) -> int:
        return authorize_final_results(conn, self.actor, key, exclusive=exclusive)

    def select(
        self,
        key: str,
        document: str,
        submission: str,
        expected_revision: int,
        acknowledged_cause_ids: list[str],
    ) -> dict[str, Any]:
        if self.actor.user_id is None:
            # A selection names the lead who chose it (final_selections.actor_id
            # is NOT NULL); process actors pass project authority but cannot
            # be that lead, so refuse instead of failing on the insert.
            raise AccessDenied(
                "NOT_ALLOWED", "Only a signed-in lead can choose a final result."
            )
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key, exclusive=True)
            return self._select(
                conn,
                key,
                pid,
                document,
                submission,
                expected_revision,
                acknowledged_cause_ids,
            )

    def _select(
        self,
        conn: Connection,
        key: str,
        pid: int,
        document: str,
        submission: str,
        expected_revision: int,
        acknowledged_cause_ids: list[str],
        *,
        via: str | None = None,
    ) -> dict[str, Any]:
        """``select`` on ``conn``, which holds the exclusive project lock.
        ``via`` names a bulk action in the audit entry."""
        doc = conn.execute(
            select(DocumentRow.case_id, DocumentRow.language).where(
                DocumentRow.project_id == pid, DocumentRow.document_id == document
            )
        ).one_or_none()
        exact = conn.execute(
            select(SubmissionRow.submission_id, SubmissionRow.annotator_id).where(
                SubmissionRow.project_id == pid,
                SubmissionRow.document_id == document,
                SubmissionRow.submission_id == submission,
                # A discarded submission (mode change, #109) is no result.
                live_submission(),
            )
        ).first()
        if doc is None or exact is None:
            raise DomainError("VERSION_NOT_FOUND")
        rule = conn.execute(
            select(ProjectRow.adjudicator_not_annotator).where(ProjectRow.id == pid)
        ).scalar_one()
        slot = (
            FinalSelectionRow.project_id == pid,
            FinalSelectionRow.case_id == doc.case_id,
            FinalSelectionRow.language == doc.language,
        )
        old = (
            conn.execute(select(FinalSelectionRow).where(*slot).with_for_update())
            .mappings()
            .first()
        )
        if expected_revision != (old["revision"] if old else 0):
            raise RevisionConflict(_conflict(conn, old))
        # After the revision check: a stale request learns of the newer
        # selection first instead of the rule refusal.
        selected_by = _pseudonym(conn, self.actor.user_id)
        if rule and exact.annotator_id == selected_by:
            raise DomainError(
                "OWN_RESULT_NOT_SELECTABLE",
                "In this project the consolidator of a text may not be one of "
                "its annotators. Another lead must choose this result.",
            )
        same = bool(
            old
            and old["document_id"] == document
            and old["submission_id"] == submission
        )
        if acknowledged_cause_ids:
            if not old or not same:
                raise DomainError(
                    "INVALID_FINAL_SELECTION",
                    "New selections cannot pre-acknowledge future causes.",
                )
            # The client sends the complete set it showed; any addition,
            # removal or status change since then is a conflict.
            available = {
                warning.get("cause_id")
                for warning in self._projection(conn, key, pid)["warnings"]
                if warning["code"] in ACKNOWLEDGEABLE_CODES
                and warning["case_id"] == doc.case_id
                and warning["language"] == doc.language
            }
            if set(acknowledged_cause_ids) != available:
                raise RevisionConflict(
                    _conflict(conn, old) | {"reason": "warnings_changed"}
                )
        if old and same:
            acknowledged_cause_ids = sorted(
                set(acknowledged_cause_ids) | set(old["acknowledged_cause_ids"])
            )
        # After a withdrawal (#343) the slot has no row; its next revision
        # continues the withdrawn one, so a client that still holds the
        # withdrawn final's revision cannot overwrite the new choice.
        base = old["revision"] if old else _withdrawn_revision(conn, pid, doc)
        now = datetime.now(UTC)
        values = {
            "project_id": pid,
            "case_id": doc.case_id,
            "language": doc.language,
            "document_id": document,
            "submission_id": submission,
            "revision": base + 1,
            "actor_id": self.actor.user_id,
            "acknowledged_cause_ids": sorted(set(acknowledged_cause_ids)),
            "updated_at": now,
            "selected_at": old["selected_at"] if old and same else now,
            "adjudicator_not_annotator": rule,
        }
        if old:
            conn.execute(update(FinalSelectionRow).where(*slot).values(**values))
        else:
            conn.execute(insert(FinalSelectionRow).values(**values))
        if not same:
            # PLAN_RESTORED was about the earlier final; a new choice
            # settles it (the plan revision stays).
            work_plan_store.clear_restored(conn, pid, RowKey(doc.case_id, doc.language))
        result = {
            name: values[name]
            for name in (
                "case_id",
                "language",
                "document_id",
                "submission_id",
                "revision",
                "adjudicator_not_annotator",
            )
        }
        event = {
            **result,
            "actor_id": self.actor.user_id,
            "acknowledged_cause_ids": values["acknowledged_cause_ids"],
            "selected_at": values["selected_at"].isoformat(),
        }
        conn.execute(
            insert(FinalSelectionEventRow).values(project_id=pid, payload=event)
        )
        record_audit(
            conn,
            self.actor,
            "project.final_selection",
            target_type="project",
            target_id=key,
            project_id=pid,
            details=event if via is None else {**event, "via": via},
        )
        return result | {
            "selected_at": values["selected_at"],
            "updated_at": values["updated_at"],
            "selected_by": selected_by,
        }

    def withdraw(
        self,
        key: str,
        case_id: str,
        language: str,
        expected_revision: int,
        reason: str,
    ) -> dict[str, Any]:
        """Withdraw the final result of one text (#343).

        The text then has no final result until a lead chooses one again; its
        submissions and consolidations stay, final exports already made stay
        as they are, and Change mode… is possible again. Compare-and-set on
        the selection's revision; the event and the audit name the withdrawn
        result and the reason.
        """
        reason = reason.strip()
        if not reason:
            raise DomainError("WITHDRAW_REASON_REQUIRED")
        if self.actor.user_id is None:
            raise AccessDenied(
                "NOT_ALLOWED", "Only a signed-in lead can withdraw a final result."
            )
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key, exclusive=True)
            slot = (
                FinalSelectionRow.project_id == pid,
                FinalSelectionRow.case_id == case_id,
                FinalSelectionRow.language == language,
            )
            old = (
                conn.execute(select(FinalSelectionRow).where(*slot).with_for_update())
                .mappings()
                .first()
            )
            if old is None or expected_revision != old["revision"]:
                raise RevisionConflict(_conflict(conn, old))
            conn.execute(delete(FinalSelectionRow).where(*slot))
            event = {
                "case_id": case_id,
                "language": language,
                "document_id": old["document_id"],
                "submission_id": old["submission_id"],
                # The withdrawal is a revision of its own: the next choice
                # continues from it (``_withdrawn_revision``).
                "revision": old["revision"] + 1,
                "withdrawn": True,
                "reason": reason,
                "actor_id": self.actor.user_id,
            }
            conn.execute(
                insert(FinalSelectionEventRow).values(project_id=pid, payload=event)
            )
            record_audit(
                conn,
                self.actor,
                "project.final_withdrawn",
                target_type="project",
                target_id=key,
                project_id=pid,
                details=event,
            )
            return {
                "case_id": case_id,
                "language": language,
                "document_id": old["document_id"],
                "submission_id": old["submission_id"],
                "revision": event["revision"],
            }

    def _agreeing(
        self, conn: Connection, key: str, pid: int, case_ids: list[str] | None
    ) -> dict[str, Any]:
        """Which texts accept_agreeing would make final now (#354).

        A text qualifies when it has no final result, no open work, at least
        two submissions, none of them a consolidation, and all findings
        match in full (the final panel's ``all_match``, notes and modifier
        spans included) with a submission the caller may accept. Texts with
        a final result are only counted: Change final… changes them. Texts
        without submissions are not named.
        """
        assert self.actor.user_id is not None
        facts = load_facts(conn, self.repo, key, pid, self.actor.user_id, scope="panel")
        ctx = page_context(facts)
        wanted = None if case_ids is None else set(case_ids)
        texts: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        already_final = 0
        for case_id, language in sorted(ctx.by_row):
            if wanted is not None and case_id not in wanted:
                continue
            row = build_row(facts, case_id, language, ctx=ctx)
            if row["final"] is not None:
                already_final += 1
                continue
            open_work = any(
                item["status"] != "submitted" and item.get("moved_to_version") is None
                for item in row["work"]
            )
            ready = any(step["code"] == "choose_final" for step in row["steps"])
            if not ready and not (
                open_work and row_comparison(ctx, case_id, language).eligible
            ):
                continue
            ref = {"case_id": case_id, "language": language}
            if open_work:
                skipped.append(ref | {"reason": "open_task"})
                continue
            panel = document_row_panel.final_panel(
                conn, facts, key, case_id, language, ctx=ctx
            )
            listed = [
                item
                for item in panel["submissions"]
                if item.get("is_latest_in_round") is not False
            ]
            chosen = next(
                (
                    item
                    for item in listed
                    if item["submission_id"] == panel["all_match_submission_id"]
                ),
                None,
            )
            reason = (
                "fewer_than_two"
                if len(listed) < 2
                else "consolidation"
                if any(item["kind"] == "consolidation" for item in listed)
                else "differ"
                if chosen is None
                else None
            )
            if reason is not None:
                skipped.append(ref | {"reason": reason})
                continue
            assert chosen is not None
            texts.append(
                ref
                | {
                    "document_id": chosen["document_id"],
                    "submission_id": chosen["submission_id"],
                    "findings": chosen.get("finding_count"),
                }
            )
        for item in skipped:
            item["message"] = AGREEING_SKIPS[item["reason"]]
        digest = state_digest(
            {
                "texts": texts,
                "skipped": skipped,
                "already_final": already_final,
                "case_ids": None if case_ids is None else sorted(set(case_ids)),
            }
        )
        return {
            "project": key,
            "texts": texts,
            "skipped": skipped,
            "already_final": already_final,
            "preview_token": f"sha256:{digest}",
        }

    def accept_agreeing(
        self,
        key: str,
        *,
        preview: bool,
        preview_token: str | None,
        case_ids: list[str] | None,
    ) -> dict[str, Any]:
        """Preview, or apply all or nothing, the acceptance of every agreeing
        text (#354). Apply recomputes the preview under the exclusive project
        lock; a token that no longer matches is refused with
        ``PREVIEW_STALE`` and the fresh preview, so preview and apply give
        the same set. Each text is selected and audited like the single PUT
        (``via``: "accept_agreeing")."""
        if self.actor.user_id is None:
            raise AccessDenied(
                "NOT_ALLOWED", "Only a signed-in lead can choose final results."
            )
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key, exclusive=not preview)
            found = self._agreeing(conn, key, pid, case_ids)
            if preview:
                return found | {"applied": False}
            if preview_token != found["preview_token"]:
                raise DomainError(
                    "PREVIEW_STALE", {"preview": found | {"applied": False}}
                )
            for item in found["texts"]:
                self._select(
                    conn,
                    key,
                    pid,
                    item["document_id"],
                    item["submission_id"],
                    0,
                    [],
                    via="accept_agreeing",
                )
            return found | {"applied": True}

    def _projection(self, conn: Connection, key: str, pid: int) -> dict[str, Any]:
        return derive_final_state(conn, self.repo, key, pid)

    def preflight(self, key: str) -> dict[str, Any]:
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key, exclusive=True)
            state = self._projection(conn, key, pid)
            # For information (#338): the texts planned-out.csv would list.
            # Outside the state and its digest, like the export snapshot.
            planned_out = work_plan_store.planned_out(
                conn, pid, work_plan_store.effective_plan(conn, pid)
            )
            return {**state, "planned_out_texts": len(planned_out)}

    def _compared(
        self,
        conn: Connection,
        pid: int,
        key: str,
        selections: list[dict[str, Any]],
        closure_ids: list[str],
        round_kinds: dict[str, str],
    ) -> list[str]:
        """Other annotations of the texts accepted directly (#295).

        A text is accepted directly when its selected result is an annotation
        of its own (from scratch or a proposal check). Its closure holds that
        one submission; the other people's work on it is what its agreement
        compares. A consolidated text compares the work the consolidation
        merged, and a carried result its earlier work (both provenance), so
        neither gains compared submissions, not even work submitted after the
        consolidation. Per text and person the latest live annotation, as the
        annotation results export chooses it; none for a person the closure
        already holds on that text. Work with round inputs (carried work) is
        no annotation of its own and is left out. ``round_kinds`` gains the
        kinds of the compared submissions.
        """
        modes: dict[str, str] = dict(
            conn.execute(
                select(SubmissionRow.submission_id, SubmissionRow.mode).where(
                    SubmissionRow.project_id == pid,
                    SubmissionRow.submission_id.in_(
                        sorted(item["submission_id"] for item in selections)
                    ),
                )
            )
            .tuples()
            .all()
        )
        document_ids = {
            item["document_id"]
            for item in selections
            if submission_kind(
                {
                    "submission_id": item["submission_id"],
                    "origin_key": {"mode": modes[item["submission_id"]]},
                },
                round_kinds,
            )
            in ANNOTATION_KINDS
        }
        if not document_ids:
            return []
        rows = conn.execute(
            select(
                SubmissionRow.submission_id,
                SubmissionRow.document_id,
                SubmissionRow.annotator_id,
                SubmissionRow.recorded_at,
                SubmissionRow.payload,
            ).where(
                SubmissionRow.project_id == pid,
                SubmissionRow.document_id.in_(sorted(document_ids)),
                SubmissionRow.mode.in_(("independent", "proposal_check")),
                live_submission(),
            )
        ).all()
        closure = set(closure_ids)
        held = {
            (r.document_id, r.annotator_id) for r in rows if r.submission_id in closure
        }
        groups: dict[tuple[str, str], list[Any]] = {}
        for row in rows:
            person = (row.document_id, row.annotator_id)
            if person not in held:
                groups.setdefault(person, []).append(row)
        chosen = []
        for _person, group in sorted(groups.items()):
            recorded = {row.submission_id: row.recorded_at for row in group}
            latest = max(
                latest_submissions(Submission.model_validate(r.payload) for r in group),
                key=lambda s: (recorded[s.submission_id], s.draft_revision),
            )
            chosen.append(latest.submission_id)
        _, inputs, kinds = human_input_closure(self.repo, key, chosen)
        compared = sorted(sid for sid in chosen if not inputs.get(sid))
        round_kinds.update({sid: kinds[sid] for sid in compared if sid in kinds})
        return compared

    def _selection_inputs(
        self, conn: Connection, key: str, pid: int, state: dict[str, Any]
    ) -> dict[str, Any]:
        """Everything a final export freezes for the selections of ``state``:
        their submissions and provenance closure, the other annotations of
        texts accepted directly, the immutable content and the source reviews.
        The final export (``freeze``) and the project agreement read the same
        selection through this one method."""
        selected_ids = [item["submission_id"] for item in state["selections"]]
        closure_ids, round_inputs, round_kinds = human_input_closure(
            self.repo, key, selected_ids
        )
        compared_ids = self._compared(
            conn,
            pid,
            key,
            state["selections"],
            closure_ids,
            round_kinds,
        )
        content = self.repo.t1_export_content_exact(key, [*closure_ids, *compared_ids])
        immutable = [
            {
                "submission_id": sub.submission_id,
                "sha256": state_digest(sub.model_dump(mode="json")),
            }
            for sub in content.submissions
        ]
        review_records = {
            review["id"]: TranslationReviewRecord.model_validate(review).model_dump(
                mode="json",
                exclude={"project_id", "reviewer_user_id", "guideline_withdrawn"},
            )
            for review in conn.execute(
                select(TranslationReviewRow).where(
                    TranslationReviewRow.project_id == pid
                )
            ).mappings()
        }
        source_reviews = []
        for resolution in conn.execute(
            select(ReviewObligationResolutionRow).where(
                ReviewObligationResolutionRow.project_id == pid
            )
        ).mappings():
            record = review_records.get(resolution["payload"]["review_id"])
            if record is None:
                raise DomainError(
                    "INVALID_EXPORT_SNAPSHOT",
                    "An immutable source review is unavailable.",
                )
            source_reviews.append(
                {
                    "cause_id": resolution["cause_id"],
                    "payload": resolution["payload"],
                    "review_record": record,
                    "created_at": resolution["created_at"].isoformat(),
                }
            )
        recorded_at = {
            sid: at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            for sid, at in conn.execute(
                select(SubmissionRow.submission_id, SubmissionRow.recorded_at).where(
                    SubmissionRow.project_id == pid,
                    SubmissionRow.submission_id.in_([*closure_ids, *compared_ids]),
                )
            ).all()
        }
        project_name = conn.execute(
            select(ProjectRow.name).where(ProjectRow.id == pid)
        ).scalar_one()
        return {
            "state": state,
            "immutable_submissions": immutable,
            "content": freeze_content(content, source_reviews=source_reviews),
            "round_inputs": round_inputs,
            "round_kinds": round_kinds,
            "selected_submission_ids": selected_ids,
            # Additive (#295): other annotations of the selected texts.
            "compared_submission_ids": compared_ids,
            "project_name": project_name,
            "submission_recorded_at": recorded_at,
        }

    def agreement(self, key: str) -> dict[str, Any]:
        """Project-wide agreement of the annotations behind the current final
        selections (#353): the figures a final export would write now to
        agreement.csv and agreement-summary.csv, computed by the same code.

        Leads only, like the final export: the answer names the annotators'
        pseudonyms, which a consolidator of a project with
        ``blind_consolidation`` must not learn.
        """
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key, exclusive=False)
            state = self._projection(conn, key, pid)
            inputs = (
                self._selection_inputs(conn, key, pid, state)
                if state["selections"]
                else None
            )
        units = [] if inputs is None else agreement_units(self.db, key, inputs)
        return {
            "project": key,
            "state_digest": state["state_digest"],
            "selected_texts": len(state["selections"]),
            **agreement_report(inputs or {}, units),
        }

    def freeze(self, key: str, request: dict[str, Any]) -> dict[str, int]:
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key, exclusive=True)
            previous = (
                conn.execute(
                    select(ExportSelectionSnapshotRow).where(
                        ExportSelectionSnapshotRow.project_id == pid,
                        ExportSelectionSnapshotRow.requester_id == self.actor.user_id,
                        ExportSelectionSnapshotRow.request_id == request["request_id"],
                    )
                )
                .mappings()
                .first()
            )
            if previous:
                if previous["payload"]["request"] != request:
                    raise RevisionConflict(
                        "Export request ID was already used for another acknowledgement."
                    )
                # The job this request queued: the first of its kind for the
                # snapshot by this user. ``admin export --format phenopacket``
                # adds further jobs for the same snapshot.
                job = conn.execute(
                    select(JobRow.id)
                    .where(
                        JobRow.project_id == pid,
                        JobRow.kind == FINAL_JOB_KINDS[request.get("format", "t1")],
                        JobRow.payload["snapshot_id"].astext == previous["snapshot_id"],
                        JobRow.requested_by == self.actor.user_id,
                    )
                    .order_by(JobRow.id)
                    .limit(1)
                ).scalar_one()
                return {"job_id": job}
            # The job is inserted below, not through ``JobQueue.enqueue`` (#396).
            check_queue_room(conn, self.actor)
            state = self._projection(conn, key, pid)
            expected_warnings = [
                {"id": warning["id"], "cause_revision": warning["cause_revision"]}
                for warning in state["warnings"]
            ]

            def sort(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
                return sorted(items, key=state_digest)

            if (
                request["state_digest"] != state["state_digest"]
                or sort(request["acknowledged_warnings"]) != sort(expected_warnings)
                or sort(request["accepted_omissions"]) != sort(state["omissions"])
            ):
                raise RevisionConflict(
                    {"reason": "EXPORT_PREFLIGHT_STALE", "preflight": state}
                )
            if not state["selections"]:
                raise DomainError(
                    "EXPORT_EMPTY",
                    "Select at least one exact submitted result before final export.",
                )
            # Texts a plan change took out of annotation (#338); a final result
            # they had stays in Ontotator (``not_in_plan``) and is not exported.
            kept = {(row["case_id"], row["language"]) for row in state["not_in_plan"]}
            planned_out = [
                {
                    **item,
                    "final_result_kept": (item["case_id"], item["language"]) in kept,
                }
                for item in work_plan_store.planned_out(
                    conn, pid, work_plan_store.effective_plan(conn, pid)
                )
            ]
            payload = {
                "format": "ontotator-final-selection/v1",
                "project": key,
                "request": request,
                **self._selection_inputs(conn, key, pid, state),
                # Additive (#338): texts taken out of the work plan.
                "planned_out": planned_out,
            }
            sid = str(uuid4())
            digest = state_digest(payload)
            conn.execute(
                insert(ExportSelectionSnapshotRow).values(
                    snapshot_id=sid,
                    project_id=pid,
                    requester_id=self.actor.user_id,
                    request_id=request["request_id"],
                    sha256=digest,
                    payload=payload,
                )
            )
            job_id = conn.execute(
                insert(JobRow)
                .values(
                    kind=FINAL_JOB_KINDS[request.get("format", "t1")],
                    status="queued",
                    project_id=pid,
                    requested_by=self.actor.user_id,
                    requested_label=self.actor.label,
                    payload={
                        "project": key,
                        "snapshot_id": sid,
                        "snapshot_sha256": digest,
                    },
                )
                .returning(JobRow.id)
            ).scalar_one()
            record_audit(
                conn,
                self.actor,
                "project.final_export_requested",
                target_type="project",
                target_id=key,
                project_id=pid,
                details={
                    "job_id": job_id,
                    "snapshot_id": sid,
                    "snapshot_sha256": digest,
                },
            )
            return {"job_id": job_id}
