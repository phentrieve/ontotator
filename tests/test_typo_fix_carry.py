"""Submitted annotations follow a typo fix by themselves (issue 465).

One accepted German translation. The typo fix removes a space before a full
stop next to the seizure passage (which stays as it is) and fixes a typo in
the hypotonia passage. A finding on "Krampfanfälle" re-anchors unambiguously;
a finding on "Hypotnie" marks words the fix changed and needs a check.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from time import monotonic, sleep
from typing import Any

import pytest
from browser_carry_fixture import HYPOTONIA, SEIZURE, _create, _new_project, _span
from browser_documents_scenarios import (
    Scenario,
    accept_translation,
    add_user,
    assign,
    finish_round,
    identity,
    import_texts,
    start_round,
)
from browser_documents_scenarios import (
    select as choose_final,
)
from browser_server import ONTOLOGY
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import select
from t1_builders import native_unit, translation_unit

from ontotator.api.app import create_app
from ontotator.application.document_rows import DocumentRowsService, RowQuery
from ontotator.application.editorial_corrections import EditorialCorrectionService
from ontotator.application.typo_fix_carry import (
    carry_after_typo_fix,
    numbers_changed,
    plan_carry,
)
from ontotator.config import AppConfig
from ontotator.domain.errors import DomainError
from ontotator.storage.overview_tables import TextChangeResolutionRow, TypoFixCarryRow
from ontotator.storage.repository import Repository
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    JobRow,
    ProjectRow,
    SubmissionRow,
    UserRow,
)

CASE = "case-0465"
SOURCE = (
    "The patient is a 14 month old girl with developmental delay. Since the"
    " summer she has seizures. On examination she shows hypotonia."
)
TEXT = (
    "Die Patientin ist ein 14 Monate altes Mädchen mit Entwicklungsverzögerung. "
    "Seit dem Sommer hat sie Krampfanfälle . Bei der Untersuchung zeigt sie eine "
    "Hypotnie."
)
REPLACEMENTS = [
    {"old": "Krampfanfälle .", "new": "Krampfanfälle."},
    {"old": "Hypotnie", "new": "Hypotonie"},
]
FIXED = TEXT.replace("Krampfanfälle .", "Krampfanfälle.").replace(
    "Hypotnie", "Hypotonie"
)
# The same fix that also changes the age: a number changed.
WITH_NUMBER = [*REPLACEMENTS, {"old": "14 Monate", "new": "15 Monate"}]


# --- "Changed no number" --------------------------------------------------- #


@pytest.mark.parametrize(
    ("old", "new", "changed"),
    [
        ("Krampfanfälle .", "Krampfanfälle.", False),
        ("seit 14 Monaten", "seit 14  Monaten", False),
        # Only the separator between digits changes: no digit changes.
        ("0.5 mg", "0,5 mg", False),
        ("am 12.03.2020", "am 12. 03. 2020", False),
        # A number split or joined is a changed number.
        ("12 Tage", "1 2 Tage", True),
        ("1 2 Tage", "12 Tage", True),
        # A digit changed, added or removed, also in a date.
        ("am 12.03.2020", "am 12.3.2020", True),
        ("14 Monate", "41 Monate", True),
        ("14 Monate", "14 Monate, 3 Tage", True),
        ("Grad 2", "Grad", True),
        # Other decimal digits count as digits.
        ("Wert ٣", "Wert 3", True),
        ("kein Wert", "kein Wert.", False),
    ],
)
def test_a_number_changed_is_a_change_of_the_digit_runs(
    old: str, new: str, changed: bool
) -> None:
    assert numbers_changed(old, new) is changed


# --- the service ------------------------------------------------------------- #


@pytest.fixture
def app(tmp_path: Path) -> Iterator[Any]:
    application = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "typo-carry.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    with TestClient(application):
        yield application


def _project(app: Any, *, accepted: bool = True) -> tuple[Scenario, str]:
    scenario = _new_project(app, "typo-carry")
    source = native_unit(CASE, "en", SOURCE, case_id=CASE)
    docs = import_texts(
        scenario, [source, translation_unit(CASE, "de", TEXT, source=source)]
    )
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "translator", ["annotator"], qualification="Physician")
    for name in ("tom", "ana", "eva"):
        add_user(scenario, name, ["annotator"], languages=("de",))
    document_id = docs[(CASE, "de", 1)]
    if accepted:
        accept_translation(scenario, document_id, "translator")
    return scenario, document_id


def _annotate(
    scenario: Scenario, document_id: str, name: str, parts: list[tuple[str, str]]
) -> str:
    """``name`` submits one finding per (term, passage); returns the submission."""
    assignment_id = assign(scenario, document_id, name, "annotate")
    started = start_round(scenario, assignment_id, name)
    text = scenario.app.state.repo.get_document(scenario.key, document_id).text
    for term, part in parts:
        _create(scenario, name, started.workspace_key, term, span=_span(text, part))
    return finish_round(scenario, name, started.workspace_key)


SEIZURE_ONLY = [(SEIZURE, "Krampfanfälle")]
BOTH = [(SEIZURE, "Krampfanfälle"), (HYPOTONIA, "Hypotnie")]


def _service(scenario: Scenario) -> EditorialCorrectionService:
    return EditorialCorrectionService(scenario.db, scenario.app.state.jobs)


def _hash(scenario: Scenario, document_id: str) -> str:
    return str(
        scenario.app.state.repo.get_variant(scenario.key, document_id).text_sha256
    )


def _preview(
    scenario: Scenario, document_id: str, replacements: list[dict[str, str]]
) -> dict[str, Any]:
    _access, actor = identity(scenario, "lead")
    return _service(scenario).preview(
        actor, scenario.key, document_id, replacements=replacements
    )


def _correct(
    scenario: Scenario,
    document_id: str,
    replacements: list[dict[str, str]] = REPLACEMENTS,
) -> dict[str, Any]:
    _access, actor = identity(scenario, "lead")
    result = _service(scenario).correct(
        actor,
        scenario.key,
        document_id,
        replacements=replacements,
        expected_text_sha256=_hash(scenario, document_id),
        reason="Spacing; Typo",
    )
    _wait_for_reanchor(scenario)
    return result


def _wait_for_reanchor(scenario: Scenario, timeout: float = 30) -> None:
    deadline = monotonic() + timeout
    while True:
        with scenario.db.transaction() as conn:
            states = conn.execute(
                select(JobRow.status)
                .join(ProjectRow, JobRow.project_id == ProjectRow.id)
                .where(
                    ProjectRow.project_key == scenario.key, JobRow.kind == "reanchor"
                )
            ).scalars()
            pending = [state for state in states if state not in ("succeeded",)]
        assert "failed" not in pending
        if not pending:
            return
        assert monotonic() < deadline, "The re-anchoring did not finish"
        sleep(0.05)


def _pid(scenario: Scenario) -> int:
    with scenario.db.transaction() as conn:
        return int(
            conn.execute(
                select(ProjectRow.id).where(ProjectRow.project_key == scenario.key)
            ).scalar_one()
        )


def _tasks(scenario: Scenario) -> dict[str, tuple[str, str, str | None]]:
    """Live annotation tasks: name -> (document id, status, last submission)."""
    names = {username: name for name, username in scenario.users.items()}
    with scenario.db.transaction() as conn:
        rows = conn.execute(
            select(
                UserRow.username,
                AssignmentRow.document_id,
                AssignmentRow.status,
                AssignmentRow.last_submission_id,
            )
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(
                AssignmentRow.project_id == _pid(scenario),
                AssignmentRow.task == "annotate",
                AssignmentRow.revoked_at.is_(None),
            )
        ).all()
    return {
        names[row.username]: (row.document_id, row.status, row.last_submission_id)
        for row in rows
    }


def _carry_view(preview: dict[str, Any]) -> dict[str, tuple[bool, str | None]]:
    names = {item["username"]: item for item in preview["annotation_carry"]}
    return {
        name.split("-")[0]: (item["carried"], item["reason"])
        for name, item in names.items()
    }


def _people(scenario: Scenario, carry: list[dict[str, Any]]) -> dict[str, Any]:
    names = {username: name for name, username in scenario.users.items()}
    return {
        names[item["username"]]: (item["carried"], item["reason"]) for item in carry
    }


def test_a_submission_whose_findings_all_reanchor_moves_by_itself(app: Any) -> None:
    """Tom's finding is on a passage the fix leaves as it is: his annotation
    moves to v2 without a click; the system's submission there has his
    findings and pseudonym, and names his submission as its source. Ana's
    finding on the corrected word stays on v1 for "Carry to v2…"; Eva's
    opened task stays for "Handle text change…"; Luc's unopened task follows."""
    scenario, document_id = _project(app)
    add_user(scenario, "luc", ["annotator"], languages=("de",))
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    ana = _annotate(scenario, document_id, "ana", BOTH)
    start_round(scenario, assign(scenario, document_id, "eva", "annotate"), "eva")
    assign(scenario, document_id, "luc", "annotate")

    preview = _preview(scenario, document_id, REPLACEMENTS)
    assert _people(scenario, preview["annotation_carry"]) == {
        "tom": (True, None),
        "ana": (False, "findings_need_check"),
        "eva": (False, "not_submitted"),
    }
    by_name = {item["username"]: item for item in preview["annotation_carry"]}
    assert (
        by_name[scenario.users["ana"]]["findings"],
        by_name[scenario.users["ana"]]["needs_check"],
    ) == (2, 1)

    result = _correct(scenario, document_id)
    v2 = result["document_id"]
    assert result["annotations_carried"] == 1
    assert _people(scenario, result["annotation_carry"]) == {
        "tom": (True, None),
        "ana": (False, "findings_need_check"),
        "eva": (False, "not_submitted"),
    }
    tasks = _tasks(scenario)
    assert tasks["ana"] == (document_id, "submitted", ana)
    assert tasks["eva"][:2] == (document_id, "open")
    assert tasks["luc"][:2] == (v2, "open")
    # Tom: one task, on v2, submitted with the system's copy.
    assert tasks["tom"][:2] == (v2, "submitted")
    copy = tasks["tom"][2]
    assert copy is not None and copy != tom

    repo = Repository(scenario.db)
    carried = repo.get_submission(copy, scenario.key)
    source = repo.get_submission(tom, scenario.key)
    assert carried.origin_key.document_id == v2
    assert carried.origin_key.annotator_id == source.origin_key.annotator_id
    (finding,) = carried.snapshots
    (original,) = source.snapshots
    assert finding.annotation.term_id == original.annotation.term_id == SEIZURE
    assert finding.annotation.provenance.actor == original.annotation.provenance.actor
    assert finding.annotation.provenance.actor.kind == "human"
    (segment,) = finding.evidence[0].mention.segments
    assert FIXED[segment.start : segment.end] == "Krampfanfälle"

    pid = _pid(scenario)
    with scenario.db.transaction() as conn:
        record = conn.execute(
            select(TypoFixCarryRow).where(TypoFixCarryRow.project_id == pid)
        ).one()
        assert (record.submission_id, record.source_submission_id) == (copy, tom)
        assert (record.from_document_id, record.to_document_id) == (document_id, v2)
        stamps = dict(
            conn.execute(
                select(
                    SubmissionRow.submission_id, SubmissionRow.guideline_version
                ).where(SubmissionRow.project_id == pid)
            )
            .tuples()
            .all()
        )
        assert stamps[copy] == stamps[tom]
        (event,) = conn.execute(
            select(AuditEventRow).where(
                AuditEventRow.project_id == pid,
                AuditEventRow.action == "text_change.typo_fix_carry",
            )
        ).all()
        assert event.actor_user_id is None
        assert event.details["source_submission_id"] == tom
        assert event.details["submission_id"] == copy
        assert (event.details["from_version"], event.details["to_version"]) == (1, 2)
        resolution = conn.execute(
            select(TextChangeResolutionRow).where(
                TextChangeResolutionRow.project_id == pid,
                TextChangeResolutionRow.submission_id == tom,
            )
        ).one()
        assert (resolution.resolution, resolution.decided_by) == ("carried", None)
        revoked = (
            conn.execute(
                select(AuditEventRow.details).where(
                    AuditEventRow.project_id == pid,
                    AuditEventRow.action == "assignment.revoke",
                )
            )
            .scalars()
            .all()
        )
        assert [d["reason"] for d in revoked] == ["typo_fix_carried"]

    # Ana's annotation keeps the manual flow.
    from ontotator.application.text_changes import TextChangeService

    access, actor = identity(scenario, "lead")
    manual = TextChangeService(scenario.db, repo).preview(
        access,
        actor,
        scenario.key,
        assignment_id=None,
        submission_id=ana,
        target_document_id=v2,
    )
    assert (manual.findings, manual.unplaced) == (2, 1)
    # Tom's is settled: "Carry to v2…" is refused for it.
    with pytest.raises(DomainError):
        TextChangeService(scenario.db, repo).preview(
            access,
            actor,
            scenario.key,
            assignment_id=None,
            submission_id=tom,
            target_document_id=v2,
        )


