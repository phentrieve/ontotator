"""Read-only facts for rounds, carried inputs and carry sources (no writes).

Every function here enriches items the caller has already read through an
authorized (scoped) repository call. The SQL below is restricted to the round
ids, assignment ids and submission ids named by those items; nothing here
fetches inputs or rounds on its own.

Each function reads in ``db.snapshot()``; a caller that opens the snapshot
around its own authorized read gets one consistent state for both.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.engine import Connection

from ontotator.domain.submission_labels import round_ordinals
from ontotator.domain.work_rounds import (
    CARRY_ROUND_KINDS,
    RoundInputView,
    RoundSourceText,
    WorkRoundView,
    unresolved_note,
)
from ontotator.packages.models import PackageManifest
from ontotator.storage.repository import Repository
from ontotator.storage.tables import ProjectRow, SubmissionRow
from ontotator.storage.workflow_tables import (
    RoundInputRow,
    RoundSubmissionBindingRow,
    WorkRoundRow,
)


def _ordinals(
    conn: Any,
    pid: int,
    assignment_ids: Iterable[int],
    archived: dict[str, dict[str, Any]],
) -> dict[str, int]:
    """Round numbers per assignment chain, archived rounds included."""
    wanted = set(assignment_ids)
    if not wanted:
        return {}
    rows = conn.execute(
        select(WorkRoundRow.round_id, WorkRoundRow.predecessor_round_id)
        .where(
            WorkRoundRow.project_id == pid,
            WorkRoundRow.assignment_id.in_(sorted(wanted)),
        )
        .order_by(WorkRoundRow.created_at, WorkRoundRow.round_id)
    ).all()
    pairs = [(r.round_id, r.predecessor_round_id) for r in rows]
    known = {rid for rid, _ in pairs}
    pairs.extend(
        (rid, item["round"].get("predecessor_round_id"))
        for rid, item in archived.items()
        if rid not in known and item["round"].get("assignment_id") in wanted
    )
    return round_ordinals(pairs)


def round_labels(
    conn: Any, pid: int, round_ids: Iterable[str]
) -> dict[str, tuple[str | None, int]]:
    """round_id -> (round kind, round number) as Documents names them.

    The number is the round's place along its ``predecessor_round_id`` chain,
    the rule of the Documents submissions table (issue 547, U4-07: the text
    view of a consolidator who is not the lead says "Round 1", as the lead's
    does). Predecessors are followed by id, so a chain that spans text
    versions counts the same way. Rounds kept only in the imported workflow
    history are read from the manifest.
    """
    pairs: dict[str, str | None] = {}
    kinds: dict[str, str | None] = {}
    wanted = set(round_ids)
    missing: set[str] = set()
    while wanted:
        rows = conn.execute(
            select(
                WorkRoundRow.round_id,
                WorkRoundRow.predecessor_round_id,
                WorkRoundRow.kind,
            ).where(
                WorkRoundRow.project_id == pid,
                WorkRoundRow.round_id.in_(sorted(wanted)),
            )
        ).all()
        for row in rows:
            pairs[row.round_id] = row.predecessor_round_id
            kinds[row.round_id] = row.kind
        missing |= wanted - {row.round_id for row in rows}
        wanted = {rid for rid in pairs.values() if rid and rid not in pairs} - missing
    if missing:
        history = (
            PackageManifest.model_validate(
                conn.execute(
                    select(ProjectRow.manifest).where(ProjectRow.id == pid)
                ).scalar_one()
            ).workflow_history
            or {}
        )
        found = [rid for rid in sorted(missing) if rid in history]
        while found:
            for rid in found:
                stored = history[rid].get("round", {})
                pairs[rid] = stored.get("predecessor_round_id")
                kinds[rid] = stored.get("kind")
            found = [
                rid
                for rid in {p for p in pairs.values() if p and p not in pairs}
                if rid in history
            ]
    ordinals = round_ordinals(pairs.items())
    return {rid: (kinds[rid], ordinals[rid]) for rid in pairs}


def _round_of_submission(
    conn: Any,
    pid: int,
    sids: Iterable[str],
    archived: dict[str, dict[str, Any]],
) -> dict[str, tuple[str, int]]:
    """submission_id -> (round_id, assignment_id)."""
    wanted = set(sids)
    if not wanted:
        return {}
    rows = conn.execute(
        select(
            RoundSubmissionBindingRow.submission_id,
            RoundSubmissionBindingRow.round_id,
            WorkRoundRow.assignment_id,
        )
        .join(
            WorkRoundRow,
            WorkRoundRow.round_id == RoundSubmissionBindingRow.round_id,
        )
        .where(
            RoundSubmissionBindingRow.project_id == pid,
            RoundSubmissionBindingRow.submission_id.in_(sorted(wanted)),
        )
    ).all()
    result = {r.submission_id: (r.round_id, r.assignment_id) for r in rows}
    for rid, item in archived.items():
        for sid in item.get("submission_ids", []):
            if sid in wanted and sid not in result:
                result[sid] = (rid, item["round"].get("assignment_id"))
    return result


def _recorded(conn: Any, pid: int, sids: Iterable[str]) -> dict[str, Any]:
    """submission_id -> row with ``recorded_at`` and ``findings`` (snapshot count)."""
    wanted = set(sids)
    if not wanted:
        return {}
    rows = conn.execute(
        select(
            SubmissionRow.submission_id,
            SubmissionRow.recorded_at,
            func.coalesce(
                func.jsonb_array_length(SubmissionRow.payload["snapshots"]), 0
            ).label("findings"),
        ).where(
            SubmissionRow.project_id == pid,
            SubmissionRow.submission_id.in_(sorted(wanted)),
        )
    ).all()
    return {r.submission_id: r for r in rows}


def _counts(conn: Any, pid: int, column: Any, round_ids: list[str]) -> dict[str, int]:
    if not round_ids:
        return {}
    table = column.class_
    rows = conn.execute(
        select(column, func.count())
        .where(table.project_id == pid, column.in_(round_ids))
        .group_by(column)
    ).all()
    return {rid: count for rid, count in rows}


def _source_facts(
    conn: Connection,
    pid: int,
    sids: Iterable[str],
    archived: dict[str, dict[str, Any]],
) -> tuple[dict[str, tuple[str, int]], dict[str, int], dict[str, Any]]:
    """Owning rounds, round ordinals and recorded rows of these submissions."""
    sids = set(sids)
    owners = _round_of_submission(conn, pid, sids, archived)
    ordinals = _ordinals(conn, pid, {a for _, a in owners.values()}, archived)
    return owners, ordinals, _recorded(conn, pid, sids)


def enrich_rounds(
    repo: Repository, project_key: str, views: list[WorkRoundView]
) -> list[WorkRoundView]:
    """Add ordinals, times, counts and text identity to authorized round views."""
    if not views:
        return []
    with repo.db.snapshot() as conn:
        variants = {v.document_id: v for v in repo.list_variants(project_key)}
        pid = repo._require_project(conn, project_key)
        archived = repo._archived_rounds(conn, pid)
        round_ids = sorted({v.round_id for v in views})
        sources = {
            v.input_submission_ids[0]
            for v in views
            if v.kind in CARRY_ROUND_KINDS and v.input_submission_ids
        }
        latest = {v.latest_submission_id for v in views if v.latest_submission_id}
        owners, source_ordinals, recorded = _source_facts(
            conn, pid, sources | latest, archived
        )
        ordinals = source_ordinals | _ordinals(
            conn, pid, {v.assignment_id for v in views}, archived
        )
        created: dict[str, datetime] = {
            r.round_id: r.created_at
            for r in conn.execute(
                select(WorkRoundRow.round_id, WorkRoundRow.created_at).where(
                    WorkRoundRow.project_id == pid,
                    WorkRoundRow.round_id.in_(round_ids),
                )
            )
        }
        submissions = _counts(conn, pid, RoundSubmissionBindingRow.round_id, round_ids)
        inputs = _counts(conn, pid, RoundInputRow.round_id, round_ids)
        from ontotator.application.typo_fix_carry import typo_fix_moves

        moved = {move.round_id for move in typo_fix_moves(conn, pid).values()}

    result = []
    for view in views:
        stored = archived.get(view.round_id) if view.round_id not in created else None
        latest_row = recorded.get(view.latest_submission_id or "")
        update: dict[str, Any] = {
            "round_ordinal": ordinals.get(view.round_id),
            "created_at": created.get(view.round_id),
            "submission_count": (
                len(stored.get("submission_ids", []))
                if stored is not None
                else submissions.get(view.round_id, 0)
            ),
            "latest_submission_recorded_at": (
                latest_row.recorded_at if latest_row is not None else None
            ),
            "input_count": (
                len(stored.get("inputs", []))
                if stored is not None
                else inputs.get(view.round_id, 0)
            ),
            "moved_by_typo_fix": view.round_id in moved,
        }
        if view.kind in CARRY_ROUND_KINDS and view.input_submission_ids:
            sid = view.input_submission_ids[0]
            owner = owners.get(sid)
            source_row = recorded.get(sid)
            update["source_round_ordinal"] = (
                ordinals.get(owner[0]) if owner is not None else None
            )
            update["source_submission_recorded_at"] = (
                source_row.recorded_at if source_row is not None else None
            )
        variant = variants.get(view.document_id)
        if variant is not None:
            update["document_language"] = variant.language
            update["document_version"] = variant.version
        result.append(view.model_copy(update=update))
    return result


def _draft_versions(conn: Connection, pid: int, ids: Iterable[int]) -> dict[int, int]:
    """draft_snapshots.id -> version of the frozen draft's text."""
    from ontotator.storage.overview_tables import DraftSnapshotRow

    wanted = set(ids)
    if not wanted:
        return {}
    return {
        r.id: int(r.version)
        for r in conn.execute(
            select(
                DraftSnapshotRow.id,
                DraftSnapshotRow.payload["document_version"]
                .as_integer()
                .label("version"),
            ).where(
                DraftSnapshotRow.project_id == pid,
                DraftSnapshotRow.id.in_(sorted(wanted)),
            )
        )
    }


