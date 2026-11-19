"""A consolidator's API token reads the inputs of their own consolidation
task, and nothing the web interface would not show them (issue 471, point 7).

The MCP tools ``list_my_tasks`` and ``get_consolidation_inputs`` read
``GET /api/v1/me/tasks``, ``GET /api/v1/assignments/{id}``, ``…/rounds`` and
``GET /api/v1/rounds/{round_id}/inputs`` (and the text, and a submission with
``get_submission``), the routes the consolidation screen reads. With
"Hide annotator names during consolidation" on, a ``read`` token of the
consolidator must get the opaque IDs the session gets: no real submission
or input ID, no user ID, username, display name or pseudonym of an
annotator, and no hash a pseudonym can be recomputed from. The scenario has
real IDs (hex hashes), unlike the hand-named ones of
``test_consolidation_resolve_api``.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest
from browser_consolidation_scenarios import build
from browser_documents_scenarios import Scenario, add_user, new_project
from browser_server import ONTOLOGY, TEST_PASSWORD
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from test_consolidation_blinding_ids import _bare_hashes, _version

from ontotator.api.app import create_app
from ontotator.auth.audit import Actor
from ontotator.config import AppConfig

ANNOTATORS = ("ann-0001", "ann-0002")


@pytest.fixture
def app(tmp_path: Path) -> Iterator[Any]:
    made = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "inputs.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    with TestClient(made):
        yield made


def _token(app: Any, username: str, **options: Any) -> TestClient:
    issued = app.state.api_tokens.create(
        Actor.cli(), username, name="mcp read", scopes=["read"], **options
    )
    return TestClient(app, headers={"Authorization": f"Bearer {issued.secret}"})


def _session(app: Any, username: str) -> TestClient:
    client = TestClient(app)
    origin = str(client.base_url).rstrip("/")
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": TEST_PASSWORD},
        headers={"Origin": origin},
    )
    assert response.status_code == 200, response.text
    return client


def _ok(response: Any) -> Any:
    assert response.status_code == 200, (response.request.url, response.text)
    return response.json()


def _reads(client: TestClient, built: dict[str, Any]) -> dict[str, Any]:
    """What get_consolidation_inputs (and get_submission on each input)
    reads, starting from the task list, with the IDs the client was given."""
    [task] = [
        t
        for t in _ok(client.get("/api/v1/me/tasks"))
        if t["project_key"] == built["project"] and t["task"] == "review"
    ]
    base = f"/api/v1/assignments/{task['assignment_id']}"
    out: dict[str, Any] = {"tasks": task, "task": _ok(client.get(base))}
    out["rounds"] = _ok(client.get(f"{base}/rounds"))
    out["inputs"] = [
        _ok(client.get(f"/api/v1/rounds/{quote(r['round_id'], safe='')}/inputs"))
        for r in out["rounds"]
    ]
    document = out["task"]["document_id"]
    text_base = (
        f"/api/v1/projects/{built['project']}/documents/{quote(document, safe='')}"
    )
    out["text"] = _ok(client.get(f"{text_base}/text"))
    sources = sorted(
        {i["source_submission_id"] for items in out["inputs"] for i in items}
    )
    out["submissions"] = [
        _ok(client.get(f"{text_base}/submissions/{quote(sid, safe='')}"))
        for sid in sources
    ]
    return out


def _identities(app: Any, built: dict[str, Any]) -> list[str]:
    """Username, display name and pseudonym of each annotator."""
    found = []
    for name in ANNOTATORS:
        user = app.state.accounts.get_by_username(built["users"][name])
        found += [user.username, user.display_name, str(user.pseudonym)]
    return found


def _named(app: Any, built: dict[str, Any], payload: Any) -> list[str]:
    text = json.dumps(payload, ensure_ascii=False)
    return [
        identity
        for identity in _identities(app, built)
        if re.search(rf"(?<![\w-]){re.escape(identity)}(?![\w-])", text)
    ]


def _user_ids(payload: Any) -> list[int]:
    """Every value of a ``user_id`` key."""
    if isinstance(payload, dict):
        found = [v for k, v in payload.items() if k == "user_id"]
        return found + [i for v in payload.values() for i in _user_ids(v)]
    if isinstance(payload, list):
        return [i for item in payload for i in _user_ids(item)]
    return []


def _real_ids(app: Any, built: dict[str, Any]) -> list[str]:
    """The real submission and input IDs and snapshot versions of the
    consolidation's inputs. The round ID is not among them: it is random
    (``round-`` and a UUID), names the consolidator's own round and is in
    the address of the web interface's consolidation screen."""
    stored = app.state.repo.get_round_input_inventory(
        built["project"], built["round_id"]
    )
    return [
        *built["submissions"],
        *[i["input_id"] for i in stored],
        *[i["source_snapshot"]["version"] for i in stored],
    ]


