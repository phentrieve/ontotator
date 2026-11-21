"""Project archives with segment pairs of a review in progress (issue 560).

The pairs are a reviewer's working aid in the draft form. An archive without them
stays schema version 1, as before, so it still imports into older servers. An
archive with them is version 2: this server imports it with the pairs, an older
server (which reads only version 1) refuses it cleanly instead of importing a draft
form it would then refuse at submit.
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import pytest
from browser_consolidation_scenarios import TEXT
from browser_documents_scenarios import (
    add_user,
    assign,
    identity,
    import_texts,
    new_project,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from t1_builders import native_unit, translation_unit
from t1_fixtures import OPERATOR
from test_project_archive import _db, _export, _rewrite
from test_project_archive import servers as servers

from ontotator.application.translation_reviews import (
    CHECKED_SENTENCES_KEY,
    SEGMENT_PAIRS_KEY,
    CheckedSentences,
    SegmentPairs,
    SegmentPairsSave,
    TranslationReviewService,
)
from ontotator.domain.errors import DomainError
from ontotator.exchange import archive as project_archive
from ontotator.storage.tables import (
    AssignmentRow,
    ProjectRow,
    TranslationReviewDraftRow,
)

CASE = "case-0560"
GERMAN = "Der Patient hatte letzte Woche zwei Anfälle. Keine muskuläre Hypotonie."
PAIRS = {
    "source_hash": "0a1b2c3d",
    "text_hash": "12345678",
    "pairs": [
        {
            "source": {"start": 0, "end": 10},
            "translation": {"start": 0, "end": 12},
            "manual": False,
            "checked": "cafebabe",
        }
    ],
}


def _review_in_progress(app: FastAPI, *, pairs: bool) -> str:
    """A translation review in progress with checked sentences (and pairs)."""
    scenario = new_project(app, "pairs" if pairs else "marks")
    source = native_unit(CASE, "en", TEXT, case_id=CASE)
    german = translation_unit(CASE, "de", GERMAN, source=source)
    documents = import_texts(scenario, [source, german])
    add_user(scenario, "reviewer", ["annotator"], qualification="Physician")
    assignment_id = assign(
        scenario, documents[(CASE, "de", 1)], "reviewer", "translation_review"
    )
    access, _actor = identity(scenario, "reviewer")
    review = TranslationReviewService(scenario.db, app.state.jobs)
    review.open(access, assignment_id)
    review.save_checked_sentences(
        access,
        assignment_id,
        CheckedSentences.model_validate(
            {"source": [{"index": 0, "hash": "0badf00d"}], "translation": []}
        ),
    )
    if pairs:
        review.save_segment_pairs(
            access, assignment_id, SegmentPairsSave.model_validate(PAIRS)
        )
    return scenario.key


def _manifest(data: bytes) -> dict[str, Any]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        value: dict[str, Any] = json.loads(archive.read("manifest.json"))
    return value


def _draft_forms(client: TestClient, key: str) -> list[dict[str, Any]]:
    with _db(client).snapshot() as conn:
        return list(
            conn.execute(
                select(TranslationReviewDraftRow.form)
                .join(
                    AssignmentRow,
                    AssignmentRow.id == TranslationReviewDraftRow.assignment_id,
                )
                .join(ProjectRow, ProjectRow.id == AssignmentRow.project_id)
                .where(ProjectRow.project_key == key)
            ).scalars()
        )


def test_an_archive_without_segment_pairs_stays_version_1(
    servers: tuple[TestClient, TestClient], tmp_path: Path
) -> None:
    source, target = servers
    key = _review_in_progress(source.app, pairs=False)  # type: ignore[arg-type]
    data = _export(source, key, tmp_path)
    assert _manifest(data)["schema_version"] == 1
    result = project_archive.import_archive(_db(target), OPERATOR, data)
    assert result["verification"]["ok"]
    [form] = _draft_forms(target, key)
    assert CHECKED_SENTENCES_KEY in form and SEGMENT_PAIRS_KEY not in form


def test_an_archive_with_segment_pairs_is_version_2_and_keeps_both_aids(
    servers: tuple[TestClient, TestClient], tmp_path: Path
) -> None:
    source, target = servers
    key = _review_in_progress(source.app, pairs=True)  # type: ignore[arg-type]
    data = _export(source, key, tmp_path)
    assert _manifest(data)["schema_version"] == 2
    result = project_archive.import_archive(_db(target), OPERATOR, data)
    assert result["verification"]["ok"]
    [form] = _draft_forms(target, key)
    assert form[SEGMENT_PAIRS_KEY] == SegmentPairs.model_validate(PAIRS).model_dump(
        mode="json"
    )
    assert form[CHECKED_SENTENCES_KEY] == {
        "source": [{"index": 0, "hash": "0badf00d"}],
        "translation": [],
    }


def test_a_server_that_reads_only_version_1_refuses_segment_pairs_cleanly(
    servers: tuple[TestClient, TestClient],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source, target = servers
    key = _review_in_progress(source.app, pairs=True)  # type: ignore[arg-type]
    data = _export(source, key, tmp_path)
    # The import rules of a server before issue 560: version 1 only.
    monkeypatch.setattr(project_archive, "SCHEMA_VERSION", 1)
    monkeypatch.setattr(project_archive, "UPGRADES", {})
    with pytest.raises(DomainError) as error:
        project_archive.import_archive(_db(target), OPERATOR, data)
    assert error.value.code == "ARCHIVE_FORMAT_UNSUPPORTED"
    assert "version 2" in str(error.value)
    with _db(target).snapshot() as conn:
        assert conn.execute(select(ProjectRow.id)).first() is None


def test_an_old_version_1_archive_still_imports(
    servers: tuple[TestClient, TestClient], tmp_path: Path
) -> None:
    source, target = servers
    key = _review_in_progress(source.app, pairs=False)  # type: ignore[arg-type]

    def as_written_before(files: dict[str, bytes]) -> None:
        manifest = json.loads(files["manifest.json"])
        assert manifest["schema_version"] == 1
        files["manifest.json"] = json.dumps(manifest).encode()

    data = _rewrite(_export(source, key, tmp_path), as_written_before)
    assert project_archive.import_archive(_db(target), OPERATOR, data)["verification"][
        "ok"
    ]
