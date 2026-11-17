"""Lead pause of a text and what it means for a task (issue 464).

A lead pauses a text: the row of Documents, (case, language), with every
version. The pause is stored once, on ``text_settings``; no task row changes.
A task is paused by the lead while its text is paused and its work is in
progress (the task is not ``submitted``): submitted work is untouched, a task
assigned, reopened or given a new round later is paused from the start, and a
release opens every task at once.

The pause from a problem report (``assignments.held``, ``task_holds``) is a
separate cause. A task may be worked on only when neither holds; every reader
and every write gate asks the expressions here, so both causes are read in
one place:

- ``task_held()``: paused by any cause (what the API calls ``held``).
- ``lead_paused()``: paused by the lead.
- ``pause_columns()``: both, with the reasons, for a ``select`` of
  ``AssignmentRow``; ``pause_causes(row)`` names the causes of such a row.

Connection-scoped, no transactions of its own.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import (
    ColumnElement,
    Connection,
    and_,
    case,
    func,
    or_,
    select,
    tuple_,
    update,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import aliased

from ontotator.storage.plan_tables import TextSettingRow
from ontotator.storage.tables import AssignmentRow, DocumentRow

PauseCause = Literal["report", "lead"]
TextKey = tuple[str, str]  # (case_id, language)

__all__ = [
    "PauseCause",
    "TextPause",
    "lead_pause_reason",
    "lead_paused",
    "pause_causes",
    "pause_columns",
    "paused_texts",
    "task_held",
    "task_pause",
    "write_pause",
    "write_release",
]


@dataclass(frozen=True)
class TextPause:
    """The lead pause of one text."""

    reason: str
    paused_by: int | None
    paused_at: datetime


def lead_pause_reason() -> Any:
    """The reason of the lead pause on the text of an ``AssignmentRow`` (any
    version of it); NULL when the text is not paused. A correlated scalar."""
    document = aliased(DocumentRow)
    return (
        select(TextSettingRow.pause_reason)
        .join(
            document,
            and_(
                document.project_id == TextSettingRow.project_id,
                document.case_id == TextSettingRow.case_id,
                document.language == TextSettingRow.language,
            ),
        )
        .where(
            document.project_id == AssignmentRow.project_id,
            document.document_id == AssignmentRow.document_id,
            TextSettingRow.paused.is_(True),
        )
        .correlate(AssignmentRow)
        .scalar_subquery()
    )


def lead_paused() -> ColumnElement[bool]:
    """The task is paused by the lead: its text is paused and its work is in
    progress. Submitted work is never paused."""
    return and_(AssignmentRow.status != "submitted", lead_pause_reason().is_not(None))


def task_held() -> ColumnElement[bool]:
    """The task is paused, by a problem report or by the lead."""
    return or_(AssignmentRow.held, lead_paused())


def pause_columns() -> tuple[Any, ...]:
    """``held`` (any cause), ``hold_reason`` (the report's, else the lead's),
    ``report_held``, ``lead_paused`` and ``lead_pause_reason`` of an
    ``AssignmentRow``, labelled so."""
    by_lead = lead_paused()
    reason = case((by_lead, lead_pause_reason()), else_=None)
    return (
        or_(AssignmentRow.held, by_lead).label("held"),
        func.coalesce(AssignmentRow.hold_reason, reason).label("hold_reason"),
        AssignmentRow.held.label("report_held"),
        by_lead.label("lead_paused"),
        reason.label("lead_pause_reason"),
    )


def pause_causes(row: Any) -> list[PauseCause]:
    """The causes that pause a row read with ``pause_columns``, the report's
    first."""
    causes: list[PauseCause] = []
    if row["report_held"]:
        causes.append("report")
    if row["lead_paused"]:
        causes.append("lead")
    return causes


def task_pause(conn: Connection, assignment_id: int) -> dict[str, Any] | None:
    """Why the task may not be worked on now, or None when it may: the one
    question every write of annotation, review, consolidation and translation
    review work asks (``workflow_guards.require_task_writable``)."""
    row = (
        conn.execute(select(*pause_columns()).where(AssignmentRow.id == assignment_id))
        .mappings()
        .one()
    )
    if not row["held"]:
        return None
    return {
        "reason": row["hold_reason"],
        "causes": pause_causes(row),
        "lead_reason": row["lead_pause_reason"],
    }


def paused_texts(
    conn: Connection, project_id: int, rows: Iterable[TextKey] | None = None
) -> dict[TextKey, TextPause]:
    """The paused texts of the project (of ``rows`` only, when given)."""
    query = select(
        TextSettingRow.case_id,
        TextSettingRow.language,
        TextSettingRow.pause_reason,
        TextSettingRow.paused_by,
        TextSettingRow.paused_at,
    ).where(TextSettingRow.project_id == project_id, TextSettingRow.paused.is_(True))
    if rows is not None:
        wanted = list(rows)
        if not wanted:
            return {}
        query = query.where(
            tuple_(TextSettingRow.case_id, TextSettingRow.language).in_(wanted)
        )
    return {
        (row.case_id, row.language): TextPause(
            row.pause_reason, row.paused_by, row.paused_at
        )
        for row in conn.execute(query)
    }


def write_pause(
    conn: Connection,
    project_id: int,
    case_id: str,
    language: str,
    *,
    reason: str,
    actor_id: int | None,
    at: datetime,
) -> None:
    """Pause one text; its other settings stay."""
    stmt = insert(TextSettingRow).values(
        project_id=project_id,
        case_id=case_id,
        language=language,
        paused=True,
        pause_reason=reason,
        paused_by=actor_id,
        paused_at=at,
    )
    conn.execute(
        stmt.on_conflict_do_update(
            index_elements=[
                TextSettingRow.project_id,
                TextSettingRow.case_id,
                TextSettingRow.language,
            ],
            set_={
                "paused": True,
                "pause_reason": reason,
                "paused_by": actor_id,
                "paused_at": at,
            },
        )
    )


def write_release(
    conn: Connection, project_id: int, case_id: str, language: str
) -> None:
    """Release one text; who paused it, when and why stay as the record."""
    conn.execute(
        update(TextSettingRow)
        .where(
            TextSettingRow.project_id == project_id,
            TextSettingRow.case_id == case_id,
            TextSettingRow.language == language,
        )
        .values(paused=False)
    )
