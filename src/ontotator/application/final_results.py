"""Lead-selected immutable results and transactional final export preflight."""

from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Connection, delete, func, insert, select, update

from ontotator.application import document_row_panel, final_change_undo
from ontotator.application.document_row_page import build_row, page_context
from ontotator.application.document_row_panel import row_comparison
from ontotator.application.document_rows import load_facts
from ontotator.application.final_causes import (
    ACKNOWLEDGEABLE_CODES,
    authorize_final_results,
    derive_final_state,
)
from ontotator.application.people import person_refs
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


def _withdrawn_revisions(
    conn: Connection, pid: int, doc: Any = None
) -> dict[tuple[str, str], int]:
    """(case, language) -> the highest revision in the text's final-selection
    events (#343); of one text with ``doc``, else of the whole project.

    The events keep every selection and withdrawal with its revision. After a
    withdrawal the slot has no row, and the next choice continues from here.
    """
    payload = FinalSelectionEventRow.payload
    case_id, language = payload["case_id"].astext, payload["language"].astext
    query = (
        select(case_id, language, func.max(payload["revision"].as_integer()))
        .where(FinalSelectionEventRow.project_id == pid)
        .group_by(case_id, language)
    )
    if doc is not None:
        query = query.where(case_id == doc.case_id, language == doc.language)
    return {(row[0], row[1]): int(row[2] or 0) for row in conn.execute(query)}


@dataclass(frozen=True)
class _Bulk:
    """What every selection of one bulk action shares, read once (#354)."""

    via: str
    rule: bool
    selected_by: str | None
    withdrawn: dict[tuple[str, str], int]


# Why accept_agreeing leaves a text out (#354), with the words the MCP tool
# and a later Documents dialog show.
AGREEING_SKIPS = {
    "open_task": "Other work on the text is still open.",
    "not_ready": "The text is not ready for a final result: nothing is"
    " submitted on its current version, or an earlier step is open.",
    "not_in_plan": "Annotation is off for this text in the work plan.",
    "fewer_than_two": "Fewer than two submissions to compare.",
    "consolidation": "The text has a consolidation; accept it on Documents.",
    # Also when only the caller's own submission would match and the project
    # does not let them accept their own work.
    "differ": "No result you may accept agrees in full; consolidate or choose"
    " on Documents.",
}


