"""A non-member cannot tell a project that exists from one that does not (E3).

Issue 398: some project routes looked a missing project up first and
answered ``PACKAGE_NOT_FOUND``, or checked a document before the project,
and so answered a foreign project differently from a missing one.
"""

import re
from urllib.parse import quote

from auth_harness import ORIGIN, logged_in
from fastapi.testclient import TestClient
from test_case_api import TARGET
from test_translation_review_task import case_env as case_env

KEY = re.compile(r"\{(key|project_key)\}")
DOC = quote(TARGET, safe="")
SCOPES = ["read", "import", "export", "project-admin"]


def _path(template: str, key: str) -> str:
    path = KEY.sub(key, template)
    path = re.sub(r"\{(doc|document_id)(:path)?\}", DOC, path)
    path = re.sub(r"\{[a-z_]*id(:path)?\}", "1", path)
    return re.sub(r"\{[a-z_]+(:path)?\}", "x", path)


def _answer(client: TestClient, template: str, key: str) -> tuple[int, str]:
    response = client.get(_path(template, key))
    return response.status_code, response.text.replace(f"'{key}'", "'KEY'")


def test_the_translation_reviews_of_a_text_hide_a_foreign_project(case_env):
    outsider = logged_in(case_env.app, "outsider", projects={}, assignments=[])
    for key in ("proj", "nope"):
        response = outsider.get(
            f"/api/v1/projects/{key}/documents/{DOC}/translation-reviews"
        )
        assert response.status_code == 404, response.text
        assert response.json() == {
            "code": "PROJECT_NOT_FOUND",
            "details": f"There is no project '{key}'.",
        }
    # Members and system admins still read them; an unknown key is the same
    # refusal for them.
    for client in (case_env.lead, case_env.admin):
        url = f"/api/v1/projects/proj/documents/{DOC}/translation-reviews"
        assert client.get(url).status_code == 200
        missing = client.get(url.replace("/proj/", "/nope/"))
        assert missing.json()["code"] == "PROJECT_NOT_FOUND"


def test_no_project_route_tells_a_foreign_project_from_a_missing_one(case_env):
    app = case_env.app
    outsider = logged_in(app, "outsider", projects={}, assignments=[])
    created = outsider.post("/api/v1/me/tokens", json={"name": "p", "scopes": SCOPES})
    assert created.status_code == 201, created.text
    token = TestClient(
        app,
        headers={"Authorization": f"Bearer {created.json()['secret']}", **ORIGIN},
    )
    routes = [
        path
        for path, operations in app.openapi()["paths"].items()
        if KEY.search(path) and "get" in operations
    ]
    assert len(routes) > 30
    for client in (outsider, token):
        differing = [
            (route, existing, missing)
            for route in routes
            if (existing := _answer(client, route, "proj"))
            != (missing := _answer(client, route, "nope"))
        ]
        assert differing == []
