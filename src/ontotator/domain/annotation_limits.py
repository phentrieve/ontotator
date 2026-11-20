"""The limit of annotators per text ("Annotators per text").

One helper, so every reader agrees: the Documents filter "More annotators
than the limit" (``over_limit``), and the bulk withdrawal of annotations above
the limit (issues 336, 339). The limit of a text is its own value where it
has one (issue 422: ``storage.text_settings.per_text_overrides``), else the
project setting.
"""

from collections.abc import Mapping

from ontotator.domain.errors import DomainError

# "Annotators per text" is at least 1, for the project setting and for a
# text's own value. There is no built-in maximum (issue 457; it was 5, then 20
# with issue 447): the check constraints of ``projects`` and ``text_settings``
# (migration 0050) only keep the minimum. A server may set a maximum
# (``settings.max_annotations_per_text``); ``require_annotations_per_text``
# refuses a value above it.
MIN_ANNOTATIONS_PER_TEXT = 1
# Not a rule of the workflow: the largest value the column's type (PostgreSQL
# ``integer``) holds, so a larger number is refused as invalid input instead
# of failing in the database.
ANNOTATIONS_PER_TEXT_CEILING = 2**31 - 1
# One consolidation merges at most twice the annotators of its text, so a
# full text can also take its submitted consolidations and the annotations of
# an earlier setting as sources; and never fewer than 40 (the fixed bound
# before issue 457), so lowering a text's value does not shut out the
# submissions it already has.
MIN_CONSOLIDATION_SOURCE_LIMIT = 40


def consolidation_source_limit(annotations_per_text: int) -> int:
    """The most submissions one consolidation of a text merges, from the
    text's "Annotations per text" (its own value, else the project's)."""
    return max(MIN_CONSOLIDATION_SOURCE_LIMIT, 2 * annotations_per_text)


def require_annotations_per_text(value: int, maximum: int | None) -> None:
    """Refuse a new "Annotations per text" above the server's maximum.

    ``maximum``: ``settings.max_annotations_per_text()``; None is no limit.

    Raises:
        DomainError: ``ANNOTATIONS_PER_TEXT_ABOVE_MAXIMUM`` with the maximum,
            the refused value and the name of the server setting.
    """
    if maximum is not None and value > maximum:
        raise DomainError(
            "ANNOTATIONS_PER_TEXT_ABOVE_MAXIMUM",
            {
                "maximum": maximum,
                "value": value,
                "setting": "ONTOTATOR_MAX_ANNOTATIONS_PER_TEXT",
            },
        )


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