def test_a_changed_number_keeps_the_manual_flow_for_everyone(app: Any) -> None:
    scenario, document_id = _project(app)
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    preview = _preview(scenario, document_id, WITH_NUMBER)
    assert _people(scenario, preview["annotation_carry"]) == {
        "tom": (False, "number_changed")
    }
    result = _correct(scenario, document_id, WITH_NUMBER)
    assert result["annotations_carried"] == 0
    assert _tasks(scenario)["tom"] == (document_id, "submitted", tom)
    with scenario.db.transaction() as conn:
        assert conn.execute(select(TypoFixCarryRow.id)).first() is None


def test_a_text_with_a_final_result_keeps_the_manual_flow(app: Any) -> None:
    scenario, document_id = _project(app)
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    choose_final(scenario, document_id, tom)
    preview = _preview(scenario, document_id, REPLACEMENTS)
    assert _people(scenario, preview["annotation_carry"]) == {
        "tom": (False, "final_result")
    }
    result = _correct(scenario, document_id)
    assert result["annotations_carried"] == 0
    assert _tasks(scenario)["tom"] == (document_id, "submitted", tom)


def test_a_text_with_a_consolidation_keeps_the_manual_flow(app: Any) -> None:
    scenario, document_id = _project(app)
    add_user(scenario, "carla", ["adjudicator"], languages=("de",))
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    _annotate(scenario, document_id, "ana", SEIZURE_ONLY)
    # Carla consolidates (a review task on v1).
    assign(scenario, document_id, "carla", "review")
    preview = _preview(scenario, document_id, REPLACEMENTS)
    assert _people(scenario, preview["annotation_carry"]) == {
        "tom": (False, "consolidation"),
        "ana": (False, "consolidation"),
    }
    _correct(scenario, document_id)
    assert _tasks(scenario)["tom"] == (document_id, "submitted", tom)


