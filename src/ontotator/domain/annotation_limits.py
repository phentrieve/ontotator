"""The limit of annotators per text ("Annotators per text").

One helper, so every reader agrees: the Documents filter "More annotators
than the limit" (``over_limit``), and the bulk withdrawal of annotations above
the limit (issues 336, 339). Today the limit is the project setting for every
text; a per-text limit (per-text annotators, PR 431) changes only this
function and what its callers pass in.
"""


def effective_annotation_limit(project_limit: int, case_id: str, language: str) -> int:
    """How many annotations the text ``(case_id, language)`` may have on a
    version. ``project_limit``: the project's ``annotations_per_text``."""
    del case_id, language  # the same limit for every text, for now
    return project_limit
