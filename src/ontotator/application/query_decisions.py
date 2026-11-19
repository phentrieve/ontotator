"""A lead decides a translation review submitted as a query (issue 483).

A reviewer who submits a review as "Query" proposes a text and asks a
question; the version stays "reviewed" and the annotation waits. The lead
closes the query in one of two ways, each with an answer the reviewer reads
at their submitted task:

``reviewer_text``: the reviewer's proposed text, as the lead confirmed it,
becomes the next version, accepted.

``unchanged``: the version is accepted as it is.

Both are recorded as the lead's decision on the query
(``translation_query_decisions``), not as an acceptance "reviewed outside
Ontotator". They share the preconditions of "Fix typos…" (the newest version
of its chain, not discarded, no open translation review, a lead of the
project).
"""

import hashlib
from collections.abc import Collection, Mapping
from dataclasses import asdict, replace
from datetime import UTC, datetime
from typing import Any, Literal

from ontospan import canonical_text
from sqlalchemy import Connection, RowMapping, insert, select, update

from ontotator.application.editorial_corrections import EditorialCorrectionService
from ontotator.application.translation_reviews import TranslationReviewService
from ontotator.application.translation_workflow import work_on_version
from ontotator.assignments.service import move_waiting_tasks
from ontotator.auth.audit import Actor, record_audit
from ontotator.domain.errors import DomainError
from ontotator.domain.variants import VariantInfo, variant_document_id
from ontotator.jobs.queue import JobQueue
from ontotator.storage.database import Database
from ontotator.storage.plan_tables import EditorialCorrectionRow, QueryDecisionRow
from ontotator.storage.tables import DocumentRow, TranslationReviewRow

REFUSED = "QUERY_DECISION_NOT_AVAILABLE"
QueryDecisionKind = Literal["reviewer_text", "unchanged"]


def governing_review(
    conn: Connection, project_id: int, document_id: str
) -> RowMapping | None:
    """The latest translation review that decides ``document_id``: its own,
    else (a typo fix has no review of its own) the one of the version it
    fixes."""
    current = document_id
    seen: set[str] = set()
    while current not in seen:
        seen.add(current)
        review = (
            conn.execute(
                select(TranslationReviewRow)
                .where(
                    TranslationReviewRow.project_id == project_id,
                    TranslationReviewRow.document_id == current,
                )
                .order_by(
                    TranslationReviewRow.created_at.desc(),
                    TranslationReviewRow.id.desc(),
                )
                .limit(1)
            )
            .mappings()
            .first()
        )
        if review is not None:
            return review
        previous = conn.execute(
            select(EditorialCorrectionRow.previous_document_id).where(
                EditorialCorrectionRow.project_id == project_id,
                EditorialCorrectionRow.document_id == current,
            )
        ).scalar_one_or_none()
        if previous is None:
            return None
        current = previous
    return None


def query_decisions(conn: Connection, project_id: int) -> dict[str, dict[str, Any]]:
    """The lead's query decision per accepted version (document id)."""
    rows = conn.execute(
        select(
            QueryDecisionRow.accepted_document_id,
            QueryDecisionRow.document_id,
            QueryDecisionRow.review_id,
            QueryDecisionRow.kind,
            QueryDecisionRow.answer,
            QueryDecisionRow.edited,
            QueryDecisionRow.decided_by,
            QueryDecisionRow.decided_at,
            TranslationReviewRow.document_id.label("reviewed_document_id"),
            TranslationReviewRow.assignment_id,
        )
        .join(
            TranslationReviewRow,
            TranslationReviewRow.id == QueryDecisionRow.review_id,
        )
        .where(QueryDecisionRow.project_id == project_id)
    ).mappings()
    return {row["accepted_document_id"]: dict(row) for row in rows}


def decisions_of_reviews(
    conn: Connection, review_ids: Collection[int]
) -> dict[int, dict[str, Any]]:
    """The lead's decision per decided review (review id), with the version
    number of the accepted version, for the reviewer's submitted task."""
    if not review_ids:
        return {}
    rows = conn.execute(
        select(
            QueryDecisionRow.review_id,
            QueryDecisionRow.kind,
            QueryDecisionRow.answer,
            QueryDecisionRow.edited,
            QueryDecisionRow.decided_at,
            DocumentRow.version.label("accepted_version"),
        )
        .join(
            DocumentRow,
            (DocumentRow.project_id == QueryDecisionRow.project_id)
            & (DocumentRow.document_id == QueryDecisionRow.accepted_document_id),
        )
        .where(QueryDecisionRow.review_id.in_(sorted(review_ids)))
    ).mappings()
    return {
        row["review_id"]: {k: v for k, v in row.items() if k != "review_id"}
        for row in rows
    }


