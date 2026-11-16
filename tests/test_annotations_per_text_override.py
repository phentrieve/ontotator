"""A text's own "Annotations per text" (issue 422).

``PUT /projects/{key}/texts/{case}/{language}/annotations-per-text`` stores
a nullable override per text (case + language). It replaces the project
value for that text as target and as limit: single and batch assignment,
the Documents row (cells, next steps) and the lowering preview read it.
"""

from __future__ import annotations

from typing import Any

from proposal_check_support import BASE, assign, client, proposal_env, refused_code
from sqlalchemy import select

from ontotator.storage.tables import AuditEventRow


def _put(
    env: Any, value: int | None, *, case: str = "c1", by: Any = None, **extra: Any
) -> Any:
    return (by or env.lead).put(
        f"{BASE}/texts/{case}/en/annotations-per-text",
        json={"value": value, **extra},
    )


def _row(env: Any, case: str) -> dict[str, Any]:
    rows = env.lead.get(f"{BASE}/document-rows", params={"case": case}).json()
    (row,) = [r for g in rows["groups"] for r in g["rows"] if r["case_id"] == case]
    return row


def _preview(env: Any, case_ids: list[str]) -> dict[str, Any]:
    response = env.lead.post(
        f"{BASE}/assignments/batch/preview",
        json={
            "task": "annotate",
            "language": "en",
            "case_ids": case_ids,
            "mode": "each",
            "usernames": [],
        },
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _audits(env: Any) -> list[dict[str, Any]]:
    with env.db.snapshot() as conn:
        return [
            row.details
            for row in conn.execute(
                select(AuditEventRow.details)
                .where(AuditEventRow.action == "text.annotations_per_text")
                .order_by(AuditEventRow.id)
            )
        ]


def test_the_override_is_target_and_limit_of_that_text_only(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    response = _put(env, 3, reason="method comparison")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "case_id": "c1",
        "language": "en",
        "override": 3,
        "project_value": 1,
        "effective": 3,
        "changed": True,
    }
    for name in ("anno", "anno2", "tom"):
        assign(env, env.c1, name)
    # The fourth is refused with the text's own limit.
    from auth_harness import grant
    from work_plan_support import _user

    _user(env.app, "lisa", "Lisa Meyer")
    assert grant(env.app, "lisa", "proj", ["annotator"])
    assert refused_code(env, env.c1, "lisa") == "ANNOTATIONS_PER_TEXT_REACHED"
    # c2 keeps the project value.
    assign(env, env.c2, "anno")
    assert refused_code(env, env.c2, "anno2") == "ANNOTATIONS_PER_TEXT_REACHED"


def test_rows_cells_and_steps_read_the_effective_value(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    assert _put(env, 3).status_code == 200
    assign(env, env.c1, "anno")
    row = _row(env, "c1")
    assert row["annotations_per_text"] == {"effective": 3, "project": 1, "override": 3}
    assert row["stages"]["annotation"]["detail"]["target"] == 3
    assert row["stages"]["annotation"]["detail"]["assigned"] == 1
    # Room for two more: the text still asks for annotators.
    assert "assign_annotation" in [step["code"] for step in row["steps"]]
    other = _row(env, "c2")
    assert other["annotations_per_text"] == {
        "effective": 1,
        "project": 1,
        "override": None,
    }


def test_the_batch_preview_names_each_texts_limit(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    assert _put(env, 2).status_code == 200
    both = _preview(env, ["c1", "c2"])
    assert {t["case_id"]: (t["per_text"], t["remaining"]) for t in both["targets"]} == {
        "c1": (2, 2),
        "c2": (1, 1),
    }
    # Mixed limits: the batch names the project value; one text: its own.
    assert (both["per_text"], both["project_per_text"]) == (1, 1)
    one = _preview(env, ["c1"])
    assert (one["per_text"], one["project_per_text"]) == (2, 1)


def test_setting_is_idempotent_audited_and_clearable(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    assert _put(env, 4, reason="  method comparison ").json()["changed"] is True
    assert _put(env, 4).json()["changed"] is False
    cleared = _put(env, None)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["override"] is None and cleared.json()["effective"] == 1
    assert _audits(env) == [
        {
            "case_id": "c1",
            "language": "en",
            "old": None,
            "new": 4,
            "project_value": 1,
            "reason": "method comparison",
        },
        {
            "case_id": "c1",
            "language": "en",
            "old": 4,
            "new": None,
            "project_value": 1,
        },
    ]


def test_lowering_the_override_keeps_the_assignments(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    assert _put(env, 2).status_code == 200
    assign(env, env.c1, "anno")
    assign(env, env.c1, "anno2")
    assert _put(env, None).status_code == 200
    row = _row(env, "c1")
    assert len([w for w in row["work"] if w["task"] == "annotate"]) == 2
    assert refused_code(env, env.c1, "tom") == "ANNOTATIONS_PER_TEXT_REACHED"


def test_the_project_lowering_preview_skips_texts_with_their_own_value(tmp_path):
    env = proposal_env(tmp_path, per_text=2)
    assign(env, env.c1, "anno")
    assign(env, env.c1, "anno2")

    def over() -> int:
        response = env.lead.get(
            f"{BASE}/work-plans/annotation-target-preview",
            params={"annotations_per_text": 1},
        )
        assert response.status_code == 200, response.text
        return int(response.json()["rows_over_target"])

    assert over() == 1
    assert _put(env, 2).status_code == 200
    assert over() == 0


def test_refusals(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    unknown = _put(env, 2, case="nope")
    assert unknown.status_code == 404 and unknown.json()["code"] == "DOCUMENT_NOT_FOUND"
    assert _put(env, 21).status_code == 422  # issue 447: 1 to 20
    assert _put(env, 0).status_code == 422
    assert (
        env.lead.put(
            f"{BASE}/texts/c1/en/annotations-per-text", json={"reason": "x"}
        ).status_code
        == 422
    )
    annotator = _put(env, 2, by=client(env, "anno"))
    assert annotator.status_code in (403, 404), annotator.text
    assert _audits(env) == []


def _put_many(env: Any, cases: list[str], value: int | None, **extra: Any) -> Any:
    return env.lead.put(
        f"{BASE}/texts/annotations-per-text",
        json={
            "texts": [{"case_id": case, "language": "en"} for case in cases],
            "value": value,
            **extra,
        },
    )


def test_several_texts_change_together_each_compared_with_its_own_value(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    assert _put(env, 3).status_code == 200
    response = _put_many(env, ["c1", "c2"], 3, reason="pilot")
    assert response.status_code == 200, response.text
    assert [(t["case_id"], t["changed"]) for t in response.json()["texts"]] == [
        ("c1", False),
        ("c2", True),
    ]
    # Clearing a mixed selection: only the text with a value changes.
    assert _put(env, None, case="c2").status_code == 200
    cleared = _put_many(env, ["c1", "c2"], None)
    assert [(t["case_id"], t["changed"]) for t in cleared.json()["texts"]] == [
        ("c1", True),
        ("c2", False),
    ]
    changes = [(a["case_id"], a["old"], a["new"]) for a in _audits(env)]
    assert changes == [
        ("c1", None, 3),
        ("c2", None, 3),
        ("c2", 3, None),
        ("c1", 3, None),
    ]


def test_one_unknown_text_refuses_the_whole_request(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    response = _put_many(env, ["c1", "nope"], 3)
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "DOCUMENT_NOT_FOUND"
    assert response.json()["details"]["texts"] == [
        {"case_id": "nope", "language": "en"}
    ]
    assert _audits(env) == []
    assert _row(env, "c1")["annotations_per_text"]["override"] is None
    assert _put_many(env, [], 3).status_code == 422


def test_a_full_text_names_its_annotators_in_the_preview(tmp_path):
    """The limit popover warns when a lower limit is below them."""
    env = proposal_env(tmp_path, per_text=1)
    assert _put(env, 2).status_code == 200
    assign(env, env.c1, "anno")
    assign(env, env.c1, "anno2")
    (skip,) = _preview(env, ["c1"])["skipped"]
    assert (skip["reason"], skip["assigned"], skip["per_text"]) == (
        "already_assigned",
        2,
        2,
    )