def test_two_fixes_in_a_row_carry_the_copy_again(app: Any) -> None:
    """v1 -> v2 -> v3: the second fix carries the copy on v2; the copy on v3
    names the copy on v2 as its source. One task per person throughout."""
    scenario, document_id = _project(app)
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    v2 = _correct(scenario, document_id, [{"old": "Hypotnie", "new": "Hypotonie"}])
    first = _tasks(scenario)["tom"]
    assert first[:2] == (v2["document_id"], "submitted")
    v3 = _correct(
        scenario,
        v2["document_id"],
        [{"old": "Krampfanfälle .", "new": "Krampfanfälle."}],
    )
    second = _tasks(scenario)["tom"]
    assert second[:2] == (v3["document_id"], "submitted")
    with scenario.db.transaction() as conn:
        chain = dict(
            conn.execute(
                select(
                    TypoFixCarryRow.submission_id, TypoFixCarryRow.source_submission_id
                ).where(TypoFixCarryRow.project_id == _pid(scenario))
            )
            .tuples()
            .all()
        )
    assert chain == {first[2]: tom, second[2]: first[2]}


def test_running_the_carry_twice_makes_one_copy(app: Any) -> None:
    """The carry is idempotent: a second run for the same fix finds the
    submission settled and leaves it as it is."""
    scenario, document_id = _project(app)
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    # The plan as it was before the fix (Tom's task on v1 submitted).
    repo = Repository(scenario.db)
    pid = _pid(scenario)
    variant = repo.get_variant(scenario.key, document_id)
    with scenario.db.transaction() as conn:
        items = plan_carry(conn, repo, scenario.key, pid, variant, TEXT, FIXED)
    result = _correct(scenario, document_id)
    before = _tasks(scenario)
    from datetime import UTC, datetime

    with scenario.db.transaction() as conn:
        correction_id = conn.execute(
            select(TypoFixCarryRow.correction_id).where(
                TypoFixCarryRow.project_id == pid
            )
        ).scalar_one()
        again = carry_after_typo_fix(
            conn,
            repo,
            key=scenario.key,
            pid=pid,
            source=variant,
            target_document_id=result["document_id"],
            correction_id=correction_id,
            items=items,
            now=datetime.now(UTC),
        )
    assert [(item.submission_id, item.reason) for item in again] == [
        (tom, "not_carryable")
    ]
    assert _tasks(scenario) == before
    with scenario.db.transaction() as conn:
        assert len(conn.execute(select(TypoFixCarryRow.id)).all()) == 1


