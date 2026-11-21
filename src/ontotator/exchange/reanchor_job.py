"""Durable, source-associated reanchoring of same-language correction proposals."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

import ontospan
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import Connection, and_, func, select, update

from ontotator.auth.audit import Actor, record_audit
from ontotator.auth.authority import lock_user_authority
from ontotator.authz.policy import Action
from ontotator.authz.project_authority import require_project_management
from ontotator.authz.visibility import qualifying_assignment
from ontotator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationSnapshot,
    Provenance,
    snapshot,
)
from ontotator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontotator.domain.errors import DomainError
from ontotator.domain.profiles import TaskProfile
from ontotator.domain.reanchor import NeedsReview, reanchor_annotation, text_map
from ontotator.domain.serialization import decode_snapshot
from ontotator.domain.variants import VariantInfo
from ontotator.exchange.t1 import (
    ImportedProposals,
    ImportedSet,
    Pin,
    _axes,
    _mentions,
    _method,
    document_to_t1,
    layers_for,
)
from ontotator.jobs.queue import Job, JobContext, JobQueue, handler_payload
from ontotator.storage.database import Database
from ontotator.storage.reanchor_credit import credited_actors, is_legacy_reanchor_actor
from ontotator.storage.repository import Repository, _lock_id
from ontotator.storage.tables import (
    AnnotationSnapshotRow,
    AssignmentRow,
    JobRow,
    ProjectRow,
    ProposalAnnotationRow,
    ProposalSetRow,
    TranslationReviewRow,
)


@dataclass(frozen=True)
class ReanchorSource:
    row_id: int
    annotation_set_id: str
    bundle_id: str | None
    payload: dict[str, Any]
    annotations: tuple[AnnotationSnapshot, ...]
    notes: dict[str, list[str]]
    # The actors the source set is credited to (#417): the stored payload
    # actors, or for a legacy re-anchored source the tool of its own source.
    actors: tuple[dict[str, Any], ...] | None = None
    actor_alias: Mapping[str, str] = field(default_factory=dict)

    def credited_actors(self) -> list[ontospan.Actor]:
        stored = (
            self.actors
            if self.actors is not None
            else tuple(self.payload.get("actors", []))
        )
        return [ontospan.Actor.model_validate(actor) for actor in stored]


def pending_payload(item: NeedsReview) -> dict[str, Any]:
    """Task4 ReanchorItem supplies proposal_set_id and computed flat old_segments."""
    if any(
        span.start < 0
        or span.end <= span.start
        or len(span.text) != span.end - span.start
        for span in item.old_segments
    ):
        raise DomainError("T1_INVALID", {"codes": ["invalid_source_anchor"]})
    payload: dict[str, Any] = {
        "source_ref": item.source_ref.model_dump(mode="json"),
        "term_id": item.term_id,
        "layer_id": item.layer_id,
        "reason": item.reason,
        "old_mentions": [
            {
                "source_ref": mention.source_ref.model_dump(mode="json"),
                "segments": [asdict(s) for s in mention.segments],
                "cue_segments": [asdict(s) for s in mention.cue_segments],
            }
            for mention in item.old_mentions
        ],
        "old_context": asdict(item.old_context),
        "new_context": asdict(item.new_context),
        "diff": [asdict(op) for op in item.diff],
    }
    if item.old_modifiers:  # absent while empty, so stored items stay equal
        payload["old_modifiers"] = [
            {"term_id": m.term_id, "segments": [asdict(s) for s in m.segments]}
            for m in item.old_modifiers
        ]
    return payload


def original_urn(source: ReanchorSource, annotation_id: str) -> str:
    try:
        ontospan.parse_annotation_ref(annotation_id)
    except ValueError:
        return ontospan.annotation_ref(
            source.annotation_set_id, annotation_id, source.bundle_id
        )
    return annotation_id


def rebuild_source(
    project: str,
    source: ReanchorSource,
    old: Document,
    target: Document,
    profile: TaskProfile,
    pins: Mapping[str, Pin],
    *,
    created_at: datetime,
    variant: VariantInfo | None = None,
    source_variant_hashes: Mapping[str, str] | None = None,
) -> tuple[ImportedSet | None, ontospan.AnnotatedDocument | None]:
    """Construct real target snapshots and their complete T1 set, never relabel hashes."""
    if not source.annotations:
        return None, None
    set_id = f"{project}:reanchor:{target.document_id}:{source.row_id}"
    # The copy keeps the producer of the source set (#417): the re-anchoring
    # is recorded by the set's origin and each proposal's source_refs.
    set_actors = source.credited_actors()
    if not set_actors:  # a source without stored actors: its proposals' own
        for item in source.annotations:
            ref = item.annotation.provenance.actor
            actor_id = source.actor_alias.get(ref.actor_id, ref.actor_id)
            if all(actor.actor_id != actor_id for actor in set_actors):
                set_actors.append(ontospan.Actor(actor_id=actor_id, kind=ref.kind))
    by_id = {actor.actor_id: actor for actor in set_actors}
    mapped = text_map(old.text, target.text)
    annotations: list[AnnotationSnapshot] = []
    evidence: list[EvidenceSnapshot] = []
    notes: dict[str, list[str]] = {}
    pending: list[dict[str, Any]] = []
    delivered: list[ontospan.Annotation] = []
    defaulted_axes = 0
    for index, original in enumerate(source.annotations, 1):
        result = reanchor_annotation(
            original, original.evidence, old.text, target.text, mapped
        )
        if isinstance(result, NeedsReview):
            pending.append(pending_payload(result))
            continue
        local_id = f"a{index}"
        annotation_id = ontospan.annotation_ref(set_id, local_id)
        own_evidence = []
        for mention_index, mention in enumerate(result.evidence):
            value = EvidenceMention(
                evidence_id=f"{annotation_id}#m{mention_index}",
                segments=[Segment(start=s.start, end=s.end) for s in mention.segments],
                cue_segments=[
                    Segment(start=s.start, end=s.end) for s in mention.cue_segments
                ],
            )
            own_evidence.append(EvidenceSnapshot.create(value, target))
        origin = original_urn(source, original.annotation.annotation_id)
        produced = original.annotation.provenance
        actor_id = source.actor_alias.get(
            produced.actor.actor_id, produced.actor.actor_id
        )
        actor = by_id.get(actor_id)
        if actor is None:
            actor = ontospan.Actor(actor_id=actor_id, kind=produced.actor.kind)
            by_id[actor_id] = actor
            set_actors.append(actor)
        method = produced.method
        annotation = Annotation(
            annotation_id=annotation_id,
            document_id=target.document_id,
            layer_id=original.annotation.layer_id,
            type_id=original.annotation.type_id,
            term_id=original.annotation.term_id,
            axes_values=dict(original.annotation.axes_values),
            axes_defaulted=list(original.annotation.axes_defaulted),
            evidence_refs=[
                EvidenceRef(evidence_id=e.mention.evidence_id, version=e.version)
                for e in own_evidence
            ],
            modifiers=result.target_modifiers,
            provenance=Provenance(
                actor=ActorRef(actor_id=actor.actor_id, kind=actor.kind),
                method=method,
                source_refs=[origin],
            ),
        )
        rebuilt = snapshot(annotation, own_evidence, target, profile)
        annotations.append(rebuilt)
        evidence.extend(own_evidence)
        own_notes = list(source.notes.get(original.annotation.annotation_id, []))
        notes[annotation_id] = own_notes
        layer = next(
            layer for layer in profile.layers if layer.layer_id == annotation.layer_id
        )
        axes, defaulted = _axes(rebuilt, pins[layer.ontology_id].t1_profile)
        defaulted_axes += defaulted
        mentions = _mentions(rebuilt, target.text)
        delivered.append(
            ontospan.Annotation(
                annotation_id=local_id,
                layer_id=annotation.layer_id,
                term_id=annotation.term_id,
                axes=axes,
                mentions=mentions,
                document_level=not mentions,
                modifiers=tuple(
                    ontospan.Modifier(
                        term_id=m.term_id,
                        segments=tuple(
                            ontospan.segment(target.text, s.start, s.end)
                            for s in m.segments
                        ),
                    )
                    for m in annotation.modifiers
                ),
                provenance=ontospan.Provenance(
                    actor=actor,
                    method=_method(rebuilt.annotation.provenance),
                    source_refs=(origin,),
                    notes=tuple(own_notes),
                ),
            )
        )
    aset = ontospan.AnnotationSet(
        annotation_set_id=set_id,
        set_kind="tool_output",
        actors=tuple(set_actors),
        created_at=created_at,
        layers=tuple(layers_for(profile, pins)),
        annotations=tuple(delivered),
    )
    unit = ontospan.AnnotatedDocument(
        document=document_to_t1(
            target, variant, source_variant_hashes or {}, single_native_case=False
        ),
        annotation_set=aset,
    )
    return ImportedSet(
        target.document_id,
        None,
        None,
        set_id,
        "tool_output",
        [actor.model_dump(mode="json", exclude_none=True) for actor in set_actors],
        aset.model_dump(mode="json"),
        ImportedProposals(annotations, evidence, notes, defaulted_axes),
        "reanchor",
        pending,
    ), unit


# Producer associations are server-owned persisted identities, never UI authority.


class ImportProducer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["import"] = "import"
    job_id: StrictInt = Field(gt=0)


class ReviewProducer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["translation_review"] = "translation_review"
    review_id: StrictInt = Field(gt=0)


class UploadProducer(BaseModel):
    """A version uploaded from the text card (issue 341 a)."""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["version_upload"] = "version_upload"
    upload_id: StrictInt = Field(gt=0)


class EditorialProducer(BaseModel):
    """An editorial correction of a version by a lead (issue 453)."""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["editorial_correction"] = "editorial_correction"
    correction_id: StrictInt = Field(gt=0)


class QueryDecisionProducer(BaseModel):
    """A lead took the reviewer's text of a queried review (issue 483)."""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["query_decision"] = "query_decision"
    decision_id: StrictInt = Field(gt=0)


