"""The limit of annotators per text ("Annotators per text").

One helper, so every reader agrees: the Documents filter "More annotators
than the limit" (``over_limit``), and the bulk withdrawal of annotations above
the limit (issues 336, 339). The limit of a text is its own value where it
has one (issue 422: ``storage.text_settings.per_text_overrides``), else the
project setting.
"""

from collections.abc import Mapping


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
