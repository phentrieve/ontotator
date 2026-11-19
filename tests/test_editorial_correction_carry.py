"""What an editorial correction (issue 453) carries, moves and leaves.

One accepted German translation with two tool proposals, a submitted
annotation with two findings, an annotation that was opened and one nobody
opened. The correction removes a space before a full stop (next to the
seizure passage, which stays as it is) and fixes a typo inside the hypotonia
passage, so one proposal and one finding can be placed and one of each needs
a check.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from time import monotonic, sleep
from typing import Any

import ontospan
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
from browser_server import ONTOLOGY
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import select
from t1_builders import native_unit, translation_unit
from t1_fixtures import HP_PATH, annotation

from ontotator.api.app import create_app
from ontotator.application.editorial_corrections import EditorialCorrectionService
from ontotator.application.text_changes import TextChangeService
from ontotator.config import AppConfig
from ontotator.storage.repository import Repository
from ontotator.storage.tables import (
    AssignmentRow,
    JobRow,
    ProjectRow,
    ProposalSetRow,
)

CASE = "case-0042"
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
REASON = "Space before the full stop; typo in 'Hypotonie'"


@pytest.fixture
def app(tmp_path: Path) -> Iterator[Any]:
    application = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "editorial.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    # The context starts the job worker: the import and the re-anchoring run.
    with TestClient(application):
        yield application


def _translation(source: Any, *, proposals: bool) -> Any:
    """The German machine translation, with two tool proposals or none."""
    made = translation_unit(CASE, "de", TEXT, source=source)
    if not proposals:
        return made
    seizure, hypotonia = _span(TEXT, "Krampfanfälle"), _span(TEXT, "Hypotnie")
    with_proposals = native_unit(
        CASE,
        "de",
        TEXT,
        case_id=CASE,
        annotations=[
            annotation("p1", (seizure["start"], seizure["end"]), text=TEXT),
            annotation(
                "p2",
                (hypotonia["start"], hypotonia["end"]),
                text=TEXT,
                term_id=HYPOTONIA,
            ),
        ],
    )
    return made.model_copy(update={"annotation_set": with_proposals.annotation_set})


def _project(app: Any, *, proposals: bool = False) -> tuple[Scenario, str]:
    scenario = _new_project(app, "editorial")
    source = native_unit(CASE, "en", SOURCE, case_id=CASE)
    docs = import_texts(scenario, [source, _translation(source, proposals=proposals)])
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "translator", ["annotator"], qualification="Physician")
    for name in ("tom", "ana", "eva"):
        add_user(scenario, name, ["annotator"], languages=("de",))
    document_id = docs[(CASE, "de", 1)]
    accept_translation(scenario, document_id, "translator")
    return scenario, document_id


def _service(scenario: Scenario) -> EditorialCorrectionService:
    return EditorialCorrectionService(scenario.db, scenario.app.state.jobs)


def _hash(scenario: Scenario, document_id: str) -> str:
    return str(
        scenario.app.state.repo.get_variant(scenario.key, document_id).text_sha256
    )


def _correct(scenario: Scenario, document_id: str) -> dict[str, Any]:
    _access, actor = identity(scenario, "lead")
    result = _service(scenario).correct(
        actor,
        scenario.key,
        document_id,
        replacements=REPLACEMENTS,
        expected_text_sha256=_hash(scenario, document_id),
        reason=REASON,
    )
    _wait_for_reanchor(scenario)
    return result


def _wait_for_reanchor(scenario: Scenario, timeout: float = 30) -> None:
    deadline = monotonic() + timeout
    while True:
        with scenario.db.transaction() as conn:
            states = conn.execute(
                select(JobRow.status, JobRow.error)
                .join(ProjectRow, JobRow.project_id == ProjectRow.id)
                .where(
                    ProjectRow.project_key == scenario.key,
                    JobRow.kind == "reanchor",
                    JobRow.payload["producer"]["kind"].as_string()
                    == "editorial_correction",
                )
            ).all()
        assert all(state.status != "failed" for state in states), states
        if states and all(state.status == "succeeded" for state in states):
            return
        assert monotonic() < deadline, "The re-anchoring did not finish"
        sleep(0.05)


def _tasks(scenario: Scenario) -> dict[str, tuple[str, str]]:
    """Live annotation tasks: short user name -> (document id, status)."""
    names = {username: name for name, username in scenario.users.items()}
    from ontotator.storage.tables import UserRow

    with scenario.db.transaction() as conn:
        rows = conn.execute(
            select(UserRow.username, AssignmentRow.document_id, AssignmentRow.status)
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .join(ProjectRow, ProjectRow.id == AssignmentRow.project_id)
            .where(
                ProjectRow.project_key == scenario.key,
                AssignmentRow.task == "annotate",
                AssignmentRow.revoked_at.is_(None),
            )
        ).all()
    return {names[row.username]: (row.document_id, row.status) for row in rows}


def _annotated(scenario: Scenario, document_id: str) -> str:
    """Tom submits a seizure and a hypotonia finding; returns the submission."""
    assignment_id = assign(scenario, document_id, "tom", "annotate")
    started = start_round(scenario, assignment_id, "tom")
    for term, part in ((SEIZURE, "Krampfanfälle"), (HYPOTONIA, "Hypotnie")):
        _create(scenario, "tom", started.workspace_key, term, span=_span(TEXT, part))
    return finish_round(scenario, "tom", started.workspace_key)


def test_only_unstarted_tasks_follow_the_new_version(app: Any) -> None:
    """A version with unstarted tasks only: every task moves, nothing is left
    for the text-change steps."""
    scenario, document_id = _project(app)
    for name in ("tom", "ana"):
        assign(scenario, document_id, name, "annotate")
    _access, actor = identity(scenario, "lead")
    preview = _service(scenario).preview(
        actor, scenario.key, document_id, replacements=REPLACEMENTS
    )
    assert (preview["available"], preview["tasks_following"]) == (True, 2)
    assert preview["annotations"] == {"submitted": 0, "open": 2}
    assert preview["findings"] == {"submitted": 0, "needs_check": 0}
    assert preview["proposals"] == {"sets": 0, "carried": 0, "needs_check": 0}
    assert (preview["inserted_characters"], preview["deleted_characters"]) == (1, 1)

    result = _correct(scenario, document_id)

    assert result["tasks_following"] == 2
    assert _tasks(scenario) == {
        "tom": (result["document_id"], "open"),
        "ana": (result["document_id"], "open"),
    }
    variant = scenario.app.state.repo.get_variant(scenario.key, result["document_id"])
    assert variant.translation_status == "accepted"
    document = scenario.app.state.repo.get_document(scenario.key, result["document_id"])
    assert document.text == FIXED


def test_submitted_and_started_work_stays_for_the_text_change_steps(app: Any) -> None:
    """A version with submitted annotations: the submission and the opened
    task stay on the corrected version; the unopened task follows. The
    existing text-change preview then places the findings on the new text."""
    scenario, document_id = _project(app)
    submission_id = _annotated(scenario, document_id)
    started = assign(scenario, document_id, "eva", "annotate")
    start_round(scenario, started, "eva")
    assign(scenario, document_id, "ana", "annotate")
    access, actor = identity(scenario, "lead")
    preview = _service(scenario).preview(
        actor, scenario.key, document_id, replacements=REPLACEMENTS
    )
    assert preview["annotations"] == {"submitted": 1, "open": 2}
    assert preview["tasks_following"] == 1
    # The seizure passage is unchanged; the hypotonia passage was corrected.
    assert preview["findings"] == {"submitted": 2, "needs_check": 1}

    result = _correct(scenario, document_id)

    assert _tasks(scenario) == {
        "tom": (document_id, "submitted"),
        "eva": (document_id, "open"),
        "ana": (result["document_id"], "open"),
    }
    carry = TextChangeService(scenario.db, Repository(scenario.db)).preview(
        access,
        actor,
        scenario.key,
        assignment_id=None,
        submission_id=submission_id,
        target_document_id=result["document_id"],
    )
    assert (carry.from_version, carry.to_version) == (1, 2)
    assert (carry.findings, carry.placed, carry.unplaced) == (2, 1, 1)
    moved = TextChangeService(scenario.db, Repository(scenario.db)).preview(
        access,
        actor,
        scenario.key,
        assignment_id=started,
        submission_id=None,
        target_document_id=result["document_id"],
    )
    assert moved.to_version == 2


def test_tool_proposals_are_carried_as_after_a_review(app: Any) -> None:
    """A version with machine proposals: the re-anchoring job carries the
    proposal on the unchanged passage and leaves the other for a check, as
    the dry run said."""
    scenario, document_id = _project(app, proposals=True)
    _access, actor = identity(scenario, "lead")
    preview = _service(scenario).preview(
        actor, scenario.key, document_id, replacements=REPLACEMENTS
    )
    assert preview["proposals"] == {"sets": 1, "carried": 1, "needs_check": 1}

    result = _correct(scenario, document_id)

    with scenario.db.transaction() as conn:
        (made,) = (
            conn.execute(
                select(ProposalSetRow)
                .join(ProjectRow, ProjectRow.id == ProposalSetRow.project_id)
                .where(
                    ProjectRow.project_key == scenario.key,
                    ProposalSetRow.document_id == result["document_id"],
                )
            )
            .mappings()
            .all()
        )
    pending = made["pending_items"]
    assert made["origin"] == "reanchor"
    (carried,) = made["payload"]["annotations"]
    assert carried["term_id"] == SEIZURE
    (segment,) = carried["mentions"][0]["segments"]
    assert FIXED[segment["start"] : segment["end"]] == "Krampfanfälle"
    # The tool stays the producer of the carried set.
    assert [actor["actor_id"] for actor in made["payload"]["actors"]] == ["phentrieve"]
    (item,) = pending
    assert (item["term_id"], item["reason"]) == (HYPOTONIA, "changed_segment")


def test_the_exported_bundle_names_a_correction_of_the_accepted_text(
    app: Any, tmp_path: Path
) -> None:
    """The Ontospan bundle (format 1.2) validates and says what it can about
    the version: version 2, origin ``correction``, derived from the corrected
    text by its hash. Who corrected it and why stay in Ontotator (the audit
    event and the correction record); a correction carries no ``translation``
    data in this format."""
    from browser_server import TEST_PASSWORD

    scenario, document_id = _project(app, proposals=True)
    _annotated(scenario, document_id)
    following = assign(scenario, document_id, "ana", "annotate")
    result = _correct(scenario, document_id)
    # Ana's task followed: she annotates the corrected text.
    started = start_round(scenario, following, "ana")
    _create(
        scenario,
        "ana",
        started.workspace_key,
        HYPOTONIA,
        span=_span(FIXED, "Hypotonie"),
    )
    finish_round(scenario, "ana", started.workspace_key)
    client = TestClient(app)
    login = client.post(
        "/api/v1/auth/login",
        json={"username": scenario.users["lead"], "password": TEST_PASSWORD},
        headers={"Origin": str(client.base_url).rstrip("/")},
    )
    assert login.status_code == 200, login.text
    client.headers["X-CSRF-Token"] = login.json()["csrf_token"]
    queued = client.post(
        f"/api/v1/projects/{scenario.key}/exports", json={"kind": "t1"}
    )
    assert queued.status_code == 200, queued.text
    job_id = queued.json()["job_id"]
    deadline = monotonic() + 30
    while (job := app.state.jobs.get(job_id)).status not in ("succeeded", "failed"):
        assert monotonic() < deadline
        sleep(0.05)
    assert job.status == "succeeded", job.error
    response = client.get(f"/api/v1/jobs/{job_id}/download")
    assert response.status_code == 200, response.text
    artifact = tmp_path / "export.zip"
    artifact.write_bytes(response.content)

    # Reading validates the bundle against the format and the ontology.
    _manifest, units = ontospan.read_bundle(
        artifact, {"hp": ontospan.ObographOntology.load(HP_PATH)}
    )

    german = {
        unit.document.variant.version: unit.document
        for unit in units
        if unit.document.language == "de" and unit.document.variant is not None
    }
    assert sorted(german) == [1, 2]
    corrected = german[2]
    assert corrected.text == FIXED
    assert corrected.document_id == CASE and corrected.case_id == CASE
    assert corrected.variant.model_dump() == {
        "version": 2,
        "origin": "correction",
        "derived_from": _hash(scenario, document_id),
    }
    assert corrected.translation is None
    assert german[1].variant.origin == "machine_translation"
    assert german[1].translation is not None
    assert _hash(scenario, result["document_id"]) == corrected.text_sha256