def enrich_inputs(
    repo: Repository, project_key: str, items: list[dict[str, Any]]
) -> list[RoundInputView]:
    """Validate authorized input payloads and add their source facts.

    Round ordinal and recorded time exist only for a submission source; an
    input of a frozen draft (kind ``text_change``) gets its text version from
    the draft snapshot, except in an archived (imported) round, whose draft
    snapshot ids do not name this database's drafts.
    """
    views = [RoundInputView.model_validate(item) for item in items]
    if not views:
        return []
    with repo.db.snapshot() as conn:
        variants = {v.document_id: v for v in repo.list_variants(project_key)}
        pid = repo._require_project(conn, project_key)
        archived = repo._archived_rounds(conn, pid)
        owners, ordinals, recorded = _source_facts(
            conn,
            pid,
            {v.source_submission_id for v in views if v.source_submission_id},
            archived,
        )
        # An archived round came from a package: its draft snapshot ids are
        # local to the exporting database, so it keeps the variants' version.
        archived_ids = {
            item["input_id"]
            for entry in archived.values()
            for item in entry.get("inputs", ())
        }
        drafts = _draft_versions(
            conn,
            pid,
            {
                v.source_draft_snapshot_id
                for v in views
                if v.source_draft_snapshot_id is not None
                and v.input_id not in archived_ids
            },
        )
        notes = _unresolved_notes(conn, pid, views, archived_ids)
    result = []
    for view in views:
        sid = view.source_submission_id or ""
        owner = owners.get(sid)
        row = recorded.get(sid)
        variant = variants.get(view.source_snapshot.annotation.document_id)
        version = variant.version if variant else None
        if (
            view.source_draft_snapshot_id is not None
            and view.input_id not in archived_ids
        ):
            version = drafts.get(view.source_draft_snapshot_id, version)
        result.append(
            view.model_copy(
                update={
                    "source_round_ordinal": (
                        ordinals.get(owner[0]) if owner is not None else None
                    ),
                    "source_recorded_at": row.recorded_at if row is not None else None,
                    "source_language": variant.language if variant else None,
                    "source_version": version,
                    # Stored with the input (#418), else read from its source.
                    "unresolved_note": view.unresolved_note or notes.get(view.input_id),
                }
            )
        )
    return result


