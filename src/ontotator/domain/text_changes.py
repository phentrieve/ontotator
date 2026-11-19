"""Count the changed passages between two versions of a text."""

from difflib import SequenceMatcher

# Beyond this many word pairs in the differing middle the texts are not
# compared: two unrelated long texts would take seconds per row of a list.
MAX_WORD_PAIRS = 4_000_000


def changed_passages(before: str, after: str) -> int | None:
    """Passages that differ between ``before`` and ``after``, compared by words.

    A passage is one run of removed, added or replaced words; a replaced
    wording counts once. A change of spaces or line breaks only is no
    passage. ``None`` when the texts differ too much to compare in time.
    """
    old, new = before.split(), after.split()
    start = 0
    while start < len(old) and start < len(new) and old[start] == new[start]:
        start += 1
    end = 0
    while (
        end < len(old) - start
        and end < len(new) - start
        and old[len(old) - 1 - end] == new[len(new) - 1 - end]
    ):
        end += 1
    old, new = old[start : len(old) - end], new[start : len(new) - end]
    if not old and not new:
        return 0
    if not old or not new:
        return 1
    if len(old) * len(new) > MAX_WORD_PAIRS:
        return None
    codes = SequenceMatcher(None, old, new, autojunk=False).get_opcodes()
    return sum(1 for tag, *_ in codes if tag != "equal")
