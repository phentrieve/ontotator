"""The tool credited with the proposals of a re-anchored proposal set (#417).

A re-anchored set keeps the actor and method of the set it was copied from.
Sets re-anchored before that rule name the job itself (actor id
``ontotator-reanchor``) as their producer. Their stored rows stay as written;
readers resolve the credit at read time from the source set, which the set id
``<project>:reanchor:<document>:<source set row id>`` names.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import Connection, select

from ontotator.storage.tables import ProposalSetRow

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


def source_set_row_id(annotation_set_id: str) -> int | None:
    """The row id of the set a re-anchored set was copied from."""
    _head, separator, tail = annotation_set_id.rpartition(":")
    return int(tail) if separator and tail.isdigit() else None


def credited_actors(
    conn: Connection, project_id: int | None, sets: Iterable[Mapping[Any, Any]]
) -> dict[int, Credit]:
    """Per set row (``id``, ``origin``, ``annotation_set_id``, ``actors``) the
    actors its proposals are credited to.

    A legacy re-anchored set is credited to the one tool of its source set,
    followed through earlier re-anchorings. When the source cannot be found or
    names no single tool, the set keeps its stored actors."""
    rows: dict[int, Mapping[Any, Any]] = {int(row["id"]): row for row in sets}
    credits: dict[int, Credit] = {}

    def load(row_id: int) -> Mapping[Any, Any] | None:
        if row_id not in rows:
            found = (
                conn.execute(
                    select(
                        ProposalSetRow.id,
                        ProposalSetRow.origin,
                        ProposalSetRow.annotation_set_id,
                        ProposalSetRow.actors,
                    ).where(
                        ProposalSetRow.project_id == project_id,
                        ProposalSetRow.id == row_id,
                    )
                )
                .mappings()
                .one_or_none()
            )
            if found is None:
                return None
            rows[row_id] = found
        return rows[row_id]

    def resolve(row_id: int, seen: frozenset[int]) -> Credit:
        if row_id in credits:
            return credits[row_id]
        row = load(row_id)
        if row is None:
            return Credit([])
        stored = [dict(actor) for actor in row["actors"] or []]
        credit = Credit(stored)
        source_id = source_set_row_id(row["annotation_set_id"])
        if (
            row["origin"] == "reanchor"
            and any(is_legacy_reanchor_actor(actor) for actor in stored)
            and source_id is not None
            and source_id not in seen
            and load(source_id) is not None
        ):
            source = resolve(source_id, seen | {row_id})
            tools = [actor for actor in source.actors if actor.get("kind") == "tool"]
            if len(tools) == 1:
                tool = tools[0]
                actors = [tool if is_legacy_reanchor_actor(a) else a for a in stored]
                unique = list({a["actor_id"]: a for a in actors}.values())
                credit = Credit(
                    unique, {LEGACY_REANCHOR_ACTOR_ID: str(tool["actor_id"])}
                )
        credits[row_id] = credit
        return credit

    wanted = list(rows)
    return {row_id: resolve(row_id, frozenset()) for row_id in wanted}
