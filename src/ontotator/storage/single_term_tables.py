"""Single-term review (issue 381, migration 0039).

A single-term review judges phrase-term groups derived from a frozen
final-result snapshot (a *basis*). The basis, the batches and the decisions
are append-only history; the state of a batch (open or abandoned) is the
one mutable row, in ``single_term_batch_state`` (pattern
``work_rounds``/``work_round_state``). Every project member may review.

A decision belongs to a phrase-term group across texts, not to a text: the
newest decision per (project, group, role) wins.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from ontotator.storage.tables import SCHEMA, Base

BATCH_ROLES = ("primary", "second")
BATCH_STATES = ("open", "abandoned")
PHRASE_ONLY = ("would_accept", "would_reject")
DECISIONS = ("accept", "adjust_span", "adjust_term", "reject", "withdrawn")
REJECT_REASONS = (
    "needs_context",
    "ambiguous_abbreviation",
    "too_general",
    "needs_rewrite",
    "conflict",
    "other",
)


def _in(values: tuple[str, ...]) -> str:
    return "(" + ", ".join(f"'{value}'" for value in values) + ")"


class SingleTermBasisRow(Base):
    """A frozen final-result snapshot the candidates are derived from.

    ``derivation_sha256`` is the digest of the derivation (groups and
    report); a recomputation from the snapshot must give the same digest. ``report`` holds counts only.
    """

    __tablename__ = "single_term_bases"
    __table_args__ = (Index("ix_single_term_bases_project_id_id", "project_id", "id"),)
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    snapshot_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.export_selection_snapshots.snapshot_id")
    )
    derivation_sha256: Mapped[str]
    report: Mapped[dict[str, Any]]
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class SingleTermBatchRow(Base):
    """A subset of the groups of a basis, frozen at creation, for one reviewer.

    A ``second`` batch is the blind second review of a sample of its
    ``parent_batch_id``'s groups.
    """

    __tablename__ = "single_term_batches"
    __table_args__ = (
        CheckConstraint(f"role IN {_in(BATCH_ROLES)}", name="role"),
        CheckConstraint(
            "(role = 'primary') = (parent_batch_id IS NULL)", name="parent"
        ),
        Index("ix_single_term_batches_project_id_basis_id", "project_id", "basis_id"),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    basis_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.single_term_bases.id")
    )
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    reviewer_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    role: Mapped[str]
    parent_batch_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.single_term_batches.id")
    )
    filter: Mapped[dict[str, Any]]
    group_ids: Mapped[list[Any]]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class SingleTermBatchStateRow(Base):
    """The one mutable fact of a batch: open or abandoned."""

    __tablename__ = "single_term_batch_state"
    __table_args__ = (CheckConstraint(f"state IN {_in(BATCH_STATES)}", name="state"),)
    batch_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.single_term_batches.id"), primary_key=True
    )
    state: Mapped[str]
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )


class SingleTermDecisionRow(Base):
    """One reviewer's judgment of a phrase-term group; never changed.

    ``occurrence_refs`` are the occurrences the group had when decided (a
    later basis marks its new occurrences as not seen by the reviewer).
    ``guideline_version`` is the version in force when decided (NULL when
    none was).
    """

    __tablename__ = "single_term_decisions"
    __table_args__ = (
        CheckConstraint(f"role IN {_in(BATCH_ROLES)}", name="role"),
        CheckConstraint(f"decision IN {_in(DECISIONS)}", name="decision"),
        CheckConstraint(
            f"phrase_only IS NULL OR phrase_only IN {_in(PHRASE_ONLY)}",
            name="phrase_only",
        ),
        CheckConstraint(
            "(decision = 'withdrawn') OR (phrase_only IS NOT NULL)",
            name="phrase_only_given",
        ),
        CheckConstraint(
            f"(decision = 'reject') = (reason IS NOT NULL)"
            f" AND (reason IS NULL OR reason IN {_in(REJECT_REASONS)})",
            name="reason",
        ),
        CheckConstraint(
            "(decision = 'adjust_span') = (adjusted_span IS NOT NULL)",
            name="adjusted_span",
        ),
        CheckConstraint(
            "(decision = 'adjust_term') = (adjusted_term_id IS NOT NULL)",
            name="adjusted_term",
        ),
        ForeignKeyConstraint(
            ["project_id", "guideline_version"],
            [
                f"{SCHEMA}.guideline_versions.project_id",
                f"{SCHEMA}.guideline_versions.version",
            ],
        ),
        Index(
            "ix_single_term_decisions_project_id_group_id_role_id",
            "project_id",
            "group_id",
            "role",
            "id",
        ),
        Index("ix_single_term_decisions_batch_id", "batch_id"),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.projects.id")
    )
    batch_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.single_term_batches.id")
    )
    basis_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.single_term_bases.id")
    )
    group_id: Mapped[str]
    role: Mapped[str]
    language: Mapped[str]
    phrase_norm: Mapped[str]
    term_id: Mapped[str]
    phrase_only: Mapped[str | None]
    decision: Mapped[str]
    adjusted_span: Mapped[dict[str, Any] | None]
    adjusted_term_id: Mapped[str | None]
    reason: Mapped[str | None]
    note: Mapped[str | None]
    occurrence_refs: Mapped[list[Any]]
    reviewer_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id")
    )
    reviewer_pseudonym: Mapped[str]
    reviewer_independent: Mapped[bool]
    guideline_version: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
