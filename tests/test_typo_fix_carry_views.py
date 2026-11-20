"""What the lead and the annotator see after a typo fix moved annotations
(issues 543 and 545).

The fixture is the one of ``test_typo_fix_carry``: one accepted German
translation; the fix removes a space after "Krampfanfälle" and corrects
"Hypotnie". A finding on "Krampfanfälle" moves by itself; a finding on
"Hypotnie" marks a changed word and stays on v1 for "Carry to v2…".
"""

from __future__ import annotations

from typing import Any

from browser_documents_scenarios import Scenario, add_user, identity
from sqlalchemy import select
from test_typo_fix_carry import (
    BOTH,
    CASE,
    SEIZURE_ONLY,
    _annotate,
    _correct,
    _lead_rows,
    _pid,
    _project,
    _tasks,
)
from test_typo_fix_carry import app as app

from ontotator.application.document_rows import DocumentRowsService
from ontotator.application.round_reads import enrich_rounds
from ontotator.assignments.service import AssignmentService
from ontotator.storage.tables import AssignmentRow, SubmissionRow, UserRow
from ontotator.storage.workflow_tables import WorkRoundRow

SEIZURE = "HP:0001250"
STATUS_EPILEPTICUS = "HP:0002133"
DIALEPTIC_SEIZURE = "HP:0011146"


def _row(scenario: Scenario) -> dict[str, Any]:
    return _lead_rows(scenario)[(CASE, "de")]


def _user_id(scenario: Scenario, name: str) -> int:
    with scenario.db.transaction() as conn:
        return int(
            conn.execute(
                select(UserRow.id).where(UserRow.username == scenario.users[name])
            ).scalar_one()
        )


def _task_row(scenario: Scenario, assignment_id: int) -> Any:
    with scenario.db.transaction() as conn:
        return conn.execute(
            select(AssignmentRow).where(AssignmentRow.id == assignment_id)
        ).one()


def _recorded(scenario: Scenario, submission_id: str) -> Any:
    with scenario.db.transaction() as conn:
        return conn.execute(
            select(SubmissionRow.recorded_at).where(
                SubmissionRow.project_id == _pid(scenario),
                SubmissionRow.submission_id == submission_id,
            )
        ).scalar_one()


def _old_task(scenario: Scenario, submission_id: str) -> Any:
    with scenario.db.transaction() as conn:
        return conn.execute(
            select(AssignmentRow).where(
                AssignmentRow.project_id == _pid(scenario),
                AssignmentRow.last_submission_id == submission_id,
            )
        ).one()


def test_the_annotation_cell_counts_the_annotations_already_on_v2(app: Any) -> None:
    """U4-01: two annotations moved by themselves, one waits on v1. The cell
    still asks for "Carry to v2…" but counts the two on v2 instead of
    reading "v2 not annotated"."""
    scenario, document_id = _project(app)
    _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    _annotate(scenario, document_id, "ana", SEIZURE_ONLY)
    _annotate(scenario, document_id, "eva", BOTH)
    assert _correct(scenario, document_id)["annotations_carried"] == 2

    cell = _row(scenario)["stages"]["annotation"]
    assert cell["state"] == "old_text_submitted"
    detail = cell["detail"]
    assert (detail["from_version"], detail["version"]) == (1, 2)
    assert detail["submitted"] == 2
    assert detail["note"] is None
    assert [person["pseudonym"] for person in detail["people"]] == [
        _row_pseudonym(scenario, "eva")
    ]


def test_nothing_on_v2_still_reads_not_annotated(app: Any) -> None:
    scenario, document_id = _project(app)
    _annotate(scenario, document_id, "eva", BOTH)
    _correct(scenario, document_id)
    detail = _row(scenario)["stages"]["annotation"]["detail"]
    assert (detail["submitted"], detail["note"]) == (None, "v2_not_annotated")


def _row_pseudonym(scenario: Scenario, name: str) -> str:
    with scenario.db.transaction() as conn:
        return str(
            conn.execute(
                select(UserRow.pseudonym).where(
                    UserRow.username == scenario.users[name]
                )
            ).scalar_one()
        )


