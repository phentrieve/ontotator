"""Carry annotation from proposals to a corrected text version (issue 414), pure.

A decision on an old proposal moves to its counterpart on the new version:
the proposal the re-anchor job made from it (its ``source_refs`` name the old
proposal), else the only new proposal with the same layer and term on the
mapped span. Findings the person made (corrections and added findings) are
re-anchored like annotation from scratch. Only what touches a changed passage,
or an accepted or corrected proposal without a counterpart, needs a check;
a rejection without a counterpart is dropped.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from ontotator.domain.annotations import AnnotationRef, AnnotationSnapshot
from ontotator.domain.reanchor import Carried, NeedsReview, TextMap, reanchor_annotation
from ontotator.domain.review import ReviewDecision


@dataclass(frozen=True)
class CarriedDecision:
    """A confirm, reject or uncertain decision moved to a new proposal."""

    target: AnnotationRef
    decision: ReviewDecision


@dataclass(frozen=True)
class CarriedItem:
    """A finding carried as a round input.

    ``checked``: carried as it is (unchanged text, nothing lost); otherwise it
    is "Check needed". ``decision``: the ``changed`` decision a correction
    came with; ``proposal``: the new proposal it replaces there (None: an own
    finding).
    """

    original: AnnotationSnapshot
    mapped: Carried | NeedsReview
    checked: bool
    decision: ReviewDecision | None = None
    proposal: AnnotationRef | None = None


@dataclass(frozen=True)
class ProposalCarryPlan:
    decisions: tuple[CarriedDecision, ...]
    items: tuple[CarriedItem, ...]


def _ref(snapshot: AnnotationSnapshot) -> AnnotationRef:
    return AnnotationRef(
        annotation_id=snapshot.annotation.annotation_id, version=snapshot.version
    )


def _key(ref: AnnotationRef) -> tuple[str, str]:
    return ref.annotation_id, ref.version


def _spans(snapshot: AnnotationSnapshot) -> list[tuple[object, ...]]:
    return sorted(
        (
            tuple((s.start, s.end) for s in e.mention.segments),
            tuple((s.start, s.end) for s in e.mention.cue_segments),
        )
        for e in snapshot.evidence
    )


def _mapped_spans(mapped: Carried) -> list[tuple[object, ...]]:
    return sorted(
        (
            tuple((s.start, s.end) for s in e.segments),
            tuple((s.start, s.end) for s in e.cue_segments),
        )
        for e in mapped.evidence
    )


def counterpart(
    proposal: AnnotationSnapshot,
    mapped: Carried | NeedsReview,
    new_proposals: Sequence[AnnotationSnapshot],
) -> AnnotationSnapshot | None:
    """The new proposal an old one became, if exactly one.

    Re-anchored sets link each proposal to its source (``source_refs``); an
    independently imported set is matched by layer, term and mapped span.
    """
    old_id = proposal.annotation.annotation_id
    linked = [p for p in new_proposals if old_id in p.annotation.provenance.source_refs]
    if linked:
        return linked[0] if len(linked) == 1 else None
    if not isinstance(mapped, Carried):
        return None
    spans = _mapped_spans(mapped)
    same = [
        p
        for p in new_proposals
        if p.annotation.layer_id == proposal.annotation.layer_id
        and p.annotation.term_id == proposal.annotation.term_id
        and _spans(p) == spans
    ]
    return same[0] if len(same) == 1 else None


def plan_proposal_carry(
    snapshots: Sequence[AnnotationSnapshot],
    decisions: Sequence[ReviewDecision],
    old_proposals: Sequence[AnnotationSnapshot],
    new_proposals: Sequence[AnnotationSnapshot],
    old_text: str,
    new_text: str,
    mapping: TextMap,
) -> ProposalCarryPlan:
    """Decisions and findings of proposals work on ``old_text``, for ``new_text``.

    ``snapshots`` and ``decisions`` are a submission's (or a frozen draft's);
    ``old_proposals`` the old version's proposals, ``new_proposals`` the new
    version's targets. Each new proposal takes at most one decision; one the
    old work did not reach stays undecided.
    """
    by_ref = {_key(_ref(s)): s for s in [*old_proposals, *snapshots]}
    used: set[tuple[str, str]] = set()

    def mapped_of(snapshot: AnnotationSnapshot) -> Carried | NeedsReview:
        return reanchor_annotation(
            snapshot, snapshot.evidence, old_text, new_text, mapping
        )

    def match(target: AnnotationRef) -> AnnotationSnapshot | None:
        proposal = by_ref.get(_key(target))
        if proposal is None:
            return None
        found = counterpart(proposal, mapped_of(proposal), new_proposals)
        if found is None or _key(_ref(found)) in used:
            return None
        used.add(_key(_ref(found)))
        return found

    carried: list[CarriedDecision] = []
    items: list[CarriedItem] = []
    ordered = sorted(decisions, key=lambda d: _key(d.target))
    for decision in ordered:
        if decision.outcome == "changed":
            continue  # with its replacement below
        found = match(decision.target)
        if found is not None:
            carried.append(CarriedDecision(_ref(found), decision))
            continue
        proposal = by_ref.get(_key(decision.target))
        # Decision 6 (#414): a rejection without counterpart is dropped; an
        # accepted proposal becomes an own finding to check.
        if decision.outcome != "rejected" and proposal is not None:
            items.append(CarriedItem(proposal, mapped_of(proposal), checked=False))
    replaced = {_key(d.replacement): d for d in ordered if d.replacement is not None}
    decided = {_key(d.target) for d in decisions}
    for snapshot in snapshots:
        identity = _key(_ref(snapshot))
        if identity in decided:
            continue  # a confirmed or uncertain proposal: carried as a decision
        mapped = mapped_of(snapshot)
        changed = replaced.get(identity)
        if changed is None:
            items.append(
                CarriedItem(snapshot, mapped, checked=isinstance(mapped, Carried))
            )
            continue
        found = match(changed.target) if isinstance(mapped, Carried) else None
        items.append(
            CarriedItem(
                snapshot,
                mapped,
                checked=found is not None,
                decision=changed,
                proposal=_ref(found) if found is not None else None,
            )
        )
    return ProposalCarryPlan(tuple(carried), tuple(items))
