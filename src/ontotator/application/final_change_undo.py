"""Undo of the bulk action "Change final…" (issue 336, step 2).

The pattern of the Undo for bulk reopen and withdraw
(``bulk_task_actions``): applying records one ``project.bulk_final_change``
audit event with the final result each text had, the one it got and a digest
of what the text's final result rests on, and returns only that event's id.
The client cannot choose the texts or the results of an Undo.

``undo`` works for the lead who applied the action, in that project, once,
within ``UNDO_MINUTES``. A preview lists the final result each text would
get back and the texts that block the Undo, with the reason; applying
restores every text or none (``BULK_UNDO_STALE`` with that preview).

A text blocks the Undo when anything its final result rests on changed since
the action: the final result itself (changed, confirmed again or withdrawn),
the text's versions and discards, its plan row, any task of the text
(assigned, reopened, withdrawn, paused or released, a new round), or its
submissions (a new one, or one discarded by a mode change). A problem report
decided meanwhile blocks only through such a change to a task. Final exports
made meanwhile do not block: they stay as they are, as after "Withdraw
final…", and the preview counts them. Agreement numbers are not stored; they
follow the restored results.

The Undo is a change of its own: the selection's revision moves on and the
event log gains one event per text (``restored``); the earlier choice comes
back with its lead, its time and the warnings that lead had confirmed. Each
text is audited like a single change (``project.final_selection`` with
``via: bulk_change_final_undo``).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Connection, RowMapping, func, insert, select, tuple_, update

from ontotator.application.bulk_task_actions import UNDO_MINUTES
from ontotator.application.people import person_refs
from ontotator.application.workflow_warnings import state_digest
from ontotator.assignments.eligibility import plan_for
from ontotator.auth.audit import Actor, record_audit
from ontotator.domain.errors import DomainError
from ontotator.domain.work_plans import RowKey
from ontotator.storage import work_plan_store
from ontotator.storage.final_tables import (
    ExportSelectionSnapshotRow,
    FinalSelectionEventRow,
    FinalSelectionRow,
)
from ontotator.storage.live_submissions import live_submission
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    SubmissionRow,
)
from ontotator.storage.workflow_tables import WorkRoundStateRow

APPLIED = "project.bulk_final_change"
UNDONE = "project.bulk_final_change_undone"
VIA = "bulk_change_final"
VIA_UNDO = "bulk_change_final_undo"

# Why a text blocks the Undo, in the order they are checked, with the words
# the toast and the MCP tool show. Each names the part of the recorded state
# that differs; an earlier result that was discarded differs in the last.
BLOCKS: dict[str, str] = {
    "final": "The final result was changed, confirmed again or withdrawn since.",
    "versions": "The text got a new version, or a version was discarded or"
    " restored since.",
    "plan": "The work plan of the text changed since.",
    "tasks": "A task of the text changed since (assigned, reopened, withdrawn,"
    " paused or a new round).",
    "submissions": "Something was submitted or discarded on the text since.",
}
Text = tuple[str, str]


def _stale(reason: str, **more: Any) -> DomainError:
    return DomainError("BULK_UNDO_STALE", {"reason": reason, **more})


def _pairs(texts: Sequence[Text]) -> list[Text]:
    return [(case_id, language) for case_id, language in texts]


def previous_finals(
    conn: Connection, pid: int, texts: Sequence[Text]
) -> dict[Text, dict[str, Any]]:
    """What an Undo puts back for each of ``texts``: its final selection as
    it is now and its PLAN_RESTORED marker (a changed result clears it). Read
    before the bulk action changes them."""
    if not texts:
        return {}
    markers = work_plan_store.restored(conn, pid)
    return {
        (row["case_id"], row["language"]): {
            "document_id": row["document_id"],
            "submission_id": row["submission_id"],
            "revision": int(row["revision"]),
            "actor_id": int(row["actor_id"]),
            "acknowledged_cause_ids": list(row["acknowledged_cause_ids"]),
            "selected_at": row["selected_at"].isoformat(),
            "adjudicator_not_annotator": row["adjudicator_not_annotator"],
            "restored_revision": markers.get(RowKey(row["case_id"], row["language"])),
        }
        for row in conn.execute(
            select(FinalSelectionRow).where(
                FinalSelectionRow.project_id == pid,
                tuple_(FinalSelectionRow.case_id, FinalSelectionRow.language).in_(
                    _pairs(texts)
                ),
            )
        ).mappings()
    }


def text_states(
    conn: Connection, pid: int, texts: Sequence[Text]
) -> dict[Text, dict[str, str]]:
    """Per text, a digest of each part its final result rests on (the keys of
    ``BLOCKS`` up to ``submissions``). The number of statements does not grow
    with the number of texts."""
    if not texts:
        return {}
    pairs = _pairs(texts)
    text_of: dict[str, Text] = {}
    versions: dict[Text, list[str]] = {text: [] for text in texts}
    for document_id, case_id, language in conn.execute(
        select(DocumentRow.document_id, DocumentRow.case_id, DocumentRow.language)
        .where(
            DocumentRow.project_id == pid,
            tuple_(DocumentRow.case_id, DocumentRow.language).in_(pairs),
        )
        .order_by(DocumentRow.document_id)
    ).tuples():
        text_of[document_id] = (case_id, language)
        versions[(case_id, language)].append(document_id)
    documents = sorted(text_of)
    discarded: dict[Text, list[str]] = {text: [] for text in texts}
    for document_id in conn.execute(
        select(DiscardedVariantRow.document_id)
        .where(
            DiscardedVariantRow.project_id == pid,
            DiscardedVariantRow.document_id.in_(documents),
        )
        .order_by(DiscardedVariantRow.document_id)
    ).scalars():
        discarded[text_of[document_id]].append(document_id)
    plan = plan_for(conn, pid, {RowKey(*text) for text in texts})
    markers = work_plan_store.restored(conn, pid)
    finals: dict[Text, list[Any]] = {
        (row.case_id, row.language): [row.revision, row.document_id, row.submission_id]
        for row in conn.execute(
            select(
                FinalSelectionRow.case_id,
                FinalSelectionRow.language,
                FinalSelectionRow.revision,
                FinalSelectionRow.document_id,
                FinalSelectionRow.submission_id,
            ).where(
                FinalSelectionRow.project_id == pid,
                tuple_(FinalSelectionRow.case_id, FinalSelectionRow.language).in_(
                    pairs
                ),
            )
        )
    }
    tasks: dict[Text, list[list[Any]]] = {text: [] for text in texts}
    round_ids: dict[str, Text] = {}
    for row in conn.execute(
        select(AssignmentRow)
        .where(
            AssignmentRow.project_id == pid,
            AssignmentRow.document_id.in_(documents),
        )
        .order_by(AssignmentRow.id)
    ):
        text = text_of[row.document_id]
        tasks[text].append(
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
        )
        if row.active_round_id is not None:
            round_ids[row.active_round_id] = text
    rounds: dict[Text, list[list[Any]]] = {text: [] for text in texts}
    for round_id, state, revision in conn.execute(
        select(
            WorkRoundStateRow.round_id,
            WorkRoundStateRow.state,
            WorkRoundStateRow.revision,
        )
        .where(WorkRoundStateRow.round_id.in_(sorted(round_ids)))
        .order_by(WorkRoundStateRow.round_id)
    ).tuples():
        rounds[round_ids[round_id]].append([round_id, state, revision])
    submissions: dict[Text, list[str]] = {text: [] for text in texts}
    for submission_id, document_id in conn.execute(
        select(SubmissionRow.submission_id, SubmissionRow.document_id)
        .where(
            SubmissionRow.project_id == pid,
            SubmissionRow.document_id.in_(documents),
            live_submission(),
        )
        .order_by(SubmissionRow.submission_id)
    ).tuples():
        submissions[text_of[document_id]].append(submission_id)
    states: dict[Text, dict[str, str]] = {}
    for text in texts:
        flags = plan.get(RowKey(*text))
        states[text] = {
            "final": state_digest(finals.get(text)),
            "versions": state_digest([versions[text], discarded[text]]),
            "plan": state_digest(
                [
                    None if flags is None else [flags.review, flags.annotate],
                    markers.get(RowKey(*text)),
                ]
            ),
            "tasks": state_digest([tasks[text], rounds[text]]),
            "submissions": state_digest(submissions[text]),
        }
    return states


def record_applied(
    conn: Connection,
    actor: Actor,
    key: str,
    pid: int,
    changes: Sequence[Mapping[str, Any]],
    previous: Mapping[Text, Mapping[str, Any]],
    results: Mapping[Text, Mapping[str, Any]],
) -> dict[str, Any] | None:
    """Record an applied bulk Change final… (one audit event) with what its
    Undo needs, after the texts changed; returns the Undo's handle, or None
    when nothing changed. ``results`` are the selections the action made."""
    if not changes:
        return None
    now = datetime.now(UTC)
    expires = now + timedelta(minutes=UNDO_MINUTES)
    texts = [(item["case_id"], item["language"]) for item in changes]
    states = text_states(conn, pid, texts)
    record_audit(
        conn,
        actor,
        APPLIED,
        target_type="project",
        target_id=key,
        project_id=pid,
        details={
            "rule": "newest_submission",
            "expires_at": expires.isoformat(),
            "texts": [
                {
                    "case_id": text[0],
                    "language": text[1],
                    "previous": dict(previous[text]),
                    "document_id": results[text]["document_id"],
                    "submission_id": results[text]["submission_id"],
                    "revision": results[text]["revision"],
                    "state": states[text],
                }
                for text in texts
            ],
        },
        at=now,
    )
    # Under the exclusive project lock: the newest such event is this one.
    event_id = conn.execute(
        select(func.max(AuditEventRow.id)).where(
            AuditEventRow.project_id == pid, AuditEventRow.action == APPLIED
        )
    ).scalar_one()
    return {"id": int(event_id), "expires_at": expires}


def _record(
    conn: Connection, actor: Actor, pid: int, undo_id: int, now: datetime
) -> tuple[Any, dict[str, Any]]:
    """The applied action ``undo_id`` names, if this lead may still undo it."""
    event = conn.execute(
        select(AuditEventRow).where(
            AuditEventRow.id == undo_id,
            AuditEventRow.project_id == pid,
            AuditEventRow.action == APPLIED,
        )
    ).one_or_none()
    if event is None or event.actor_user_id != actor.user_id:
        raise _stale("not_found")
    record = dict(event.details)
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
    return event, record


def undo(
    conn: Connection, actor: Actor, key: str, pid: int, undo_id: int, *, preview: bool
) -> dict[str, Any]:
    """Preview or apply the Undo of the bulk Change final… ``undo_id`` on
    ``conn``, which holds the project lock (exclusive to apply) and has
    authorized the caller for final results."""
    assert actor.user_id is not None
    now = datetime.now(UTC)
    event, record = _record(conn, actor, pid, undo_id, now)
    entries: list[dict[str, Any]] = list(record["texts"])
    texts: list[Text] = [(item["case_id"], item["language"]) for item in entries]
    states = text_states(conn, pid, texts)
    version_of: dict[str, int] = {
        document_id: int(version)
        for document_id, version in conn.execute(
            select(DocumentRow.document_id, DocumentRow.version).where(
                DocumentRow.project_id == pid,
                DocumentRow.document_id.in_(
                    sorted(
                        {item["document_id"] for item in entries}
                        | {item["previous"]["document_id"] for item in entries}
                    )
                ),
            )
        ).tuples()
    }
    people = person_refs(
        conn,
        {int(item["previous"]["actor_id"]) for item in entries},
        viewer_id=actor.user_id,
        viewer_is_lead=True,
    )
    restores: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    for item, text in zip(entries, texts, strict=True):
        ref = {"case_id": text[0], "language": text[1]}
        before = item["previous"]
        reason = next(
            (
                part
                for part in item["state"]
                if states[text][part] != item["state"][part]
            ),
            None,
        )
        if reason is not None:
            blocked.append(ref | {"reason": reason, "message": BLOCKS[reason]})
            continue
        selector = people.get(int(before["actor_id"]))
        restores.append(
            ref
            | {
                "document_id": before["document_id"],
                "submission_id": before["submission_id"],
                "version": version_of.get(before["document_id"]),
                "from_document_id": item["document_id"],
                "from_submission_id": item["submission_id"],
                "from_version": version_of.get(item["document_id"]),
                "selected_by": None if selector is None else selector.model_dump(),
                "selected_at": before["selected_at"],
            }
        )
    exports_since = int(
        conn.execute(
            select(func.count())
            .select_from(ExportSelectionSnapshotRow)
            .where(
                ExportSelectionSnapshotRow.project_id == pid,
                ExportSelectionSnapshotRow.created_at >= event.at,
            )
        ).scalar_one()
    )
    view: dict[str, Any] = {
        "project": key,
        "undo_id": undo_id,
        "applied": False,
        "expires_at": record["expires_at"],
        "texts": len(entries),
        "restore_count": len(restores),
        "blocked_count": len(blocked),
        "restores": restores,
        "blocked": blocked,
        "exports_since": exports_since,
    }
    if preview:
        return view
    if blocked:
        raise _stale("changed", preview=view)
    rows = {
        (row["case_id"], row["language"]): row
        for row in conn.execute(
            select(FinalSelectionRow)
            .where(
                FinalSelectionRow.project_id == pid,
                tuple_(FinalSelectionRow.case_id, FinalSelectionRow.language).in_(
                    _pairs(texts)
                ),
            )
            .with_for_update()
        ).mappings()
    }
    for item, text in zip(entries, texts, strict=True):
        _restore(conn, actor, key, pid, undo_id, text, item, rows[text], now)
    record_audit(
        conn,
        actor,
        UNDONE,
        target_type="project",
        target_id=key,
        project_id=pid,
        details={
            "undo_of": undo_id,
            "texts": [[case_id, language] for case_id, language in texts],
            "exports_since": exports_since,
        },
        at=now,
    )
    return view | {"applied": True}


def _restore(
    conn: Connection,
    actor: Actor,
    key: str,
    pid: int,
    undo_id: int,
    text: Text,
    item: Mapping[str, Any],
    row: RowMapping,
    now: datetime,
) -> None:
    """Put back the final selection ``item`` recorded for ``text``: result,
    lead, time, confirmed warnings and the PLAN_RESTORED marker. The
    revision moves on from the current one."""
    before = item["previous"]
    selected_at = datetime.fromisoformat(before["selected_at"])
    values = {
        "document_id": before["document_id"],
        "submission_id": before["submission_id"],
        "revision": int(row["revision"]) + 1,
        "actor_id": int(before["actor_id"]),
        "acknowledged_cause_ids": list(before["acknowledged_cause_ids"]),
        "updated_at": now,
        "selected_at": selected_at,
        "adjudicator_not_annotator": before["adjudicator_not_annotator"],
    }
    conn.execute(
        update(FinalSelectionRow)
        .where(FinalSelectionRow.id == row["id"])
        .values(**values)
    )
    if before["restored_revision"] is not None:
        work_plan_store.set_restored(
            conn, pid, RowKey(*text), int(before["restored_revision"])
        )
    event = {
        "case_id": text[0],
        "language": text[1],
        "document_id": values["document_id"],
        "submission_id": values["submission_id"],
        "revision": values["revision"],
        "adjudicator_not_annotator": values["adjudicator_not_annotator"],
        "actor_id": values["actor_id"],
        "acknowledged_cause_ids": values["acknowledged_cause_ids"],
        "selected_at": before["selected_at"],
        # The lead who undid the change; ``actor_id`` is the lead whose
        # choice came back.
        "restored": True,
        "restored_by": actor.user_id,
        "undo_of": undo_id,
    }
    conn.execute(insert(FinalSelectionEventRow).values(project_id=pid, payload=event))
    record_audit(
        conn,
        actor,
        "project.final_selection",
        target_type="project",
        target_id=key,
        project_id=pid,
        details={**event, "via": VIA_UNDO},
        at=now,
    )
