"""The source text of a carried round, for "Show changes since vN" (issue 421).

``GET /rounds/{id}/source-text`` and the ``carried_from`` of a submission's
history name the version the carry re-anchored from (the ``text_map`` pair):
the source submission's text, or the version a text change moved the draft
from. Rounds carried on the same text, and ordinary rounds, have none.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_carry_fixture import (
    CORRECTED_DE,
    TEXT_DE,
    register_carry_forward_scenario_route,
)
from browser_documents_scenarios import Scenario, add_user
from browser_server import ONTOLOGY, TEST_PASSWORD
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from test_text_change_service import _env, _move, _started

from ontotator.api.app import create_app
from ontotator.config import AppConfig


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "source-text.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    register_carry_forward_scenario_route(app)
    with TestClient(app) as client:
        yield client


def scenario(client: TestClient, name: str) -> dict[str, Any]:
    response = client.post("/__test_carry_forward__", params={"scenario": name})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def login(client: TestClient, username: str) -> None:
    client.cookies.clear()
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": TEST_PASSWORD},
        headers={"Origin": str(client.base_url).rstrip("/")},
    )
    assert response.status_code == 200, response.text


def get(client: TestClient, path: str) -> Any:
    response = client.get(path)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_carry_to_a_corrected_text_names_the_earlier_version(client):
    built = scenario(client, "corrected")
    login(client, built["username"])
    rounds = built["rounds"]
    source = get(client, f"/api/v1/rounds/{rounds['round2']}/source-text")
    assert source == {
        "document_id": built["documents"][0],
        "language": "de",
        "version": 1,
        "text": TEXT_DE,
    }
    # Round 1 was an ordinary round on v1.
    assert get(client, f"/api/v1/rounds/{rounds['round1']}/source-text") is None


def test_a_carry_on_the_same_text_has_no_source_text(client):
    built = scenario(client, "t5")
    login(client, built["username"])
    assert (
        get(client, f"/api/v1/rounds/{built['rounds']['round2']}/source-text") is None
    )


def test_only_who_may_see_the_round_reads_its_source(client):
    built = scenario(client, "corrected_done")
    other = add_user(
        Scenario(client.app, built["project"], dict(built["users"])),  # type: ignore[arg-type]
        "other",
        ["annotator"],
        languages=("de",),
    )
    login(client, other)
    response = client.get(f"/api/v1/rounds/{built['rounds']['round2']}/source-text")
    assert response.status_code == 404
    assert response.json()["code"] == "ROUND_NOT_FOUND"
    login(client, built["lead_username"])
    source = get(client, f"/api/v1/rounds/{built['rounds']['round2']}/source-text")
    assert source["version"] == 1


def test_submission_history_names_the_carried_source(client):
    built = scenario(client, "corrected_done")
    login(client, built["lead_username"])
    base = f"/api/v1/projects/{built['project']}/documents"
    v1, v2 = built["documents"]
    carried = get(client, f"{base}/{v2}/submissions/{built['submissions']['round2']}")
    assert carried["carried_from"] == {
        "document_id": v1,
        "language": "de",
        "version": 1,
        "text": TEXT_DE,
    }
    first = get(client, f"{base}/{v1}/submissions/{built['submissions']['round1']}")
    assert first["carried_from"] is None
    # The text of the submission is the corrected one: the marks map onto it.
    assert get(client, f"{base}/{v2}/text")["text"] == CORRECTED_DE


def test_a_text_change_names_the_version_the_draft_moved_from(client):
    env = _env(client.app)
    work = _started(env)
    moved = _move(env, work["assignment_id"])
    login(client, env.user("tom"))
    source = get(client, f"/api/v1/rounds/{moved.round.round_id}/source-text")
    assert source["document_id"] == env.docs[0]
    assert source["version"] == 1
    assert source["text"] == TEXT_DE