class CorrectionPair(BaseModel):
    model_config = ConfigDict(extra="forbid")
    old_document_id: str = Field(min_length=1)
    new_document_id: str = Field(min_length=1)


class ReanchorPayload(CorrectionPair):
    project: str = Field(min_length=1)
    producer: Annotated[
        ImportProducer
        | ReviewProducer
        | UploadProducer
        | EditorialProducer
        | QueryDecisionProducer,
        Field(discriminator="kind"),
    ]


def enqueue_import_pairs(
    db: Database,
    project: str,
    project_id: int,
    parent_job_id: int,
    actor: Actor,
    pairs: list[CorrectionPair],
) -> None:
    """Persist exact inserted pairs and enqueue children in the creation transaction."""
    from ontotator.exchange.jobs import HANDLERS

    with db.transaction() as conn:
        parent = (
            conn.execute(select(JobRow).where(JobRow.id == parent_job_id))
            .mappings()
            .one_or_none()
        )
        if (
            parent is None
            or parent["kind"] not in {"upload_commit", "t1_import"}
            or parent["payload"].get("project") != project
            or parent["project_id"] not in {None, project_id}
            or (parent["requested_by"], parent["requested_label"])
            != (actor.user_id, actor.label)
        ):
            raise DomainError("REANCHOR_PRODUCER_INVALID")
        manifest = [pair.model_dump(mode="json") for pair in pairs]
        # Result is safe for strict persisted input DTOs and visible before _finish.
        conn.execute(
            update(JobRow)
            .where(JobRow.id == parent_job_id)
            .values(
                project_id=project_id,
                result={**(parent["result"] or {}), "reanchor_pairs": manifest},
            )
        )
        queue = JobQueue(db, HANDLERS)
        for pair in pairs:
            payload = ReanchorPayload(
                project=project,
                **pair.model_dump(),
                producer=ImportProducer(job_id=parent_job_id),
            )
            # Part of the accepted import: never refused for the queue limit.
            queue.enqueue(
                "reanchor",
                payload.model_dump(mode="json"),
                project_id=project_id,
                actor=actor,
                queue_limit=False,
            )