def _snapshots(reads: dict[str, Any]) -> list[dict[str, Any]]:
    snaps = [i["source_snapshot"] for items in reads["inputs"] for i in items]
    snaps += [
        i["target_snapshot"]
        for items in reads["inputs"]
        for i in items
        if i["target_snapshot"]
    ]
    snaps += [s for sub in reads["submissions"] for s in sub["annotations"]]
    return snaps


def test_a_blinded_consolidators_token_reads_the_inputs_under_opaque_ids(
    app: Any,
) -> None:
    built = build(app, started=True, blind=True)
    consolidator = built["users"]["adj"]
    reads = _reads(_token(app, consolidator), built)
    inputs = [i for items in reads["inputs"] for i in items]
    # The inputs are there: every finding of both annotators.
    stored = app.state.repo.get_round_input_inventory(
        built["project"], built["round_id"]
    )
    assert len(inputs) == len(stored) > 10
    assert {i["source_snapshot"]["annotation"]["term_id"] for i in inputs} >= {
        "HP:0001250",
        "HP:0001252",
    }
    assert {
        i["source_snapshot"]["annotation"]["provenance"]["actor"]["actor_id"]
        for i in inputs
    } == {"annotator-a", "annotator-b"}
    assert len(reads["submissions"]) == 2
    # Nothing names an annotator or maps back to one.
    text = json.dumps(reads)
    assert _named(app, built, reads) == []
    assert [real for real in _real_ids(app, built) if real in text] == []
    assert _bare_hashes(reads) == []
    annotator_ids = {
        app.state.accounts.get_by_username(built["users"][n]).id for n in ANNOTATORS
    }
    assert annotator_ids.isdisjoint(_user_ids(reads))
    pseudonyms = [
        str(app.state.accounts.get_by_username(u).pseudonym)
        for u in built["users"].values()
    ]
    for snap in _snapshots(reads):
        assert all(_version(snap, p) != snap["version"] for p in pseudonyms)
    # Exactly what the consolidator's own session reads in the web interface.
    assert reads == _reads(_session(app, consolidator), built)


def test_a_consolidator_who_sees_names_reads_the_real_inputs(app: Any) -> None:
    built = build(app, started=True, consolidator="adj")
    consolidator = built["users"]["adj"]
    reads = _reads(_token(app, consolidator), built)
    sources = {i["source_submission_id"] for items in reads["inputs"] for i in items}
    assert sources == set(built["submissions"])
    assert [r["round_id"] for r in reads["rounds"]] == [built["round_id"]]
    # The names the consolidation screen shows without the setting.
    assert _named(app, built, reads) != []
    assert reads == _reads(_session(app, consolidator), built)


def _refused(client: TestClient, built: dict[str, Any], code: str) -> None:
    """The task, its rounds and its round's inputs are all refused."""
    base = f"/api/v1/assignments/{built['assignment_id']}"
    for path, expected in (
        (base, code),
        (f"{base}/rounds", code),
        (f"/api/v1/rounds/{built['round_id']}/inputs", "ROUND_NOT_FOUND"),
    ):
        response = client.get(path)
        assert response.status_code == 404, (path, response.text)
        assert response.json()["code"] == expected, path


@pytest.mark.parametrize("blind", [True, False])
def test_nobody_else_reads_the_inputs_of_a_consolidation_task(
    app: Any, blind: bool
) -> None:
    built = build(app, started=True, blind=blind, consolidator="adj")
    scenario = Scenario(app, built["project"], dict(built["users"]))
    other = add_user(scenario, "adj-2", ["adjudicator"])
    # Another consolidator of the project and an annotator of the inputs.
    for username in (other, built["users"]["ann-0001"]):
        _refused(_token(app, username), built, "ASSIGNMENT_NOT_FOUND")


def test_a_consolidator_whose_role_was_taken_reads_nothing(app: Any) -> None:
    built = build(app, started=True, blind=True)
    consolidator = built["users"]["adj"]
    client = _token(app, consolidator)
    _ok(client.get(f"/api/v1/assignments/{built['assignment_id']}"))
    app.state.memberships.remove(
        Actor.cli(),
        built["project"],
        consolidator,
        ["adjudicator"],
        revoke_assignments=True,
    )
    _refused(client, built, "ASSIGNMENT_NOT_FOUND")


def test_a_project_token_of_another_project_reads_nothing(app: Any) -> None:
    built = build(app, started=True, blind=True)
    consolidator = built["users"]["adj"]
    # The consolidator leads another project and has a token of it.
    elsewhere = new_project(app, "other")
    app.state.memberships.add(Actor.cli(), elsewhere.key, consolidator, ["lead"])
    client = _token(app, consolidator, kind="project", project_key=elsewhere.key)
    _refused(client, built, "ASSIGNMENT_NOT_FOUND")
    # The task list is no route of a project.
    listed = client.get("/api/v1/me/tasks")
    assert listed.status_code == 403, listed.text
    assert listed.json()["code"] == "TOKEN_NOT_ALLOWED"
