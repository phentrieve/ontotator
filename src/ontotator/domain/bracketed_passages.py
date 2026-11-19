"""Bracketed passages a translation has and its source does not (issue 484).

A machine translation sometimes adds a second name in brackets, for example
a lay term followed by the Latin or English term: "Gelbsucht (Ikterus)". For
annotation one finding is then named twice. The check counts the bracketed
passages of both texts and fails when the translation has more; it names the
passages of the translation that the source does not have as they are. It is
pure and computed on request, never stored, and it blocks nothing: the
reviewer decides.

A passage is an outermost pair of round or square brackets (ASCII or
full-width) with everything between them. A bracket without its partner, as
in "1)" or "a)", is no passage. Positions are zero-based intervals
``[start, end)`` in Unicode code points, as annotation spans.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

_PAIRS = {
    ")": "(",
    "]": "[",
    "\N{FULLWIDTH RIGHT PARENTHESIS}": "\N{FULLWIDTH LEFT PARENTHESIS}",
    "\N{FULLWIDTH RIGHT SQUARE BRACKET}": "\N{FULLWIDTH LEFT SQUARE BRACKET}",
}
_OPENERS = frozenset(_PAIRS.values())
# Passages listed per check; the counts stay exact.
PASSAGE_LIMIT = 50


@dataclass(frozen=True)
class BracketedPassage:
    start: int
    end: int
    text: str


@dataclass(frozen=True)
class BracketCheck:
    """``passages`` is empty unless the translation has more passages."""

    source_count: int
    translation_count: int
    passages: tuple[BracketedPassage, ...]
    # True when ``passages`` holds fewer than the translation has more.
    truncated: bool = False

    @property
    def failed(self) -> bool:
        return self.translation_count > self.source_count


def bracketed_passages(text: str) -> list[BracketedPassage]:
    """The outermost bracketed passages of ``text``, in order."""
    # One stack of open positions per kind of bracket (linear time).
    open_at: dict[str, list[int]] = {opener: [] for opener in _OPENERS}
    pairs: list[tuple[int, int]] = []
    for index, char in enumerate(text):
        if char in _OPENERS:
            open_at[char].append(index)
        elif char in _PAIRS and open_at[_PAIRS[char]]:
            # The nearest open bracket of the same kind; brackets of another
            # kind opened after it and never closed are dropped.
            start = open_at[_PAIRS[char]].pop()
            pairs.append((start, index + 1))
            for stack in open_at.values():
                while stack and stack[-1] > start:
                    stack.pop()
    pairs.sort()
    passages: list[BracketedPassage] = []
    for start, end in pairs:
        if passages and start < passages[-1].end:
            continue  # inside the passage before it
        passages.append(BracketedPassage(start, end, text[start:end]))
    return passages


def _content(passage: BracketedPassage) -> str:
    """What stands between the brackets, for comparing across languages."""
    return " ".join(passage.text[1:-1].split()).casefold()


def check_added_brackets(source: str, translation: str) -> BracketCheck:
    """Fails when ``translation`` has more bracketed passages than ``source``.

    The passages named are those of the translation whose content the source
    does not have in brackets as it is (a dose or a code that both texts
    bracket is not named), so at least as many as the translation has more.
    """
    in_source = bracketed_passages(source)
    in_translation = bracketed_passages(translation)
    if len(in_translation) <= len(in_source):
        return BracketCheck(len(in_source), len(in_translation), ())
    known = Counter(_content(passage) for passage in in_source)
    added: list[BracketedPassage] = []
    for passage in in_translation:
        content = _content(passage)
        if known[content] > 0:
            known[content] -= 1
        else:
            added.append(passage)
    return BracketCheck(
        len(in_source),
        len(in_translation),
        tuple(added[:PASSAGE_LIMIT]),
        len(added) > PASSAGE_LIMIT,
    )
