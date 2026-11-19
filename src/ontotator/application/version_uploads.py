"""Upload a new version of one translation from the text card (issue 341 a).

A lead brings in a text made elsewhere (a new machine translation, a human
translation, a correction by hand) as the next version of one translation.
The new version is always a ``correction`` of the newest version of its
chain and starts "ready for review" with Review on; accepting it is the
separate, audited "Accept this version…" (issue 341 d). The work on the
previous version stays there, as after a lead correction (issue 341 b).
"""

import hashlib
from collections.abc import Mapping
from dataclasses import asdict, replace
from datetime import UTC, date, datetime
from typing import Any, Literal

from ontospan import canonical_text
from sqlalchemy import Connection, insert, select

from ontotator.application.translation_reviews import TranslationReviewService
from ontotator.application.translation_workflow import (
    TranslationWorkflowService,
    work_on_version,
)
from ontotator.assignments.eligibility import load_variants
from ontotator.assignments.service import AssignmentService, move_waiting_tasks
from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.policy import Action
from ontotator.authz.project_authority import require_project_management
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.variants import (
    VariantInfo,
    is_translation_chain,
    variant_document_id,
)
from ontotator.jobs.queue import JobQueue
from ontotator.storage.database import Database
from ontotator.storage.plan_tables import (
    DiscardedVariantRow,
    TranslationVersionUploadRow,
)
from ontotator.storage.tables import AssignmentRow, DocumentRow

UploadMethod = Literal["machine_translation", "human_translation", "manual_correction"]


def canonical_upload_text(text: str) -> str:
    """The text as stored: without a byte order mark, canonical as an import,
    and without white space at its end (a text file ends with a line break
    that is not part of the translation)."""
    return canonical_text(text.removeprefix("\ufeff")).rstrip()


def _same_text(proposed: str, previous: str) -> bool:
    """No new version: the texts differ at most in white space at the end."""
    return proposed == previous.rstrip()


