"""Issue 635: the CLI operator's exports of a project with work rounds.

The operator of ``ontotator admin`` has no user row. Its rights must not be
reloaded from the users table, or every text of a project with a work round
reads as ``DOCUMENT_NOT_FOUND``.
"""

from __future__ import annotations

import json
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_consolidation_scenarios import FINDINGS, TEXT, _annotate
from browser_documents_scenarios import (
    accept_translation,
    add_user,
    import_texts,
    new_project,
)
from browser_server import ONTOLOGY
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import select
from t1_builders import native_unit, translation_unit
from typer.testing import CliRunner

from ontotator.api.app import create_app
from ontotator.authz.policy import Access, Action, can
from ontotator.authz.visibility import current_access, require_document
from ontotator.config import AppConfig
from ontotator.domain.errors import DomainError
from ontotator.exchange.jobs import operator_access
from ontotator.storage.tables import ProjectRow
from ontotator.storage.workflow_tables import WorkRoundRow

CASE = "case-0635"
GERMAN = "Der Patient hatte letzte Woche zwei Anfälle. Keine muskuläre Hypotonie."


@pytest.fixture
def server(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    folder = tmp_path / "server"
    folder.mkdir()
    app = create_app(
        AppConfig(
            workspace_dir=folder,
            database_url=database_url_for(folder / "editor.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    with TestClient(app) as client:
        monkeypatch.setenv("ONTOTATOR_DATA_DIR", str(_db(client).data_dir))
        yield client


def _db(client: TestClient) -> Any:
    return client.app.state.repo.db  # type: ignore[attr-defined]


def _project(client: TestClient) -> tuple[str, str]:
    """A text with a reviewed translation and two submitted work rounds."""
    scenario = new_project(client.app, "cli635")  # type: ignore[arg-type]
    source = native_unit(CASE, "en", TEXT, case_id=CASE)
    german = translation_unit(CASE, "de", GERMAN, source=source)
    documents = import_texts(scenario, [source, german])
    english, translated = documents[(CASE, "en", 1)], documents[(CASE, "de", 1)]
    add_user(scenario, "reviewer", ["annotator"], qualification="Physician")
    for name in FINDINGS:
        add_user(scenario, name, ["annotator"])
    accept_translation(scenario, translated, "reviewer")
    for name in FINDINGS:
        _annotate(scenario, name, english, FINDINGS[name])
    with _db(client).snapshot() as conn:
        rounds = conn.execute(
            select(WorkRoundRow.round_id)
            .join(ProjectRow, ProjectRow.id == WorkRoundRow.project_id)
            .where(ProjectRow.project_key == scenario.key)
        ).all()
    assert rounds, "the regression needs a project with a work round"
    return scenario.key, english


def _cli(client: TestClient, *args: str) -> Any:
    from ontotator.cli import app as cli

    url = str(_db(client).url.render_as_string(hide_password=False))
    return CliRunner().invoke(cli, ["admin", "--database-url", url, *args])


def _t1(path: Path, output: str) -> None:
    assert "Wrote" in output
    with zipfile.ZipFile(path) as archive:
        assert "manifest.json" in archive.namelist()


def _edit_log(path: Path, output: str) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    assert lines and all(json.loads(line) for line in lines)


def _reviews(path: Path, output: str) -> None:
    assert "1 review" in output
    [line] = path.read_text(encoding="utf-8").splitlines()
    assert json.loads(line)


def _archive(path: Path, output: str) -> None:
    assert zipfile.is_zipfile(path)


@pytest.mark.parametrize(
    ("command", "check"),
    [
        (["export"], _t1),
        (["export-edit-log"], _edit_log),
        (["export-translation-reviews"], _reviews),
        (["projects", "export-archive"], _archive),
    ],
    ids=["t1", "edit-log", "translation-reviews", "archive"],
)
def test_cli_exports_a_project_with_work_rounds(
    server: TestClient, tmp_path: Path, command: list[str], check: Any
) -> None:
    key, _document = _project(server)
    out = tmp_path / "out"
    exported = _cli(server, *command, key, str(out))
    assert exported.exit_code == 0, exported.output
    check(out, exported.output)


def test_operator_access_is_not_reloaded_but_users_still_are(
    server: TestClient,
) -> None:
    """The operator keeps its rights without a user row; a real account
    claiming the same flags is still read fresh from the users table."""
    key, document = _project(server)
    db = _db(server)
    from ontotator.auth.audit import Actor

    operator = operator_access(Actor.cli())
    with db.snapshot() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == key)
        ).scalar_one()
        fresh = current_access(conn, operator, pid, key)
        assert fresh.is_system_admin and fresh.system_operator
        assert can(fresh, Action.VIEW_ALL_DOCUMENTS, key)
        require_document(conn, operator, pid, key, document)

        # Without the operator flag, user 0 is nobody, as before.
        stranger = Access(0, "cli", True)
        assert not current_access(conn, stranger, pid, key).is_system_admin
        with pytest.raises(DomainError) as error:
            require_document(conn, stranger, pid, key, document)
        assert error.value.code == "DOCUMENT_NOT_FOUND"
