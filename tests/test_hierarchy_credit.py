"""Prototype of the hierarchy-aware agreement (#600): the worked example of
docs/design/hierarchy-agreement.md, and the properties every rule must keep."""

from collections.abc import Collection

import pytest

from ontotator.domain.hierarchy_credit import (
    RULES,
    CreditRule,
    PairedConflict,
    credit,
    hierarchical_f1,
    relation,
    steps,
)

# A small synthetic is_a tree with HPO-like labels (not the real HPO graph).
PARENT = {
    "Abnormality of the nervous system": "Phenotypic abnormality",
    "Seizure": "Abnormality of the nervous system",
    "Focal seizure": "Seizure",
    "Generalized seizure": "Seizure",
    "Abnormal muscle tone": "Abnormality of the nervous system",
    "Hypotonia": "Abnormal muscle tone",
    "Generalized hypotonia": "Hypotonia",
    "Growth abnormality": "Phenotypic abnormality",
    "Abnormal body height": "Growth abnormality",
    "Short stature": "Abnormal body height",
    "Fever": "Phenotypic abnormality",
}


def ancestors(term: str) -> Collection[str]:
    found = []
    while term in PARENT:
        term = PARENT[term]
        found.append(term)
    return found


# The worked example: six findings each; one equal pair (Fever, absent),
# four paired term conflicts, one finding only A and one only B marked.
CONFLICTS = (
    PairedConflict("Focal seizure", "Seizure"),  # child / parent
    PairedConflict("Hypotonia", "Generalized hypotonia"),  # parent / child
    PairedConflict("Short stature", "Growth abnormality"),  # two steps
    PairedConflict("Generalized seizure", "Focal seizure"),  # siblings
)
EQUAL, COMPATIBLE, N_A, N_B = 1, 0, 6, 6


def figure(rule: CreditRule, sibling_credit: float = 0.0) -> float:
    credits = [credit(p, ancestors, rule, sibling_credit) for p in CONFLICTS]
    return hierarchical_f1(EQUAL, COMPATIBLE, credits, N_A, N_B)


def test_relations_and_steps_of_the_example() -> None:
    assert [relation(p.term_a, p.term_b, ancestors) for p in CONFLICTS] == [
        "ancestor",
        "ancestor",
        "ancestor",
        "sibling",
    ]
    assert relation("Fever", "Seizure", ancestors) == "unrelated"
    assert [steps(p.term_a, p.term_b, ancestors) for p in CONFLICTS[:3]] == [1, 1, 2]
    with pytest.raises(ValueError):
        steps("Fever", "Seizure", ancestors)


def test_worked_example_figures() -> None:
    strict = hierarchical_f1(EQUAL, COMPATIBLE, [], N_A, N_B)
    assert strict == pytest.approx(2 / 12)  # 0.167, the tolerant F1 today
    assert figure("full") == pytest.approx(2 * 4 / 12)  # 0.667
    assert figure("fixed") == pytest.approx(2 * 2.5 / 12)  # 0.417
    assert figure("per_step") == pytest.approx(2 * 2.25 / 12)  # 0.375
    # Up-set sizes 3/4 (Seizure, Focal seizure), 4/5 and 2/4.
    assert figure("depth_ratio") == pytest.approx(2 * (1 + 0.75 + 0.8 + 0.5) / 12)
    assert figure("fixed", sibling_credit=0.25) == pytest.approx(2 * 2.75 / 12)


@pytest.mark.parametrize("rule", RULES)
def test_every_rule_is_symmetric_and_bounded(rule: CreditRule) -> None:
    for p in CONFLICTS:
        forward = credit(p, ancestors, rule)
        back = credit(PairedConflict(p.term_b, p.term_a), ancestors, rule)
        assert forward == back
        assert 0.0 <= forward <= 1.0


@pytest.mark.parametrize("rule", RULES)
def test_other_axes_and_unrelated_terms_get_no_credit(rule: CreditRule) -> None:
    other_axes = PairedConflict("Focal seizure", "Seizure", axes_equal=False)
    assert credit(other_axes, ancestors, rule) == 0.0
    assert credit(PairedConflict("Fever", "Seizure"), ancestors, rule) == 0.0


@pytest.mark.parametrize("rule", RULES)
def test_a_farther_ancestor_never_gets_more_credit(rule: CreditRule) -> None:
    near = credit(PairedConflict("Focal seizure", "Seizure"), ancestors, rule)
    far = credit(
        PairedConflict("Focal seizure", "Abnormality of the nervous system"),
        ancestors,
        rule,
    )
    assert far <= near


def test_the_hierarchical_figure_is_never_below_the_tolerant_one() -> None:
    tolerant = hierarchical_f1(EQUAL, COMPATIBLE, [], N_A, N_B)
    assert all(figure(rule) >= tolerant for rule in RULES)
    assert hierarchical_f1(0, 0, [], 0, 0) == 1.0  # two empty sets agree
