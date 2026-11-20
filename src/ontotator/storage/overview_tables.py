"""Documents overview: lead visits, text-change resolutions and draft snapshots."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from ontotator.storage.tables import SCHEMA, Base


def _document_fk(column: str) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        ["project_id", column],
        [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
    )


class DocumentsVisitRow(Base):
    """A lead's Documents visit per project; NEW compares with ``baseline_at``."""

    __tablename__ = "documents_visits"
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id"), primary_key=True
    )
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id"), primary_key=True
    )
    baseline_at: Mapped[datetime]
    last_seen_at: Mapped[datetime]


class TextChangeResolutionRow(Base):
    """How work on an old text version was handled (append-only).

    A submission may have several rows for one target version: every carry
    is kept, also one whose task was withdrawn later (issue 461).

    ``decided_by`` is NULL for the system carry after ``finish_then_carry``;
    that row has ``assignment_id`` NULL and the new submission.
    """

    __tablename__ = "text_change_resolutions"
    __table_args__ = (
        _document_fk("from_document_id"),
        _document_fk("to_document_id"),
        ForeignKeyConstraint(
            ["project_id", "submission_id"],
            [f"{SCHEMA}.submissions.project_id", f"{SCHEMA}.submissions.submission_id"],
        ),
        ForeignKeyConstraint(
            ["project_id", "round_id"],
            [f"{SCHEMA}.work_rounds.project_id", f"{SCHEMA}.work_rounds.round_id"],
        ),
        CheckConstraint(
            "resolution IN ('moved', 'finish_then_carry', 'withdrawn', 'carried',"
            " 'handed_over', 'dismissed')",
            name="resolution",
        ),
        CheckConstraint(
            "num_nonnulls(assignment_id, submission_id) >= 1",
            name="assignment_or_submission",
        ),
        UniqueConstraint("project_id", "assignment_id"),
        # Not unique since 0047 (issue 461): a carry whose task was withdrawn
        # without a submission may be followed by a new carry of the same
        # submission to the same version. The service allows one standing
        # decision (``storage.text_change_carries``).
        Index(
            "ix_text_change_resolutions_submission_target",
            "project_id",
            "submission_id",
            "to_document_id",
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    case_id: Mapped[str]
    language: Mapped[str]
    from_document_id: Mapped[str]
    to_document_id: Mapped[str]
    assignment_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.assignments.id")
    )
    submission_id: Mapped[str | None]
    resolution: Mapped[str]
    round_id: Mapped[str | None]
    decided_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    decided_at: Mapped[datetime] = mapped_column(server_default=func.now())


class TypoFixCarryRow(Base):
    """A submission the system made on a typo fix's new version (issue 465).

    Append-only, one row per carried copy. After "Fix typos…" the person's
    submitted annotation (``source_submission_id`` on ``from_document_id``)
    is moved to the new version without anyone's click: the copy
    (``submission_id`` on ``to_document_id``) has the same author and the
    same findings, placed on the new text. This row is the copy's origin:
    it is not a second annotation of that person (exports, counts) and it
    names the correction (``correction_id``) that caused it.
    """

    __tablename__ = "typo_fix_carries"
    __table_args__ = (
        _document_fk("from_document_id"),
        _document_fk("to_document_id"),
        ForeignKeyConstraint(
            ["project_id", "submission_id"],
            [f"{SCHEMA}.submissions.project_id", f"{SCHEMA}.submissions.submission_id"],
        ),
        ForeignKeyConstraint(
            ["project_id", "source_submission_id"],
            [f"{SCHEMA}.submissions.project_id", f"{SCHEMA}.submissions.submission_id"],
        ),
        UniqueConstraint("project_id", "submission_id"),
        Index(
            "ix_typo_fix_carries_source",
            "project_id",
            "source_submission_id",
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    submission_id: Mapped[str]
    source_submission_id: Mapped[str]
    correction_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.translation_editorial_corrections.id")
    )
    from_document_id: Mapped[str]
    to_document_id: Mapped[str]
    carried_at: Mapped[datetime] = mapped_column(server_default=func.now())


class DraftSnapshotRow(Base):
    """A frozen copy of an assignment's draft (append-only, spec I1)."""

    __tablename__ = "draft_snapshots"
    __table_args__ = (
        _document_fk("document_id"),
        Index("ix_draft_snapshots_project_assignment", "project_id", "assignment_id"),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    assignment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.assignments.id")
    )
    document_id: Mapped[str]
    workspace_key: Mapped[str]
    draft_revision: Mapped[int] = mapped_column(BigInteger)
    # The annotations with their evidence; the domain validates the shape.
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