def import_pair_result(conn: Connection, job_id: int) -> dict[str, Any]:
    result = conn.execute(select(JobRow.result).where(JobRow.id == job_id)).scalar_one()
    return {"reanchor_pairs": (result or {}).get("reanchor_pairs", [])}


def enqueue_review_pair(
    jobs: JobQueue,
    project: str,
    project_id: int,
    old: str,
    new: str,
    review_id: int,
    actor: Actor,
) -> int:
    payload = ReanchorPayload(
        project=project,
        old_document_id=old,
        new_document_id=new,
        producer=ReviewProducer(review_id=review_id),
    )
    # Part of the accepted review: never refused for the queue limit.
    return jobs.enqueue(
        "reanchor",
        payload.model_dump(mode="json"),
        project_id=project_id,
        actor=actor,
        queue_limit=False,
    )


def enqueue_upload_pair(
    jobs: JobQueue,
    project: str,
    project_id: int,
    old: str,
    new: str,
    upload_id: int,
    actor: Actor,
) -> int:
    payload = ReanchorPayload(
        project=project,
        old_document_id=old,
        new_document_id=new,
        producer=UploadProducer(upload_id=upload_id),
    )
    # Part of the saved upload: never refused for the queue limit.
    return jobs.enqueue(
        "reanchor",
        payload.model_dump(mode="json"),
        project_id=project_id,
        actor=actor,
        queue_limit=False,
    )


