"""Hierarchy-aware agreement: partial credit for parent/child terms (#600).

PROTOTYPE for the owner's sign-off (docs/design/hierarchy-agreement.md).
Nothing in the service calls this module yet; it shows the candidate rules
on the same inputs so their numbers can be compared.

The pairing is the one ``ontospan.agreement`` already makes (an optimal
one-to-one assignment per layer). This module never re-pairs: it only gives
each paired *term conflict* a credit between 0 and 1, from the pinned
release's ``is_a`` hierarchy alone. Strict and tolerant figures stay as they
are; the hierarchical F1 is an additional figure:

    hierarchical_f1 = 2 * (equal + compatible + sum(credits)) / (n_a + n_b)

A pair gets credit only when both annotations have evidence that overlaps
(a term conflict of the matching) and their axes are equal: "Seizure,
present" against "Focal seizure, absent" is a real conflict, not a
granularity difference.

Every rule is symmetric (no side is the reference) and uses only
``ancestors(term)`` (every term above it, ``is_a``, transitive, without
itself), the lookup Ontotator already passes to ontospan (#303).
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Iterable
from dataclasses import dataclass
from typing import Literal

__all__ = [
    "RULES",
    "CreditRule",
    "PairedConflict",
    "Relation",
    "credit",
    "hierarchical_f1",
    "relation",
    "steps",
]

# term id -> every term above it (is_a, transitive), without itself.
AncestorsOf = Callable[[str], Collection[str]]
Relation = Literal["same", "ancestor", "sibling", "unrelated"]
CreditRule = Literal["full", "fixed", "per_step", "depth_ratio"]

# The candidate rules of the design note, in its order.
RULES: tuple[CreditRule, ...] = ("full", "fixed", "per_step", "depth_ratio")
FIXED_WEIGHT = 0.5  # rule "fixed"
STEP_FACTOR = 0.5  # rule "per_step": credit = STEP_FACTOR ** steps


@dataclass(frozen=True)
class PairedConflict:
    """A term conflict the one-to-one matching formed (overlapping evidence,
    same layer, other terms)."""

    term_a: str
    term_b: str
    axes_equal: bool = True


def _up(term: str, ancestors: AncestorsOf) -> frozenset[str]:
    """The term and everything above it."""
    return frozenset(ancestors(term)) | {term}


def relation(a: str, b: str, ancestors: AncestorsOf) -> Relation:
    """How two terms sit in the hierarchy; symmetric.

    ``sibling`` means a shared direct parent (a parent of one that is a parent
    of the other), neither being above the other.
    """
    if a == b:
        return "same"
    up_a, up_b = _up(a, ancestors), _up(b, ancestors)
    if a in up_b or b in up_a:
        return "ancestor"
    if _parents(a, ancestors) & _parents(b, ancestors):
        return "sibling"
    return "unrelated"


def _parents(term: str, ancestors: AncestorsOf) -> frozenset[str]:
    """Direct parents, derived from the transitive closure: the ancestors
    that are not above another ancestor."""
    above = frozenset(ancestors(term))
    covered: set[str] = set()
    for t in above:
        covered |= set(ancestors(t))
    return above - covered


def steps(a: str, b: str, ancestors: AncestorsOf) -> int:
    """For an ancestor and its descendant: the terms between them plus one,
    counted as ``|up(specific)| - |up(general)|``. In a tree this is the path
    length; in a DAG it also counts the extra parents of the specific term,
    which is still reproducible from the closure alone."""
    up_a, up_b = _up(a, ancestors), _up(b, ancestors)
    if a not in up_b and b not in up_a:
        raise ValueError(f"{a} and {b} are not ancestor and descendant")
    return abs(len(up_a) - len(up_b))


def credit(
    pair: PairedConflict,
    ancestors: AncestorsOf,
    rule: CreditRule,
    sibling_credit: float = 0.0,
) -> float:
    """The credit of one paired term conflict under ``rule``; symmetric."""
    if not pair.axes_equal:
        return 0.0
    kind = relation(pair.term_a, pair.term_b, ancestors)
    if kind == "same":
        raise ValueError("a pair with the same term is no term conflict")
    if kind == "sibling":
        return sibling_credit
    if kind == "unrelated":
        return 0.0
    if rule == "full":
        return 1.0
    if rule == "fixed":
        return FIXED_WEIGHT
    if rule == "per_step":
        return float(STEP_FACTOR ** steps(pair.term_a, pair.term_b, ancestors))
    # depth_ratio: |up(general)| / |up(specific)|, the Jaccard index of the
    # two up-sets (one contains the other).
    up_a, up_b = _up(pair.term_a, ancestors), _up(pair.term_b, ancestors)
    return min(len(up_a), len(up_b)) / max(len(up_a), len(up_b))


def hierarchical_f1(
    equal: int, compatible: int, credits: Iterable[float], n_a: int, n_b: int
) -> float:
    """The tolerant annotation F1 with the credits of paired term conflicts
    added to the matches. Two empty sets agree (as ``ontospan.matching``)."""
    if n_a + n_b == 0:
        return 1.0
    return 2 * (equal + compatible + sum(credits)) / (n_a + n_b)