def _lead_rows(scenario: Scenario) -> dict[tuple[str, str], dict[str, Any]]:
    access, actor = identity(scenario, "lead")
    page = DocumentRowsService(scenario.db, actor, access).page(
        scenario.key, RowQuery()
    )
    return {
        (row["case_id"], row["language"]): row
        for group in page["groups"]
        for row in group["rows"]
    }


def test_agreement_counts_and_export_are_unchanged_by_the_carry(app: Any) -> None:
    """Both annotations move: the row compares the two copies on v2 exactly
    as it compared the two submissions on v1, each person counts one
    submitted annotation, and the work export still holds the two
    submissions the people made (not the copies)."""
    scenario, document_id = _project(app)
    _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    _annotate(
        scenario,
        document_id,
        "ana",
        [(SEIZURE, "Krampfanfälle"), (HYPOTONIA, "Untersuchung")],
    )
    before = _lead_rows(scenario)[(CASE, "de")]["stages"]
    exported = sorted(
        s.submission_id
        for s in scenario.app.state.repo.t1_export_content(scenario.key).submissions
    )

    result = _correct(scenario, document_id)
    assert result["annotations_carried"] == 2

    after = _lead_rows(scenario)[(CASE, "de")]["stages"]
    final_before, final_after = before["final"]["detail"], after["final"]["detail"]
    assert (
        (final_after["matching"], final_after["compared"])
        == (
            final_before["matching"],
            final_before["compared"],
        )
        == (1, 2)
    )
    # The Annotation cell: two people submitted, now on v2.
    cell = [
        (
            stage["annotation"]["state"],
            len(stage["annotation"]["detail"]["people"]),
            stage["annotation"]["detail"]["version"],
        )
        for stage in (before, after)
    ]
    assert cell == [("submitted", 2, 1), ("submitted", 2, 2)]
    assert (
        sorted(
            s.submission_id
            for s in scenario.app.state.repo.t1_export_content(scenario.key).submissions
        )
        == exported
    )

    from ontotator.application.progress import progress_view

    access, _actor = identity(scenario, "lead")
    repo = Repository(scenario.db)
    with scenario.db.transaction() as conn:
        view = progress_view(conn, repo, scenario.key, _pid(scenario), access.user_id)
    submitted = {entry["username"]: entry["submitted"] for entry in view["workload"]}
    # The translator's review is the third submitted task.
    assert submitted == {
        scenario.users["tom"]: 1,
        scenario.users["ana"]: 1,
        scenario.users["translator"]: 1,
    }
    # Nobody worked on the copies: no working time on v2.
    from ontotator.storage.work_time_tables import WorkIntervalRow

    with scenario.db.transaction() as conn:
        assert (
            conn.execute(
                select(WorkIntervalRow.id).where(
                    WorkIntervalRow.document_id == result["document_id"]
                )
            ).first()
            is None
        )