class QueryDecisionService:
    def __init__(self, db: Database, jobs: JobQueue):
        self.db = db
        self.jobs = jobs

    @staticmethod
    def _target(
        conn: Connection, actor: Actor, project_key: str, document_id: str
    ) -> tuple[
        Mapping[Any, Any],
        VariantInfo,
        dict[str, VariantInfo],
        RowMapping | None,
        str | None,
    ]:
        """The project, the version, the inventory, the review that decides
        the version and why the lead cannot decide a query here (``None``:
        they can). For a lead of the project only; takes the project lock."""
        project, variant, variants, reason = EditorialCorrectionService._target(
            conn, actor, project_key, document_id
        )
        pid = project["id"]
        review = governing_review(conn, pid, document_id)
        decided = review is not None and (
            conn.execute(
                select(QueryDecisionRow.id).where(
                    QueryDecisionRow.review_id == review["id"]
                )
            ).first()
            is not None
        )
        if decided:
            # Before "not_newest": the reviewer's text is already a version.
            reason = "already_decided"
        elif reason is None and (
            review is None
            or review["decision"] != "query"
            or variant.translation_status != "reviewed"
        ):
            reason = "not_a_query"
        return project, variant, variants, review, reason

    def preview(
        self, actor: Actor, project_key: str, document_id: str
    ) -> dict[str, Any]:
        """Read only: the query the lead decides at ``document_id``.

        ``available`` with the refusal ``reason``: ``already_decided``,
        ``discarded``, ``not_newest``, ``review_open``, ``not_a_query``.
        ``text`` is the version's text and ``text_sha256`` the hash the
        decision must name; ``review`` is the querying review with the
        reviewer's ``proposed_text`` (``None`` without one);
        ``proposes_changes`` says whether that text differs from the
        version's. The work on the version is counted as for a lead
        correction: it stays there when the reviewer's text becomes the next
        version.
        """
        with self.db.transaction() as conn:
            project, variant, variants, review, reason = self._target(
                conn, actor, project_key, document_id
            )
            text = TranslationReviewService._text(conn, project["id"], variant)
            query = (
                review if review is not None and review["decision"] == "query" else None
            )
            reviewed = variants.get(query["document_id"]) if query is not None else None
            return {
                "document_id": document_id,
                "case_id": variant.case_id,
                "language": variant.language,
                "version": variant.version,
                "translation_status": variant.translation_status,
                "text_sha256": variant.text_sha256,
                "text": text,
                "available": reason is None,
                "reason": reason,
                "review": None
                if query is None
                else {
                    "id": query["id"],
                    "assignment_id": query["assignment_id"],
                    "document_id": query["document_id"],
                    "version": reviewed.version if reviewed else variant.version,
                    "rationale": query["rationale"],
                    "categories": list(query["categories"]),
                    "proposed_text": query["proposed_text"],
                    "created_at": query["created_at"],
                },
                "proposes_changes": query is not None
                and canonical_text(query["proposed_text"]) != text,
                **work_on_version(conn, project, variant, variants),
            }

    def decide(
        self,
        actor: Actor,
        project_key: str,
        document_id: str,
        *,
        kind: QueryDecisionKind,
        expected_text_sha256: str,
        expected_review_id: int,
        text: str | None = None,
        answer: str | None = None,
    ) -> dict[str, Any]:
        """Close the query on ``document_id`` as the lead's decision.

        ``reviewer_text``: ``text`` (the reviewer's proposed text, as the lead
        confirmed it) becomes the next version, a ``correction`` of
        ``document_id``, accepted; waiting annotation tasks follow it and
        tool proposals are re-anchored, as after a corrected review.
        ``unchanged``: ``document_id`` is accepted as it is; an ``answer`` is
        required. Refused with ``QUERY_DECISION_NOT_AVAILABLE`` and a
        ``reason`` (see ``preview``; ``answer_required``; ``unchanged`` for a
        text equal to the version's), and with ``VARIANT_REVIEW_STALE`` when
        the version's text or the querying review is not the one named.
        """
        said = (answer or "").strip() or None
        if kind == "unchanged" and said is None:
            raise DomainError(REFUSED, {"reason": "answer_required"})
        if (kind == "reviewer_text") != (text is not None):
            # The route validates this; a caller naming it wrongly is a bug.
            raise ValueError("A text goes with reviewer_text only")
        with self.db.transaction() as conn:
            project, variant, variants, review, refused = self._target(
                conn, actor, project_key, document_id
            )
            pid = project["id"]
            if refused is not None:
                raise DomainError(REFUSED, {"reason": refused})
            assert review is not None
            if (
                variant.text_sha256 != expected_text_sha256
                or review["id"] != expected_review_id
            ):
                raise DomainError("VARIANT_REVIEW_STALE")
            now = datetime.now(UTC)
            accepted = variant
            edited = False
            if text is not None:
                previous = TranslationReviewService._text(conn, pid, variant)
                proposed = canonical_text(text.removeprefix("﻿"))
                if not proposed.strip():
                    raise DomainError("TEXT_EMPTY")
                if proposed == previous:
                    raise DomainError(REFUSED, {"reason": "unchanged"})
                edited = proposed != canonical_text(review["proposed_text"])
                accepted = replace(
                    variant,
                    document_id=variant_document_id(
                        variant.external_id,
                        variant.language,
                        variant.version + 1,
                        set(variants),
                    ),
                    version=variant.version + 1,
                    origin="correction",
                    derived_from=variant.document_id,
                    translation=None,
                    translation_status="accepted",
                    status_reason=f"query decision on translation review {review['id']}",
                    text_sha256=hashlib.sha256(proposed.encode("utf-8")).hexdigest(),
                )
                conn.execute(
                    insert(DocumentRow).values(
                        project_id=pid, text=proposed, **asdict(accepted)
                    )
                )
            else:
                conn.execute(
                    update(DocumentRow)
                    .where(
                        DocumentRow.project_id == pid,
                        DocumentRow.document_id == document_id,
                    )
                    .values(
                        translation_status="accepted",
                        status_reason=(
                            f"query decision on translation review {review['id']}"
                        ),
                    )
                )
            decision_id = conn.execute(
                insert(QueryDecisionRow)
                .values(
                    project_id=pid,
                    review_id=review["id"],
                    document_id=document_id,
                    accepted_document_id=accepted.document_id,
                    kind=kind,
                    answer=said,
                    edited=edited,
                    decided_by=actor.user_id,
                    decided_at=now,
                )
                .returning(QueryDecisionRow.id)
            ).scalar_one()
            if accepted is not variant:
                # After the insert of the accepted version: the waiting tasks
                # open on it.
                move_waiting_tasks(
                    conn, actor, pid, document_id, accepted.document_id, now
                )
            record_audit(
                conn,
                actor,
                "translation.query_decided",
                target_type="document",
                target_id=accepted.document_id,
                project_id=pid,
                details={
                    "document_id": accepted.document_id,
                    "decided_document_id": document_id,
                    "case_id": variant.case_id,
                    "language": variant.language,
                    "kind": kind,
                    "decision_id": decision_id,
                    "review_id": review["id"],
                    "reviewed_document_id": review["document_id"],
                    "reviewer_assignment_id": review["assignment_id"],
                    "version": accepted.version,
                    "status_before": variant.translation_status,
                    "status_after": "accepted",
                    "text_sha256": accepted.text_sha256,
                    "previous_text_sha256": variant.text_sha256,
                    "edited": edited,
                    "answer": said,
                },
                at=now,
            )
            if accepted is not variant:
                from ontotator.exchange.reanchor_job import enqueue_query_decision_pair

                enqueue_query_decision_pair(
                    self.jobs,
                    project_key,
                    pid,
                    document_id,
                    accepted.document_id,
                    decision_id,
                    actor,
                )
            return {
                "case_id": variant.case_id,
                "language": variant.language,
                "kind": kind,
                "document_id": accepted.document_id,
                "version": accepted.version,
                "decided_document_id": document_id,
                "decided_version": variant.version,
                "translation_status": "accepted",
                "text_sha256": accepted.text_sha256,
                "edited": edited,
            }
