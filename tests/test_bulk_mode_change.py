"""Bulk "Change mode…" on Documents (issue 336 step 4)."""

from __future__ import annotations

from typing import Any

from proposal_check_support import BASE, assign, client, proposal_env
from sqlalchemy import event, insert, select, update
from test_annotation_mode_changes import audit, submit
from work_plan_support import revision_of, select_final

from ontotator.storage.live_submissions import discarded_ids
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.tables import AssignmentRow, UserRow

BULK = f"{BASE}/annotation-mode-changes/bulk"
ROWS = [{"case_id": "c1", "language": "en"}, {"case_id": "c2", "language": "en"}]
REASON = "Proposals were from the wrong model"


def _post(env: Any, mode: str = "scratch", rows: Any = None, **body: Any) -> Any:
    return env.lead.post(BULK, json={"rows": rows or ROWS, "mode": mode, **body})


def _preview(env: Any, mode: str = "scratch", rows: Any = None) -> dict[str, Any]:
    response = _post(env, mode, rows, preview=True)
    assert response.status_code == 200, response.text
    return dict(response.json())


def _skips(found: dict[str, Any]) -> list[tuple[str, str]]:
    return [(item["case_id"], item["reason"]) for item in found["skipped"]]


def _from_proposals(env: Any, assignment_id: int) -> None:
    """Make the task one from proposals (c2 has none of its own)."""
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(annotation_mode="proposals")
        )


def _revoked(env: Any, assignment_id: int) -> bool:
    with env.db.transaction() as conn:
        return (
            conn.execute(
                select(AssignmentRow.revoked_at).where(
                    AssignmentRow.id == assignment_id
                )
            ).scalar_one()
            is not None
        )


def _two_texts(tmp_path: Any) -> Any:
    """c1 and c2 from proposals: anno submitted both, anno2 is annotating c1."""
    env = proposal_env(tmp_path)
    env.first = assign(env, env.c1, "anno")["id"]
    env.second = assign(env, env.c1, "anno2")["id"]
    submit(env, env.first, "sub-c1")
    env.third = assign(env, env.c2, "anno")["id"]
    _from_proposals(env, env.third)
    submit(env, env.third, "sub-c2")
    return env


def test_preview_names_the_people_and_every_reason_a_text_is_skipped(tmp_path):
    env = proposal_env(tmp_path)
    first = assign(env, env.c1, "anno")["id"]
    second = assign(env, env.c1, "anno2")["id"]
    submit(env, first, "sub-c1")

    # c1 is from proposals with work; nobody works on c2 yet.
    found = _preview(env)
    assert found["mode"] == "scratch" and found["applied"] is False
    assert (found["texts"], found["change_count"], found["skipped_count"]) == (2, 1, 1)
    [change] = found["changes"]
    assert (change["case_id"], change["from_mode"], change["to_mode"]) == (
        "c1",
        "proposals",
        "scratch",
    )
    assert [
        (s["submission_id"], s["author"]["display_name"]) for s in change["submissions"]
    ] == [("sub-c1", "Anne Notator")]
    assert [
        (a["assignment_id"], a["status"], a["person"]["display_name"])
        for a in change["assignments"]
    ] == [(first, "submitted", "Anne Notator"), (second, "open", "Arne Notator")]
    assert (found["submission_count"], found["assignment_count"]) == (1, 2)
    assert found["skipped"] == [
        {
            "case_id": "c2",
            "language": "en",
            "reason": "not_locked",
            "message": "No annotation work yet: set the mode with Plan….",
        }
    ]
    assert found["skipped_by_reason"] == {"not_locked": 1}
    assert _skips(_preview(env, "proposals")) == [
        ("c1", "unchanged"),
        ("c2", "not_locked"),
    ]

    # c2 gets work from scratch: it has no tool proposals to change to.
    assign(env, env.c2, "tom")
    assert _skips(_preview(env, "proposals")) == [
        ("c1", "unchanged"),
        ("c2", "no_proposals"),
    ]
    assert _skips(_preview(env, "scratch")) == [("c2", "unchanged")]

    # A final result on c1; c2's only version is discarded.
    select_final(env, env.c1, "sub-c1")
    with env.db.transaction() as conn:
        lead = conn.execute(
            select(UserRow.id).where(UserRow.username == "leader")
        ).scalar_one()
        conn.execute(
            insert(DiscardedVariantRow).values(
                project_id=env.pid, document_id=env.c2, reason="t", discarded_by=lead
            )
        )
    final = _preview(env, "scratch")
    assert final["changes"] == []
    assert [(s["case_id"], s["reason"], s["message"]) for s in final["skipped"]] == [
        ("c1", "final_result", "Final result chosen: use Withdraw final… first."),
        ("c2", "no_current_version", "No version of the text is in use."),
    ]
    # Unknown texts are not counted; nothing was written by any preview.
    unknown = _preview(env, rows=[{"case_id": "nope", "language": "en"}])
    assert (unknown["texts"], unknown["change_count"]) == (0, 0)
    assert audit(env, "annotation_mode.change") == []