def test_the_row_history_names_the_move(app: Any) -> None:
    scenario, document_id = _project(app)
    _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    _correct(scenario, document_id)
    access, actor = identity(scenario, "lead")
    found = DocumentRowsService(scenario.db, actor, access).submissions(
        scenario.key, CASE, "de"
    )
    (change,) = [c for c in found["changes"] if c["kind"] == "carried_by_typo_fix"]
    assert (change["from_version"], change["to_version"]) == (1, 2)
    assert change["by"] is None
    assert change["to_person"]["pseudonym"] == _pseudonym(scenario, "tom")


def _pseudonym(scenario: Scenario, name: str) -> str:
    with scenario.db.transaction() as conn:
        return str(
            conn.execute(
                select(UserRow.pseudonym).where(
                    UserRow.username == scenario.users[name]
                )
            ).scalar_one()
        )


def _proposal_check_submission(scenario: Scenario, assignment_id: int) -> str:
    """Record a submitted check of proposals (empty) for the assignment."""
    from sqlalchemy import update

    from ontotator.domain.review import ReviewTargetSet
    from ontotator.domain.workspace import Submission, WorkspaceKey
    from ontotator.storage.repository import _key_str

    with scenario.db.transaction() as conn:
        row = conn.execute(
            select(AssignmentRow.document_id, UserRow.pseudonym)
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(AssignmentRow.id == assignment_id)
        ).one()
    key = WorkspaceKey(
        project_key=scenario.key,
        document_id=row.document_id,
        annotator_id=row.pseudonym,
        mode="proposal_check",
        target_set_id="targets-0",
    )
    record = Submission(
        submission_id=f"sub-proposals-{assignment_id}",
        origin_key=key,
        targets=ReviewTargetSet.create([]),
        draft_revision=1,
        snapshots=[],
        decisions=[],
        created_at="2026-11-19T10:00:00Z",
    )
    with scenario.db.transaction() as conn:
        scenario.app.state.repo._insert_submission(
            conn, _pid(scenario), record, local_key=_key_str(key), imported=False
        )
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(status="submitted", last_submission_id=record.submission_id)
        )
    return record.submission_id


