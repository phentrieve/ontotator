"""Issue 484 in the translation review: typography hints of the draft text
for the submit confirmation, and the check for bracketed passages the
translation has and its source does not."""

from types import SimpleNamespace
from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import func, select
from t1_builders import bundle, native_unit, translation_unit
from t1_fixtures import create_project, run_import
from test_auth_api import _app
from work_plan_support import plan_all

from ontotator.assignments.service import AssignmentService
from ontotator.storage.tables import AuditEventRow, TranslationReviewDraftRow

BASE = "/api/v1/projects/proj"
SOURCE_TEXT = "Jaundice and a dose of aspirin (100 mg)."
TARGET_TEXT = "Gelbsucht (Ikterus) und eine Dosis Aspirin (100 mg)."
FACE = "\N{GRINNING FACE}"


@pytest.fixture
def env(tmp_path: Any) -> SimpleNamespace:
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    source = native_unit("source", "en", SOURCE_TEXT, case_id="case 1")
    target = translation_unit("target", "de", TARGET_TEXT, source=source)
    plain_source = native_unit("plain", "en", "Pain (left).", case_id="case 2")
    plain = translation_unit("plain-de", "de", "Schmerz (links).", source=plain_source)
    imported = run_import(db, bundle(tmp_path, [source, target, plain_source, plain]))
    assert imported.status == "succeeded", imported.error
    plan_all(db, "proj")
    alice = logged_in(app, "alice", projects={"proj": ["annotator"]}, assignments=[])
    bob = logged_in(app, "bob", projects={"proj": ["annotator"]}, assignments=[])
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    return SimpleNamespace(app=app, db=db, alice=alice, bob=bob, lead=lead)


def assigned(env: Any, document: str = "target") -> str:
    response = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": document, "username": "alice"}],
            "task": "translation_review",
            "confirm_language": True,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["refused"] == [], response.text
    return f"/api/v1/translation-reviews/{response.json()['created'][0]['id']}"


def save(env: Any, url: str, text: str, revision: int = 0) -> None:
    response = env.alice.put(
        url + "/draft",
        json={"expected_revision": revision, "text": text, "form": {}},
    )
    assert response.status_code == 200, response.text


def test_the_workspace_names_the_passages_the_translation_added(env: Any) -> None:
    url = assigned(env)
    workspace = env.alice.get(url).json()
    check = workspace["added_brackets"]
    assert (check["source_count"], check["translation_count"]) == (1, 2)
    # The dose both texts bracket is not named.
    assert check["passages"] == [{"start": 10, "end": 19, "text": "(Ikterus)"}]
    assert check["truncated"] is False
    # It is no failed check of the translation run: nothing asks for a
    # rationale and My tasks counts nothing.
    assert workspace["failed_checks"] == []
    (task,) = AssignmentService(env.db).my_tasks(workspace["assignment"]["user_id"])
    assert task.failed_check_count == 0


def test_as_many_passages_as_the_source_name_nothing(env: Any) -> None:
    check = env.alice.get(assigned(env, "plain-de")).json()["added_brackets"]
    assert check == {
        "source_count": 1,
        "translation_count": 1,
        "passages": [],
        "truncated": False,
    }


def test_the_check_is_of_the_reviewed_version_not_of_the_draft(env: Any) -> None:
    url = assigned(env)
    save(env, url, "Gelbsucht und eine Dosis Aspirin (100 mg).")
    check = env.alice.get(url).json()["added_brackets"]
    assert [passage["text"] for passage in check["passages"]] == ["(Ikterus)"]


def test_an_accepted_unchanged_review_needs_no_rationale_for_the_passages(
    env: Any,
) -> None:
    url = assigned(env)
    env.alice.patch("/api/v1/me/profile", json={"qualification": "Reviewer"})
    body = {
        "expected_revision": 0,
        "text": TARGET_TEXT,
        "form": {"decision": "accepted_unchanged", "clinical_change": False},
    }
    assert env.alice.put(url + "/draft", json=body).status_code == 200
    submitted = env.alice.post(url + "/submit", json={"expected_revision": 1})
    assert submitted.status_code == 200, submitted.text


def test_draft_hints_are_of_the_version_text_before_the_first_save(env: Any) -> None:
    url = assigned(env)
    hints = env.alice.get(url + "/draft/typography-hints")
    assert hints.status_code == 200, hints.text
    assert hints.json() == {
        "revision": 0,
        "total": 0,
        "counts": {},
        "hints": [],
        "truncated": False,
    }
    # Asking wrote no draft.
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count()).select_from(TranslationReviewDraftRow)
            ).scalar_one()
            == 0
        )


def test_draft_hints_follow_the_saved_text_in_code_points(env: Any) -> None:
    url = assigned(env)
    text = f"{FACE} Gelbsucht  und Fieber.. Kein Husten "
    save(env, url, text)
    with env.db.transaction() as conn:
        audits = conn.execute(
            select(func.count()).select_from(AuditEventRow)
        ).scalar_one()
    body = env.alice.get(url + "/draft/typography-hints").json()
    assert body["revision"] == 1
    assert body["total"] == 3
    assert body["counts"] == {
        "DOUBLE_SPACE": 1,
        "TRAILING_WHITESPACE_TEXT": 1,
        "DOUBLE_FULL_STOP": 1,
    }
    assert body["hints"] == [
        {"rule": "DOUBLE_SPACE", "start": 11, "end": 13},
        {"rule": "DOUBLE_FULL_STOP", "start": 23, "end": 25},
        {"rule": "TRAILING_WHITESPACE_TEXT", "start": 37, "end": 38},
    ]
    assert body["truncated"] is False
    for hint in body["hints"]:
        assert text[hint["start"] : hint["end"]].strip(" .") == ""
    with env.db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(AuditEventRow)).scalar_one()
            == audits
        )
    save(env, url, "Gelbsucht und Fieber.", revision=1)
    assert env.alice.get(url + "/draft/typography-hints").json()["total"] == 0


def test_only_the_reviewer_reads_the_hints_of_a_draft(env: Any) -> None:
    url = assigned(env)
    save(env, url, "Gelbsucht  und Fieber.")
    for client in (env.bob, env.lead):
        refused = client.get(url + "/draft/typography-hints")
        assert refused.status_code == 404, refused.text
        assert refused.json()["code"] == "ASSIGNMENT_NOT_FOUND"
        assert "Gelbsucht" not in refused.text
    missing = env.alice.get("/api/v1/translation-reviews/999999/draft/typography-hints")
    assert missing.status_code == 404
