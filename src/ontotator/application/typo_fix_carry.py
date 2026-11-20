"""Submitted annotations follow a typo fix by themselves (issue 465).

After "Fix typos…" a submitted annotation moves to the new version without
any click by the lead or the annotator, only when every finding re-anchors
unambiguously and the correction changed no number. The system then does
what the lead's "Carry to v2…" and the person's new submit would do: the
author gets a task on the new version whose round carries the submission,
every carried finding is placed and its input completed, and the system
stores the submission of that round. That submission is the same person's
annotation: same author, same findings, the guideline version they worked
with. ``typo_fix_carries`` records it as a copy of the source submission
made by the typo fix, so it is not a second annotation; the task on the old
version is withdrawn (the annotation moved), and the copy adds no working
time (nobody worked on it).

Everything else keeps the manual flow ("Carry to v2…", "Handle text
change…") with the reason the preview names per person:

- ``number_changed``: a digit run of the text changed (``numbers_changed``);
- ``final_result``: the text has a final result;
- ``consolidation``: a consolidation task on the corrected version;
- ``translation_not_accepted``: a translation of the text is not accepted:
  a task on the new version would need the lead's confirmation (or wait);
- ``from_proposals``: work from tool proposals needs the new version's own
  proposals, which only the background re-anchoring job makes;
- ``task_paused``: the task is paused;
- ``findings_need_check``: a finding cannot be placed on the new text;
- ``not_submitted``: started work (the person may have the editor open);
- ``not_carryable``: any other refusal of the carry at save time.

The caller (the editorial correction) holds the exclusive project lock.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import Connection, insert, select, update

from ontotator.auth.audit import Actor, record_audit
from ontotator.auth.authority import lock_user_authority
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.errors import DomainError
from ontotator.domain.scopes import build_scope
from ontotator.domain.variants import VariantInfo
from ontotator.domain.workspace import Submission
from ontotator.projects.assignments import revoke_assignments
from ontotator.storage.final_tables import FinalSelectionRow
from ontotator.storage.live_submissions import live_submission_ref
from ontotator.storage.overview_tables import TypoFixCarryRow
from ontotator.storage.repository import Repository, _key_str
from ontotator.storage.tables import (
    AssignmentRow,
    DraftRow,
    ProjectRow,
    SubmissionRow,
    UserRow,
)

logger = logging.getLogger(__name__)

# The actor of the carry after a typo fix: nobody clicked.
TYPO_FIX_ACTOR = Actor(user_id=None, label="system:typo_fix")
# ``revoke_assignments`` reason of the old task whose annotation moved.
CARRIED_REASON = "typo_fix_carried"
AUDIT_ACTION = "text_change.typo_fix_carry"

CarryReason = Literal[
    "number_changed",
    "final_result",
    "consolidation",
    "translation_not_accepted",
    "from_proposals",
    "task_paused",
    "findings_need_check",
    "not_submitted",
    "not_carryable",
]

_DIGITS = re.compile(r"\d+")


def digit_runs(text: str) -> list[str]:
    """The runs of digits of ``text`` in order ("12.03.2020" -> 12, 03, 2020)."""
    return _DIGITS.findall(text)


def numbers_changed(old: str, new: str) -> bool:
    """Whether a correction changed a number: a digit added, removed or
    changed anywhere in the text, or a number split or joined.

    The texts are compared by their runs of digits, so only the characters
    between numbers may change: "0.5" -> "0,5" or "12.03." -> "12. 03." keep
    every number; "12" -> "1 2", "03" -> "3" and "14" -> "41" do not. Any
    Unicode decimal digit counts.
    """
    return digit_runs(old) != digit_runs(new)


@dataclass(frozen=True)
class CarryItem:
    """One person's work on the corrected version that does not follow by
    itself as an unopened task, and whether the typo fix carries it."""

    assignment_id: int
    user_id: int
    username: str
    display_name: str
    status: Literal["submitted", "started"]
    submission_id: str | None
    findings: int
    needs_check: int
    # None: carried automatically; else why it stays for the manual flow.
    reason: CarryReason | None
    # After the save: the copy on the new version.
    carried_submission_id: str | None = None

    @property
    def carried(self) -> bool:
        return self.reason is None

    def view(self) -> dict[str, Any]:
        return {
            "username": self.username,
            "display_name": self.display_name,
            "status": self.status,
            "carried": self.carried,
            "reason": self.reason,
            "findings": self.findings,
            "needs_check": self.needs_check,
        }


def _text_reason(
    conn: Connection, pid: int, variant: VariantInfo, previous: str, proposed: str
) -> CarryReason | None:
    """Why no annotation of this text is carried automatically, if any."""
    if numbers_changed(previous, proposed):
        return "number_changed"
    final = conn.execute(
        select(FinalSelectionRow.submission_id).where(
            FinalSelectionRow.project_id == pid,
            FinalSelectionRow.case_id == variant.case_id,
            FinalSelectionRow.language == variant.language,
        )
    ).first()
    if final is not None:
        return "final_result"
    consolidation = conn.execute(
        select(AssignmentRow.id).where(
            AssignmentRow.project_id == pid,
            AssignmentRow.document_id == variant.document_id,
            AssignmentRow.task == "review",
            AssignmentRow.revoked_at.is_(None),
        )
    ).first()
    if consolidation is not None:
        return "consolidation"
    from ontotator.application.text_targets import (
        TextRow,
        text_translation_statuses,
    )
    from ontotator.domain.next_steps import translations_accepted

    statuses = text_translation_statuses(
        conn, pid, TextRow(variant.case_id, variant.language)
    )
    if not translations_accepted(False, statuses):
        return "translation_not_accepted"
    return None


def plan_carry(
    conn: Connection,
    repo: Repository,
    key: str,
    pid: int,
    variant: VariantInfo,
    previous: str,
    proposed: str,
) -> list[CarryItem]:
    """Per person with started or submitted annotation work on ``variant``:
    whether the typo fix to ``proposed`` carries it, and why not.

    Read only. Unopened tasks are not listed: they follow by themselves.
    """
    from ontotator.application.text_changes import (
        TextChangeService,
        editable_findings,
        unplaced_findings,
    )
    from ontotator.assignments.service import unopened_tasks

    text_reason = _text_reason(conn, pid, variant, previous, proposed)
    waiting = set(
        conn.execute(
            select(AssignmentRow.id).where(*unopened_tasks(pid, variant.document_id))
        ).scalars()
    )
    rows = conn.execute(
        select(
            AssignmentRow.id,
            AssignmentRow.user_id,
            AssignmentRow.status,
            AssignmentRow.held,
            AssignmentRow.last_submission_id,
            live_submission_ref(
                AssignmentRow.project_id, AssignmentRow.last_submission_id
            ).label("live"),
            UserRow.username,
            UserRow.display_name,
        )
        .join(UserRow, UserRow.id == AssignmentRow.user_id)
        .where(
            AssignmentRow.project_id == pid,
            AssignmentRow.document_id == variant.document_id,
            AssignmentRow.task == "annotate",
            AssignmentRow.revoked_at.is_(None),
        )
        .order_by(UserRow.display_name, UserRow.username, AssignmentRow.id)
    ).all()
    profile = repo.get_task_profile(key)
    service = TextChangeService(repo.db, repo)
    items: list[CarryItem] = []
    for row in rows:
        if row.id in waiting:
            continue
        base = {
            "assignment_id": int(row.id),
            "user_id": int(row.user_id),
            "username": row.username,
            "display_name": row.display_name,
        }
        submission = (
            repo.get_submission(row.last_submission_id, key)
            if row.status == "submitted" and row.last_submission_id and row.live
            else None
        )
        if submission is None:
            items.append(
                CarryItem(
                    **base,
                    status="started" if row.status != "submitted" else "submitted",
                    submission_id=None,
                    findings=0,
                    needs_check=0,
                    reason="not_submitted"
                    if row.status != "submitted"
                    else "not_carryable",
                )
            )
            continue
        findings = editable_findings(submission.snapshots, profile)
        unplaced = len(unplaced_findings(findings, previous, proposed))
        reason: CarryReason | None = text_reason
        if reason is None and submission.origin_key.mode == "proposal_check":
            reason = "from_proposals"
        elif reason is None and submission.origin_key.mode != "independent":
            reason = "not_carryable"
        elif reason is None and row.held:
            reason = "task_paused"
        elif reason is None and unplaced:
            reason = "findings_need_check"
        elif reason is None and len(findings) != len(submission.snapshots):
            # A finding in a read-only layer is not carried (as "Carry to v2…").
            reason = "not_carryable"
        if reason is None:
            try:
                service._check_submission(
                    conn, key, pid, submission.submission_id, submission
                )
            except DomainError as refusal:
                reason = (
                    "task_paused" if refusal.code == "TASK_HELD" else "not_carryable"
                )
        items.append(
            CarryItem(
                **base,
                status="submitted",
                submission_id=submission.submission_id,
                findings=len(findings),
                needs_check=unplaced,
                reason=reason,
            )
        )
    return items


def carry_after_typo_fix(
    conn: Connection,
    repo: Repository,
    *,
    key: str,
    pid: int,
    source: VariantInfo,
    target_document_id: str,
    correction_id: int,
    items: list[CarryItem],
    now: datetime,
) -> list[CarryItem]:
    """Carry every item the plan allows to ``target_document_id``.

    Each carry runs in its own savepoint: a refusal leaves that submission
    on the old version for the manual flow (``not_carryable``, logged) and
    the others carry on. Returns the items with the copies they made.
    """
    done: list[CarryItem] = []
    for item in items:
        if not item.carried:
            done.append(item)
            continue
        try:
            with repo.db.savepoint(conn):
                copy = _carry_one(
                    conn,
                    repo,
                    key=key,
                    pid=pid,
                    source=source,
                    target_document_id=target_document_id,
                    correction_id=correction_id,
                    item=item,
                    now=now,
                )
        except DomainError as error:
            logger.warning(
                "No automatic carry of submission %s after a typo fix: %s %s",
                item.submission_id,
                error.code,
                error.details,
            )
            done.append(replace(item, reason="not_carryable"))
            continue
        except Exception:
            # The fix itself stands; this annotation keeps the manual flow.
            logger.exception(
                "Automatic carry of submission %s after a typo fix failed",
                item.submission_id,
            )
            done.append(replace(item, reason="not_carryable"))
            continue
        done.append(replace(item, carried_submission_id=copy))
    return done


def _carry_one(
    conn: Connection,
    repo: Repository,
    *,
    key: str,
    pid: int,
    source: VariantInfo,
    target_document_id: str,
    correction_id: int,
    item: CarryItem,
    now: datetime,
) -> str:
    """One carry: the task on the new version, its round with every finding
    placed, the system's submission, the old task withdrawn and the record."""
    from ontotator.application.text_changes import TextChangeService

    assert item.submission_id is not None
    service = TextChangeService(repo.db, repo)
    submission = repo.get_submission(item.submission_id, key)
    if submission is None:
        raise DomainError("SUBMISSION_NOT_FOUND")
    service._check_submission(conn, key, pid, item.submission_id, submission)
    old, target = service._check_target(
        conn, key, pid, submission.origin_key.document_id, target_document_id
    )
    if old.document_id != source.document_id:
        raise DomainError("TEXT_CHANGE_NOT_APPLICABLE", {"reason": "not_ancestor"})
    # Idempotent: a submission carried (or dismissed) for this version once
    # is not carried again.
    service._require_not_carried(conn, pid, item.submission_id, target.document_id)
    project_row = (
        conn.execute(select(ProjectRow).where(ProjectRow.id == pid)).mappings().one()
    )
    old_task = (
        conn.execute(
            select(AssignmentRow).where(AssignmentRow.id == item.assignment_id)
        )
        .mappings()
        .one()
    )
    if (
        old_task["revoked_at"] is not None
        or old_task["status"] != "submitted"
        or old_task["last_submission_id"] != item.submission_id
    ):
        raise DomainError("TEXT_CHANGE_NOT_APPLICABLE", {"reason": "not_submitted"})
    # The author's account, as a lead's carry locks it.
    lock_user_authority(conn, item.user_id, target_user_id=item.user_id)
    carried = service._carry_round(
        conn,
        key,
        project_row,
        TYPO_FIX_ACTOR,
        item.submission_id,
        submission.origin_key.annotator_id,
        target,
        mode="author",
        username=None,
        locked_user_id=item.user_id,
        # The author works on this row's language already (as a move).
        confirm_language=True,
        now=now,
        complete=True,
    )
    assert carried.round is not None and carried.assignment_id is not None
    copy = _submit_round(
        conn,
        repo,
        pid=pid,
        round_workspace=carried.round.workspace_key,
        manifest=carried.round.input_manifest_sha256,
        source=submission,
        source_guideline=_guideline_version(conn, pid, item.submission_id),
        assignment_id=carried.assignment_id,
        now=now,
    )
    # The annotation moved: the old task is withdrawn, its submission stays.
    revoke_assignments(
        conn, TYPO_FIX_ACTOR, pid, [dict(old_task)], now, reason=CARRIED_REASON
    )
    TextChangeService._record(
        conn,
        pid,
        old,
        target,
        "carried",
        TYPO_FIX_ACTOR,
        now,
        submission_id=item.submission_id,
        round_id=carried.round.round_id,
    )
    conn.execute(
        insert(TypoFixCarryRow).values(
            project_id=pid,
            submission_id=copy,
            source_submission_id=item.submission_id,
            correction_id=correction_id,
            from_document_id=old.document_id,
            to_document_id=target.document_id,
            carried_at=now,
        )
    )
    record_audit(
        conn,
        TYPO_FIX_ACTOR,
        AUDIT_ACTION,
        target_type="assignment",
        target_id=carried.assignment_id,
        project_id=pid,
        details={
            "assignment_id": carried.assignment_id,
            "from_assignment_id": item.assignment_id,
            "source_submission_id": item.submission_id,
            "submission_id": copy,
            "round_id": carried.round.round_id,
            "from_document_id": old.document_id,
            "to_document_id": target.document_id,
            "from_version": old.version,
            "to_version": target.version,
            "correction_id": correction_id,
            "findings": item.findings,
        },
        at=now,
    )
    return copy


