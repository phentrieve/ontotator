"""Editorial correction of a translation version by a lead (issue 453).

A lead fixes spacing, typos or grammar in the newest version of a
translation without a translation review. The fix becomes the next version:
a ``correction`` of the version it fixes with that version's translation
status: an accepted text stays accepted, a rejected one stays rejected. It
shares the preconditions of "Upload new version…" (issue 341 a). The size
of the change is reported, and a change of a number is pointed out
(``number_changes``); neither is refused.
"""

import hashlib
import re
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from itertools import pairwise, zip_longest
from typing import Any

from ontospan import canonical_text
from sqlalchemy import Connection, func, insert, select

from ontotator.application.translation_reviews import TranslationReviewService
from ontotator.application.translation_workflow import work_on_version
from ontotator.application.version_uploads import VersionUploadService
from ontotator.assignments.service import move_waiting_tasks, unopened_tasks
from ontotator.auth.audit import Actor, record_audit
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.reanchor import NeedsReview, reanchor_annotation, text_map
from ontotator.domain.variants import VariantInfo, variant_document_id
from ontotator.jobs.queue import JobQueue
from ontotator.storage.database import Database
from ontotator.storage.plan_tables import EditorialCorrectionRow
from ontotator.storage.repository import Repository
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectMembershipRow,
)

REFUSED = "EDITORIAL_CORRECTION_NOT_AVAILABLE"
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")


def number_changes(old: str, new: str) -> list[dict[str, str | None]]:
    """The numbers a correction changes, adds (``old`` is ``None``) or removes
    (``new`` is ``None``), in text order. A notice for the lead, not a guard:
    typos happen in numbers too."""
    before, after = _NUMBER.findall(old), _NUMBER.findall(new)
    start = 0
    while start < min(len(before), len(after)) and before[start] == after[start]:
        start += 1
    end = 0
    while (
        end < min(len(before), len(after)) - start
        and before[-1 - end] == after[-1 - end]
    ):
        end += 1
    # What lies between the equal numbers at both ends, paired in order.
    return [
        {"old": was, "new": now}
        for was, now in zip_longest(
            before[start : len(before) - end], after[start : len(after) - end]
        )
    ]


@dataclass(frozen=True)
class Change:
    """One changed passage: ``old_text`` at ``[old_start, old_end)`` of the
    corrected version became ``new_text`` at ``[new_start, new_end)``
    (Unicode code points)."""

    old_start: int
    old_end: int
    new_start: int
    new_end: int
    old_text: str
    new_text: str


def changes(old: str, new: str) -> list[Change]:
    """The changed passages between ``old`` and ``new``, by the text diff
    that also re-anchors annotations (``text_map``)."""
    found: list[Change] = []
    a = b = 0
    for old_at, new_at, length in (*text_map(old, new).blocks, (len(old), len(new), 0)):
        if old_at > a or new_at > b:
            found.append(Change(a, old_at, b, new_at, old[a:old_at], new[b:new_at]))
        a, b = old_at + length, new_at + length
    return found


def apply_replacements(text: str, replacements: Sequence[Mapping[str, str]]) -> str:
    """``text`` with every ``old`` replaced by its ``new``.

    Each ``old`` occurs exactly once in ``text`` and no two of them overlap;
    otherwise the correction is refused with the index of the replacement
    (``replacement_not_found``, ``replacement_ambiguous``,
    ``replacements_overlap``).
    """
    spans: list[tuple[int, int, str, int]] = []
    for index, item in enumerate(replacements):
        old = item["old"]
        starts: list[int] = []
        at = text.find(old) if old else -1
        while at >= 0 and len(starts) < 2:
            starts.append(at)
            at = text.find(old, at + 1)
        if len(starts) != 1:
            raise DomainError(
                REFUSED,
                {
                    "reason": "replacement_ambiguous"
                    if starts
                    else "replacement_not_found",
                    "index": index,
                },
            )
        spans.append((starts[0], starts[0] + len(old), item["new"], index))
    spans.sort()
    for (_, end, _, _), (start, _, _, index) in pairwise(spans):
        if start < end:
            raise DomainError(
                REFUSED, {"reason": "replacements_overlap", "index": index}
            )
    parts: list[str] = []
    at = 0
    for start, end, new, _ in spans:
        parts += [text[at:start], new]
        at = end
    return "".join([*parts, text[at:]])


