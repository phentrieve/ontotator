"""Whether an earlier carry of a submission still stands (issue 461).

``text_change_resolutions`` is append-only: a carry that no longer counts is
never changed or deleted. Whether it still stands is read from the task it
created.
"""

from sqlalchemy import ColumnElement, and_, exists, select
from sqlalchemy.orm import aliased

from ontotator.storage.overview_tables import TextChangeResolutionRow
from ontotator.storage.tables import AssignmentRow
from ontotator.storage.workflow_tables import RoundSubmissionBindingRow, WorkRoundRow


def carry_lapsed() -> ColumnElement[bool]:
    """SQL: this ``TextChangeResolutionRow`` is a carry whose task is gone.

    True for ``carried`` and ``handed_over`` when the task of the carry's
    round was withdrawn or removed (revoked) and the round has no submission.
    A task that was moved to a newer version is not gone: the carried work
    continues there. ``dismissed`` never lapses, and neither does a decision
    about an assignment.
    """
    moved = aliased(TextChangeResolutionRow)
    return and_(
        TextChangeResolutionRow.resolution.in_(("carried", "handed_over")),
        exists(
            select(WorkRoundRow.round_id)
            .join(AssignmentRow, AssignmentRow.id == WorkRoundRow.assignment_id)
            .where(
                WorkRoundRow.project_id == TextChangeResolutionRow.project_id,
                WorkRoundRow.round_id == TextChangeResolutionRow.round_id,
                AssignmentRow.revoked_at.is_not(None),
                ~exists(
                    select(RoundSubmissionBindingRow.submission_id).where(
                        RoundSubmissionBindingRow.project_id == WorkRoundRow.project_id,
                        RoundSubmissionBindingRow.round_id == WorkRoundRow.round_id,
                    )
                ),
                ~exists(
                    select(moved.id).where(
                        moved.project_id == WorkRoundRow.project_id,
                        moved.assignment_id == AssignmentRow.id,
                        moved.resolution == "moved",
                    )
                ),
            )
        ),
    )
