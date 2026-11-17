"""Mutation gates shared by annotation and translation-review task paths."""

from sqlalchemy import Connection

from ontotator.domain.errors import DomainError
from ontotator.storage.text_pause import task_pause


def require_task_writable(conn: Connection, assignment_id: int) -> None:
    """The one answer to "may this task be worked on now" for every write of
    annotation, review, consolidation and translation review work: refused
    with ``TASK_HELD`` while a pause holds, whichever cause. ``causes`` names
    them (``report``: a problem report; ``lead``: the lead paused the text,
    issue 464); ``reason`` is the first cause's, ``lead_reason`` the lead's.
    Reading stays possible."""
    pause = task_pause(conn, assignment_id)
    if pause is not None:
        raise DomainError("TASK_HELD", pause | {"assignment_id": assignment_id})