class EditorialCorrectionService:
    def __init__(self, db: Database, jobs: JobQueue):
        self.db = db
        self.jobs = jobs

    @staticmethod
    def _target(
        conn: Connection, actor: Actor, project_key: str, document_id: str
    ) -> tuple[Mapping[Any, Any], VariantInfo, dict[str, VariantInfo], str | None]:
        """The target of "Upload new version…" (a translation, the newest
        version of its chain, not discarded, no open translation review), for
        a lead of the project only."""
        project, variant, variants, reason = VersionUploadService._target(
            conn, actor, project_key, document_id
        )
        if "lead" not in set(
            conn.execute(
                select(ProjectMembershipRow.role).where(
                    ProjectMembershipRow.project_id == project["id"],
                    ProjectMembershipRow.user_id == actor.user_id,
                )
            ).scalars()
        ):
            raise AccessDenied("NOT_ALLOWED", "Only a project lead can do this.")
        return project, variant, variants, reason

    @staticmethod
    def _proposed(
        previous: str,
        text: str | None,
        replacements: Sequence[Mapping[str, str]] | None,
    ) -> str:
        if (text is None) == (replacements is None):
            # The route validates this; a caller naming neither or both is a bug.
            raise ValueError("Give either the text or replacements")
        if replacements is not None:
            text = apply_replacements(previous, replacements)
        assert text is not None
        proposed = canonical_text(text.removeprefix("﻿"))
        if not proposed.strip():
            raise DomainError("TEXT_EMPTY")
        return proposed

    @staticmethod
    def _change(previous: str, proposed: str) -> dict[str, Any]:
        """The changed passages, their size and the numbers that change."""
        found = changes(previous, proposed)
        inserted = sum(len(item.new_text) for item in found)
        deleted = sum(len(item.old_text) for item in found)
        return {
            "inserted_characters": inserted,
            "deleted_characters": deleted,
            "changed_characters": inserted + deleted,
            "number_changes": number_changes(previous, proposed),
            "diff": [asdict(item) for item in found],
        }

    def _consequences(
        self,
        conn: Connection,
        project: Mapping[Any, Any],
        variant: VariantInfo,
        previous: str,
        proposed: str | None,
    ) -> dict[str, Any]:
        """What follows the new version and what stays for a check.

        ``tasks_following``: annotation tasks nobody opened, which move to the
        new version. With a text, ``findings`` counts the findings of the
        submitted annotations on this version and how many of them the
        text-change steps could not place (``needs_check``), and ``proposals``
        the tool proposals that are carried and the ones left for a check.
        """
        pid = project["id"]
        following = conn.execute(
            select(func.count())
            .select_from(AssignmentRow)
            .where(*unopened_tasks(pid, variant.document_id))
        ).scalar_one()
        result: dict[str, Any] = {
            "tasks_following": following,
            "findings": None,
            "proposals": None,
        }
        if proposed is None:
            return result
        from ontotator.application.text_changes import (
            editable_findings,
            unplaced_findings,
        )
        from ontotator.exchange.reanchor_job import reanchor_sources

        repo = Repository(self.db)
        key = project["project_key"]
        profile = repo.get_task_profile(key)
        submitted = conn.execute(
            select(AssignmentRow.last_submission_id).where(
                AssignmentRow.project_id == pid,
                AssignmentRow.document_id == variant.document_id,
                AssignmentRow.task == "annotate",
                AssignmentRow.revoked_at.is_(None),
                AssignmentRow.status == "submitted",
                AssignmentRow.last_submission_id.is_not(None),
            )
        ).scalars()
        total = unplaced = 0
        for submission_id in submitted:
            submission = (
                repo.get_submission(submission_id, key) if submission_id else None
            )
            if submission is None:
                continue
            findings = editable_findings(submission.snapshots, profile)
            total += len(findings)
            unplaced += len(unplaced_findings(findings, previous, proposed))
        result["findings"] = {"submitted": total, "needs_check": unplaced}
        mapping = text_map(previous, proposed)
        sources = reanchor_sources(conn, pid, variant.document_id)
        outcomes = [
            isinstance(
                reanchor_annotation(item, item.evidence, previous, proposed, mapping),
                NeedsReview,
            )
            for source in sources
            for item in source.annotations
        ]
        result["proposals"] = {
            "sets": len(sources),
            "carried": outcomes.count(False),
            "needs_check": outcomes.count(True),
        }
        return result

    def preview(
        self,
        actor: Actor,
        project_key: str,
        document_id: str,
        *,
        text: str | None = None,
        replacements: Sequence[Mapping[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Read only: what an editorial correction of ``document_id`` would do.

        ``available`` with the refusal ``reason``: ``not_newest``,
        ``discarded``, ``review_open`` and, with a text or replacements that
        change nothing, ``unchanged``. ``text_sha256`` is the hash the
        correction must name; ``translation_status`` is the status the new
        version would get (the one of this version). With a text or
        replacements: the ``text`` that would be stored, the
        ``previous_text``, the ``diff``, the size of the change and the
        numbers it changes (``number_changes``, a notice only). Replacements
        that do not apply are refused as in ``correct``.
        """
        with self.db.transaction() as conn:
            project, variant, variants, reason = self._target(
                conn, actor, project_key, document_id
            )
            previous = TranslationReviewService._text(conn, project["id"], variant)
            result: dict[str, Any] = {
                "document_id": document_id,
                "case_id": variant.case_id,
                "language": variant.language,
                "version": variant.version,
                "translation_status": variant.translation_status,
                "text_sha256": variant.text_sha256,
                **work_on_version(conn, project, variant, variants),
                "text": None,
                "previous_text": None,
                "new_text_sha256": None,
                "inserted_characters": None,
                "deleted_characters": None,
                "changed_characters": None,
                "number_changes": None,
                "diff": None,
            }
            proposed = None
            if text is not None or replacements is not None:
                proposed = self._proposed(previous, text, replacements)
                change = self._change(previous, proposed)
                result.update(
                    change,
                    text=proposed,
                    previous_text=previous,
                    new_text_sha256=hashlib.sha256(
                        proposed.encode("utf-8")
                    ).hexdigest(),
                )
                if reason is None and not change["diff"]:
                    reason = "unchanged"
            result.update(
                self._consequences(conn, project, variant, previous, proposed),
                available=reason is None,
                reason=reason,
            )
            return result

    def correct(
        self,
        actor: Actor,
        project_key: str,
        document_id: str,
        *,
        expected_text_sha256: str,
        reason: str,
        text: str | None = None,
        replacements: Sequence[Mapping[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Save the corrected text as the next version of ``document_id``.

        The new version is a ``correction`` of ``document_id`` with its
        translation status; the corrected version keeps its status, as after
        a lead correction or an upload. Annotation tasks nobody opened follow
        the new version; started and submitted work, consolidations and a
        final result stay on the corrected version for the text-change steps;
        tool proposals are re-anchored, as after a review. Refused with
        ``EDITORIAL_CORRECTION_NOT_AVAILABLE`` and a ``reason`` (see
        ``preview``, and ``reason_required``), with ``VARIANT_REVIEW_STALE``
        when the corrected text is not the one named, and with
        ``NOT_A_TRANSLATION`` for a source text.
        """
        why = reason.strip()
        if not why:
            raise DomainError(REFUSED, {"reason": "reason_required"})
        with self.db.transaction() as conn:
            project, variant, variants, refused = self._target(
                conn, actor, project_key, document_id
            )
            pid = project["id"]
            if refused is not None:
                raise DomainError(REFUSED, {"reason": refused})
            if variant.text_sha256 != expected_text_sha256:
                raise DomainError("VARIANT_REVIEW_STALE")
            previous = TranslationReviewService._text(conn, pid, variant)
            proposed = self._proposed(previous, text, replacements)
            change = self._change(previous, proposed)
            if not change["diff"]:
                raise DomainError(REFUSED, {"reason": "unchanged"})
            sha = hashlib.sha256(proposed.encode("utf-8")).hexdigest()
            child = replace(
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
                # Inherited: an accepted text stays accepted without a review,
                # a rejected or queried one stays so (its decision is read
                # through ``inherited_review_decisions``).
                translation_status=variant.translation_status,
                status_reason="editorial correction",
                text_sha256=sha,
            )
            now = datetime.now(UTC)
            conn.execute(
                insert(DocumentRow).values(
                    project_id=pid, text=proposed, **asdict(child)
                )
            )
            correction_id = conn.execute(
                insert(EditorialCorrectionRow)
                .values(
                    project_id=pid,
                    document_id=child.document_id,
                    previous_document_id=variant.document_id,
                    reason=why,
                    inserted_characters=change["inserted_characters"],
                    deleted_characters=change["deleted_characters"],
                    corrected_by=actor.user_id,
                    corrected_at=now,
                )
                .returning(EditorialCorrectionRow.id)
            ).scalar_one()
            following = conn.execute(
                select(func.count())
                .select_from(AssignmentRow)
                .where(*unopened_tasks(pid, variant.document_id))
            ).scalar_one()
            move_waiting_tasks(
                conn,
                actor,
                pid,
                variant.document_id,
                child.document_id,
                now,
                waiting_only=False,
            )
            record_audit(
                conn,
                actor,
                "translation.editorial_correction",
                target_type="document",
                target_id=child.document_id,
                project_id=pid,
                details={
                    "document_id": child.document_id,
                    "previous_document_id": variant.document_id,
                    "case_id": variant.case_id,
                    "language": variant.language,
                    "version": child.version,
                    "translation_status": child.translation_status,
                    "text_sha256": sha,
                    "previous_text_sha256": variant.text_sha256,
                    "correction_id": correction_id,
                    "reason": why,
                    "inserted_characters": change["inserted_characters"],
                    "deleted_characters": change["deleted_characters"],
                    "diff": change["diff"],
                    "number_changes": change["number_changes"],
                    "tasks_following": following,
                },
                at=now,
            )
            from ontotator.exchange.reanchor_job import enqueue_editorial_pair

            enqueue_editorial_pair(
                self.jobs,
                project_key,
                pid,
                variant.document_id,
                child.document_id,
                correction_id,
                actor,
            )
            return {
                "case_id": variant.case_id,
                "language": variant.language,
                "document_id": child.document_id,
                "version": child.version,
                "previous_document_id": variant.document_id,
                "previous_version": variant.version,
                "translation_status": child.translation_status,
                "text_sha256": sha,
                "inserted_characters": change["inserted_characters"],
                "deleted_characters": change["deleted_characters"],
                "tasks_following": following,
            }


def editorial_corrections(
    conn: Connection, project_id: int
) -> dict[str, dict[str, Any]]:
    """The editorial correction record per corrected version (document id)."""
    rows = conn.execute(
        select(
            EditorialCorrectionRow.document_id,
            EditorialCorrectionRow.previous_document_id,
            EditorialCorrectionRow.reason,
            EditorialCorrectionRow.inserted_characters,
            EditorialCorrectionRow.deleted_characters,
            EditorialCorrectionRow.corrected_by,
            EditorialCorrectionRow.corrected_at,
        ).where(EditorialCorrectionRow.project_id == project_id)
    ).mappings()
    return {row["document_id"]: dict(row) for row in rows}