# Why bulk Change final… leaves a text as it is (issue 336, step 2), with the
# words the dialog and the MCP tool show.
CHANGE_SKIPS = {
    "no_final": "No final result yet: use Accept agreeing results… or choose"
    " one in the text card.",
    "open_task": "Other work on the text is still open.",
    "nothing_submitted": "Nothing is submitted on the current version of the text.",
    "already_newest": "The final result is already the newest submission.",
    "not_newer": "Nothing was submitted since the final result was chosen.",
    "own_result": "The newest submission is your own; in this project another"
    " lead must choose it.",
    "differ": "The submissions differ: compare or consolidate first.",
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
            text = conn.execute(
                select(DocumentRow.case_id, DocumentRow.language).where(
                    DocumentRow.project_id == pid, DocumentRow.document_id == document
                )
            ).one_or_none()
            texts = [] if text is None else [(text.case_id, text.language)]
            previous = final_change_undo.previous_finals(conn, pid, texts)
            result = self._select(
                conn,
                key,
                pid,
                document,
                submission,
                expected_revision,
                acknowledged_cause_ids,
            )
            # Another result replaced the final one: the Undo of the bulk
            # "Change final…" for this one text (same record, same rules). A
            # first choice or a result confirmed again has nothing to undo.
            before = previous.get(texts[0]) if texts else None
            replaced = before is not None and (
                before["document_id"],
                before["submission_id"],
            ) != (document, submission)
            undo = (
                final_change_undo.record_applied(
                    conn,
                    self.actor,
                    key,
                    pid,
                    [{"case_id": texts[0][0], "language": texts[0][1]}],
                    previous,
                    {texts[0]: result},
                    rule="single",
                )
                if replaced
                else None
            )
            return result | {"undo": undo}

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
        bulk: _Bulk | None = None,
    ) -> dict[str, Any]:
        """``select`` on ``conn``, which holds the exclusive project lock.
        ``bulk`` carries what a bulk action read once for all its texts and
        names it in the audit entry."""
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
        rule = (
            bulk.rule
            if bulk is not None
            else conn.execute(
                select(ProjectRow.adjudicator_not_annotator).where(ProjectRow.id == pid)
            ).scalar_one()
        )
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
        selected_by = (
            bulk.selected_by
            if bulk is not None
            else _pseudonym(conn, self.actor.user_id)
        )
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
        withdrawn = (
            {}
            if old
            else bulk.withdrawn
            if bulk is not None
            else _withdrawn_revisions(conn, pid, doc)
        )
        base = old["revision"] if old else withdrawn.get((doc.case_id, doc.language), 0)
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
            details=event if bulk is None else {**event, "via": bulk.via},
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
                # continues from it (``_withdrawn_revisions``).
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
        self,
        conn: Connection,
        key: str,
        pid: int,
        case_ids: list[str] | None,
        rows: list[RowKey] | None = None,
    ) -> dict[str, Any]:
        """Which texts accept_agreeing would make final now (#354).

        A text qualifies when it has no final result, no open work, at least
        two submissions to compare, no consolidation among its eligible
        submissions, and all findings match in full (the final panel's
        ``all_match``, notes and modifier spans included) with a submission
        the caller may accept. Every text of the scope is in exactly one of
        ``texts``, ``skipped`` (with the reason) and ``already_final`` (only
        counted: Change final… changes them); ``case_ids`` the project does
        not have are named in ``unknown_case_ids``. ``rows`` instead limits
        the scope to exactly these texts (the Documents selection, issue
        336) and names the ones that already have a final result in
        ``already_final_rows``. The submissions are read in a fixed number
        of statements, whatever the number of texts.
        """
        assert self.actor.user_id is not None
        facts = load_facts(conn, self.repo, key, pid, self.actor.user_id, scope="panel")
        ctx = page_context(facts)
        wanted = None if case_ids is None else set(case_ids)
        unknown = (
            []
            if wanted is None
            else sorted(wanted - {case_id for case_id, _ in ctx.by_row})
        )
        selected = None if rows is None else {(r.case_id, r.language) for r in rows}
        skipped: list[dict[str, Any]] = []
        candidates: list[tuple[str, str]] = []
        already_final = 0
        final_rows: list[dict[str, str]] = []
        for case_id, language in sorted(ctx.by_row):
            if wanted is not None and case_id not in wanted:
                continue
            if selected is not None and (case_id, language) not in selected:
                continue
            row = build_row(facts, case_id, language, ctx=ctx)
            ref = {"case_id": case_id, "language": language}
            if row["final"] is not None:
                already_final += 1
                if selected is not None:
                    final_rows.append(ref)
                continue
            open_work = any(
                item["status"] != "submitted" and item.get("moved_to_version") is None
                for item in row["work"]
            )
            if open_work and row_comparison(ctx, case_id, language).eligible:
                skipped.append(ref | {"reason": "open_task"})
            elif any(step["code"] == "choose_final" for step in row["steps"]):
                candidates.append((case_id, language))
            elif not row["plan_row"]["annotate"]:
                skipped.append(ref | {"reason": "not_in_plan"})
            else:
                skipped.append(ref | {"reason": "not_ready"})
        texts: list[dict[str, Any]] = []
        choices = document_row_panel.agreeing_choices(conn, pid, ctx, candidates)
        for case_id, language in candidates:
            ref = {"case_id": case_id, "language": language}
            reason, chosen = choices[(case_id, language)]
            if chosen is None:
                skipped.append(ref | {"reason": reason})
            else:
                texts.append(ref | chosen)
        skipped.sort(key=lambda item: (item["case_id"], item["language"]))
        for item in skipped:
            item["message"] = AGREEING_SKIPS[item["reason"]]
        digest = state_digest(
            {
                "texts": texts,
                "skipped": skipped,
                "already_final": already_final,
                "case_ids": None if case_ids is None else sorted(set(case_ids)),
            }
            # Without a selection the digest is the one of issue 354.
            | ({} if selected is None else {"rows": sorted(selected)})
        )
        return {
            "project": key,
            "texts": texts,
            "skipped": skipped,
            "already_final": already_final,
            "already_final_rows": final_rows,
            "unknown_case_ids": unknown,
            "preview_token": f"sha256:{digest}",
        }

    def accept_agreeing(
        self,
        key: str,
        *,
        preview: bool,
        preview_token: str | None,
        case_ids: list[str] | None,
        rows: list[RowKey] | None = None,
    ) -> dict[str, Any]:
        """Preview, or apply all or nothing, the acceptance of every agreeing
        text (#354), of ``case_ids`` or of the selected ``rows``. Apply recomputes the preview under the exclusive project
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
            found = self._agreeing(conn, key, pid, case_ids, rows)
            if preview:
                return found | {"applied": False}
            if preview_token != found["preview_token"]:
                raise DomainError(
                    "PREVIEW_STALE", {"preview": found | {"applied": False}}
                )
            bulk = self._bulk(conn, pid, "accept_agreeing")
            for item in found["texts"]:
                self._select(
                    conn,
                    key,
                    pid,
                    item["document_id"],
                    item["submission_id"],
                    0,
                    [],
                    bulk=bulk,
                )
            return found | {"applied": True}

    def _bulk(self, conn: Connection, pid: int, via: str) -> _Bulk:
        return _Bulk(
            via=via,
            rule=bool(
                conn.execute(
                    select(ProjectRow.adjudicator_not_annotator).where(
                        ProjectRow.id == pid
                    )
                ).scalar_one()
            ),
            selected_by=_pseudonym(conn, self.actor.user_id),
            withdrawn=_withdrawn_revisions(conn, pid),
        )

    def _newest(
        self,
        conn: Connection,
        key: str,
        pid: int,
        rows: list[RowKey],
        *,
        summary_only: bool,
    ) -> dict[str, Any]:
        """What bulk Change final… with the rule "newest submission" would do
        to ``rows`` now (issue 336, step 2).

        A text changes when it has a final result, no open work, and its
        newest eligible submission (the submissions the final panel offers
        on the current version: the last one of each submitted annotation
        and of each submitted consolidation) is another one than the final,
        was submitted after the final result was chosen, is one the caller
        may choose, and is a consolidation, the text's only eligible
        submission, or an annotation that agrees in full with the text's
        other eligible submissions (the rule of ``accept_agreeing``: notes,
        spans, modifiers and unresolved findings included). Submissions that
        differ and were not consolidated never replace a final result. A submission that was already there when a lead
        chose the final result never replaces it: that choice was made
        knowing it. Every other selected text is skipped
        with the reason. ``rows`` the project does not have are left out
        (``texts`` counts the ones found) and named in ``unknown_rows``. The number of statements does not
        grow with the number of texts.
        """
        assert self.actor.user_id is not None
        facts = load_facts(conn, self.repo, key, pid, self.actor.user_id, scope="panel")
        ctx = page_context(facts)
        found = [
            (row.case_id, row.language)
            for row in dict.fromkeys(rows)
            if (row.case_id, row.language) in ctx.by_row
        ]
        skipped: list[dict[str, Any]] = []
        candidates: list[tuple[tuple[str, str], dict[str, Any]]] = []
        for case_id, language in found:
            row = build_row(facts, case_id, language, ctx=ctx)
            ref = {"case_id": case_id, "language": language}
            if row["final"] is None:
                skipped.append(ref | {"reason": "no_final"})
            elif any(
                item["status"] != "submitted" and item.get("moved_to_version") is None
                for item in row["work"]
            ):
                skipped.append(ref | {"reason": "open_task"})
            else:
                candidates.append(((case_id, language), row["final"]))
        newest = document_row_panel.newest_choices(
            conn, pid, ctx, [text for text, _ in candidates]
        )
        chosen = sorted(
            found[0].submission_id for found in newest.values() if found is not None
        )
        authors: dict[str, tuple[str, int | None]] = {
            row.submission_id: (row.annotator_id, row.id)
            for row in conn.execute(
                select(
                    SubmissionRow.submission_id, SubmissionRow.annotator_id, UserRow.id
                )
                .outerjoin(UserRow, UserRow.pseudonym == SubmissionRow.annotator_id)
                .where(
                    SubmissionRow.project_id == pid,
                    SubmissionRow.submission_id.in_(chosen),
                )
            )
        }
        # An annotation among several submissions replaces the final only
        # when all of them agree in full; a consolidation compared them.
        agreeing = document_row_panel.agreeing_rows(
            conn,
            pid,
            ctx,
            [
                text
                for text, pick in newest.items()
                if pick is not None
                and pick[1] > 1
                and pick[0].consolidation_round is None
            ],
        )
        changes: list[dict[str, Any]] = []
        for (case_id, language), final in candidates:
            ref = {"case_id": case_id, "language": language}
            pick = newest[(case_id, language)]
            if pick is None:
                skipped.append(ref | {"reason": "nothing_submitted"})
                continue
            candidate, eligible, recorded_at = pick
            author, author_id = authors[candidate.submission_id]
            if candidate.submission_id == final["submission_id"]:
                skipped.append(ref | {"reason": "already_newest"})
            elif recorded_at <= final["selected_at"]:
                # The lead chose the final with this submission already there.
                skipped.append(ref | {"reason": "not_newer"})
            elif facts.adjudicator_not_annotator and author == facts.viewer_pseudonym:
                skipped.append(ref | {"reason": "own_result"})
            elif (
                candidate.consolidation_round is None
                and eligible > 1
                and (case_id, language) not in agreeing
            ):
                skipped.append(ref | {"reason": "differ"})
            else:
                versions = {
                    v.document_id: v.version for v in ctx.by_row[(case_id, language)]
                }
                changes.append(
                    ref
                    | {
                        "expected_revision": final["revision"],
                        "from_document_id": final["document_id"],
                        "from_submission_id": final["submission_id"],
                        "from_version": versions.get(final["document_id"]),
                        "document_id": candidate.document_id,
                        "submission_id": candidate.submission_id,
                        "version": versions[candidate.document_id],
                        "kind": "annotation"
                        if candidate.consolidation_round is None
                        else "consolidation",
                        "author_id": author_id,
                        "eligible_submissions": eligible,
                    }
                )
        order = {text: index for index, text in enumerate(found)}
        skipped.sort(key=lambda item: order[(item["case_id"], item["language"])])
        digest = state_digest(
            {
                "rule": "newest_submission",
                "rows": [list(text) for text in found],
                "changes": [
                    [
                        item["case_id"],
                        item["language"],
                        item["expected_revision"],
                        item["from_submission_id"],
                        item["document_id"],
                        item["submission_id"],
                    ]
                    for item in changes
                ],
                "skipped": [
                    [item["case_id"], item["language"], item["reason"]]
                    for item in skipped
                ],
            }
        )
        result: dict[str, Any] = {
            "project": key,
            "rule": "newest_submission",
            "texts": len(found),
            # Selected texts the project does not have, as they were given.
            "unknown_rows": [
                {"case_id": row.case_id, "language": row.language}
                for row in dict.fromkeys(rows)
                if (row.case_id, row.language) not in ctx.by_row
            ],
            "change_count": len(changes),
            "skipped_count": len(skipped),
            "skipped_by_reason": dict(
                sorted(Counter(item["reason"] for item in skipped).items())
            ),
            "changes": [],
            "skipped": [],
            "preview_token": f"sha256:{digest}",
        }
        if summary_only:
            return result
        people = person_refs(
            conn,
            {item["author_id"] for item in changes if item["author_id"] is not None},
            viewer_id=self.actor.user_id,
            viewer_is_lead=True,
        )
        for item in changes:
            person = people.get(item.pop("author_id"))
            item["person"] = None if person is None else person.model_dump()
        for item in skipped:
            item["message"] = CHANGE_SKIPS[item["reason"]]
        return result | {"changes": changes, "skipped": skipped}

    def change_finals(
        self,
        key: str,
        rows: list[RowKey],
        *,
        preview: bool,
        preview_token: str | None,
        summary_only: bool = False,
    ) -> dict[str, Any]:
        """Preview, or apply all or nothing, bulk Change final… with the rule
        "newest submission" for the selected texts (issue 336, step 2).

        Apply recomputes the preview under the exclusive project lock; a
        token that no longer matches is refused with ``PREVIEW_STALE`` and
        the fresh preview. The token covers the texts, the final each one
        has (its revision and submission) and the result it gets, so a final
        changed meanwhile refuses the whole action. Each text is selected
        and audited like the single PUT (``via``: "bulk_change_final"), with
        the revision of the final it replaces. An applied action returns
        ``undo``, the handle of its Undo (``final_change_undo``).
        """
        if self.actor.user_id is None:
            raise AccessDenied(
                "NOT_ALLOWED", "Only a signed-in lead can choose final results."
            )
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key, exclusive=not preview)
            found = self._newest(
                conn, key, pid, rows, summary_only=preview and summary_only
            )
            if preview:
                return found | {"applied": False, "undo": None}
            if preview_token != found["preview_token"]:
                raise DomainError(
                    "PREVIEW_STALE",
                    {"preview": found | {"applied": False, "undo": None}},
                )
            bulk = self._bulk(conn, pid, final_change_undo.VIA)
            texts = [(item["case_id"], item["language"]) for item in found["changes"]]
            previous = final_change_undo.previous_finals(conn, pid, texts)
            results = {
                text: self._select(
                    conn,
                    key,
                    pid,
                    item["document_id"],
                    item["submission_id"],
                    item["expected_revision"],
                    [],
                    bulk=bulk,
                )
                for text, item in zip(texts, found["changes"], strict=True)
            }
            undo = final_change_undo.record_applied(
                conn, self.actor, key, pid, found["changes"], previous, results
            )
            return found | {"applied": True, "undo": undo}

    def undo_change_finals(
        self, key: str, undo_id: int, *, preview: bool
    ) -> dict[str, Any]:
        """Preview, or apply all or nothing, the Undo of the bulk Change
        final… that returned ``undo_id`` (``final_change_undo``)."""
        if self.actor.user_id is None:
            raise AccessDenied(
                "NOT_ALLOWED", "Only a signed-in lead can choose final results."
            )
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key, exclusive=not preview)
            return final_change_undo.undo(
                conn, self.actor, key, pid, undo_id, preview=preview
            )

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
                exclude={
                    "project_id",
                    "reviewer_user_id",
                    "guideline_withdrawn",
                    "guideline_label",
                },
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
