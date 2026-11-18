"""Typography hints: rules, positions in code points, and what stays quiet."""

import time
from collections.abc import Callable

import pytest

from ontotator.domain.typography import (
    TYPOGRAPHY_RULES,
    TypographyHint,
    count_by_rule,
    typography_hints,
)

NBSP = "\N{NO-BREAK SPACE}"
ZWSP = "\N{ZERO WIDTH SPACE}"
BOM = "\N{ZERO WIDTH NO-BREAK SPACE}"
SHY = "\N{SOFT HYPHEN}"
FACE = "\N{GRINNING FACE}"  # outside the Basic Multilingual Plane
ACUTE = "\N{COMBINING ACUTE ACCENT}"
MISSING = "MISSING_SPACE_AFTER_PUNCTUATION"
BEFORE = "SPACE_BEFORE_PUNCTUATION"
_SHORT_RUN = 10_000  # characters; the linear-time test also uses 4 times this


def found(text: str) -> list[tuple[str, str]]:
    """Each hint as (rule, the characters it covers)."""
    return [(hint.rule, text[hint.start : hint.end]) for hint in typography_hints(text)]


def rules(text: str) -> set[str]:
    return {hint.rule for hint in typography_hints(text)}


def test_a_clean_text_has_no_hints() -> None:
    text = "Kein Fieber, kein Husten.\n\nSeit 2 Wochen Kopfschmerzen (links)."
    assert typography_hints(text) == []
    assert typography_hints("") == []


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Fieber  und Husten", [("DOUBLE_SPACE", "  ")]),
        ("Fieber    und", [("DOUBLE_SPACE", "    ")]),
        ("Fieber , Husten", [(BEFORE, " ")]),
        ("Fieber .\nHusten", [(BEFORE, " ")]),
        ("V. a. Pneumonie ?", [(BEFORE, " ")]),
        ("Fieber,Husten", [(MISSING, ",")]),
        ("Kein Fieber.Husten seit gestern", [(MISSING, ".")]),
        ("Diagnose:Pneumonie", [(MISSING, ":")]),
        ("Fieber;Husten", [(MISSING, ";")]),
        ("Wirklich?Nein", [(MISSING, "?")]),
        ("Fieber \nHusten", [("TRAILING_WHITESPACE_LINE", " ")]),
        ("Fieber \t\r\nHusten", [("TRAILING_WHITESPACE_LINE", " \t"), ("TAB", "\t")]),
        ("Fieber ", [("TRAILING_WHITESPACE_TEXT", " ")]),
        ("Fieber\n\n", [("TRAILING_WHITESPACE_TEXT", "\n\n")]),
        ("Fieber \n", [("TRAILING_WHITESPACE_TEXT", " \n")]),
        (
            "Fieber\t\r\n",
            [("TAB", "\t"), ("TRAILING_WHITESPACE_TEXT", "\t\r\n")],
        ),
        ("Fieber\r\n\r\n", [("TRAILING_WHITESPACE_TEXT", "\r\n\r\n")]),
        ("Fieber \n\n", [("TRAILING_WHITESPACE_TEXT", " \n\n")]),
        ("a\tb", [("TAB", "\t")]),
        (f"Fie{ZWSP}ber", [("ZERO_WIDTH_CHARACTER", ZWSP)]),
        (f"{BOM}Fieber", [("ZERO_WIDTH_CHARACTER", BOM)]),
        (f"Fie{SHY}ber", [("SOFT_HYPHEN", SHY)]),
        ("Fie\x07ber", [("CONTROL_CHARACTER", "\x07")]),
        ("Fieber\rHusten", [("CONTROL_CHARACTER", "\r")]),
        (
            "a\N{RIGHT-TO-LEFT OVERRIDE}b",
            [("CONTROL_CHARACTER", "\N{RIGHT-TO-LEFT OVERRIDE}")],
        ),
    ],
)
def test_each_rule_reports_the_characters_it_means(
    text: str, expected: list[tuple[str, str]]
) -> None:
    assert found(text) == expected


@pytest.mark.parametrize("text", ["Fieber\n", "Fieber\r\n", "Fieber.\nHusten.\n"])
def test_one_final_line_break_is_no_hint(text: str) -> None:
    assert typography_hints(text) == []


@pytest.mark.parametrize(
    "space",
    ["\N{NO-BREAK SPACE}", "\N{NARROW NO-BREAK SPACE}", "\N{FIGURE SPACE}"],
)
def test_non_breaking_spaces_are_no_hint(space: str) -> None:
    # They are often correct ("10 mg", "z. B."); the toggle in the review shows them.
    assert typography_hints(f"10{space}mg und z.{space}B. Fieber") == []
    assert "NON_BREAKING_SPACE" not in TYPOGRAPHY_RULES


def test_every_rule_code_is_produced() -> None:
    text = f"A  b ,c\td{NBSP}e{ZWSP}f{SHY}g\x01 \nWort,Wort \n"
    assert rules(text) == set(TYPOGRAPHY_RULES)


def test_a_run_of_the_same_character_is_one_hint() -> None:
    assert found(f"a{ZWSP}{ZWSP}{BOM}b\t\tc") == [
        ("ZERO_WIDTH_CHARACTER", ZWSP + ZWSP + BOM),
        ("TAB", "\t\t"),
    ]


def test_indentation_and_line_ends_are_not_double_spaces() -> None:
    assert found("  Fieber\n    Husten") == []
    assert found("Fieber  \nHusten") == [("TRAILING_WHITESPACE_LINE", "  ")]
    # Windows line ends are line ends, not control characters.
    assert found("Fieber\r\nHusten") == []


