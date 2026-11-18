"""Documents: the flag and filter "Typography hints" (issue 484).

A row counts the hints of the newest version of its text. Hints are computed,
never stored; the count of a version is kept in the process by text hash.
"""

import re
from types import SimpleNamespace
from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import event
from t1_builders import bundle, correction_unit, native_unit, translation_unit
from t1_fixtures import create_project, run_import
from test_auth_api import _app
from work_plan_support import plan_all

from ontotator.application import typography_counts

BASE = "/api/v1/projects/proj"


@pytest.fixture
def env(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    monkeypatch.setattr(typography_counts, "_COUNTS", {})
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    spaced = native_unit("spaced", "en", "Fever  and cough.. ", case_id="c1")
    # The first version has a hint, its correction has none.
    fixed_source = native_unit("fixed", "en", "No fever.", case_id="c2")
    fixed = translation_unit("fixed-de", "de", "Kein  Fieber.", source=fixed_source)
    # The first version is clean, its correction has a hint.
    broken_source = native_unit("broken", "en", "No cough.", case_id="c3")
    broken = translation_unit("broken-de", "de", "Kein Husten.", source=broken_source)
    units = [
        spaced,
        fixed_source,
        fixed,
        correction_unit(fixed, "Kein Fieber."),
        broken_source,
        broken,
        correction_unit(broken, "Kein Husten ."),
    ]
    imported = run_import(db, bundle(tmp_path, units))
    assert imported.status == "succeeded", imported.error
    plan_all(db, "proj")
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    return SimpleNamespace(app=app, db=db, lead=lead)


def page(env: Any, **params: Any) -> dict[str, Any]:
    response = env.lead.get(f"{BASE}/document-rows", params=params)
    assert response.status_code == 200, response.text
    return dict(response.json())


def counts(body: dict[str, Any]) -> dict[tuple[str, str], int]:
    return {
        (row["case_id"], row["language"]): row["typography_hints"]
        for group in body["groups"]
        for row in group["rows"]
    }


def test_a_row_counts_the_hints_of_its_newest_version(env: Any) -> None:
    assert counts(page(env)) == {
        ("c1", "en"): 3,  # double space, doubled full stop, space at the end
        ("c2", "en"): 0,
        ("c2", "de"): 0,  # v1 had a double space, v2 has none
        ("c3", "en"): 0,
        ("c3", "de"): 1,  # only v2 has a space before the full stop
    }


def test_the_filter_lists_the_rows_with_hints_and_the_facet_counts_them(
    env: Any,
) -> None:
    body = page(env, flags="typography_hints")
    assert {key for key, count in counts(body).items() if count} == {
        ("c1", "en"),
        ("c3", "de"),
    }
    assert body["bar"]["shown"] == 2
    assert body["bar"]["facets"]["flags"]["typography_hints"] == 2
    # Together with another filter: AND across groups.
    german = page(env, flags="typography_hints", language="de")
    assert german["bar"]["shown"] == 1
    assert page(env)["bar"]["facets"]["flags"]["typography_hints"] == 2


def test_an_unknown_flag_is_refused(env: Any) -> None:
    refused = env.lead.get(f"{BASE}/document-rows", params={"flags": "typography"})
    assert refused.status_code == 422


def test_texts_are_read_once_and_counted_from_then_on(env: Any) -> None:
    def text_reads() -> int:
        statements: list[str] = []

        def capture(_c: Any, _cur: Any, statement: str, *_rest: Any) -> None:
            statements.append(statement.lower())

        event.listen(env.db.engine, "before_cursor_execute", capture)
        try:
            page(env)
        finally:
            event.remove(env.db.engine, "before_cursor_execute", capture)
        return sum(bool(re.search(r"documents\.text\s", sql)) for sql in statements)

    assert text_reads() == 1
    assert text_reads() == 0
    # The newest versions only: five texts, not the two replaced ones.
    assert len(typography_counts._COUNTS) == 5
