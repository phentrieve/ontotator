"""Project setting ``term_link_templates``: where an ontology's term codes link to."""

from __future__ import annotations

import pytest
from sqlalchemy import update
from test_progress_export_api import BASE, project  # noqa: F401
from test_search_within import api  # noqa: F401

from ontotator.storage.tables import ProjectRow

ICD = "https://www.icd10data.com/search?s={code}"
TEMPLATE = "https://example.org/hpo/{code}?full={id}"


def _ontology_id(lead) -> str:  # type: ignore[no-untyped-def]
    settings = lead.get(f"{BASE}/settings").json()
    return settings["profile"]["ontologies"][0]["ontology_id"]


def test_none_by_default(project):  # type: ignore[no-untyped-def]  # noqa: F811
    _, lead, _, _ = project
    assert lead.get(f"{BASE}/settings").json()["term_link_templates"] == {}


def test_a_lead_sets_and_clears_a_template(project):  # type: ignore[no-untyped-def]  # noqa: F811
    _, lead, _, _ = project
    ontology = _ontology_id(lead)
    response = lead.patch(
        f"{BASE}/settings", json={"term_link_templates": {ontology: f"  {ICD} "}}
    )
    assert response.status_code == 200, response.text
    assert response.json()["term_link_templates"] == {ontology: ICD}
    assert lead.get(f"{BASE}/settings").json()["term_link_templates"] == {ontology: ICD}

    # An emptied field removes it: the default link is back.
    response = lead.patch(
        f"{BASE}/settings", json={"term_link_templates": {ontology: ""}}
    )
    assert response.status_code == 200, response.text
    assert response.json()["term_link_templates"] == {}


@pytest.mark.parametrize(
    "template",
    [
        "http://www.icd10data.com/search?s={code}",
        "javascript:alert({code})",
        "https://www.icd10data.com/search",
        "https://{code}.example.org/",
        "https://example.org/{label}",
    ],
)
def test_an_unusable_template_is_refused(project, template: str):  # type: ignore[no-untyped-def]  # noqa: F811
    _, lead, _, _ = project
    ontology = _ontology_id(lead)
    response = lead.patch(
        f"{BASE}/settings", json={"term_link_templates": {ontology: template}}
    )
    assert response.status_code in (400, 422), response.text
    assert "SETTINGS_INVALID" in response.text
    assert lead.get(f"{BASE}/settings").json()["term_link_templates"] == {}


def test_only_the_projects_ontologies(project):  # type: ignore[no-untyped-def]  # noqa: F811
    _, lead, _, _ = project
    response = lead.patch(
        f"{BASE}/settings", json={"term_link_templates": {"not-here": ICD}}
    )
    assert response.status_code in (400, 422), response.text
    assert "term_link_templates.not-here" in response.text


def test_an_annotator_cannot_set_one(project):  # type: ignore[no-untyped-def]  # noqa: F811
    _, lead, worker, _ = project
    ontology = _ontology_id(lead)
    response = worker.patch(
        f"{BASE}/settings", json={"term_link_templates": {ontology: ICD}}
    )
    assert response.status_code in (403, 404)


def _open_tree(session, key):  # type: ignore[no-untyped-def]
    return session.post(
        "/api/v1/terms/tree/open",
        {
            "workspace_key": key,
            "annotation_id": "seizure",
            "layer_id": "hpo",
            "term_id": "HP:0001250",
        },
    )


def _urls(opened) -> dict[str, str | None]:  # type: ignore[no-untyped-def]
    nodes = [node for level in opened["levels"] for node in level["children"]]
    nodes += opened["roots"] + opened["detail"]["parents"] + [opened["detail"]]
    return {node["term_id"]: node["external_url"] for node in nodes}


def test_the_tree_links_through_the_template(api):  # type: ignore[no-untyped-def]  # noqa: F811
    app, session, project_key, key = api
    before = _urls(_open_tree(session, key))
    assert before["HP:0001250"] == "https://hpo.jax.org/browse/term/HP:0001250"

    with app.state.repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == project_key)
            .values(term_link_templates={"hp": TEMPLATE})
        )
    opened = _open_tree(session, key)
    after = _urls(opened)
    assert after["HP:0001250"] == ("https://example.org/hpo/0001250?full=HP:0001250")
    assert all(
        url == f"https://example.org/hpo/{term.split(':')[1]}?full={term}"
        for term, url in after.items()
    )
    # A node opened later in the walk links the same way.
    node = session.post(
        "/api/v1/terms/tree/node",
        {
            "workspace_key": key,
            "annotation_id": "seizure",
            "layer_id": "hpo",
            "browse_id": opened["browse_id"],
            "term_id": opened["roots"][0]["term_id"],
            "expand": True,
        },
    )
    assert node["detail"]["external_url"].startswith("https://example.org/hpo/")
    assert all(
        child["external_url"].startswith("https://example.org/hpo/")
        for child in node["children"]
    )
