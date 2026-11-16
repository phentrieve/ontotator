"""Documents rows after a text change (issue 420): the Annotation cell counts
only work on the row's newest version. A v1 submission carried to v2 (to its
author or to someone else), open work moved to v2 and a v1 submission the lead
left behind ("Start v2 fresh") never count as submitted on v2; the row's work
items on v2 are exactly the work the cell counts (the table counts them when
the cell carries no counts, ``cardModel.annotationState``)."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest
from browser_overview_scenarios import (
    BOTH,
    PRESETS,
    Scenario,
    annotate,
    assign,
    assign_and_annotate,
    decide_translation,
    identity,
    import_bundle,
    move_to_newest,
    newest,
    overview_project,
    plan,
    request_correction,
    review_translation,
    units,
)
from test_browser_overview_fixture import Lead, client

CASE = "case-420"

__all__ = ["client"]


def _carry(scenario: Scenario, submission_id: str, target: str, mode: str) -> Any:
    from ontotator.application.text_changes import TextChangeService

    access, actor = identity(scenario, "lead")
    return TextChangeService(scenario.db, scenario.app.state.repo).carry(
        access,
        actor,
        scenario.key,
        submission_id,
        target_document_id=target,
        mode=mode,  # type: ignore[arg-type]
        username=scenario.users["luc"] if mode == "other" else None,
        confirm_language=False,
        confirm_unreviewed_translation=True,
        request_id=f"carry-{uuid4().hex}",
    )


def _accepted(client: Any, per_text: int) -> tuple[Scenario, str]:
    """A project whose de v1 Ana accepted unchanged."""
    scenario = overview_project(client.app, "C420", per_text=per_text)
    docs = import_bundle(scenario, units(CASE, ("de",)))
    plan(scenario, [CASE], {"de": BOTH})
    v1 = docs[(CASE, "de", 1)]
    decide_translation(scenario, v1, "ana", "accepted_unchanged")
    return scenario, v1


def _correct(scenario: Scenario, v1: str) -> str:
    """Ana corrects v1 on request; accepted with corrections, it is v2."""
    review = request_correction(scenario, v1, "ana")
    review_translation(scenario, review, "ana", "accepted_corrected")
    v2 = newest(scenario, CASE, "de")
    assert v2 != v1
    return v2


def _annotation(lead: Lead) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
    row = lead.row(CASE, "de")
    cell = row["stages"]["annotation"]
    newest_ids = {v["document_id"] for v in row["versions"] if v["is_newest_in_chain"]}
    on_target = [
        item
        for item in row["work"]
        if item["task"] == "annotate"
        and item["moved_to_version"] is None
        and item["document_id"] in newest_ids
    ]
    return cell["state"], cell["detail"], on_target


@pytest.mark.parametrize("per_text", [1, 2])
@pytest.mark.parametrize("how", ["author", "other", "move", "dismiss"])
def test_annotation_cell_counts_the_newest_version_only(client, per_text, how):
    scenario, v1 = _accepted(client, per_text)
    tom = assign_and_annotate(
        scenario, v1, "tom", PRESETS["three"], submit=how != "move"
    )
    v2 = _correct(scenario, v1)
    lead = Lead(client, {"project": scenario.key, "users": scenario.users})
    if how == "move":
        move_to_newest(scenario, tom["assignment_id"], v2)
    else:
        _carry(scenario, tom["submission_id"], v2, how)

    state, detail, on_target = _annotation(lead)
    # Nothing is submitted on v2: never "1 of 2" (v1 submission + v2 task).
    assert all(item["status"] != "submitted" for item in on_target)
    assert detail["submitted"] in (None, 0)
    if how == "dismiss":
        # Start v2 fresh: v2 has no work; the v1 submission does not count.
        assert on_target == []
        assert state == "unassigned"
        assert detail["assigned"] == (0 if per_text > 1 else None)
        worker = assign(scenario, v2, "luc", "annotate")
        name = "luc"
    else:
        assert len(on_target) == 1
        if per_text == 1:
            assert (state, detail["total"]) == ("in_progress", None)
        else:
            # One of two annotators: the second is still to assign.
            assert (state, detail["assigned"], detail["target"]) == (
                "partly_assigned",
                1,
                2,
            )
        worker = on_target[0]["assignment_id"]
        name = "luc" if how == "other" else "tom"

    # Submitted on v2: one submission, never two (v1 + v2).
    annotate(scenario, worker, name, PRESETS["three"])
    state, detail, on_target = _annotation(lead)
    assert [item["status"] for item in on_target] == ["submitted"]
    if per_text == 1:
        assert (state, detail["submitted"], detail["total"]) == (
            "submitted",
            None,
            None,
        )
    else:
        # One of two on v2: the v1 submission does not fill the second place.
        assert (state, detail["assigned"], detail["target"]) == (
            "partly_assigned",
            1,
            2,
        )
