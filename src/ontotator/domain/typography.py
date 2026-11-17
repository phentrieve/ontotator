"""Typography hints for a text: spacing errors and invisible characters.

Pure and computed on request; a hint is never stored and never blocks
review, annotation or export. Positions are zero-based intervals
``[start, end)`` in Unicode code points, the unit of annotation spans
(``ontotator.domain.documents``). Hints of different rules may overlap.

The rule for a missing space after punctuation prefers missing a case over
a false alarm; see ``_missing_space`` for what it leaves alone.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Iterator
from typing import Literal, NamedTuple, get_args

TypographyRule = Literal[
    "DOUBLE_SPACE",
    "SPACE_BEFORE_PUNCTUATION",
    "MISSING_SPACE_AFTER_PUNCTUATION",
    "TRAILING_WHITESPACE_LINE",
    "TRAILING_WHITESPACE_TEXT",
    "TAB",
    "ZERO_WIDTH_CHARACTER",
    "SOFT_HYPHEN",
    "CONTROL_CHARACTER",
]
TYPOGRAPHY_RULES: tuple[TypographyRule, ...] = get_args(TypographyRule)


class TypographyHint(NamedTuple):
    rule: TypographyRule
    start: int
    end: int


# One hint per run of the same kind of character.
_CHARACTER_RULES: tuple[tuple[TypographyRule, re.Pattern[str]], ...] = (
    ("TAB", re.compile(r"\t+")),
    (
        "ZERO_WIDTH_CHARACTER",
        re.compile(
            "[\N{ZERO WIDTH SPACE}\N{ZERO WIDTH NON-JOINER}\N{ZERO WIDTH JOINER}"
            "\N{WORD JOINER}\N{ZERO WIDTH NO-BREAK SPACE}]+"
        ),
    ),
    ("SOFT_HYPHEN", re.compile("\N{SOFT HYPHEN}+")),
    # C0 and C1 controls except tab and line ends (a carriage return counts
    # only without its line feed), the Unicode line and paragraph
    # separators, and the invisible direction, math and interlinear marks.
    (
        "CONTROL_CHARACTER",
        re.compile(
            "(?:[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f"
            "\N{LEFT-TO-RIGHT MARK}\N{RIGHT-TO-LEFT MARK}"
            "\N{LEFT-TO-RIGHT EMBEDDING}-\N{RIGHT-TO-LEFT OVERRIDE}"
            "\N{LINE SEPARATOR}\N{PARAGRAPH SEPARATOR}"
            "\N{FUNCTION APPLICATION}-\N{INVISIBLE PLUS}"
            "\N{LEFT-TO-RIGHT ISOLATE}-\N{POP DIRECTIONAL ISOLATE}"
            "\N{INTERLINEAR ANNOTATION ANCHOR}-\N{INTERLINEAR ANNOTATION TERMINATOR}"
            "]|\r(?!\n))+"
        ),
    ),
)
# Two or more spaces inside a line: not the indentation at its start and
# not the spaces at its end (those are trailing whitespace).
_DOUBLE_SPACE = re.compile(r"(?<=[^ \r\n]) {2,}(?=[^ \r\n])")
# The lookbehinds start a match only at the start of a run, so a long run of
# spaces is looked at once (linear time).
_SPACE_BEFORE = re.compile(r"(?<! ) +(?=[,;:!?.])")
_LINE_END_SPACE = re.compile(r"(?<![ \t])[ \t]+(?=\r?\n)")
_END_WHITESPACE = " \t\r\n"
_PUNCTUATION = re.compile(r"[,;:!?.]")
_TOKEN = re.compile(r"\S+")
# German gender colon: "Patient:innen", "Ärzt:in".
_GENDER_ENDINGS = frozenset({"in", "innen"})


def _is_letter(char: str) -> bool:
    return unicodedata.category(char).startswith("L")


def _is_mark(char: str) -> bool:
    return unicodedata.category(char).startswith("M")


def _word_before(text: str, end: int) -> str:
    """The letters (with their combining marks) that end right before ``end``."""
    start = end
    while start > 0 and (_is_letter(text[start - 1]) or _is_mark(text[start - 1])):
        start -= 1
    # A word starts with a letter, not with a mark.
    while start < end and _is_mark(text[start]):
        start += 1
    return text[start:end]


def _word_after(text: str, start: int) -> str:
    """The letters (with their combining marks) that start at ``start``."""
    if start >= len(text) or not _is_letter(text[start]):
        return ""
    end = start + 1
    while end < len(text) and (_is_letter(text[end]) or _is_mark(text[end])):
        end += 1
    return text[start:end]


def _letters(word: str) -> str:
    return "".join(char for char in word if _is_letter(char))


def _address_like(token: str) -> bool:
    """A web address, e-mail address, path or identifier, not prose."""
    lowered = token.lower()
    return (
        "://" in token
        or "@" in token
        or "/" in token
        or "\\" in token
        or "_" in token
        or lowered.startswith("www.")
    )


def _missing_space(text: str) -> Iterator[TypographyHint]:
    """Punctuation directly between two words, e.g. "Fieber,Husten".

    Reported only between two words of at least two letters each, so that
    these stay without a hint:

    - numbers: decimals ("3,5", "1.25"), dates ("12.03.2024"), times and
      ratios ("12:30", "1:80"), and identifiers such as "HP:0001250";
    - abbreviations written with dots and single letters ("z.B.", "e.g.",
      "i.v.", "d.h.", "Ph.D.") and chains of short abbreviations
      ("Prof.Dr.", "Dipl.Ing.");
    - a period that is not followed by a capitalised word ("Dr.med.",
      "report.pdf", "Node.js"), and one after a capital letter ("PD.Dr");
    - ellipses ("Fieber...Husten");
    - web and e-mail addresses, paths and identifiers (a token with "://",
      "@", "/", a backslash, "_" or a leading "www.");
    - after a colon: the German gender colon ("Patient:innen"), variant
      notation ("CFTR:c.1521"), and identifiers in capitals or followed
      by a digit ("OMIM:PS123", "MONDO:ABC").
    """
    for token in _TOKEN.finditer(text):
        if not _address_like(token.group()):
            yield from _missing_space_in(text, *token.span())


def _missing_space_in(text: str, start: int, end: int) -> Iterator[TypographyHint]:
    for match in _PUNCTUATION.finditer(text, start, end):
        index, mark = match.start(), match.group()
        before = _word_before(text, index)
        after = _word_after(text, index + 1)
        before_letters, after_letters = _letters(before), _letters(after)
        if len(before_letters) < 2 or len(after_letters) < 2:
            continue
        following = text[index + 1 + len(after) : index + 2 + len(after)]
        if mark == ".":
            preceding = text[index - len(before) - 1 : index - len(before)]
            if (
                not before_letters[-1].islower()
                or not after_letters[0].isupper()
                or not after_letters[1].islower()
                or preceding == "."
                or (following == "." and len(after_letters) <= 4)
            ):
                continue
        elif mark == ":":
            if (
                after_letters.lower() in _GENDER_ENDINGS
                or following.isdigit()
                or (before_letters.isupper() and after_letters.isupper())
            ):
                continue
        yield TypographyHint("MISSING_SPACE_AFTER_PUNCTUATION", index, index + 1)


def _space_before(text: str) -> Iterator[TypographyHint]:
    """Spaces between a word and ``, ; : ! ? .``, e.g. "Fieber , Husten".

    Left alone: a mark that starts an ellipsis ("Fieber ..."), one followed
    by a digit (" .5", " ,5"), a period or colon followed by a letter
    (" .NET", " :innen"), a ratio ("1 : 80"), and spaces that do not follow
    a letter, digit, ")", "]" or "%" (indentation, lists).
    """
    for match in _SPACE_BEFORE.finditer(text):
        start, end = match.span()
        if start == 0:
            continue
        previous, mark = text[start - 1], text[end]
        following = text[end + 1 : end + 2]
        if not (previous.isalnum() or _is_mark(previous) or previous in ")]%"):
            continue
        if mark == "." and following == ".":
            continue
        if following.isdigit() or (mark in ".:" and following.isalpha()):
            continue
        if (
            mark == ":"
            and previous.isdigit()
            and re.match(r" +\d", text[end + 1 : end + 8])
        ):
            continue
        yield TypographyHint("SPACE_BEFORE_PUNCTUATION", start, end)


def typography_hints(text: str) -> list[TypographyHint]:
    """Every hint for ``text``, ordered by start, end and rule."""
    hints: list[TypographyHint] = []
    for rule, pattern in _CHARACTER_RULES:
        hints.extend(
            TypographyHint(rule, *match.span()) for match in pattern.finditer(text)
        )
    hints.extend(
        TypographyHint("DOUBLE_SPACE", *match.span())
        for match in _DOUBLE_SPACE.finditer(text)
    )
    hints.extend(_space_before(text))
    hints.extend(_missing_space(text))
    tail_start = len(text.rstrip(_END_WHITESPACE))
    # One line break that ends the text is how files end, not an error.
    if text[tail_start:] not in ("", "\n", "\r\n"):
        hints.append(TypographyHint("TRAILING_WHITESPACE_TEXT", tail_start, len(text)))
    hints.extend(
        TypographyHint("TRAILING_WHITESPACE_LINE", *match.span())
        for match in _LINE_END_SPACE.finditer(text, 0, tail_start)
    )
    hints.sort(key=lambda hint: (hint.start, hint.end, hint.rule))
    return hints


def count_by_rule(hints: Iterable[TypographyHint]) -> dict[str, int]:
    """Number of hints per rule, in the order of ``TYPOGRAPHY_RULES``."""
    counted = Counter(hint.rule for hint in hints)
    return {rule: counted[rule] for rule in TYPOGRAPHY_RULES if counted[rule]}