def test_positions_are_code_points_after_astral_characters() -> None:
    # One code point in Python, two UTF-16 units in JavaScript.
    text = f"{FACE}{FACE} Fieber,Husten  x"
    assert len(FACE) == 1 and len(FACE.encode("utf-16-le")) == 4
    assert typography_hints(text) == [
        TypographyHint(MISSING, 9, 10),
        TypographyHint("DOUBLE_SPACE", 16, 18),
    ]
    assert text[9:10] == "," and text[16:18] == "  "


def test_positions_count_combining_marks_as_code_points() -> None:
    # "e" + combining acute: one visible character, two code points.
    word = f"Caf{'e'}{ACUTE}"
    text = f"{word},{word}  {word} ."
    assert typography_hints(text) == [
        TypographyHint(MISSING, 5, 6),
        TypographyHint("DOUBLE_SPACE", 11, 13),
        TypographyHint(BEFORE, 18, 19),
    ]
    # The mark belongs to the word: it does not hide the letter before it.
    assert found(f"Fiebe{'r'}{ACUTE},Husten") == [(MISSING, ",")]


@pytest.mark.parametrize(
    "text",
    [
        # decimals, dates, times, ratios
        "3,5 mg",
        "1.25 mmol/l",
        "am 12.03.2024",
        "am 12.03.",
        "um 12:30 Uhr",
        "Titer 1:80",
        "v1.2.3",
        # abbreviations with dots
        "z.B. Fieber",
        "z.B.Fieber",
        "e.g. fever",
        "i.e. fever",
        "i.v. Gabe",
        "d.h. kein",
        "u.a. Husten",
        "o.B.",
        "a.m.",
        "U.S.A.",
        "Ph.D.",
        "M.Sc.",
        "Dr.med. Meier",
        "Prof.Dr. Meier",
        "Dipl.Ing. Meier",
        "Abb.Tab. 3",
        "PD.Dr Meier",
        # a period before a lower-case word: file names, product names
        "report.pdf",
        "Node.js",
        "siehe befund.docx",
        # ellipses
        "Fieber...Husten",
        "Fieber... Husten",
        "Fieber\N{HORIZONTAL ELLIPSIS}Husten",
        # addresses and identifiers
        "https://www.Example.Com/Pfad,Datei?x=Ab,Cd",
        "http://example.org/a.B",
        "www.Uniklinik.De",
        "Max.Mustermann@Klinik.De",
        "C:\\Daten\\Befund.Docx",
        "mein_Befund.Docx",
        "HP:0001250",
        "OMIM:PS123",
        "MONDO:ABC",
        "CFTR:c.1521_1523del",
        "NM_000492.4:c.1521",
        "p.Arg117His",
        # German gender colon
        "Patient:innen",
        "Ärzt:in",
        # single letters
        "Typ A,B",
        "N,N-Dimethyl",
    ],
)
def test_missing_space_stays_quiet(text: str) -> None:
    assert MISSING not in rules(text), found(text)


@pytest.mark.parametrize(
    "text",
    [
        "Fieber ...",
        "Fieber ... Husten",
        "ca .5 mg",
        "Dosis ,5 mg",
        "mit .NET",
        "Patient :innen",
        "Titer 1 : 80",
        "- , so",
        " .",
        "\n  . Punkt",
    ],
)
def test_space_before_punctuation_stays_quiet(text: str) -> None:
    assert BEFORE not in rules(text), found(text)


def test_hints_are_ordered_by_position() -> None:
    hints = typography_hints(f"b  a ,c\n{ZWSP}x \n")
    assert hints == sorted(hints, key=lambda hint: (hint.start, hint.end, hint.rule))
    assert all(0 <= hint.start < hint.end for hint in hints)


def test_count_by_rule_lists_only_rules_with_hints() -> None:
    hints = typography_hints("a  b  c\td")
    assert count_by_rule(hints) == {"DOUBLE_SPACE": 2, "TAB": 1}


def _cpu_seconds(text: str) -> float:
    """CPU time of one call in this thread; waiting for other work does not count."""
    started = time.thread_time()
    typography_hints(text)
    return time.thread_time() - started


@pytest.mark.parametrize(
    "build",
    [
        pytest.param(lambda n: " " * n + "x", id="spaces-at-start"),
        pytest.param(lambda n: "a" + " " * n, id="spaces-at-end"),
        pytest.param(lambda n: "a" + " \t" * (n // 2) + "b", id="spaces-and-tabs"),
        pytest.param(lambda n: "Ab,Cd" * (n // 5), id="commas-between-words"),
        pytest.param(lambda n: "a." * (n // 2), id="periods-after-letters"),
        pytest.param(lambda n: "x" * n + ".Ab", id="long-word-before-period"),
        pytest.param(
            lambda n: ("a" + " " * (n // 10) + "\n") * 10, id="spaces-at-line-ends"
        ),
    ],
)
def test_long_runs_take_linear_time(build: Callable[[int], str]) -> None:
    # A pattern that retries inside a run takes time that grows with the
    # square of the length. So the test compares two lengths instead of
    # using a time limit: four times the text takes about 4 times as long
    # when the time is linear and about 16 times as long when it is
    # quadratic. The limit of 8 lies in the middle, and the result does not
    # depend on how fast the machine is. The fastest of several calls
    # counts, because other work can only make a call slower.
    short, long = build(_SHORT_RUN), build(4 * _SHORT_RUN)
    short_times, long_times = [], []
    for _ in range(5):
        short_times.append(_cpu_seconds(short))
        long_times.append(_cpu_seconds(long))
    ratio = min(long_times) / min(short_times)
    assert ratio < 8, f"4 times the text took {ratio:.1f} times as long"
