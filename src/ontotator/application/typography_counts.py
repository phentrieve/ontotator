"""Typography hint counts of the newest text versions for Documents (issue 484).

Hints are never stored. A text version never changes, so its count is kept in
the process under the hash of its text: after the first Documents page of a
project only new versions are read and checked.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import Connection, select

from ontotator.domain.typography import typography_hints
from ontotator.storage.tables import DocumentRow

# text_sha256 -> number of hints. Restarting the server empties it, so a new
# rule counts from the next start on.
_COUNTS: dict[str, int] = {}
_COUNTS_MAX = 200_000
_TEXT_BATCH = 200


def typography_hint_counts(
    conn: Connection, project_id: int, document_ids: Iterable[str]
) -> dict[str, int]:
    """``document_id -> hints`` for the given versions that have any."""
    wanted = sorted(set(document_ids))
    if not wanted:
        return {}
    hashes = dict(
        conn.execute(
            select(DocumentRow.document_id, DocumentRow.text_sha256).where(
                DocumentRow.project_id == project_id,
                DocumentRow.document_id.in_(wanted),
            )
        )
        .tuples()
        .all()
    )
    unknown = sorted({sha for sha in hashes.values() if sha not in _COUNTS})
    if len(_COUNTS) + len(unknown) > _COUNTS_MAX:
        _COUNTS.clear()
    for start in range(0, len(unknown), _TEXT_BATCH):
        batch = unknown[start : start + _TEXT_BATCH]
        for sha, text in conn.execute(
            select(DocumentRow.text_sha256, DocumentRow.text)
            .where(
                DocumentRow.project_id == project_id,
                DocumentRow.text_sha256.in_(batch),
            )
            .distinct(DocumentRow.text_sha256)
        ):
            _COUNTS[sha] = len(typography_hints(text))
    return {
        document_id: _COUNTS[sha]
        for document_id, sha in hashes.items()
        if _COUNTS.get(sha)
    }
