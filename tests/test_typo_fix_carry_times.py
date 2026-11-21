"""An annotation a typo fix moved is the person's own submission (issue 575).

The fixture is the one of ``test_typo_fix_carry``: Tom's finding on
"Krampfanfälle" moves to v2 by itself; Eva's second finding on "Hypotnie"
marks a changed word, so her annotation stays on v1.

- F1: every place that names the copy's submission time names the time the
  person submitted, not the time of the fix.
- F2: the row's submissions keep the people's order, each original before
  its copy.
- F3: the moved annotation has no carried findings, also for the lead.
- F4: the dry run counts the findings of the annotations that stay only.
- F5: Finalization does not offer the v1 original of a moved annotation.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import quote

from browser_documents_scenarios import Scenario, identity
from browser_documents_scenarios import select as choose_final
from browser_server import TEST_PASSWORD
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_typo_fix_carry import (
    BOTH,
    CASE,
    REPLACEMENTS,
    SEIZURE_ONLY,
    _annotate,
    _correct,
    _lead_rows,
    _pid,
    _preview,
    _project,
    _tasks,
)
from test_typo_fix_carry import app as app

from ontotator.application.document_rows import DocumentRowsService
from ontotator.application.round_reads import assignment_submissions, enrich_rounds
from ontotator.authz.versions import visible_annotation_versions
from ontotator.storage.tables import AssignmentRow, SubmissionRow
from ontotator.storage.workflow_tables import WorkRoundRow


def _recorded(scenario: Scenario, submission_id: str) -> Any:
    with scenario.db.transaction() as conn:
        return conn.execute(
            select(SubmissionRow.recorded_at).where(
                SubmissionRow.project_id == _pid(scenario),
                SubmissionRow.submission_id == submission_id,
            )
        ).scalar_one()


def _client(scenario: Scenario, name: str) -> TestClient:
    client = TestClient(scenario.app)
    response = client.post(
        "/api/v1/auth/login",
        json={"username": scenario.users[name], "password": TEST_PASSWORD},
        headers={"Origin": str(client.base_url).rstrip("/")},
    )
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    return client


def _moved(app: Any) -> tuple[Scenario, str, str, str]:
    """Tom's annotation moved to v2: (scenario, v1, his original, the copy)."""
    scenario, document_id = _project(app)
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    _correct(scenario, document_id)
    copy = _tasks(scenario)["tom"][2]
    assert copy is not None and copy != tom
    # The copy itself was recorded at the fix.
    assert _recorded(scenario, copy) > _recorded(scenario, tom)
    return scenario, document_id, tom, copy


def test_the_lead_sees_the_time_the_person_submitted(app: Any) -> None:
    """F1: the row's submissions (Finalization, the Consolidate dialog, the
    text view's submission history), the history of the text and the "Show"
    choices name Tom's own submission time for the copy."""
    scenario, _v1, tom, copy = _moved(app)
    own = _recorded(scenario, tom)
    access, actor = identity(scenario, "lead")
    service = DocumentRowsService(scenario.db, actor, access)

    listing = service.submissions(scenario.key, CASE, "de")
    times = {e["submission_id"]: e["recorded_at"] for e in listing["submissions"]}
    assert times[copy] == own
    panel = service.final_panel(scenario.key, CASE, "de")
    (entry,) = [e for e in panel["submissions"] if e["submission_id"] == copy]
    assert entry["recorded_at"] == own

    v2 = _tasks(scenario)["tom"][0]
    with scenario.db.transaction() as conn:
        refs = visible_annotation_versions(
            conn, access, _pid(scenario), scenario.key, v2
        )
    assert {r.id: r.created_at for r in refs if r.kind == "submission"} == {copy: own}

    lead = _client(scenario, "lead")
    base = f"/api/v1/projects/{scenario.key}/documents/{quote(v2, safe='')}"
    history = lead.get(f"{base}/submissions")
    assert history.status_code == 200, history.text
    assert [
        (row["submission_id"], datetime.fromisoformat(row["created_at"]))
        for row in history.json()
    ] == [(copy, own)]


def test_the_final_result_names_the_time_the_person_submitted(app: Any) -> None:
    """F1: a copy accepted as final reads as submitted when Tom submitted."""
    scenario, _v1, tom, copy = _moved(app)
    choose_final(scenario, _tasks(scenario)["tom"][0], copy)
    final = _lead_rows(scenario)[(CASE, "de")]["final"]
    assert final["submission_id"] == copy
    assert final["recorded_at"] == _recorded(scenario, tom)


