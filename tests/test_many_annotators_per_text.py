"""More than five annotators on one text (issue 447).

"Annotations per text" goes up to 20, as the project setting and as a text's
own value. One text takes 6 and 20 annotators; the next one is refused, as is
a setting of 21. What reads every annotator of a text holds at 20: the
Documents row and the final panel's agreement, the consolidation round (one
person per source, lanes 1 to 4, letters past E while names are hidden), the
project agreement (every pair of two people: 190 for 20) and the final
export's agreement.csv.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import event, update
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
from ontotator.domain.annotation_limits import MAX_ANNOTATIONS_PER_TEXT
from ontotator.storage.tables import ProjectRow

LIMIT = MAX_ANNOTATIONS_PER_TEXT
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


def test_the_setting_takes_20_and_refuses_21(tmp_path):
    env = plan_env(tmp_path)
    for value in (6, LIMIT):
        response = _set(env, value)
        assert response.status_code == 200, response.text
        assert response.json()["annotations_per_text"] == value
    for value in (0, LIMIT + 1):
        assert _set(env, value).status_code == 422
    assert env.lead.get(SETTINGS).json()["annotations_per_text"] == LIMIT
    preview = f"{BASE}/work-plans/annotation-target-preview"
    assert env.lead.get(preview, params={"annotations_per_text": LIMIT}).is_success
    refused = env.lead.get(preview, params={"annotations_per_text": LIMIT + 1})
    assert refused.status_code == 422


def test_a_texts_own_value_takes_20_and_refuses_21(tmp_path):
    env = plan_env(tmp_path)
    one = f"{BASE}/texts/c1/en/annotations-per-text"
    several = f"{BASE}/texts/annotations-per-text"
    texts = [{"case_id": "c2", "language": "en"}]
    for value in (6, LIMIT):
        assert env.lead.put(one, json={"value": value}).json()["effective"] == value
        body = env.lead.put(several, json={"texts": texts, "value": value}).json()
        assert [t["effective"] for t in body["texts"]] == [value]
    assert env.lead.put(one, json={"value": LIMIT + 1}).status_code == 422
    over = env.lead.put(several, json={"texts": texts, "value": LIMIT + 1})
    assert over.status_code == 422
    row = _row(env)
    assert row["annotations_per_text"]["override"] == LIMIT
    assert row["stages"]["annotation"]["detail"]["target"] == LIMIT


@pytest.mark.parametrize("count", [6, LIMIT])
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


def test_documents_reads_20_annotators_in_as_many_statements_as_2(tmp_path):
    """No query per annotator in the Documents page and the final panel."""
    counts = []
    for count in (2, LIMIT):
        env = plan_env(tmp_path / str(count))
        target, _names, tasks = _full_text(env, count)
        _submit_all(env, target, tasks)
        counts.append(
            (
                _statements(env, lambda env=env: _row(env)),
                _statements(env, lambda env=env: panel(env)),
            )
        )
    assert counts[0] == counts[1]


def test_hidden_names_have_a_letter_for_every_annotator():
    assert [letters(i) for i in (0, 4, 5, 19, 25, 26)] == [
        "A",
        "E",
        "F",
        "T",
        "Z",
        "AA",
    ]


def test_agreement_counts_every_pair_of_20_annotators(tmp_path):
    env = plan_env(tmp_path)
    target, _names, tasks = _full_text(env, LIMIT)
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
    pairs = LIMIT * (LIMIT - 1) // 2
    assert len(body["pairs"]) == len(body["annotator_pairs"]) == pairs == 190
    assert body["summary"]["pooled"]["pairs"] == pairs
    assert body["summary"]["pooled"]["texts"] == 1
    (text,) = body["texts"]
    assert text["macro_mean"]["pairs"] == pairs
    # The export writes the same pairs, one line each.
    archive = final_archive(env, "many-annotators")
    assert len(rows(archive.read("agreement.csv"))) == pairs