def _guideline_version(conn: Connection, pid: int, submission_id: str) -> int | None:
    found: int | None = conn.execute(
        select(SubmissionRow.guideline_version).where(
            SubmissionRow.project_id == pid,
            SubmissionRow.submission_id == submission_id,
        )
    ).scalar_one_or_none()
    return found


def _submit_round(
    conn: Connection,
    repo: Repository,
    *,
    pid: int,
    round_workspace: Any,
    manifest: str,
    source: Submission,
    source_guideline: int | None,
    assignment_id: int,
    now: datetime,
) -> str:
    """Store the round's draft as its submission, made by the system.

    The submission is built as a submit would build it from this draft (the
    carried findings, every input completed), with the source's checked
    layers. It is not validated again: its findings are those of a
    validated submission, placed on the new text. No edit event: nobody
    edited. The guideline version is the one the person worked with.
    """
    key = round_workspace
    key_string = _key_str(key)
    draft = repo._open_draft(conn, key, None)
    profile = repo.get_task_profile(key.project_key)
    scope = build_scope(profile, key.mode).model_copy(update={"scope_id": key.scope_id})
    snapshots = list(draft.annotations)
    content: dict[str, Any] = {
        "key": key.model_dump(),
        "scope": scope.model_dump(),
        "targets": draft.targets.model_dump(),
        "draft_revision": draft.revision,
        "snapshots": [s.version for s in snapshots],
        "decisions": [],
        "input_manifest_sha256": manifest,
        "round_input_resolutions": [
            r.model_dump(mode="json") for r in draft.round_input_resolutions
        ],
        # A copy is never mistaken for the person's own submit of this draft.
        "carried_from": source.submission_id,
    }
    copy = Submission(
        format_version="ontotator-submission/v3",
        input_manifest_sha256=manifest,
        round_input_resolutions=list(draft.round_input_resolutions),
        submission_id=f"sub-{canonical_hash(content)[:16]}",
        origin_key=key,
        scope=scope,
        targets=draft.targets,
        draft_revision=draft.revision + 1,
        snapshots=snapshots,
        decisions=[],
        checked_layer_ids=list(source.checked_layer_ids),
        document_checked=True,
        created_at=now.isoformat(),
    )
    conn.execute(
        update(DraftRow)
        .where(DraftRow.project_id == pid, DraftRow.draft_key == key_string)
        .values(revision=copy.draft_revision, updated_at=now)
    )
    repo._insert_submission(
        conn,
        pid,
        copy,
        local_key=key_string,
        imported=False,
        guideline_version=source_guideline,
    )
    repo._advance_round(conn, key, copy)
    conn.execute(
        update(AssignmentRow)
        .where(AssignmentRow.id == assignment_id)
        .values(
            status="submitted",
            last_submission_id=copy.submission_id,
            workflow_revision=AssignmentRow.workflow_revision + 1,
            updated_at=now,
        )
    )
    return copy.submission_id


