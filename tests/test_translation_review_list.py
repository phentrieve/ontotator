"""GET /projects/{key}/translation-review-list: the lead's list (issue 483)."""

from types import SimpleNamespace

import pytest
from auth_harness import logged_in
from t1_builders import bundle, native_unit, translation_unit
from t1_fixtures import create_project, run_import
from test_auth_api import _app
from work_plan_support import plan_all

from ontotator.domain.text_changes import changed_passages

BASE = "/api/v1/projects/proj"
URL = f"{BASE}/translation-review-list"
TEXT = "Dose 5 mg daily. No fever was seen. The knee is swollen."


@pytest.fixture
def env(tmp_path):
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    source = native_unit("src", "en", "Source text", case_id="case-1")
    units = [source] + [
        translation_unit(f"t-{language}", language, TEXT, source=source)
        for language in ("de", "es", "fr", "it")
    ]
    result = run_import(db, bundle(tmp_path, units))
    assert result.status == "succeeded", result.error
    plan_all(db, "proj")
    people = {
        name: logged_in(app, name, projects={"proj": [role]}, assignments=[])
        for name, role in (
            ("alice", "annotator"),
            ("bob", "annotator"),
            ("carol", "adjudicator"),
            ("leader", "lead"),
        )
    }
    admin = logged_in(app, "root", system_admin=True, assignments=[])
    for name in ("alice", "bob"):
        people[name].patch("/api/v1/me/profile", json={"qualification": "Physician"})
    return SimpleNamespace(app=app, db=db, admin=admin, **people)


def assign(env, document, username):
    response = env.leader.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": document, "username": username}],
            "task": "translation_review",
            "confirm_language": True,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["refused"] == [], response.text
    return response.json()["created"][0]["id"]


def review(client, assignment_id, form, text=None):
    url = f"/api/v1/translation-reviews/{assignment_id}"
    current = client.get(url).json()["text"]
    saved = client.put(
        url + "/draft",
        json={"expected_revision": 0, "text": text or current, "form": form},
    )
    assert saved.status_code == 200, saved.text
    submitted = client.post(url + "/submit", json={"expected_revision": 1})
    assert submitted.status_code == 200, submitted.text
    return submitted.json()


@pytest.fixture
def reviewed(env):
    """Three submitted reviews (in this order) and one open one."""
    corrected = review(
        env.alice,
        assign(env, "t-de", "alice"),
        {"decision": "accepted_corrected", "clinical_change": False},
        # Two reworded passages and a doubled space, which is no passage.
        text="Dose 5 mg twice daily. No fever was  seen. The left knee is swollen.",
    )
    unchanged = review(
        env.alice,
        assign(env, "t-fr", "alice"),
        {
            "decision": "accepted_unchanged",
            "clinical_change": False,
            "rationale": "The dose looks low, but the source says so.",
        },
    )
    query = review(
        env.bob,
        assign(env, "t-es", "bob"),
        {
            "decision": "query",
            "clinical_change": True,
            "categories": ["source"],
            "rationale": "Is 5 mg right?",
        },
    )
    open_id = assign(env, "t-it", "bob")
    return SimpleNamespace(
        corrected=corrected, unchanged=unchanged, query=query, open_id=open_id
    )