def enqueue_editorial_pair(
    jobs: JobQueue,
    project: str,
    project_id: int,
    old: str,
    new: str,
    correction_id: int,
    actor: Actor,
) -> int:
    payload = ReanchorPayload(
        project=project,
        old_document_id=old,
        new_document_id=new,
        producer=EditorialProducer(correction_id=correction_id),
    )
    # Part of the saved correction: never refused for the queue limit.
    return jobs.enqueue(
        "reanchor",
        payload.model_dump(mode="json"),
        project_id=project_id,
        actor=actor,
        queue_limit=False,
    )


def enqueue_query_decision_pair(
    jobs: JobQueue,
    project: str,
    project_id: int,
    old: str,
    new: str,
    decision_id: int,
    actor: Actor,
) -> int:
    payload = ReanchorPayload(
        project=project,
        old_document_id=old,
        new_document_id=new,
        producer=QueryDecisionProducer(decision_id=decision_id),
    )
    # Part of the saved decision: never refused for the queue limit.
    return jobs.enqueue(
        "reanchor",
        payload.model_dump(mode="json"),
        project_id=project_id,
        actor=actor,
        queue_limit=False,
    )


@dataclass(frozen=True)
class PairJob:
    job_id: int
    payload: ReanchorPayload
    actor: Actor
    created_at: datetime


def _pair(row: Mapping[Any, Any], project_id: int, project: str) -> PairJob:
    from pydantic import ValidationError

    try:
        payload = ReanchorPayload.model_validate(handler_payload(row["payload"]))
    except ValidationError as exc:
        raise DomainError("REANCHOR_PRODUCER_INVALID") from exc
    if (
        row["kind"] != "reanchor"
        or row["project_id"] != project_id
        or payload.project != project
    ):
        raise DomainError("REANCHOR_PRODUCER_INVALID")
    return PairJob(
        row["id"],
        payload,
        Actor(row["requested_by"], row["requested_label"]),
        row["created_at"],
    )


def _check_pair(pair: CorrectionPair, variants: Mapping[str, VariantInfo]) -> None:
    old, new = variants.get(pair.old_document_id), variants.get(pair.new_document_id)
    if old is None or new is None:
        raise DomainError("DOCUMENT_NOT_FOUND")
    if old.language != new.language:
        raise DomainError("REANCHOR_LANGUAGE_MISMATCH")
    if (
        new.origin != "correction"
        or (old.document_id, old.case_id, old.external_id, old.version + 1)
        != (new.derived_from, new.case_id, new.external_id, new.version)
        or old.document_id == new.document_id
    ):
        raise DomainError("REANCHOR_PRODUCER_INVALID")