def carried_copies(conn: Connection, pid: int) -> Mapping[str, str]:
    """Copy -> source submission of every carry after a typo fix."""
    return dict(
        conn.execute(
            select(
                TypoFixCarryRow.submission_id, TypoFixCarryRow.source_submission_id
            ).where(TypoFixCarryRow.project_id == pid)
        )
        .tuples()
        .all()
    )


def first_sources(
    conn: Connection, pid: int, submission_ids: list[str]
) -> dict[str, tuple[str, str]]:
    """Per typo-fix copy among ``submission_ids``: the submission the person
    made and its text version, following copies of copies (v1 -> v2 -> v3)."""
    copies = carried_copies(conn, pid)
    found: dict[str, str] = {}
    for submission_id in submission_ids:
        current, seen = submission_id, set()
        while current in copies and current not in seen:
            seen.add(current)
            current = copies[current]
        if current != submission_id:
            found[submission_id] = current
    if not found:
        return {}
    documents = dict(
        conn.execute(
            select(SubmissionRow.submission_id, SubmissionRow.document_id).where(
                SubmissionRow.project_id == pid,
                SubmissionRow.submission_id.in_(sorted(set(found.values()))),
            )
        )
        .tuples()
        .all()
    )
    return {copy: (source, documents[source]) for copy, source in found.items()}


