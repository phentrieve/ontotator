"""Per-text settings: the override of "Annotations per text" (issue 422).

A text is the unit of the work plan, (case, language). Its override replaces
the project's ``annotations_per_text`` as target and as limit; the effective
value is ``override ?? project value``. Every reader of the project value for
one text reads ``effective_per_text`` (or the map of ``per_text_overrides``).
Connection-scoped, no transactions of its own.
"""

from __future__ import annotations

from sqlalchemy import Connection, func, select
from sqlalchemy.dialects.postgresql import insert

from ontotator.storage.plan_tables import TextSettingRow
from ontotator.storage.tables import DocumentRow, ProjectRow

TextKey = tuple[str, str]  # (case_id, language)


def per_text_overrides(conn: Connection, project_id: int) -> dict[TextKey, int]:
    """The project's texts with an override (texts without one: absent)."""
    return {
        (row.case_id, row.language): row.annotations_per_text
        for row in conn.execute(
            select(
                TextSettingRow.case_id,
                TextSettingRow.language,
                TextSettingRow.annotations_per_text,
            ).where(
                TextSettingRow.project_id == project_id,
                TextSettingRow.annotations_per_text.is_not(None),
            )
        )
    }


def per_text_override(
    conn: Connection, project_id: int, case_id: str, language: str
) -> int | None:
    """One text's override; None follows the project value."""
    value: int | None = conn.execute(
        select(TextSettingRow.annotations_per_text).where(
            TextSettingRow.project_id == project_id,
            TextSettingRow.case_id == case_id,
            TextSettingRow.language == language,
        )
    ).scalar_one_or_none()
    return value


def effective_per_text(
    conn: Connection, project_id: int, document_id: str, project_value: int
) -> int:
    """The limit for the text of ``document_id`` (any of its versions)."""
    value: int | None = conn.execute(
        select(TextSettingRow.annotations_per_text)
        .join(
            DocumentRow,
            (DocumentRow.project_id == TextSettingRow.project_id)
            & (DocumentRow.case_id == TextSettingRow.case_id)
            & (DocumentRow.language == TextSettingRow.language),
        )
        .where(
            TextSettingRow.project_id == project_id,
            DocumentRow.document_id == document_id,
        )
    ).scalar_one_or_none()
    return project_value if value is None else value


def project_per_text(conn: Connection, project_id: int) -> int:
    value: int = conn.execute(
        select(ProjectRow.annotations_per_text).where(ProjectRow.id == project_id)
    ).scalar_one()
    return value


def write_per_text(
    conn: Connection,
    project_id: int,
    case_id: str,
    language: str,
    value: int | None,
    *,
    reason: str | None,
    actor_id: int | None,
) -> None:
    """Set (or with None clear) one text's override; the row stays."""
    stmt = insert(TextSettingRow).values(
        project_id=project_id,
        case_id=case_id,
        language=language,
        annotations_per_text=value,
        reason=reason,
        updated_by=actor_id,
    )
    conn.execute(
        stmt.on_conflict_do_update(
            index_elements=[
                TextSettingRow.project_id,
                TextSettingRow.case_id,
                TextSettingRow.language,
            ],
            set_={
                "annotations_per_text": stmt.excluded.annotations_per_text,
                "reason": stmt.excluded.reason,
                "updated_by": stmt.excluded.updated_by,
                "updated_at": func.now(),
            },
        )
    )