def _unresolved_notes(
    conn: Connection, pid: int, views: list[RoundInputView], archived_ids: set[str]
) -> dict[str, str]:
    """input_id -> the note of the Unresolved decision the source work left on
    the input's proposal (carried without counterpart, #414)."""
    from ontotator.storage.overview_tables import DraftSnapshotRow

    tool = [
        v
        for v in views
        if v.source_snapshot.annotation.provenance.actor.kind == "tool"
        and v.unresolved_note is None
    ]
    sids = {v.source_submission_id for v in tool if v.source_submission_id}
    dids = {
        v.source_draft_snapshot_id
        for v in tool
        if v.source_draft_snapshot_id is not None and v.input_id not in archived_ids
    }
    decisions: dict[str | int, list[dict[str, Any]]] = {}
    if sids:
        for sid, stored in conn.execute(
            select(
                SubmissionRow.submission_id, SubmissionRow.payload["decisions"]
            ).where(
                SubmissionRow.project_id == pid,
                SubmissionRow.submission_id.in_(sorted(sids)),
            )
        ):
            decisions[sid] = stored or []
    if dids:
        for did, stored in conn.execute(
            select(DraftSnapshotRow.id, DraftSnapshotRow.payload["decisions"]).where(
                DraftSnapshotRow.project_id == pid,
                DraftSnapshotRow.id.in_(sorted(dids)),
            )
        ):
            decisions[did] = stored or []
    notes: dict[str, str] = {}
    for view in tool:
        source = view.source_submission_id or view.source_draft_snapshot_id
        note = unresolved_note(
            view.source_ref.model_dump(), decisions.get(source or "", [])
        )
        if note is not None:
            notes[view.input_id] = note
    return notes