@dataclass(frozen=True)
class TypoFixMove:
    """A task a typo fix made on its new version for a moved annotation.

    ``assignment_id`` and ``round_id`` are the task and round on the new
    version that hold the copy ``submission_id``. The ``first_*`` facts are
    the person's own work, through copies of copies (v1 -> v2 -> v3): the
    submission they made, when, and the task they were given for it.
    """

    assignment_id: int
    round_id: str
    submission_id: str
    from_document_id: str
    moved_at: datetime
    first_submission_id: str
    first_recorded_at: datetime
    first_assignment_id: int | None
    first_assigned_at: datetime | None
    first_assigned_by: int | None


def typo_fix_moves(conn: Connection, pid: int) -> dict[str, TypoFixMove]:
    """Every annotation a typo fix moved in the project, by its copy."""
    from ontotator.storage.workflow_tables import (
        RoundSubmissionBindingRow,
        WorkRoundRow,
    )

    rows = conn.execute(
        select(
            TypoFixCarryRow.submission_id,
            TypoFixCarryRow.source_submission_id,
            TypoFixCarryRow.from_document_id,
            TypoFixCarryRow.carried_at,
            WorkRoundRow.round_id,
            WorkRoundRow.assignment_id,
        )
        .join(
            RoundSubmissionBindingRow,
            (RoundSubmissionBindingRow.project_id == TypoFixCarryRow.project_id)
            & (
                RoundSubmissionBindingRow.submission_id == TypoFixCarryRow.submission_id
            ),
        )
        .join(WorkRoundRow, WorkRoundRow.round_id == RoundSubmissionBindingRow.round_id)
        .where(TypoFixCarryRow.project_id == pid)
    ).all()
    if not rows:
        return {}
    source_of = {row.submission_id: row.source_submission_id for row in rows}

    def first(submission_id: str) -> str:
        seen: set[str] = set()
        while submission_id in source_of and submission_id not in seen:
            seen.add(submission_id)
            submission_id = source_of[submission_id]
        return submission_id

    firsts = {row.submission_id: first(row.submission_id) for row in rows}
    wanted = sorted(set(firsts.values()))
    recorded = dict(
        conn.execute(
            select(SubmissionRow.submission_id, SubmissionRow.recorded_at).where(
                SubmissionRow.project_id == pid,
                SubmissionRow.submission_id.in_(wanted),
            )
        )
        .tuples()
        .all()
    )
    # The task of the person's own submission (withdrawn when it moved; a
    # task keeps its last submission).
    tasks = {
        row.last_submission_id: row
        for row in conn.execute(
            select(
                AssignmentRow.id,
                AssignmentRow.last_submission_id,
                AssignmentRow.created_at,
                AssignmentRow.created_by,
            )
            .where(
                AssignmentRow.project_id == pid,
                AssignmentRow.task == "annotate",
                AssignmentRow.last_submission_id.in_(wanted),
            )
            .order_by(AssignmentRow.id)
        )
    }
    moves: dict[str, TypoFixMove] = {}
    for row in rows:
        own = firsts[row.submission_id]
        task = tasks.get(own)
        moves[row.submission_id] = TypoFixMove(
            assignment_id=int(row.assignment_id),
            round_id=row.round_id,
            submission_id=row.submission_id,
            from_document_id=row.from_document_id,
            moved_at=row.carried_at,
            first_submission_id=own,
            first_recorded_at=recorded[own],
            first_assignment_id=int(task.id) if task is not None else None,
            first_assigned_at=task.created_at if task is not None else None,
            first_assigned_by=task.created_by if task is not None else None,
        )
    return moves


def submission_order_times(
    conn: Connection, pid: int, recorded_at: Mapping[str, datetime]
) -> dict[str, datetime]:
    """``recorded_at`` (submission id -> time) with each typo-fix copy at the
    time the person made the submission it stands for.

    Comparisons and consolidation groups take submissions in this order: a
    copy is the same person's annotation, so the order, and with it every
    tie-break of the grouping, stays as it was before the fix (issue 543).
    All copies of one fix share the fix's time and would otherwise be
    ordered by their random ids.
    """
    moves = typo_fix_moves(conn, pid) if recorded_at else {}
    return {
        sid: moves[sid].first_recorded_at if sid in moves else at
        for sid, at in recorded_at.items()
    }
