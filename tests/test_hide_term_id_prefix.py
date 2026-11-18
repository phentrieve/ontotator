"""Project setting ``hide_term_id_prefix``: display only, off by default."""

from __future__ import annotations

from test_progress_export_api import BASE, _assignment, project  # noqa: F401
from test_t1_export import DOC


def _view(app, worker, pid):
    task = _assignment(app, pid, DOC, "worker")
    response = worker.post(f"/api/v1/assignments/{task}/open")
    assert response.status_code == 200, response.text
    return response.json()["view"]


def test_off_by_default_and_the_editor_view_says_so(project):  # noqa: F811
    app, lead, worker, pid = project
    assert lead.get(f"{BASE}/settings").json()["hide_term_id_prefix"] is False
    assert _view(app, worker, pid)["hide_term_id_prefix"] is False


def test_the_lead_switches_it_on_and_the_editor_view_follows(project):  # noqa: F811
    app, lead, worker, pid = project
    response = lead.patch(f"{BASE}/settings", json={"hide_term_id_prefix": True})
    assert response.status_code == 200, response.text
    assert response.json()["hide_term_id_prefix"] is True
    assert lead.get(f"{BASE}/settings").json()["hide_term_id_prefix"] is True
    assert _view(app, worker, pid)["hide_term_id_prefix"] is True


def test_an_annotator_cannot_switch_it(project):  # noqa: F811
    _, _, worker, _ = project
    response = worker.patch(f"{BASE}/settings", json={"hide_term_id_prefix": True})
    assert response.status_code in (403, 404)
