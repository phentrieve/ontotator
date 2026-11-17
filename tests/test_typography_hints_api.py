"""Typography hints over HTTP: who may read them, paging, and their cost.

Reading the hints of a text needs exactly what reading the text needs: the
tests compare every answer with the answer of the text route.
"""

from types import SimpleNamespace
from typing import Any
from urllib.parse import quote

import pytest
from auth_harness import logged_in
from fastapi.testclient import TestClient
from sqlalchemy import event, update
from t1_builders import bundle, correction_unit, native_unit, translation_unit
from t1_fixtures import create_project, run_import
from test_auth_api import _app
from work_plan_support import plan_all

from ontotator.api.typography_routes import PROJECT_PAGE_MAX
from ontotator.auth.audit import Actor
from ontotator.storage.tables import ProjectRow

BASE = "/api/v1/projects/proj"
FACE = "\N{GRINNING FACE}"
SOURCE = "source/id #1"
TARGET = "target/id #1"
CORRECTED = f"{TARGET}~de~v2"
CLEAN = "clean"
OTHER = "other"
SOURCE_TEXT = f"{FACE} Fever,cough  and chills ."
TARGET_TEXT = "Fieber ,Husten\tund Frost."
CORRECTED_TEXT = "Fieber, Husten und Frost. "
SECRET_WORDS = ("Fever", "cough", "chills", "Fieber", "Husten", "Frost")


def path(document: str, suffix: str) -> str:
    return f"{BASE}/documents/{quote(document, safe='')}/{suffix}"


def _env(tmp_path: Any, extra: int = 0) -> SimpleNamespace:
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(annotate_accepted_translations_only=False)
        )
    source = native_unit(SOURCE, "en", SOURCE_TEXT, case_id="case 1")
    target = translation_unit(TARGET, "de", TARGET_TEXT, source=source)
    corrected = correction_unit(target, CORRECTED_TEXT)
    units = [
        source,
        target,
        corrected,
        native_unit(CLEAN, "en", "No fever.", case_id="case 2"),
        native_unit(OTHER, "fr", "Sans fièvre ; sans toux.", case_id="case 3"),
        # Every third extra text has one double space.
        *(
            native_unit(
                f"many-{index:04d}",
                "en",
                f"Text {index} has{'  ' if index % 3 == 0 else ' '}words.",
                case_id=f"many-{index:04d}",
            )
            for index in range(extra)
        ),
    ]
    result = run_import(db, bundle(tmp_path, units))
    assert result.status == "succeeded", result.error
    plan_all(db, "proj")
    return SimpleNamespace(
        app=app,
        db=db,
        lead=logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[]),
        alice=logged_in(
            app,
            "alice",
            projects={"proj": ["annotator"]},
            assignments=[("proj", SOURCE, "annotate")],
        ),
        outsider=logged_in(app, "outsider", assignments=[]),
    )


@pytest.fixture
def env(tmp_path: Any) -> SimpleNamespace:
    return _env(tmp_path)


def _token(env: Any, owner: str, scopes: list[str], **options: Any) -> TestClient:
    issued = env.app.state.api_tokens.create(
        Actor.cli(), owner, name="hints", scopes=scopes, **options
    )
    return TestClient(env.app, headers={"Authorization": f"Bearer {issued.secret}"})