def test_a_moved_task_names_the_persons_own_work(app: Any) -> None:
    """U4-02: the task the typo fix made on v2 says where it came from, when
    the person was given the work and when they submitted it; its copy is
    flagged in the row's submissions."""
    scenario, document_id = _project(app)
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    old = _old_task(scenario, tom)
    _correct(scenario, document_id)
    v2_task = _tasks(scenario)["tom"]
    row = _row(scenario)
    (item,) = [
        entry
        for entry in row["work"]
        if entry["task"] == "annotate" and entry["document_id"] == v2_task[0]
    ]
    moved = item["moved_by_typo_fix"]
    assert moved is not None
    assert moved["submission_id"] == v2_task[2]
    assert moved["from_version"] == 1
    assert moved["assigned_at"] == old.created_at
    assert moved["submitted_at"] == _recorded(scenario, tom)
    # The scenario assigns without an account, as the admin CLI does.
    assert old.created_by is None and moved["assigned_by"] is None
    # The task itself was made by the system at the fix.
    assert item["assigned_at"] > old.created_at

    access, actor = identity(scenario, "lead")
    listing = DocumentRowsService(scenario.db, actor, access).submissions(
        scenario.key, CASE, "de"
    )
    flags = {
        entry["submission_id"]: entry["moved_by_typo_fix"]
        for entry in listing["submissions"]
    }
    assert flags == {tom: False, v2_task[2]: True}


def test_my_tasks_keeps_the_day_the_person_was_given_the_work(app: Any) -> None:
    """U4-05: My tasks shows when the person was assigned, not the time the
    typo fix made the task on v2."""
    scenario, document_id = _project(app)
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    old = _old_task(scenario, tom)
    _correct(scenario, document_id)
    tasks = AssignmentService(scenario.db).my_tasks(_user_id(scenario, "tom"))
    (task,) = [t for t in tasks if t.task == "annotate"]
    assert task.document_id != document_id
    assert task.assigned_at == old.created_at


def test_the_moved_round_says_so(app: Any) -> None:
    """U4-05: the round the typo fix made is marked as moved, so the editor
    does not present its findings as carried and checked by the person."""
    scenario, document_id = _project(app)
    _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    _correct(scenario, document_id)
    v2_document = _tasks(scenario)["tom"][0]
    repo = scenario.app.state.repo
    with scenario.db.transaction() as conn:
        rounds = conn.execute(
            select(WorkRoundRow.round_id, WorkRoundRow.document_id).where(
                WorkRoundRow.project_id == _pid(scenario)
            )
        ).all()
    views = enrich_rounds(
        repo,
        scenario.key,
        [repo.get_work_round(scenario.key, r.round_id) for r in rounds],
    )
    by_document = {
        (view.document_id, view.kind): view.moved_by_typo_fix for view in views
    }
    assert by_document[(v2_document, "carry_forward")] is True
    assert by_document[(document_id, "ordinary")] is False


def _text(scenario: Scenario, document_id: str) -> str:
    return str(scenario.app.state.repo.get_document(scenario.key, document_id).text)


def test_the_comparison_after_the_move_is_the_one_before(app: Any) -> None:
    """U4-03: the copies all carry the time of the fix. They are compared in
    the order the people submitted, as before the fix: Luc's "Dialeptic
    seizure" on "Krampfanfälle" stays with the two "Seizure" findings on the
    same word ("Related terms"), not with Ana's "Status epilepticus" on the
    longer passage "sie Krampfanfälle"."""
    scenario, document_id = _project(app)
    add_user(scenario, "luc", ["annotator"], languages=("de",))
    people = {
        "tom": [(SEIZURE, "Krampfanfälle")],
        "ana": [(SEIZURE, "Krampfanfälle"), (STATUS_EPILEPTICUS, "sie Krampfanfälle")],
        "luc": [(DIALEPTIC_SEIZURE, "Krampfanfälle")],
        "eva": [(SEIZURE, "Krampfanfälle")],
    }
    for name, parts in people.items():
        _annotate(scenario, document_id, name, parts)
    access, actor = identity(scenario, "lead")
    service = DocumentRowsService(scenario.db, actor, access)
    before = service.final_panel(scenario.key, CASE, "de")
    assert _correct(scenario, document_id)["annotations_carried"] == 4
    after = service.final_panel(scenario.key, CASE, "de")

    def authors(panel: dict[str, Any], version: int) -> list[str]:
        return [
            entry["author_label"]
            for entry in panel["submissions"]
            if entry["version"] == version
        ]

    assert before["agreement"]["related_terms"]
    for key in ("total", "matching", "related_terms", "detail_differences"):
        assert after["agreement"][key] == before["agreement"][key], key
    order = [_row_pseudonym(scenario, name) for name in people]
    assert authors(before, 1) == order
    # Every copy has the time of the fix; they stand in the people's order.
    assert authors(after, 2) == order


def test_last_activity_follows_a_typo_fix(app: Any) -> None:
    """U2-03: a fix with nobody working on the text is activity too."""
    scenario, document_id = _project(app)
    before = _row(scenario)["last_activity_at"]
    _correct(scenario, document_id)
    row = _row(scenario)
    (fixed,) = [
        v["editorial_correction"] for v in row["versions"] if v["editorial_correction"]
    ]
    assert before is None or fixed["corrected_at"] > before
    assert row["last_activity_at"] == fixed["corrected_at"]