def _authority(conn: Connection, pair: PairJob, project_id: int) -> None:
    payload, actor = pair.payload, pair.actor
    if isinstance(payload.producer, ImportProducer):
        parent = (
            conn.execute(select(JobRow).where(JobRow.id == payload.producer.job_id))
            .mappings()
            .one_or_none()
        )
        expected = CorrectionPair(
            old_document_id=payload.old_document_id,
            new_document_id=payload.new_document_id,
        ).model_dump()
        if (
            parent is None
            or parent["kind"] not in {"upload_commit", "t1_import"}
            or parent["project_id"] != project_id
            or parent["payload"].get("project") != payload.project
            or (parent["requested_by"], parent["requested_label"])
            != (actor.user_id, actor.label)
            or expected not in (parent["result"] or {}).get("reanchor_pairs", [])
        ):
            raise DomainError("REANCHOR_PRODUCER_INVALID")
        if actor.user_id is None and not actor.label.startswith("cli:"):
            raise DomainError("NOT_ALLOWED")
        require_project_management(
            conn, actor, payload.project, project_id, Action.IMPORT_DOCUMENTS
        )
    elif isinstance(payload.producer, UploadProducer):
        from ontotator.storage.plan_tables import TranslationVersionUploadRow

        upload = conn.execute(
            select(
                TranslationVersionUploadRow.project_id,
                TranslationVersionUploadRow.previous_document_id,
                TranslationVersionUploadRow.document_id,
                TranslationVersionUploadRow.uploaded_by,
            ).where(TranslationVersionUploadRow.id == payload.producer.upload_id)
        ).one_or_none()
        if (
            upload is None
            or actor.user_id is None
            or tuple(upload)
            != (
                project_id,
                payload.old_document_id,
                payload.new_document_id,
                actor.user_id,
            )
        ):
            raise DomainError("REANCHOR_PRODUCER_INVALID")
        require_project_management(
            conn, actor, payload.project, project_id, Action.IMPORT_DOCUMENTS
        )
    elif isinstance(payload.producer, EditorialProducer):
        from ontotator.storage.plan_tables import EditorialCorrectionRow

        correction = conn.execute(
            select(
                EditorialCorrectionRow.project_id,
                EditorialCorrectionRow.previous_document_id,
                EditorialCorrectionRow.document_id,
                EditorialCorrectionRow.corrected_by,
            ).where(EditorialCorrectionRow.id == payload.producer.correction_id)
        ).one_or_none()
        if (
            correction is None
            or actor.user_id is None
            or tuple(correction)
            != (
                project_id,
                payload.old_document_id,
                payload.new_document_id,
                actor.user_id,
            )
        ):
            raise DomainError("REANCHOR_PRODUCER_INVALID")
        # The correction added a text to the project, as an upload does.
        require_project_management(
            conn, actor, payload.project, project_id, Action.IMPORT_DOCUMENTS
        )
    elif isinstance(payload.producer, QueryDecisionProducer):
        from ontotator.storage.plan_tables import QueryDecisionRow

        decision = conn.execute(
            select(
                QueryDecisionRow.project_id,
                QueryDecisionRow.document_id,
                QueryDecisionRow.accepted_document_id,
                QueryDecisionRow.decided_by,
                QueryDecisionRow.kind,
            ).where(QueryDecisionRow.id == payload.producer.decision_id)
        ).one_or_none()
        if (
            decision is None
            or actor.user_id is None
            or tuple(decision)
            != (
                project_id,
                payload.old_document_id,
                payload.new_document_id,
                actor.user_id,
                "reviewer_text",
            )
        ):
            raise DomainError("REANCHOR_PRODUCER_INVALID")
        # The decision added a text to the project, as an upload does.
        require_project_management(
            conn, actor, payload.project, project_id, Action.IMPORT_DOCUMENTS
        )
    else:
        if actor.user_id is None:
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        user = lock_user_authority(conn, actor.user_id)
        if actor.label != f"user:{user['username']}":
            raise DomainError("REANCHOR_PRODUCER_INVALID")
        record = (
            conn.execute(
                select(TranslationReviewRow).where(
                    TranslationReviewRow.id == payload.producer.review_id
                )
            )
            .mappings()
            .one_or_none()
        )
        if record is None or (
            record["project_id"],
            record["document_id"],
            record["created_variant_id"],
            record["reviewer_user_id"],
            record["decision"],
        ) != (
            project_id,
            payload.old_document_id,
            payload.new_document_id,
            actor.user_id,
            "accepted_corrected",
        ):
            raise DomainError("REANCHOR_PRODUCER_INVALID")
        valid = conn.execute(
            select(AssignmentRow.id)
            .where(
                AssignmentRow.id == record["assignment_id"],
                AssignmentRow.project_id == project_id,
                AssignmentRow.document_id == payload.old_document_id,
                AssignmentRow.task == "translation_review",
                qualifying_assignment(actor.user_id),
            )
            .with_for_update(key_share=True)
        ).scalar_one_or_none()
        if valid is None:
            raise DomainError("ASSIGNMENT_NOT_FOUND")


