"""Bracketed passages the translation has and the source does not (issue 484)."""

import time

import pytest

from ontotator.domain.bracketed_passages import (
    PASSAGE_LIMIT,
    bracketed_passages,
    check_added_brackets,
)

FACE = "\N{GRINNING FACE}"  # outside the Basic Multilingual Plane
WIDE_OPEN = "\N{FULLWIDTH LEFT PARENTHESIS}"
WIDE_CLOSE = "\N{FULLWIDTH RIGHT PARENTHESIS}"


def texts(text: str) -> list[str]:
    return [passage.text for passage in bracketed_passages(text)]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Gelbsucht (Ikterus) seit gestern", ["(Ikterus)"]),
        ("Wert [erhöht] und (links)", ["[erhöht]", "(links)"]),
        ("außen (innen (tief) noch) Ende", ["(innen (tief) noch)"]),
        ("gemischt (rund [eckig] rund)", ["(rund [eckig] rund)"]),
        (
            f"黄疸{WIDE_OPEN}イクテルス{WIDE_CLOSE}",
            [f"{WIDE_OPEN}イクテルス{WIDE_CLOSE}"],
        ),
        ("leer () bleibt", ["()"]),
        ("ohne Klammern", []),
        ("", []),
    ],
)
def test_a_passage_is_an_outermost_pair_of_brackets(
    text: str, expected: list[str]
) -> None:
    assert texts(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("1) Fieber 2) Husten", []),
        ("a) Fieber (seit gestern)", ["(seit gestern)"]),
        ("offen ( und dann (zu)", ["(zu)"]),
        ("falsch (rund] und (richtig)", ["(richtig)"]),
        ("zu ] vor [auf]", ["[auf]"]),
    ],
)
def test_a_bracket_without_its_partner_is_no_passage(
    text: str, expected: list[str]
) -> None:
    assert texts(text) == expected


def test_positions_are_code_points() -> None:
    text = f"{FACE} Gelbsucht (Ikterus)"
    (passage,) = bracketed_passages(text)
    assert (passage.start, passage.end) == (12, 21)
    assert text[passage.start : passage.end] == passage.text == "(Ikterus)"


def test_more_passages_in_the_translation_fail_and_are_named() -> None:
    check = check_added_brackets(
        "Jaundice and a dose of aspirin (100 mg).",
        "Gelbsucht (Ikterus) und eine Dosis Aspirin (100 mg).",
    )
    assert check.failed
    assert (check.source_count, check.translation_count) == (1, 2)
    # The dose both texts bracket is not named.
    assert [passage.text for passage in check.passages] == ["(Ikterus)"]
    assert not check.truncated


def test_a_translated_passage_is_named_with_the_added_one() -> None:
    check = check_added_brackets(
        "Pain (left side).", "Schmerz (linke Seite) und Gelbsucht (Ikterus)."
    )
    # Which of the two the source has cannot be told: both are named.
    assert [passage.text for passage in check.passages] == [
        "(linke Seite)",
        "(Ikterus)",
    ]


@pytest.mark.parametrize(
    ("source", "translation"),
    [
        ("Jaundice.", "Gelbsucht."),
        ("Pain (left).", "Schmerz (links)."),
        ("Pain (left) and fever (high).", "Schmerz (links) und hohes Fieber."),
        ("1) fever", "1) Fieber"),
    ],
)
def test_as_many_or_fewer_passages_pass(source: str, translation: str) -> None:
    check = check_added_brackets(source, translation)
    assert not check.failed
    assert check.passages == ()


def test_the_same_content_is_matched_once_per_passage() -> None:
    check = check_added_brackets("Dose (5 mg).", "Dosis (5 mg) und (5  MG).")
    # Compared without case and with single spaces; the second one is added.
    assert [(p.start, p.text) for p in check.passages] == [(17, "(5  MG)")]


def test_many_added_passages_are_cut_and_counted() -> None:
    check = check_added_brackets("Text.", " ".join(f"(n{i})" for i in range(60)))
    assert check.translation_count == 60
    assert len(check.passages) == PASSAGE_LIMIT
    assert check.truncated


def test_long_runs_of_brackets_take_little_time() -> None:
    started = time.perf_counter()
    assert bracketed_passages("(" * 20_000 + "x" + "]" * 20_000) == []
    assert len(bracketed_passages("(a)" * 50_000)) == 50_000
    assert time.perf_counter() - started < 5