def listed(client, **params):
    response = client.get(URL, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_the_list_has_one_row_per_submitted_and_open_review(env, reviewed):
    page = listed(env.leader)
    assert (page["total"], page["limit"], page["offset"]) == (4, 50, 0)
    # Newest submitted first; the open review comes last.
    query, unchanged, corrected, opened = page["reviews"]
    assert [row["decision"] for row in page["reviews"]] == [
        "query",
        "accepted_unchanged",
        "accepted_corrected",
        "open",
    ]
    assert corrected == {
        "review_id": reviewed.corrected["id"],
        "assignment_id": reviewed.corrected["assignment_id"],
        "document_id": "t-de",
        "case_id": "case-1",
        "language": "de",
        "version": 1,
        "reviewer": corrected["reviewer"],
        "decision": "accepted_corrected",
        "clinical_change": False,
        "categories": [],
        "rationale": None,
        "changed_passages": 2,
        "created_variant_id": reviewed.corrected["created_variant_id"],
        "submitted_at": corrected["submitted_at"],
        "assigned_at": corrected["assigned_at"],
    }
    assert corrected["created_variant_id"]
    assert corrected["assigned_at"] <= corrected["submitted_at"]
    # The rationale of an accepting review is in the list.
    assert unchanged["rationale"] == "The dose looks low, but the source says so."
    assert (unchanged["changed_passages"], unchanged["created_variant_id"]) == (0, None)
    assert (query["clinical_change"], query["categories"]) == (True, ["source"])
    assert (query["rationale"], query["changed_passages"]) == ("Is 5 mg right?", 0)
    assert opened == {
        "review_id": None,
        "assignment_id": reviewed.open_id,
        "document_id": "t-it",
        "case_id": "case-1",
        "language": "it",
        "version": 1,
        "reviewer": opened["reviewer"],
        "decision": "open",
        "clinical_change": None,
        "categories": [],
        "rationale": None,
        "changed_passages": None,
        "created_variant_id": None,
        "submitted_at": None,
        "assigned_at": opened["assigned_at"],
    }
    assert opened["assigned_at"] is not None
    # The lead reads names; the choices of the filters come with every page.
    assert [person["display_name"] for person in page["reviewers"]] == ["alice", "bob"]
    assert corrected["reviewer"] == page["reviewers"][0]
    assert opened["reviewer"] == page["reviewers"][1]
    assert page["languages"] == ["de", "es", "fr", "it"]


def test_filters_by_person_decision_and_language(env, reviewed):
    page = listed(env.leader)
    alice, bob = (person["pseudonym"] for person in page["reviewers"])

    def decisions(**params):
        found = listed(env.leader, **params)
        assert found["total"] == len(found["reviews"])
        # The choices do not shrink with the filter.
        assert found["reviewers"] == page["reviewers"]
        assert found["languages"] == page["languages"]
        return [row["decision"] for row in found["reviews"]]

    assert decisions(reviewer=alice) == ["accepted_unchanged", "accepted_corrected"]
    assert decisions(reviewer=bob) == ["query", "open"]
    assert decisions(reviewer="nobody") == []
    assert decisions(decision="open") == ["open"]
    assert decisions(decision=["query", "accepted_unchanged"]) == [
        "query",
        "accepted_unchanged",
    ]
    assert decisions(decision="rejected") == []
    assert decisions(language="fr") == ["accepted_unchanged"]
    assert decisions(language=["de", "it"]) == ["accepted_corrected", "open"]
    assert decisions(reviewer=bob, decision="query", language="es") == ["query"]
    assert decisions(reviewer=alice, decision="query") == []
    assert env.leader.get(URL, params={"decision": "other"}).status_code == 422


def test_sorts_by_date_and_pages_on_the_server(env, reviewed):
    newest = [row["assignment_id"] for row in listed(env.leader)["reviews"]]
    oldest = listed(env.leader, sort="submitted")["reviews"]
    # Oldest first turns the submitted reviews; the open one stays last.
    assert [row["assignment_id"] for row in oldest] == [
        *reversed(newest[:3]),
        newest[3],
    ]
    first = listed(env.leader, limit=3)
    second = listed(env.leader, limit=3, offset=3)
    assert (first["total"], second["total"]) == (4, 4)
    assert (second["limit"], second["offset"]) == (3, 3)
    assert [
        row["assignment_id"] for row in first["reviews"] + second["reviews"]
    ] == newest
    assert listed(env.leader, offset=4)["reviews"] == []
    paged = listed(env.leader, decision=["query", "open"], limit=1, offset=1)
    assert paged["total"] == 2
    assert [row["decision"] for row in paged["reviews"]] == ["open"]
    for params in ({"limit": 0}, {"limit": 201}, {"offset": -1}, {"sort": "case"}):
        assert env.leader.get(URL, params=params).status_code == 422


def test_a_reopened_review_is_listed_as_submitted_and_as_open(env, reviewed):
    assignment = reviewed.unchanged["assignment_id"]
    reopened = env.leader.post(
        f"/api/v1/assignments/{assignment}/reopen",
        json={"reason": "Please look again"},
    )
    assert reopened.status_code == 200, reopened.text
    rows = [
        (row["decision"], row["review_id"])
        for row in listed(env.leader, language="fr")["reviews"]
    ]
    assert rows == [("accepted_unchanged", reviewed.unchanged["id"]), ("open", None)]


def test_a_removed_open_review_leaves_the_list(env, reviewed):
    removed = env.leader.post(
        f"/api/v1/assignments/{reviewed.open_id}/revoke",
        json={"reason": "Not needed any more"},
    )
    assert removed.status_code == 200, removed.text
    assert listed(env.leader, decision="open")["reviews"] == []


def test_only_leads_and_system_admins_read_the_list(env, reviewed):
    assert listed(env.admin)["total"] == 4
    # A reviewer does not read it, also not their own reviews.
    for client in (env.alice, env.bob, env.carol):
        refused = client.get(URL)
        assert refused.status_code == 403, refused.text
        assert "rationale" not in refused.text
    assert (
        env.leader.get("/api/v1/projects/other/translation-review-list").status_code
        == 404
    )


def test_an_empty_project_has_an_empty_list(env):
    assert listed(env.leader) == {
        "reviews": [],
        "total": 0,
        "limit": 50,
        "offset": 0,
        "reviewers": [],
        "languages": [],
    }


@pytest.mark.parametrize(
    ("before", "after", "count"),
    [
        ("One two three.", "One two three.", 0),
        # Spaces and line breaks only: no passage.
        ("One two three.", "One  two\nthree.", 0),
        ("One two three.", "One 2 three.", 1),
        ("One two three four five.", "Zero one two three for five. Six.", 3),
        ("One two three.", "One two three. Four five.", 1),
        ("One two three.", "One three.", 1),
        ("", "One two.", 1),
        ("One two.", "", 1),
        ("", "", 0),
    ],
)
def test_changed_passages_are_counted_by_words(before, after, count):
    assert changed_passages(before, after) == count


def test_texts_that_differ_too_much_are_not_counted(monkeypatch):
    monkeypatch.setattr("ontotator.domain.text_changes.MAX_WORD_PAIRS", 8)
    assert changed_passages("a b c", "d e f") is None
    assert changed_passages("a b c x", "a d e x") == 1