def reanchor_sources(
    conn: Connection, project_id: int, document_id: str
) -> list[ReanchorSource]:
    sets = (
        conn.execute(
            select(ProposalSetRow)
            .where(
                ProposalSetRow.project_id == project_id,
                ProposalSetRow.document_id == document_id,
                ProposalSetRow.origin.in_(["import", "reanchor"]),
            )
            .order_by(ProposalSetRow.id)
        )
        .mappings()
        .all()
    )
    if not sets:
        return []
    rows = conn.execute(
        select(
            ProposalAnnotationRow.proposal_set_id,
            ProposalAnnotationRow.notes,
            AnnotationSnapshotRow.payload,
        )
        .join(
            AnnotationSnapshotRow,
            and_(
                AnnotationSnapshotRow.project_id == ProposalAnnotationRow.project_id,
                AnnotationSnapshotRow.annotation_id
                == ProposalAnnotationRow.annotation_id,
                AnnotationSnapshotRow.version == ProposalAnnotationRow.version,
            ),
        )
        .where(
            ProposalAnnotationRow.project_id == project_id,
            ProposalAnnotationRow.proposal_set_id.in_([row["id"] for row in sets]),
            AnnotationSnapshotRow.document_id == document_id,
        )
    ).all()
    credits = credited_actors(conn, project_id, sets)
    result = []
    for row in sets:
        credit = credits[row["id"]]
        members = [
            (decode_snapshot(payload), notes)
            for set_id, notes, payload in rows
            if set_id == row["id"]
        ]
        order = {}
        for index, raw in enumerate(row["payload"].get("annotations", [])):
            local_id = raw["annotation_id"]
            order[local_id] = index
            order[
                ontospan.annotation_ref(
                    row["annotation_set_id"], local_id, row["bundle_id"]
                )
            ] = index
        if any(snap.annotation.annotation_id not in order for snap, _ in members):
            raise DomainError(
                "REANCHOR_PRODUCER_INVALID",
                "Unresolvable original set annotation identity",
            )
        members.sort(key=lambda value: order[value[0].annotation.annotation_id])
        result.append(
            ReanchorSource(
                row["id"],
                row["annotation_set_id"],
                row["bundle_id"],
                row["payload"],
                tuple(snap for snap, _ in members),
                {snap.annotation.annotation_id: list(notes) for snap, notes in members},
                # A legacy re-anchored source is read as its credited tool.
                tuple(credit.actors) if credit.alias else None,
                dict(credit.alias),
            )
        )
    return result


def proposal_counts(
    conn: Connection, project_id: int, document_id: str, old: str, new: str
) -> dict[str, int]:
    """What re-anchoring the tool proposals of ``document_id`` from the text
    ``old`` to ``new`` does: the proposal ``sets``, the proposals that are
    ``carried`` and the ones left for a check (``needs_check``). Read only;
    the editorial correction's dry run and the re-anchoring job agree on it."""
    mapping = text_map(old, new)
    sources = reanchor_sources(conn, project_id, document_id)
    outcomes = [
        isinstance(
            reanchor_annotation(item, item.evidence, old, new, mapping), NeedsReview
        )
        for source in sources
        for item in source.annotations
    ]
    return {
        "sets": len(sources),
        "carried": outcomes.count(False),
        "needs_check": outcomes.count(True),
    }