def test_work_from_proposals_and_paused_tasks_keep_the_manual_flow(app: Any) -> None:
    """Work from proposals is carried onto the new version's own proposals,
    which only the background re-anchoring makes: it is not carried by the
    fix. A paused task is not touched either."""
    from sqlalchemy import update

    scenario, document_id = _project(app)
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    checked = _proposal_check_submission(
        scenario, assign(scenario, document_id, "ana", "annotate")
    )
    with scenario.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.last_submission_id == tom)
            .values(held=True, hold_reason="problem")
        )
    preview = _preview(scenario, document_id, REPLACEMENTS)
    assert _people(scenario, preview["annotation_carry"]) == {
        "tom": (False, "task_paused"),
        "ana": (False, "from_proposals"),
    }
    result = _correct(scenario, document_id)
    assert result["annotations_carried"] == 0
    tasks = _tasks(scenario)
    assert (tasks["tom"][2], tasks["ana"][2]) == (tom, checked)


def _final_agreement(scenario: Scenario) -> dict[str, Any]:
    from ontotator.application.final_results import FinalResultService

    access, actor = identity(scenario, "lead")
    return FinalResultService(scenario.db, actor, access).agreement(scenario.key)


def test_a_moved_annotation_accepted_as_final_agrees_as_before_the_fix(
    app: Any,
) -> None:
    """The final export's agreement (agreement.csv, the project agreement
    route): Tom's annotation accepted directly compares with Ana's as it did
    before the fix, also when the final is the copy on v2."""
    parts = [(SEIZURE, "Krampfanfälle"), (HYPOTONIA, "Untersuchung")]
    figures = []
    for fixed in (False, True):
        scenario, document_id = _project(app)
        tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
        _annotate(scenario, document_id, "ana", parts)
        final_on = document_id
        if fixed:
            final_on = _correct(scenario, document_id)["document_id"]
            tom = _tasks(scenario)["tom"][2]
        choose_final(scenario, final_on, tom)
        report = _final_agreement(scenario)
        (pair,) = report["pairs"]
        figures.append(
            (
                pair["document_id"],
                {
                    k: v
                    for k, v in pair.items()
                    if k.endswith(("_f1", "_a", "_b"))
                    and not k.startswith(("submission", "pseudonym"))
                },
                report["summary"],
            )
        )
    (before_doc, before, before_summary), (after_doc, after, after_summary) = figures
    assert before == after and before_summary == after_summary
    # Both compare the work on version 1, where the people made it.
    assert before_doc.split("~")[0] == after_doc.split("~")[0]


def test_an_unreviewed_translation_keeps_the_manual_flow(app: Any) -> None:
    """A task on the new version of a translation nobody accepted would need
    the lead's confirmation: the annotation stays for "Carry to v2…"."""
    scenario, document_id = _project(app, accepted=False)
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    preview = _preview(scenario, document_id, REPLACEMENTS)
    assert _people(scenario, preview["annotation_carry"]) == {
        "tom": (False, "translation_not_accepted")
    }
    assert _correct(scenario, document_id)["annotations_carried"] == 0
    assert _tasks(scenario)["tom"] == (document_id, "submitted", tom)
