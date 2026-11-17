"""Lead pause (issue 464) and new versions of a paused text.

The pause belongs to the text (case, language), not to a version. "Fix
typos…" (editorial correction, issue 453) and "Upload a corrected text…" (issue
341 a) are the lead's own actions and change nobody's work in progress, so
both stay possible on a paused text; a task that follows the correction to
the new version is still paused there.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from test_editorial_correction import correct
from test_lead_correction import accepted as accepted
from test_translation_review_service import review_env as review_env
from test_version_upload import upload
from work_plan_support import write

from ontotator.assignments.service import AssignmentService
from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.storage.tables import AssignmentRow, DocumentRow, ProjectRow
from ontotator.storage.text_pause import write_pause

WHY = "Clinic is checking the text"


def _pause(env: Any) -> None:
    with env.db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        write_pause(
            conn,
            pid,
            "case",
            "de",
            reason=WHY,
            actor_id=None,
            at=datetime(2026, 11, 17, 9, 30, tzinfo=UTC),
        )


def _annotations(env: Any) -> list[Any]:
    """The unrevoked annotation tasks of the German text, with their version."""
    with env.db.transaction() as conn:
        ids = conn.execute(
            select(AssignmentRow.id)
            .join(
                DocumentRow,
                (DocumentRow.project_id == AssignmentRow.project_id)
                & (DocumentRow.document_id == AssignmentRow.document_id),
            )
            .where(
                DocumentRow.case_id == "case",
                DocumentRow.language == "de",
                AssignmentRow.task == "annotate",
                AssignmentRow.revoked_at.is_(None),
            )
            .order_by(AssignmentRow.id)
        ).scalars()
        return [AssignmentService._get(conn, task) for task in ids]


def test_fix_typos_works_on_a_paused_text_and_the_moved_task_stays_paused(accepted):
    env = accepted
    write(env, {RowKey("case", "de"): PlanFlags(False, True)})
    _pause(env)
    # Bob's task was never opened; the other annotation is submitted.
    before, done = _annotations(env)
    assert (before.document_id, before.status) == ("target", "open")
    assert (before.held, before.pause_causes) == (True, ("lead",))
    assert (done.status, done.held) == ("submitted", False)

    result = correct(env)

    assert result["tasks_following"] == 1
    after, still_done = _annotations(env)
    # The same task, on the new version, paused by the same pause.
    assert (after.id, after.document_id) == (before.id, result["document_id"])
    assert (after.held, after.pause_causes) == (True, ("lead",))
    assert after.hold_reason == WHY
    # Submitted work stays where it is and is not paused.
    assert (still_done.document_id, still_done.held) == ("target", False)


def test_upload_new_version_works_on_a_paused_text_and_the_task_stays_paused(
    accepted,
):
    env = accepted
    write(env, {RowKey("case", "de"): PlanFlags(False, True)})
    _pause(env)
    before, _done = _annotations(env)

    result = upload(env)

    assert result["version"] == 2
    after, done = _annotations(env)
    assert after.id == before.id
    assert (after.held, after.pause_causes) == (True, ("lead",))
    assert done.held is False