def enrich_sources(
    repo: Repository, project_key: str, sids: list[str]
) -> list[dict[str, Any]]:
    """Round ordinal, server time and finding count per authorized submission id."""
    if not sids:
        return []
    with repo.db.snapshot() as conn:
        pid = repo._require_project(conn, project_key)
        archived = repo._archived_rounds(conn, pid)
        owners, ordinals, recorded = _source_facts(conn, pid, sids, archived)
    result = []
    for sid in sids:
        owner = owners.get(sid)
        row = recorded.get(sid)
        result.append(
            {
                "round_ordinal": ordinals.get(owner[0]) if owner is not None else None,
                "recorded_at": row.recorded_at if row is not None else None,
                "finding_count": int(row.findings) if row is not None else 0,
            }
        )
    return result


def assignment_submissions(
    repo: Repository, project_key: str, assignment_id: int
) -> list[dict[str, Any]]:
    """Submissions bound to any round of the assignment, oldest recorded first.

    The caller has authorized the assignment (owner or lead). Archived rounds of
    the assignment count; a legacy ``last_submission_id`` without any round
    binding is listed without a round.
    """
    from ontotator.storage.tables import AssignmentRow

    with repo.db.snapshot() as conn:
        variants = {v.document_id: v for v in repo.list_variants(project_key)}
        pid = repo._require_project(conn, project_key)
        archived = repo._archived_rounds(conn, pid)
        owners: dict[str, str | None] = {
            r.submission_id: r.round_id
            for r in conn.execute(
                select(
                    RoundSubmissionBindingRow.submission_id,
                    RoundSubmissionBindingRow.round_id,
                )
                .join(
                    WorkRoundRow,
                    (WorkRoundRow.project_id == RoundSubmissionBindingRow.project_id)
                    & (WorkRoundRow.round_id == RoundSubmissionBindingRow.round_id),
                )
                .where(
                    RoundSubmissionBindingRow.project_id == pid,
                    WorkRoundRow.assignment_id == assignment_id,
                )
            )
        }
        for rid, item in archived.items():
            if item["round"].get("assignment_id") == assignment_id:
                for sid in item.get("submission_ids", []):
                    owners.setdefault(sid, rid)
        legacy = conn.execute(
            select(AssignmentRow.last_submission_id).where(
                AssignmentRow.project_id == pid, AssignmentRow.id == assignment_id
            )
        ).scalar_one_or_none()
        if legacy is not None and legacy not in owners:
            bound = _round_of_submission(conn, pid, [legacy], archived)
            if legacy not in bound:
                owners[legacy] = None
        if not owners:
            return []
        ordinals = _ordinals(conn, pid, [assignment_id], archived)
        rows = conn.execute(
            select(
                SubmissionRow.submission_id,
                SubmissionRow.document_id,
                SubmissionRow.recorded_at,
                func.coalesce(
                    func.jsonb_array_length(SubmissionRow.payload["snapshots"]), 0
                ).label("findings"),
            )
            .where(
                SubmissionRow.project_id == pid,
                SubmissionRow.submission_id.in_(sorted(owners)),
            )
            .order_by(SubmissionRow.recorded_at, SubmissionRow.submission_id)
        ).all()
    result = []
    for row in rows:
        variant = variants.get(row.document_id)
        if variant is None:
            continue
        owner = owners[row.submission_id]
        result.append(
            {
                "submission_id": row.submission_id,
                "round_id": owner,
                "round_ordinal": ordinals.get(owner) if owner is not None else None,
                "recorded_at": row.recorded_at,
                "finding_count": int(row.findings),
                "document_id": row.document_id,
                "language": variant.language,
                "version": variant.version,
            }
        )
    return result