def test_the_person_sees_the_time_they_submitted(app: Any) -> None:
    """F1: Tom's task on v2 (My submissions, the Work rounds table, the
    editor's "Submitted" chip, the "Show" choice of his own work) names his
    own submission time."""
    scenario, _v1, tom, copy = _moved(app)
    own = _recorded(scenario, tom)
    with scenario.db.transaction() as conn:
        task = conn.execute(
            select(AssignmentRow.id).where(
                AssignmentRow.project_id == _pid(scenario),
                AssignmentRow.last_submission_id == copy,
            )
        ).scalar_one()
        round_id = conn.execute(
            select(WorkRoundRow.round_id).where(
                WorkRoundRow.project_id == _pid(scenario),
                WorkRoundRow.assignment_id == task,
            )
        ).scalar_one()
    repo = scenario.app.state.repo
    (mine,) = assignment_submissions(repo, scenario.key, int(task))
    assert (mine["submission_id"], mine["recorded_at"]) == (copy, own)
    (view,) = enrich_rounds(
        repo, scenario.key, [repo.get_work_round(scenario.key, round_id)]
    )
    assert view.latest_submission_id == copy
    assert view.latest_submission_recorded_at == own
    assert view.source_submission_recorded_at == own

    access, _actor = identity(scenario, "tom")
    with scenario.db.transaction() as conn:
        refs = visible_annotation_versions(
            conn, access, _pid(scenario), scenario.key, _tasks(scenario)["tom"][0]
        )
    assert {r.id: r.created_at for r in refs if r.kind == "own"} == {copy: own}


def test_the_row_keeps_the_order_of_the_people(app: Any) -> None:
    """F2: the copies stand where the people's own submissions stand, each
    after its original: Tom, then Ana, as they submitted on v1."""
    scenario, document_id = _project(app)
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    ana = _annotate(scenario, document_id, "ana", SEIZURE_ONLY)
    _correct(scenario, document_id)
    tasks = _tasks(scenario)
    access, actor = identity(scenario, "lead")
    listing = DocumentRowsService(scenario.db, actor, access).submissions(
        scenario.key, CASE, "de"
    )
    assert [e["submission_id"] for e in listing["submissions"]] == [
        tom,
        tasks["tom"][2],
        ana,
        tasks["ana"][2],
    ]
    times = [e["recorded_at"] for e in listing["submissions"]]
    assert times == sorted(times)


def test_the_moved_annotation_has_no_carried_findings_for_the_lead(
    app: Any,
) -> None:
    """F3: the text view opens the copy without "Carried findings", as the
    person's own editor does (issue 543)."""
    scenario, _v1, _tom, copy = _moved(app)
    v2 = _tasks(scenario)["tom"][0]
    lead = _client(scenario, "lead")
    detail = lead.get(
        f"/api/v1/projects/{scenario.key}/documents/{quote(v2, safe='')}"
        f"/submissions/{copy}"
    )
    assert detail.status_code == 200, detail.text
    assert detail.json()["annotations"]
    assert detail.json()["round_inputs"] == []


def test_the_dry_run_counts_the_findings_that_stay(app: Any) -> None:
    """F4: Tom's finding moves; Eva's two findings stay, one of them on a
    changed word: "1 of 2 findings", not "1 of 3"."""
    scenario, document_id = _project(app)
    _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    _annotate(scenario, document_id, "eva", BOTH)
    preview = _preview(scenario, document_id, REPLACEMENTS)
    assert preview["findings"] == {"submitted": 2, "needs_check": 1}


def test_finalization_leaves_out_the_originals_of_moved_annotations(
    app: Any,
) -> None:
    """F5: Tom's v1 original is not offered as final again; Eva's
    annotation, which stayed on v1, still is."""
    scenario, document_id = _project(app)
    tom = _annotate(scenario, document_id, "tom", SEIZURE_ONLY)
    eva = _annotate(scenario, document_id, "eva", BOTH)
    _correct(scenario, document_id)
    copy = _tasks(scenario)["tom"][2]
    access, actor = identity(scenario, "lead")
    service = DocumentRowsService(scenario.db, actor, access)
    panel = service.final_panel(scenario.key, CASE, "de")
    assert [e["submission_id"] for e in panel["submissions"]] == [copy, eva]
    # The history of the row still lists both.
    listing = service.submissions(scenario.key, CASE, "de")
    assert tom in {e["submission_id"] for e in listing["submissions"]}
