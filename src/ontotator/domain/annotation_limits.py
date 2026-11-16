"""The limit of annotators per text ("Annotators per text").

One helper, so every reader agrees: the Documents filter "More annotators
than the limit" (``over_limit``), and the bulk withdrawal of annotations above
the limit (issues 336, 339). The limit of a text is its own value where it
has one (issue 422: ``storage.text_settings.per_text_overrides``), else the
project setting.
"""

from collections.abc import Mapping

# The bounds of "Annotators per text", for the project setting and for a
# text's own value (issue 447: the upper bound was 5). The check constraints
# of ``projects`` and ``text_settings`` (migration 0041) carry the same bounds.
MIN_ANNOTATIONS_PER_TEXT = 1
MAX_ANNOTATIONS_PER_TEXT = 20


def effective_annotation_limit(
    project_limit: int,
    overrides: Mapping[tuple[str, str], int],
    case_id: str,
    language: str,
) -> int:
    """How many annotations the text ``(case_id, language)`` may have on a
    version. ``project_limit``: the project's ``annotations_per_text``;
    ``overrides``: the texts with their own value, by (case, language)."""
    return overrides.get((case_id, language), project_limit)