def _follow_editorial(
    conn: Connection, project_id: int, pair: PairJob, old: str, new: str
) -> None:
    """Issue 509: after an editorial correction, the tasks from proposals
    nobody opened follow the new version once its proposals are stored,
    when every proposal was carried (none needs a check). Otherwise, and
    for a task opened or paused since, they stay for "Handle text change"
    (``move_task_to_version``)."""
    from ontotator.assignments.service import move_unopened_proposal_tasks

    counts = proposal_counts(conn, project_id, pair.payload.old_document_id, old, new)
    if counts["needs_check"] or not counts["carried"]:
        return
    move_unopened_proposal_tasks(
        conn,
        pair.actor,
        project_id,
        pair.payload.old_document_id,
        pair.payload.new_document_id,
        datetime.now(UTC),
    )


def _legacy_form(built: ImportedSet, actors: list[Any]) -> dict[str, Any]:
    """The payload a set re-anchored before #417 holds for this rebuild: the
    job as the one actor and method ``tool`` of every proposal."""
    payload = dict(built.payload)
    payload["actors"] = list(actors)
    payload["annotations"] = [
        {
            **item,
            "provenance": {
                **item["provenance"],
                "actor": actors[0],
                "method": "tool",
            },
        }
        for item in payload.get("annotations", [])
    ]
    return payload


def _process_pair(
    db: Database,
    conn: Connection,
    project_id: int,
    pair: PairJob,
    variants: Mapping[str, VariantInfo],
    trigger_job_id: int,
) -> dict[str, int]:
    repo = Repository(db)
    old = repo.get_document(pair.payload.project, pair.payload.old_document_id)
    target = repo.get_document(pair.payload.project, pair.payload.new_document_id)
    assert old is not None and target is not None
    profile, pins = (
        repo.get_task_profile(pair.payload.project),
        repo.project_pins(pair.payload.project),
    )
    sources = reanchor_sources(conn, project_id, old.document_id)
    counts = {"sets": 0, "carried": 0, "needs_review": 0}
    for source in sources:
        built, unit = rebuild_source(
            pair.payload.project,
            source,
            old,
            target,
            profile,
            pins,
            created_at=pair.created_at,
            variant=variants[target.document_id],
            source_variant_hashes={
                key: value.text_sha256 for key, value in variants.items()
            },
        )
        if built is None:
            continue
        assert unit is not None
        known = (
            conn.execute(
                select(ProposalSetRow).where(
                    ProposalSetRow.project_id == project_id,
                    ProposalSetRow.document_id == target.document_id,
                    ProposalSetRow.annotation_set_id == built.annotation_set_id,
                    ProposalSetRow.bundle_id.is_(None),
                )
            )
            .mappings()
            .one_or_none()
        )
        if known is not None:
            # A set stored before #417 names the job (of its release) as its
            # producer; it is the same set when it matches in every other way.
            legacy = len(known["actors"]) == 1 and is_legacy_reanchor_actor(
                known["actors"][0]
            )
            expected = (
                _legacy_form(
                    built, known["payload"].get("actors") or list(known["actors"])
                )
                if legacy
                else dict(built.payload)
            )
            actual = dict(known["payload"])
            expected.pop("created_at", None)
            actual.pop("created_at", None)
            if (
                (not legacy and known["actors"] != built.actors)
                or known["set_kind"] != "tool_output"
                or known["source_sha256"] is not None
                or known["manifest_sha256"] is not None
                or known["origin"] != "reanchor"
                or actual != expected
                or known["pending_items"] != built.pending_items
            ):
                raise DomainError("REANCHOR_SET_COLLISION")
            continue
        ontology_views = {
            key: ontospan.ObographOntology.load(db.blobs.path(pin.sha256))
            for key, pin in pins.items()
        }
        report = ontospan.validate(unit, ontology_views)
        if not report.ok:
            raise DomainError(
                "T1_INVALID", {"codes": sorted({issue.code for issue in report.errors})}
            )
        inserted = repo.add_documents_and_proposals(
            pair.payload.project,
            [],
            [built],
            source_sha256=None,
            imported_by=pair.actor.user_id,
            job_id=pair.job_id,
        )
        if inserted["sets_added"]:
            counts["sets"] += 1
            counts["carried"] += inserted["proposals"]
            counts["needs_review"] += len(built.pending_items)
    if counts["sets"]:
        record_audit(
            conn,
            pair.actor,
            "variant.reanchor",
            target_type="document",
            target_id=target.document_id,
            project_id=project_id,
            details={
                **counts,
                "old_document_id": old.document_id,
                "new_document_id": target.document_id,
                "job_id": pair.job_id,
                "trigger_job_id": trigger_job_id,
            },
        )
    return counts