def test_apply_changes_every_listed_text_or_none_and_audits_each(tmp_path):
    env = _two_texts(tmp_path)
    found = _preview(env)
    assert [c["case_id"] for c in found["changes"]] == ["c1", "c2"]
    token = found["preview_token"]

    # A reason is required; the token of another mode does not apply.
    assert (
        _post(env, preview_token=token).json()["code"] == "MODE_CHANGE_REASON_REQUIRED"
    )
    assert _post(env, preview_token=token, reason="  ").json()["code"] == (
        "MODE_CHANGE_REASON_REQUIRED"
    )
    other = _post(env, "proposals", preview_token=token, reason=REASON)
    assert other.status_code == 409 and other.json()["code"] == "PREVIEW_STALE"

    # anno2 submits meanwhile: the preview is stale, nothing is changed.
    submit(env, env.second, "sub-c1-b")
    stale = _post(env, preview_token=token, reason=REASON)
    assert stale.status_code == 409 and stale.json()["code"] == "PREVIEW_STALE"
    fresh = stale.json()["details"]["preview"]
    assert fresh["applied"] is False and fresh["submission_count"] == 3
    assert audit(env, "annotation_mode.change") == []
    assert not _revoked(env, env.first)
    with env.db.transaction() as conn:
        assert discarded_ids(conn, env.pid, ["sub-c1", "sub-c1-b", "sub-c2"]) == set()

    # ``summary_only`` is for previews: applying changes the texts all the same.
    done = _post(
        env, preview_token=fresh["preview_token"], reason=REASON, summary_only=True
    )
    assert done.status_code == 200, done.text
    assert done.json()["applied"] is True and done.json()["change_count"] == 2
    with env.db.transaction() as conn:
        assert discarded_ids(conn, env.pid, ["sub-c1", "sub-c1-b", "sub-c2"]) == {
            "sub-c1",
            "sub-c1-b",
            "sub-c2",
        }
    assert all(_revoked(env, task) for task in (env.first, env.second, env.third))
    entries = audit(env, "annotation_mode.change")
    assert [
        (e["case_id"], e["from_mode"], e["to_mode"], e["via"], e["reason"])
        for e in entries
    ] == [
        ("c1", "proposals", "scratch", "bulk_change_mode", REASON),
        ("c2", "proposals", "scratch", "bulk_change_mode", REASON),
    ]
    assert entries[0]["discarded_submission_ids"] == ["sub-c1", "sub-c1-b"]
    assert entries[0]["revoked_assignment_ids"] == [env.first, env.second]

    # Applied once: the token no longer matches, and nothing is left to change.
    again = _post(env, preview_token=fresh["preview_token"], reason=REASON)
    assert again.json()["code"] == "PREVIEW_STALE"
    assert _skips(_preview(env)) == [("c1", "not_locked"), ("c2", "not_locked")]

    # Each text is a single change: it restores on its own.
    restored = env.lead.post(
        f"{BASE}/annotation-mode-changes/{entries[1]['change_id']}/restore",
        json={"expected_revision": revision_of(env, "c2")},
    )
    assert restored.status_code == 200, restored.text
    assert not _revoked(env, env.third) and _revoked(env, env.first)
    assert _skips(_preview(env)) == [("c1", "not_locked")]


def test_bulk_mode_change_is_for_leads_of_the_project_only(tmp_path):
    env = _two_texts(tmp_path)
    body = {"rows": ROWS, "mode": "scratch", "preview": True}
    assert client(env, "anno").post(BULK, json=body).status_code in {403, 404}
    other = env.lead.post(
        "/api/v1/projects/other/annotation-mode-changes/bulk", json=body
    )
    assert other.status_code == 404
    # Neither a preview nor a token; an unknown mode.
    assert (
        env.lead.post(BULK, json={"rows": ROWS, "mode": "scratch"}).status_code == 422
    )
    assert _post(env, "empty", preview=True).status_code == 422
    from ontotator.api.token_scopes import requirement

    found = requirement("POST", BULK)
    assert found is not None and found.scope == "project-admin"
    assert audit(env, "annotation_mode.change") == []


def test_summary_only_and_statements_do_not_grow_with_the_texts(tmp_path):
    env = _two_texts(tmp_path)
    summary = _post(env, preview=True, summary_only=True).json()
    assert (summary["change_count"], summary["submission_count"]) == (2, 2)
    assert summary["changes"] == summary["skipped"] == []
    assert summary["preview_token"] == _preview(env)["preview_token"]

    def statements(rows: list[dict[str, str]], **body: Any) -> tuple[int, Any]:
        seen: list[str] = []

        def count(conn, cursor, statement, *args):
            seen.append(statement)

        event.listen(env.db.engine, "before_cursor_execute", count)
        try:
            found = env.lead.post(BULK, json={"rows": rows, "mode": "scratch", **body})
        finally:
            event.remove(env.db.engine, "before_cursor_execute", count)
        assert found.status_code == 200, found.text
        return len(seen), found.json()

    # A preview of one text or two: the same number of statements.
    one, _ = statements(ROWS[1:], preview=True)
    two, both = statements(ROWS, preview=True)
    assert one == two
    # Applying costs a bounded number of statements per text.
    applied, _ = statements(ROWS, preview_token=both["preview_token"], reason=REASON)
    assert (applied - two) / 2 <= 40, applied - two