def _pages(client: TestClient, **params: Any) -> tuple[list[dict[str, Any]], int, int]:
    """Every page of the project list: its texts, texts scanned, requests."""
    texts: list[dict[str, Any]] = []
    scanned = requests = 0
    after = None
    while True:
        response = client.get(
            f"{BASE}/typography-hints",
            params={**params, **({"after": after} if after else {})},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        texts += body["texts"]
        scanned += body["scanned"]
        requests += 1
        after = body["next_after"]
        if after is None:
            return texts, scanned, requests


def test_hints_of_a_version_have_rule_and_code_point_positions(env: Any) -> None:
    response = env.lead.get(path(SOURCE, "typography-hints"))
    assert response.status_code == 200, response.text
    body = response.json()
    text = env.lead.get(path(SOURCE, "text")).json()
    assert body["document_id"] == SOURCE
    assert body["text_sha256"] == text["text_sha256"]
    # The emoji before them is one code point (two UTF-16 units).
    assert body["hints"] == [
        {"rule": "MISSING_SPACE_AFTER_PUNCTUATION", "start": 7, "end": 8},
        {"rule": "DOUBLE_SPACE", "start": 13, "end": 15},
        {"rule": "SPACE_BEFORE_PUNCTUATION", "start": 25, "end": 26},
    ]
    assert [SOURCE_TEXT[hint["start"] : hint["end"]] for hint in body["hints"]] == [
        ",",
        "  ",
        " ",
    ]
    assert body["total"] == 3 and body["truncated"] is False
    assert body["counts"] == {
        "DOUBLE_SPACE": 1,
        "SPACE_BEFORE_PUNCTUATION": 1,
        "MISSING_SPACE_AFTER_PUNCTUATION": 1,
    }
    # A hint never carries text.
    assert not any(word in response.text for word in SECRET_WORDS)


def test_a_clean_version_and_a_limit(env: Any) -> None:
    clean = env.lead.get(path(CLEAN, "typography-hints")).json()
    assert clean["hints"] == [] and clean["total"] == 0 and clean["counts"] == {}
    limited = env.lead.get(path(SOURCE, "typography-hints"), params={"limit": 2}).json()
    assert len(limited["hints"]) == 2
    assert limited["total"] == 3 and limited["truncated"] is True
    assert sum(limited["counts"].values()) == 3
    for bad in (0, 2001):
        refused = env.lead.get(path(SOURCE, "typography-hints"), params={"limit": bad})
        assert refused.status_code == 422


def test_hints_are_read_exactly_where_the_text_is_read(env: Any) -> None:
    documents = (SOURCE, TARGET, CORRECTED, CLEAN, OTHER, "missing")
    for name in ("lead", "alice", "outsider"):
        client = getattr(env, name)
        for document in documents:
            text = client.get(path(document, "text"))
            hints = client.get(path(document, "typography-hints"))
            assert hints.status_code == text.status_code, (name, document)
            if text.status_code != 200:
                assert hints.json()["code"] == text.json()["code"], (name, document)
    # The annotator reads her one assigned text and nothing else.
    assert env.alice.get(path(SOURCE, "typography-hints")).status_code == 200
    assert env.alice.get(path(TARGET, "typography-hints")).status_code == 404
    assert env.outsider.get(path(SOURCE, "typography-hints")).status_code == 404


def test_the_project_list_counts_per_text(env: Any) -> None:
    response = env.lead.get(f"{BASE}/typography-hints")
    assert response.status_code == 200, response.text
    body = response.json()
    # Newest versions only: the corrected translation, not the one before it.
    assert body["scanned"] == 4 and body["next_after"] is None
    by_id = {row["document_id"]: row for row in body["texts"]}
    assert set(by_id) == {SOURCE, CORRECTED, OTHER}
    assert by_id[SOURCE] == {
        "document_id": SOURCE,
        "case_id": "case 1",
        "language": "en",
        "version": 1,
        "total": 3,
        "counts": {
            "DOUBLE_SPACE": 1,
            "SPACE_BEFORE_PUNCTUATION": 1,
            "MISSING_SPACE_AFTER_PUNCTUATION": 1,
        },
    }
    assert by_id[CORRECTED]["counts"] == {"TRAILING_WHITESPACE_TEXT": 1}
    assert by_id[CORRECTED]["version"] == 2
    assert by_id[OTHER]["counts"] == {"SPACE_BEFORE_PUNCTUATION": 1}
    assert not any(word in response.text for word in SECRET_WORDS)
    everything = env.lead.get(
        f"{BASE}/typography-hints", params={"versions": "all"}
    ).json()
    assert everything["scanned"] == 5
    assert {row["document_id"] for row in everything["texts"]} == {
        SOURCE,
        TARGET,
        CORRECTED,
        OTHER,
    }


def test_the_project_list_shows_only_readable_texts(env: Any) -> None:
    mine = env.alice.get(f"{BASE}/typography-hints", params={"versions": "all"})
    assert mine.status_code == 200, mine.text
    assert [row["document_id"] for row in mine.json()["texts"]] == [SOURCE]
    assert mine.json()["scanned"] == 1
    refused = env.outsider.get(f"{BASE}/typography-hints")
    assert refused.status_code == 404
    assert refused.json()["code"] == "PROJECT_NOT_FOUND"
    assert env.lead.get("/api/v1/projects/nope/typography-hints").status_code == 404


def test_the_project_list_pages_through_every_text(env: Any) -> None:
    whole, _, _ = _pages(env.lead, versions="all")
    paged, scanned, requests = _pages(env.lead, versions="all", limit=2)
    assert paged == whole
    assert scanned == 5 and requests == 3
    ids = [row["document_id"] for row in paged]
    assert ids == sorted(ids)
    for bad in (0, PROJECT_PAGE_MAX + 1):
        refused = env.lead.get(f"{BASE}/typography-hints", params={"limit": bad})
        assert refused.status_code == 422


def test_a_token_needs_the_scope_of_the_text_route(env: Any) -> None:
    routes = (
        path(SOURCE, "text"),
        path(SOURCE, "typography-hints"),
        f"{BASE}/typography-hints",
    )
    reader = _token(env, "leader", ["read"])
    exporter = _token(env, "leader", ["export"])
    project = _token(env, "leader", ["read"], kind="project", project_key="proj")
    for route in routes:
        assert reader.get(route).status_code == 200, route
        assert project.get(route).status_code == 200, route
        refused = exporter.get(route)
        assert refused.status_code == 403, route
        assert refused.json()["code"] == exporter.get(routes[0]).json()["code"]
    # The token of an annotator reaches what she reaches.
    annotator = _token(env, "alice", ["read"])
    assert annotator.get(path(SOURCE, "typography-hints")).status_code == 200
    for document in (TARGET, OTHER):
        assert annotator.get(path(document, "typography-hints")).status_code == 404
        assert annotator.get(path(document, "text")).status_code == 404
    listed = annotator.get(f"{BASE}/typography-hints").json()
    assert [row["document_id"] for row in listed["texts"]] == [SOURCE]


def _statements(env: Any, client: TestClient, url: str, **params: Any) -> list[str]:
    statements: list[str] = []

    def capture(_c: Any, _cur: Any, statement: str, *_rest: Any) -> None:
        statements.append(statement.lower())

    event.listen(env.db.engine, "before_cursor_execute", capture)
    try:
        response = client.get(url, params=params)
    finally:
        event.remove(env.db.engine, "before_cursor_execute", capture)
    assert response.status_code == 200, response.text
    return statements


def test_hints_are_computed_and_nothing_is_written(env: Any) -> None:
    for url in (path(SOURCE, "typography-hints"), f"{BASE}/typography-hints"):
        statements = _statements(env, env.lead, url)
        assert not any(
            sql.lstrip().startswith(("insert", "update", "delete"))
            for sql in statements
        ), url


def test_the_project_list_stays_cheap_in_a_project_of_many_texts(
    tmp_path: Any,
) -> None:
    small = _env(tmp_path / "small")
    large = _env(tmp_path / "large", extra=600)

    def selects(env: Any, client: TestClient, **params: Any) -> list[str]:
        return [
            sql
            for sql in _statements(env, client, f"{BASE}/typography-hints", **params)
            if sql.lstrip().startswith("select")
        ]

    for name in ("lead", "alice"):
        few = selects(small, getattr(small, name))
        many = selects(large, getattr(large, name), limit=50)
        # The number of statements does not grow with the project ...
        assert len(many) == len(few) <= 12, name
        # ... and exactly one of them reads text, of one page of texts.
        reading = [sql for sql in many if "documents.text" in sql]
        assert len(reading) == 1 and "limit" in reading[0], name

    page = large.lead.get(f"{BASE}/typography-hints", params={"limit": 50}).json()
    assert page["scanned"] == 50 and page["next_after"] is not None
    # No page reads more than the maximum, whatever is asked for.
    full = large.lead.get(
        f"{BASE}/typography-hints", params={"limit": PROJECT_PAGE_MAX}
    ).json()
    assert full["scanned"] == PROJECT_PAGE_MAX
    texts, scanned, requests = _pages(large.lead, limit=PROJECT_PAGE_MAX)
    assert scanned == 604 and requests == 4
    assert sum(row["document_id"].startswith("many-") for row in texts) == 200