class VersionUploadService:
    def __init__(self, db: Database, jobs: JobQueue):
        self.db = db
        self.jobs = jobs

    @staticmethod
    def _target(
        conn: Connection, actor: Actor, project_key: str, document_id: str
    ) -> tuple[Mapping[Any, Any], VariantInfo, dict[str, VariantInfo], str | None]:
        """The project, the version, the inventory and why no version can be
        uploaded after it (``None``: it can). Takes the project lock."""
        if actor.user_id is None:
            raise AccessDenied("NOT_ALLOWED", "Only a project lead can do this.")
        project = AssignmentService._prepare(conn, actor, project_key)
        pid = project["id"]
        # The upload adds a text to the project, as an import does.
        require_project_management(
            conn, actor, project_key, pid, Action.IMPORT_DOCUMENTS
        )
        variants = load_variants(conn, pid)
        variant = variants.get(document_id)
        if variant is None:
            raise DomainError("DOCUMENT_NOT_FOUND")
        try:
            translation = is_translation_chain(variant, variants.get)
        except ValueError as error:
            raise DomainError("VARIANT_SOURCE_UNKNOWN", str(error)) from error
        if not translation:
            # Source texts keep coming in as a package (decision 341a-F).
            raise DomainError("NOT_A_TRANSLATION", {"reason": "not_a_translation"})
        chain = [
            v.document_id
            for v in variants.values()
            if (v.external_id, v.language) == (variant.external_id, variant.language)
        ]
        newest = max(variants[item].version for item in chain)
        reason: str | None = None
        if (
            conn.execute(
                select(DiscardedVariantRow.document_id)
                .where(
                    DiscardedVariantRow.project_id == pid,
                    DiscardedVariantRow.document_id.in_(chain),
                )
                .limit(1)
            ).first()
            is not None
        ):
            reason = "discarded"
        elif variant.version != newest:
            reason = "not_newest"
        elif (
            conn.execute(
                select(AssignmentRow.id)
                .where(
                    AssignmentRow.project_id == pid,
                    AssignmentRow.document_id.in_(chain),
                    AssignmentRow.task == "translation_review",
                    AssignmentRow.revoked_at.is_(None),
                    AssignmentRow.status != "submitted",
                )
                .limit(1)
            ).first()
            is not None
        ):
            # Decision 341a-G: as the lead correction and "Accept this
            # version…", so no open review is left on an outdated version.
            reason = "review_open"
        return project, variant, variants, reason

    def preview(
        self,
        actor: Actor,
        project_key: str,
        document_id: str,
        *,
        text: str | None = None,
    ) -> dict[str, Any]:
        """Read only: what uploading a version after ``document_id`` would do.

        ``available`` with the refusal ``reason`` (``not_newest``,
        ``discarded``, ``review_open``, and with a ``text`` that equals the
        version's text ``unchanged``); the work that stays on the version
        (``work_on_version``); ``text_sha256`` is the hash the upload must
        name. With ``text``: the canonical ``text`` that would be stored and
        the ``previous_text`` to compare it with.
        """
        with self.db.transaction() as conn:
            project, variant, variants, reason = self._target(
                conn, actor, project_key, document_id
            )
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
                "unchanged": None,
            }
            if text is not None:
                proposed = canonical_upload_text(text)
                if not proposed:
                    raise DomainError("TEXT_EMPTY")
                previous = TranslationReviewService._text(conn, project["id"], variant)
                result.update(
                    text=proposed,
                    previous_text=previous,
                    unchanged=_same_text(proposed, previous),
                )
                if reason is None and result["unchanged"]:
                    reason = "unchanged"
            result.update(available=reason is None, reason=reason)
            return result

    def upload(
        self,
        actor: Actor,
        project_key: str,
        document_id: str,
        *,
        text: str,
        expected_text_sha256: str,
        method: UploadMethod,
        provider: str | None = None,
        model: str | None = None,
        made_on: date | None = None,
        made_by: str | None = None,
        note: str | None = None,
    ) -> dict[str, Any]:
        """Save ``text`` as the next version of the translation ``document_id``.

        The new version is a ``correction`` of ``document_id`` (the newest
        version of its chain), "ready for review", and the row's Review is
        turned on. Nothing is accepted here. Annotation work, consolidations
        and a final result stay on the previous version; waiting annotation
        tasks nobody opened follow the new version and tool proposals are
        re-anchored, as after an import. Refused with
        ``VERSION_UPLOAD_NOT_AVAILABLE`` (``not_newest``, ``discarded``,
        ``review_open``, ``unchanged``) and ``VARIANT_REVIEW_STALE`` when
        the previous text is not the one named.
        """
        provider, model, made_by, note = (
            (value or "").strip() or None for value in (provider, model, made_by, note)
        )
        if method == "machine_translation" and provider is None:
            # The route refuses this before; the table's check is the backstop.
            raise ValueError("A machine translation names its provider.")
        proposed = canonical_upload_text(text)
        if not proposed:
            raise DomainError("TEXT_EMPTY")
        sha = hashlib.sha256(proposed.encode("utf-8")).hexdigest()
        with self.db.transaction() as conn:
            project, variant, variants, reason = self._target(
                conn, actor, project_key, document_id
            )
            pid = project["id"]
            if reason is None and variant.text_sha256 != expected_text_sha256:
                raise DomainError("VARIANT_REVIEW_STALE")
            if reason is None and _same_text(
                proposed, TranslationReviewService._text(conn, pid, variant)
            ):
                reason = "unchanged"
            if reason is not None:
                raise DomainError("VERSION_UPLOAD_NOT_AVAILABLE", {"reason": reason})
            # A new version needs a review: Review on for the row (D26).
            TranslationWorkflowService._plan_review(conn, actor, pid, variant)
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
                translation_status="ready_for_review",
                status_reason="uploaded version",
                text_sha256=sha,
            )
            now = datetime.now(UTC)
            conn.execute(
                insert(DocumentRow).values(
                    project_id=pid, text=proposed, **asdict(child)
                )
            )
            upload_id = conn.execute(
                insert(TranslationVersionUploadRow)
                .values(
                    project_id=pid,
                    document_id=child.document_id,
                    previous_document_id=variant.document_id,
                    method=method,
                    provider=provider,
                    model=model,
                    made_on=made_on,
                    made_by=made_by,
                    note=note,
                    uploaded_by=actor.user_id,
                    uploaded_at=now,
                )
                .returning(TranslationVersionUploadRow.id)
            ).scalar_one()
            move_waiting_tasks(
                conn, actor, pid, variant.document_id, child.document_id, now
            )
            record_audit(
                conn,
                actor,
                "translation.version_uploaded",
                target_type="document",
                target_id=child.document_id,
                project_id=pid,
                details={
                    "document_id": child.document_id,
                    "previous_document_id": variant.document_id,
                    "case_id": variant.case_id,
                    "language": variant.language,
                    "version": child.version,
                    "text_sha256": sha,
                    "previous_text_sha256": variant.text_sha256,
                    "upload_id": upload_id,
                    "method": method,
                    "provider": provider,
                    "model": model,
                    "made_on": made_on.isoformat() if made_on else None,
                    "made_by": made_by,
                    "note": note,
                },
                at=now,
            )
            from ontotator.exchange.reanchor_job import enqueue_upload_pair

            enqueue_upload_pair(
                self.jobs,
                project_key,
                pid,
                variant.document_id,
                child.document_id,
                upload_id,
                actor,
            )
            return {
                "case_id": variant.case_id,
                "language": variant.language,
                "document_id": child.document_id,
                "version": child.version,
                "previous_document_id": variant.document_id,
                "previous_version": variant.version,
                "translation_status": "ready_for_review",
                "text_sha256": sha,
            }


def uploads(conn: Connection, project_id: int) -> dict[str, dict[str, Any]]:
    """The upload record per uploaded version (document id)."""
    rows = conn.execute(
        select(
            TranslationVersionUploadRow.document_id,
            TranslationVersionUploadRow.method,
            TranslationVersionUploadRow.provider,
            TranslationVersionUploadRow.model,
            TranslationVersionUploadRow.made_on,
            TranslationVersionUploadRow.made_by,
            TranslationVersionUploadRow.note,
            TranslationVersionUploadRow.uploaded_by,
            TranslationVersionUploadRow.uploaded_at,
        ).where(TranslationVersionUploadRow.project_id == project_id)
    ).mappings()
    return {row["document_id"]: dict(row) for row in rows}