def reanchor(job: Job, ctx: JobContext) -> dict[str, Any]:
    """Ensure legitimate precursor obligations oldest-first, with no lock-held waits."""
    db = ctx.db
    with db.transaction() as conn:
        current = (
            conn.execute(select(JobRow).where(JobRow.id == job.id))
            .mappings()
            .one_or_none()
        )
        if (
            current is None
            or current["status"] != "running"
            or current["kind"] != "reanchor"
            or current["project_id"] is None
            or handler_payload(current["payload"]) != job.payload
        ):
            raise DomainError("REANCHOR_PRODUCER_INVALID")
        project = conn.execute(
            select(ProjectRow.project_key).where(ProjectRow.id == current["project_id"])
        ).scalar_one_or_none()
        if project is None:
            raise DomainError("PROJECT_NOT_FOUND")
        conn.execute(select(func.pg_advisory_xact_lock(_lock_id("import"))))
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", project)))
        )
        conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", project))))
        main = _pair(current, current["project_id"], project)
        variants = {v.document_id: v for v in Repository(db)._variants(project)}
        _check_pair(main.payload, variants)
        ancestry = []
        previous = variants[main.payload.old_document_id]
        seen = {main.payload.new_document_id}
        while previous.origin == "correction":
            if previous.document_id in seen:
                raise DomainError("REANCHOR_PRODUCER_INVALID")
            seen.add(previous.document_id)
            ancestry.append(previous.document_id)
            if previous.derived_from not in variants:
                raise DomainError("REANCHOR_PRODUCER_INVALID")
            previous = variants[previous.derived_from]
        jobs = (
            conn.execute(
                select(JobRow)
                .where(
                    JobRow.kind == "reanchor",
                    JobRow.project_id == current["project_id"],
                    JobRow.payload["new_document_id"].astext.in_(ancestry),
                )
                .order_by(JobRow.id)
            )
            .mappings()
            .all()
        )
        by_target: dict[str, PairJob] = {}
        for row in jobs:
            candidate = _pair(row, current["project_id"], project)
            by_target.setdefault(candidate.payload.new_document_id, candidate)
        pairs = [main]
        old = main.payload.old_document_id
        while old in by_target:
            pair = by_target[old]
            _check_pair(pair.payload, variants)
            pairs.append(pair)
            old = pair.payload.old_document_id
        # All actors at final SHARE strength, sorted BEFORE any assignment row.
        for user_id in sorted(
            {p.actor.user_id for p in pairs if p.actor.user_id is not None}
        ):
            lock_user_authority(conn, user_id)
        for pair in sorted(pairs, key=lambda p: p.job_id):
            _authority(conn, pair, current["project_id"])
        totals = {"sets": 0, "carried": 0, "needs_review": 0}
        for pair in reversed(pairs):
            added = _process_pair(
                db, conn, current["project_id"], pair, variants, job.id
            )
            if isinstance(pair.payload.producer, EditorialProducer):
                repo = Repository(db)
                old_doc = repo.get_document(project, pair.payload.old_document_id)
                new_doc = repo.get_document(project, pair.payload.new_document_id)
                assert old_doc is not None and new_doc is not None
                _follow_editorial(
                    conn, current["project_id"], pair, old_doc.text, new_doc.text
                )
            for key, value in added.items():
                totals[key] += value
        return totals
