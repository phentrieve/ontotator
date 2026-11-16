"""The tool credited with the proposals of a re-anchored proposal set (#417).

A re-anchored set keeps the actor and method of the set it was copied from.
Sets re-anchored before that rule name the job itself (actor id
``ontotator-reanchor``) as their producer. Their stored rows stay as written;
readers resolve the credit at read time from the source set.

The source set is found through what a project archive keeps unchanged: it is
a set of the text version the legacy set's text was corrected from, and the
legacy set's proposals (their ``source_refs``) and pending items name its
annotations. The row id at the end of the legacy set id
(``<project>:reanchor:<document>:<source set row id>``) is not used: an
archive import gives every row a new id and leaves that string as it was.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

import ontospan
from sqlalchemy import Connection, select

from ontotator.storage.tables import DocumentRow, ProposalSetRow

LEGACY_REANCHOR_ACTOR_ID = "ontotator-reanchor"


@dataclass(frozen=True)
class Credit:
    """The actors a set is credited to, and the actor ids to read as others.

    ``alias`` maps the legacy job actor id to the credited tool's actor id; it
    is empty for every set that already names its producer."""

    actors: list[dict[str, Any]]
    alias: dict[str, str] = field(default_factory=dict)

    def actor_id(self, actor_id: str) -> str:
        return self.alias.get(actor_id, actor_id)


def is_legacy_reanchor_actor(actor: Mapping[str, Any]) -> bool:
    return (
        actor.get("kind") == "tool"
        and actor.get("actor_id") == LEGACY_REANCHOR_ACTOR_ID
    )


def _named_annotations(row: Mapping[Any, Any]) -> set[str]:
    """The source annotations a re-anchored set names: the ``source_refs`` of
    its proposals and the annotations of its pending items."""
    named: set[str] = set()
    for item in (row["payload"] or {}).get("annotations", []):
        named.update(item.get("provenance", {}).get("source_refs", []))
    for item in row["pending_items"] or []:
        annotation_id = item.get("source_ref", {}).get("annotation_id")
        if annotation_id:
            named.add(annotation_id)
    return named


def _own_annotations(row: Mapping[Any, Any]) -> set[str]:
    """Every name of a set's annotations: the id in the set and its reference."""
    names: set[str] = set()
    for item in (row["payload"] or {}).get("annotations", []):
        local_id = item.get("annotation_id")
        if not local_id:
            continue
        names.add(local_id)
        names.add(
            ontospan.annotation_ref(
                row["annotation_set_id"], local_id, row["bundle_id"]
            )
        )
    return names


def credited_actors(
    conn: Connection, project_id: int | None, sets: Iterable[Mapping[Any, Any]]
) -> dict[int, Credit]:
    """Per set row (``id``, ``origin``, ``annotation_set_id``, ``actors``) the
    actors its proposals are credited to.

    A legacy re-anchored set is credited to the one tool of its source set,
    followed through earlier re-anchorings. The source set is the one set of
    the corrected-from text version that holds every annotation the legacy
    set names. When no set or more than one does, or the source names no
    single tool, the set keeps its stored actors: nothing is guessed."""
    given = {int(row["id"]): row for row in sets}
    full: dict[int, Mapping[Any, Any]] = {}
    by_document: dict[str, list[int]] = {}
    credits: dict[int, Credit] = {}
    columns = (
        ProposalSetRow.id,
        ProposalSetRow.origin,
        ProposalSetRow.document_id,
        ProposalSetRow.annotation_set_id,
        ProposalSetRow.bundle_id,
        ProposalSetRow.actors,
        ProposalSetRow.payload,
        ProposalSetRow.pending_items,
    )

    def load(row_id: int) -> Mapping[Any, Any] | None:
        if row_id not in full:
            found = (
                conn.execute(
                    select(*columns).where(
                        ProposalSetRow.project_id == project_id,
                        ProposalSetRow.id == row_id,
                    )
                )
                .mappings()
                .one_or_none()
            )
            if found is None:
                return None
            full[row_id] = found
        return full[row_id]

    def sets_of(document_id: str) -> list[int]:
        if document_id not in by_document:
            found = (
                conn.execute(
                    select(*columns)
                    .where(
                        ProposalSetRow.project_id == project_id,
                        ProposalSetRow.document_id == document_id,
                    )
                    .order_by(ProposalSetRow.id)
                )
                .mappings()
                .all()
            )
            for row in found:
                full.setdefault(row["id"], row)
            by_document[document_id] = [row["id"] for row in found]
        return by_document[document_id]

    def source_of(row: Mapping[Any, Any]) -> int | None:
        named = _named_annotations(row)
        if not named:
            return None
        previous = conn.execute(
            select(DocumentRow.derived_from).where(
                DocumentRow.project_id == project_id,
                DocumentRow.document_id == row["document_id"],
                DocumentRow.origin == "correction",
            )
        ).scalar_one_or_none()
        if previous is None:
            return None
        holding = [
            candidate
            for candidate in sets_of(previous)
            if named <= _own_annotations(full[candidate])
        ]
        return holding[0] if len(holding) == 1 else None

    def resolve(row_id: int, seen: frozenset[int]) -> Credit:
        if row_id in credits:
            return credits[row_id]
        light = given.get(row_id) or load(row_id)
        if light is None:
            return Credit([])
        stored = [dict(actor) for actor in light["actors"] or []]
        credit = Credit(stored)
        if light["origin"] == "reanchor" and any(
            is_legacy_reanchor_actor(actor) for actor in stored
        ):
            row = load(row_id)
            source_id = source_of(row) if row is not None else None
            if source_id is not None and source_id not in seen:
                source = resolve(source_id, seen | {row_id})
                tools = [a for a in source.actors if a.get("kind") == "tool"]
                if len(tools) == 1 and not is_legacy_reanchor_actor(tools[0]):
                    tool = tools[0]
                    actors = [
                        tool if is_legacy_reanchor_actor(a) else a for a in stored
                    ]
                    unique = list({a["actor_id"]: a for a in actors}.values())
                    credit = Credit(
                        unique, {LEGACY_REANCHOR_ACTOR_ID: str(tool["actor_id"])}
                    )
        credits[row_id] = credit
        return credit

    return {row_id: resolve(row_id, frozenset()) for row_id in given}
