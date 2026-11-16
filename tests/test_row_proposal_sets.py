"""Which proposal set the text card names, and when a newer one (issue 337).

"Newer set available" stays until every task of the text works on the
newest set; the line then names the older set still in use. Tasks whose
round began before sets were recorded (migration 0037) name no set.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

from ontotator.application.document_row_page import (
    _row_proposal_sets,
    _set_unrecorded,
)
from ontotator.application.document_rows import ProposalSetFact, RoundFact
from ontotator.domain.document_rows import AssignmentFact

DOC = "d1"
OLD, MID, NEW = 1, 2, 3


def _set(set_id: int) -> ProposalSetFact:
    return ProposalSetFact(
        set_id=set_id,
        document_id=DOC,
        imported_at=datetime(2026, 10, set_id, tzinfo=UTC),
        tool="phentrieve",
        tool_version="1.4",
        proposal_count=24,
    )


def _task(number: int, set_id: int | str | None) -> tuple[AssignmentFact, Any]:
    """``set_id``: the round's set; None: a round without a recorded set;
    "new": no round yet (starts on the newest set); "scratch": from scratch."""
    started = set_id not in ("new", "scratch")
    item = AssignmentFact(
        assignment_id=number,
        document_id=DOC,
        task="annotate",
        status="in_progress" if started else "assigned",
        held=False,
        revoked=False,
        pseudonym=f"ann-{number}",
        user_id=number,
        active_round_id=f"r{number}" if started else None,
        annotation_mode="scratch" if set_id == "scratch" else "proposals",
    )
    round_fact = (
        RoundFact(
            round_id=f"r{number}",
            assignment_id=number,
            predecessor_round_id=None,
            document_id=DOC,
            kind="ordinary",
            mode="proposal_check",
            state="active",
            latest_submission_id=None,
            author_pseudonym=f"ann-{number}",
            proposal_set_id=set_id if isinstance(set_id, int) else None,
        )
        if started
        else None
    )
    return item, round_fact


def _shown(*sets: int | str | None, newest: int | None = NEW) -> tuple[Any, Any, bool]:
    tasks = [_task(number, set_id) for number, set_id in enumerate(sets, start=1)]
    ctx: Any = SimpleNamespace(
        rounds={r.round_id: r for _, r in tasks if r is not None},
        facts=SimpleNamespace(
            proposal_sets={n: _set(n) for n in (OLD, MID, NEW)},
            newest_sets={} if newest is None else {DOC: newest},
        ),
    )
    shown, newer, unrecorded = _row_proposal_sets(ctx, DOC, [t for t, _ in tasks])
    return (
        shown and shown["set_id"],
        newer and newer["set_id"],
        unrecorded,
    )


def test_one_started_on_the_old_set_and_one_not_started_names_the_old_set():
    """The 337-A mockup: Tom submitted on the old set, R. Roe is assigned."""
    assert _shown(OLD, "new") == (OLD, NEW, False)


def test_a_minority_on_an_old_set_still_offers_the_newer_one():
    assert _shown(NEW, NEW, OLD) == (OLD, NEW, False)


def test_everyone_on_the_newest_set_offers_nothing():
    assert _shown(NEW, "new") == (NEW, None, False)
    assert _shown() == (NEW, None, False)


def test_among_older_sets_the_one_with_the_most_work_then_the_older():
    assert _shown(OLD, MID, MID, "new") == (MID, NEW, False)
    assert _shown(MID, OLD) == (OLD, NEW, False)


def test_rounds_from_before_sets_were_recorded_name_no_set():
    assert _shown(None, None) == (None, None, True)
    # A task from scratch says nothing about sets.
    assert _shown("scratch") == (NEW, None, False)
    # One known set is enough to name it.
    assert _shown(None, OLD) == (OLD, NEW, False)
    # Seed proposals only (no imported set): nothing is missing.
    assert _shown(None, newest=None) == (None, None, False)


def test_a_work_item_knows_that_its_set_was_not_recorded():
    item, round_fact = _task(1, None)
    ctx: Any = SimpleNamespace(
        rounds={"r1": round_fact}, facts=SimpleNamespace(newest_sets={DOC: NEW})
    )
    assert _set_unrecorded(ctx, item) is True
    fresh, _ = _task(2, "new")
    assert _set_unrecorded(ctx, fresh) is False