def _source_document_id(conn: Connection, pid: int, view: WorkRoundView) -> str | None:
    """The document the carry of ``view`` re-anchored from (``text_map``'s old
    text): the source submission's text, or for a text change the version the
    lead moved the draft from. None for other kinds and unknown sources."""
    from ontotator.storage.overview_tables import TextChangeResolutionRow

    if view.kind not in CARRY_ROUND_KINDS:
        return None
    if view.input_submission_ids:
        found: str | None = conn.execute(
            select(SubmissionRow.document_id).where(
                SubmissionRow.project_id == pid,
                SubmissionRow.submission_id == view.input_submission_ids[0],
            )
        ).scalar_one_or_none()
        return found
    moved: str | None = conn.execute(
        select(TextChangeResolutionRow.from_document_id)
        .where(
            TextChangeResolutionRow.project_id == pid,
            TextChangeResolutionRow.round_id == view.round_id,
        )
        .limit(1)
    ).scalar_one_or_none()
    return moved


def round_source_text(
    repo: Repository, project_key: str, view: WorkRoundView
) -> RoundSourceText | None:
    """The earlier text version an authorized carried round came from (issue
    421, "Show changes since vN"); None when its source is the same text."""
    if view.kind not in CARRY_ROUND_KINDS:
        return None
    # The round is authorized; its source text is read unscoped (the version
    # the work was moved from may no longer be assigned to the reader).
    plain = Repository(repo.db)
    with plain.db.snapshot() as conn:
        pid = plain._require_project(conn, project_key)
        source_id = _source_document_id(conn, pid, view)
        if source_id is None or source_id == view.document_id:
            return None
        variant = plain.get_variant(project_key, source_id)
        document = plain.get_document(project_key, source_id)
    if document is None:
        return None
    return RoundSourceText(
        document_id=source_id,
        language=variant.language,
        version=variant.version,
        text=document.text,
    )
