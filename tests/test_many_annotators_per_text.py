"""Many annotators on one text (issues 447 and 457).

"Annotations per text" has no built-in maximum (it was 5, then 20), as the
project setting and as a text's own value; a server may set one
(``ONTOTATOR_MAX_ANNOTATIONS_PER_TEXT``), and a value above it is refused
with the maximum named. One text takes 6, 20 and 30 annotators; the next one
is refused. What reads every annotator of a text holds at 20 and at 30: the
Documents row and the final panel's agreement, the consolidation round (one
person per source, lanes 1 to 4, letters past E while names are hidden), the
project agreement (every pair of two people: 190 for 20, 435 for 30) and the
final export's agreement.csv.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import event, select, update
from test_final_panel_api import (
    HYPOTONIA,
    SEIZURE,
    final_cell,
    finding,
    panel,
    span_of,
    submit_findings,
)
from test_final_tables import final_archive, rows
from work_plan_support import BASE, _user, doc, plan_env, select_final

from ontotator.application.consolidation_blinding import letters
from ontotator.domain.annotation_limits import (
    ANNOTATIONS_PER_TEXT_CEILING,
    consolidation_source_limit,
)
from ontotator.storage.tables import ProjectRow

# The built-in maximum until issue 457; BEYOND is past it.
LIMIT = 20
BEYOND = 30
CAP_ENV = "ONTOTATOR_MAX_ANNOTATIONS_PER_TEXT"
SETTINGS = f"{BASE}/settings"


def _people(env: Any, count: int) -> list[str]:
    from auth_harness import grant

    names = [f"many{number:02d}" for number in range(1, count + 1)]
    for name in names:
        _user(env.app, name, f"Person {name[4:]}")
        assert grant(env.app, name, "proj", ["annotator"])
    return names


def _set(env: Any, value: int) -> Any:
    return env.lead.patch(SETTINGS, json={"annotations_per_text": value})


def _assign(env: Any, document_id: str, username: str) -> dict[str, Any]:
    """One annotate row through the route (no harness: the real limit)."""
    response = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [{"document_id": document_id, "username": username}],
            "task": "annotate",
            "confirm_language": True,
        },
    )
    assert response.status_code == 200, response.text
    return dict(response.json())


def _row(env: Any, case: str = "c1") -> dict[str, Any]:
    page = env.lead.get(f"{BASE}/document-rows", params={"case": case}).json()
    (row,) = [
        r
        for g in page["groups"]
        for r in g["rows"]
        if r["case_id"] == case and r["language"] == "en"
    ]
    return dict(row)


def _full_text(env: Any, count: int) -> tuple[str, list[str], list[str]]:
    """c1-en with ``count`` assigned annotators; (document, names, task ids)."""
    assert _set(env, count).status_code == 200
    names = _people(env, count + 1)
    target = doc("c1", "en")
    tasks = []
    for name in names[:count]:
        body = _assign(env, target, name)
        assert body["refused"] == [], body
        tasks.append(body["created"][0]["id"])
        if len(tasks) == count - 1:  # "n of m annotators assigned"
            detail = _row(env)["stages"]["annotation"]["detail"]
            assert (detail["assigned"], detail["target"]) == (count - 1, count)
    return target, names, tasks


def _submit_all(env: Any, target: str, tasks: list[str]) -> list[str]:
    """Everyone marks the seizure; every third person as absent, and every
    fourth adds a finding the others do not have."""
    period, heavy = (
        span_of(env, target, "Neonatalzeit"),
        span_of(env, target, "schwere"),
    )
    sids = []
    for index, task in enumerate(tasks):
        sid = f"sub-many-{index:02d}"
        items = [
            finding(
                f"m{index}-1",
                SEIZURE,
                period,
                assertion="absent" if index % 3 == 2 else "present",
            )
        ]
        if index % 4 == 3:
            items.append(finding(f"m{index}-2", HYPOTONIA, heavy))
        submit_findings(env, int(task), sid, items)
        sids.append(sid)
    return sids


def _statements(env: Any, call: Any) -> int:
    seen = 0

    def count(*_: Any) -> None:  # the route runs in the test client's thread
        nonlocal seen
        seen += 1

    event.listen(env.db.engine, "before_cursor_execute", count)
    try:
        call()
    finally:
        event.remove(env.db.engine, "before_cursor_execute", count)
    return seen


def _above(response: Any, maximum: int, value: int) -> None:
    assert response.status_code == 422, response.text
    assert response.json() == {
        "code": "ANNOTATIONS_PER_TEXT_ABOVE_MAXIMUM",
        "details": {"maximum": maximum, "value": value, "setting": CAP_ENV},
    }


def test_the_setting_has_no_built_in_maximum(tmp_path):
    env = plan_env(tmp_path)
    assert env.lead.get(SETTINGS).json()["annotations_per_text_max"] is None
    for value in (6, LIMIT, LIMIT + 1, BEYOND, 5000):
        response = _set(env, value)
        assert response.status_code == 200, response.text
        assert response.json()["annotations_per_text"] == value
    # The minimum stays; beyond the column's type is no value.
    for value in (0, ANNOTATIONS_PER_TEXT_CEILING + 1):
        assert _set(env, value).status_code == 422
    assert env.lead.get(SETTINGS).json()["annotations_per_text"] == 5000
    preview = f"{BASE}/work-plans/annotation-target-preview"
    assert env.lead.get(preview, params={"annotations_per_text": BEYOND}).is_success
    assert env.lead.get(preview, params={"annotations_per_text": 0}).status_code == 422


def test_a_texts_own_value_has_no_built_in_maximum(tmp_path):
    env = plan_env(tmp_path)
    one = f"{BASE}/texts/c1/en/annotations-per-text"
    several = f"{BASE}/texts/annotations-per-text"
    texts = [{"case_id": "c2", "language": "en"}]
    for value in (6, LIMIT, LIMIT + 1, BEYOND):
        assert env.lead.put(one, json={"value": value}).json()["effective"] == value
        body = env.lead.put(several, json={"texts": texts, "value": value}).json()
        assert [t["effective"] for t in body["texts"]] == [value]
    assert env.lead.put(one, json={"value": 0}).status_code == 422
    over = env.lead.put(
        several, json={"texts": texts, "value": ANNOTATIONS_PER_TEXT_CEILING + 1}
    )
    assert over.status_code == 422
    row = _row(env)
    assert row["annotations_per_text"]["override"] == BEYOND
    assert row["stages"]["annotation"]["detail"]["target"] == BEYOND


def test_the_server_maximum_refuses_a_larger_setting_and_names_itself(
    tmp_path, monkeypatch
):
    env = plan_env(tmp_path)
    assert _set(env, 12).status_code == 200  # stored before the maximum is set
    monkeypatch.setenv(CAP_ENV, "8")
    settings = env.lead.get(SETTINGS).json()
    assert settings["annotations_per_text_max"] == 8
    assert settings["annotations_per_text"] == 12
    # A larger value is refused and names the maximum; nothing is written.
    _above(_set(env, 9), 8, 9)
    _above(_set(env, 13), 8, 13)
    assert env.lead.get(SETTINGS).json()["annotations_per_text"] == 12
    # The stored value sent again (the settings form sends every field) is
    # no change, so other settings can still be saved.
    kept = env.lead.patch(
        SETTINGS, json={"annotations_per_text": 12, "import_plan": "nothing"}
    )
    assert kept.status_code == 200, kept.text
    assert kept.json()["annotations_per_text"] == 12
    assert kept.json()["import_plan"] == "nothing"
    # At the maximum and below it is fine; from there 12 is refused too.
    for value in (8, 3):
        assert _set(env, value).status_code == 200
    _above(_set(env, 12), 8, 12)
    # Unset again: no limit.
    monkeypatch.delenv(CAP_ENV)
    assert _set(env, BEYOND).status_code == 200


def test_the_server_maximum_refuses_a_larger_value_of_a_text(tmp_path, monkeypatch):
    env = plan_env(tmp_path)
    one = f"{BASE}/texts/c1/en/annotations-per-text"
    several = f"{BASE}/texts/annotations-per-text"
    texts = [
        {"case_id": "c1", "language": "en"},
        {"case_id": "c2", "language": "en"},
    ]
    assert env.lead.put(one, json={"value": 12}).status_code == 200
    monkeypatch.setenv(CAP_ENV, "8")
    _above(env.lead.put(one, json={"value": 9}), 8, 9)
    # Several texts: one refusal, and no text is changed.
    _above(env.lead.put(several, json={"texts": texts, "value": 9}), 8, 9)
    assert _row(env)["annotations_per_text"]["override"] == 12
    assert _row(env, "c2")["annotations_per_text"]["override"] is None
    # The same value again changes nothing and is not refused.
    assert env.lead.put(one, json={"value": 12}).json()["effective"] == 12
    # Up to the maximum, and back to the project value.
    body = env.lead.put(several, json={"texts": texts, "value": 8}).json()
    assert [t["effective"] for t in body["texts"]] == [8, 8]
    assert env.lead.put(one, json={"value": None}).status_code == 200
    # The assign dialog reads the maximum with its preview.
    body = {
        "task": "annotate",
        "language": "en",
        "case_ids": ["c1"],
        "mode": "each",
        "usernames": [],
    }
    preview = env.lead.post(f"{BASE}/assignments/batch/preview", json=body)
    assert preview.status_code == 200, preview.text
    assert preview.json()["max_per_text"] == 8
    monkeypatch.delenv(CAP_ENV)
    preview = env.lead.post(f"{BASE}/assignments/batch/preview", json=body)
    assert preview.json()["max_per_text"] is None


@pytest.mark.parametrize("count", [6, LIMIT, BEYOND])
def test_one_text_takes_as_many_annotators_as_the_limit(tmp_path, count):
    env = plan_env(tmp_path)
    target, names, tasks = _full_text(env, count)
    # Full: the cell counts the submissions of all of them.
    detail = _row(env)["stages"]["annotation"]["detail"]
    assert (detail["submitted"], detail["total"]) == (0, count)
    assert len(detail["people"]) == count
    # The next one is refused.
    body = _assign(env, target, names[count])
    assert body["created"] == []
    assert [r["code"] for r in body["refused"]] == ["ANNOTATIONS_PER_TEXT_REACHED"]

    sids = _submit_all(env, target, tasks)
    row = _row(env)
    assert len([w for w in row["work"] if w["task"] == "annotate"]) == count
    # The final cell and the panel compare all of them, in one comparison.
    assert final_cell(env)["detail"]["compared"] >= 1
    result = panel(env)
    assert len(result["submissions"]) == count
    assert result["agreement"]["total"] >= 1

    # A consolidation of all of them: one person per source, lanes 1 to 4.
    started = env.lead.post(
        f"{BASE}/consolidations",
        json={
            "document_id": target,
            "reviewer": "leader",
            "source_submission_ids": sids,
            "reason": None,
            "confirm_language": True,
            "request_id": f"start-{count}",
            "expected_workflow_revision": None,
        },
    )
    assert started.status_code == 200, started.text
    round_id = started.json()["round"]["round_id"]
    view = env.lead.get(f"/api/v1/rounds/{round_id}/consolidation")
    assert view.status_code == 200, view.text
    people = view.json()["people"]
    assert len(people) == count
    assert [p["lane"] for p in people] == [1, 2, 3] + [4] * (count - 3)
    seizure = max(view.json()["groups"], key=lambda g: len(g["members"]))
    assert len(seizure["members"]) == count


def _start(env: Any, target: str, reviewer: str, sources: list[str]) -> Any:
    return env.lead.post(
        f"{BASE}/consolidations",
        json={
            "document_id": target,
            "reviewer": reviewer,
            "source_submission_ids": sources,
            "reason": None,
            "confirm_language": True,
            "request_id": f"start-{reviewer}-{len(sources)}",
            "expected_workflow_revision": None,
        },
    )


def test_the_source_limit_follows_the_texts_annotations_per_text():
    """Twice the annotators of the text, and never below 40 (the fixed bound
    before issue 457)."""
    assert [consolidation_source_limit(n) for n in (1, 5, 20, 21, 30, 500)] == [
        40,
        40,
        40,
        42,
        60,
        1000,
    ]


def test_a_consolidation_takes_21_sources_and_refuses_41(tmp_path):
    """A text with 20 annotators and a submitted consolidation has 21
    eligible submissions; one consolidation merges all of them. The bound is
    twice the text's annotations per text: 40 here, 60 once the text takes
    30 annotators."""
    from test_consolidation_submit_gating import submit_acknowledged

    from ontotator.storage.tables import DraftRow

    env = plan_env(tmp_path)
    target, _names, tasks = _full_text(env, LIMIT)
    sids = _submit_all(env, target, tasks)
    # The 21st: the lead consolidates the first two, who agree, and submits.
    first = _start(env, target, "leader", sids[:2])
    assert first.status_code == 200, first.text
    round_id = first.json()["round"]["round_id"]
    view = env.lead.get(f"/api/v1/rounds/{round_id}/consolidation").json()
    assert {kind for g in view["groups"] for kind in g["kinds"]} == {"match"}
    with env.db.transaction() as conn:
        revision = conn.execute(
            select(DraftRow.revision).where(
                DraftRow.project_id == env.pid,
                DraftRow.draft_key.contains(round_id),
            )
        ).scalar_one()
    submitted = submit_acknowledged(env.lead, view["workspace_id"], int(revision))
    assert submitted.status_code == 200, submitted.text
    eligible = [s["submission_id"] for s in panel(env)["submissions"] if s["eligible"]]
    assert len(eligible) == LIMIT + 1
    assert set(sids) < set(eligible)

    started = _start(env, target, "adj", eligible)
    assert started.status_code == 200, started.text
    second = started.json()["round"]["round_id"]
    from auth_harness import logged_in

    consolidator = logged_in(env.app, "adj", assignments=[])
    shown = consolidator.get(f"/api/v1/rounds/{second}/consolidation")
    assert shown.status_code == 200, shown.text
    assert len(shown.json()["people"]) == LIMIT + 1

    # 41 sources are refused, whatever they name: the refusal says how many
    # one consolidation of this text merges.
    too_many = "Too many source submissions"
    over = [f"sub-{number}" for number in range(61)]
    refused = _start(env, target, "adj", over[:41])
    assert refused.status_code == 422, refused.text
    assert refused.json() == {
        "code": "ROUND_INPUT_INVALID",
        "details": "Too many source submissions: 41. One"
        " consolidation of this text merges at most 40.",
    }
    # 40 pass the bound; the command then refuses what they name.
    at_bound = _start(env, target, "adj", over[:40])
    assert at_bound.status_code != 200
    assert too_many not in at_bound.text
    # The text takes 30 annotators: 60 sources pass the bound, 61 do not.
    put = env.lead.put(f"{BASE}/texts/c1/en/annotations-per-text", json={"value": 30})
    assert put.status_code == 200, put.text
    assert too_many not in _start(env, target, "adj", over[:60]).text
    assert "merges at most 60" in _start(env, target, "adj", over).text


def test_documents_reads_many_annotators_in_as_many_statements_as_2(tmp_path):
    """No query per annotator in the Documents page and the final panel."""
    counts = []
    for count in (2, LIMIT, BEYOND):
        env = plan_env(tmp_path / str(count))
        target, _names, tasks = _full_text(env, count)
        _submit_all(env, target, tasks)
        counts.append(
            (
                _statements(env, lambda env=env: _row(env)),
                _statements(env, lambda env=env: panel(env)),
            )
        )
    assert counts[0] == counts[1] == counts[2]


def test_hidden_names_have_a_letter_for_every_annotator():
    assert [letters(i) for i in (0, 4, 5, 19, 25, 26)] == [
        "A",
        "E",
        "F",
        "T",
        "Z",
        "AA",
    ]


@pytest.mark.parametrize("count", [LIMIT, BEYOND])
def test_agreement_counts_every_pair_of_many_annotators(tmp_path, count):
    env = plan_env(tmp_path)
    target, _names, tasks = _full_text(env, count)
    sids = _submit_all(env, target, tasks)
    with env.db.transaction() as conn:  # accept one directly, without a round
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(adjudicator_not_annotator=False)
        )
    select_final(env, target, sids[0])
    answer = env.lead.get(f"{BASE}/agreement")
    assert answer.status_code == 200, answer.text
    body = answer.json()
    pairs = count * (count - 1) // 2
    assert pairs == {LIMIT: 190, BEYOND: 435}[count]
    assert len(body["pairs"]) == len(body["annotator_pairs"]) == pairs
    assert body["summary"]["pooled"]["pairs"] == pairs
    assert body["summary"]["pooled"]["texts"] == 1
    (text,) = body["texts"]
    assert text["macro_mean"]["pairs"] == pairs
    # The export writes the same pairs, one line each.
    archive = final_archive(env, "many-annotators")
    assert len(rows(archive.read("agreement.csv"))) == pairs
