"""Undo of the bulk action "Change final…" (issue 336, step 2): the server
restores each text's earlier final result, all or nothing, while nothing the
final result rests on changed since."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import insert, select, update
from test_bulk_final_actions import (
    CHANGE,
    _final,
    _final_then_newer,
    _newer,
    preview,
    rows,
)
from test_final_withdraw_and_accept_agreeing import _audits, _finals, _statements
from work_plan_support import BASE, assign, doc, plan_env, write

from ontotator.application import final_change_undo
from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.storage import work_plan_store
from ontotator.storage.final_tables import (
    ExportSelectionSnapshotRow,
    FinalSelectionEventRow,
    FinalSelectionRow,
)
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    ProjectRow,
    SubmissionRow,
    UserRow,
)

UNDO = f"{CHANGE}/undo"
BOTH = (("c1", "en"), ("c2", "en"))


@pytest.fixture
def env(tmp_path):
    return plan_env(tmp_path)


def _apply(env: Any, *texts: tuple[str, str], who: Any = None) -> dict[str, Any]:
    token = preview(env, *texts)["preview_token"]
    applied = (who or env.lead).post(
        CHANGE, json={"rows": rows(*texts), "preview_token": token}
    )
    assert applied.status_code == 200, applied.text
    return dict(applied.json())


def _undo(env: Any, applied: dict[str, Any], who: Any = None, **more: Any) -> Any:
    return (who or env.lead).post(UNDO, json={"undo_id": applied["undo"]["id"], **more})


def _selection(env: Any, case: str) -> Any:
    with env.db.transaction() as conn:
        return conn.execute(
            select(FinalSelectionRow).where(
                FinalSelectionRow.project_id == env.pid,
                FinalSelectionRow.case_id == case,
                FinalSelectionRow.language == "en",
            )
        ).one()


def _user_id(env: Any, username: str) -> int:
    with env.db.transaction() as conn:
        return int(
            conn.execute(
                select(UserRow.id).where(UserRow.username == username)
            ).scalar_one()
        )


def _same_preview(details: dict[str, Any], body: dict[str, Any]) -> bool:
    """The refusal carries the preview the lead would get now."""
    return details == {"reason": "changed", "preview": body}


def _blocks(body: dict[str, Any]) -> list[tuple[str, str]]:
    return [(item["case_id"], item["reason"]) for item in body["blocked"]]


def test_a_preview_has_no_undo_and_an_apply_returns_its_handle(env):
    _final_then_newer(env, "c1")
    assert preview(env, ("c1", "en"))["undo"] is None
    applied = _apply(env, ("c1", "en"))
    handle = applied["undo"]
    assert handle["id"] > 0
    expires = datetime.fromisoformat(handle["expires_at"])
    left = expires - datetime.now(expires.tzinfo)
    assert timedelta(minutes=59) < left <= timedelta(minutes=60)
    # Nothing changed: no record, no handle.
    token = preview(env, ("c1", "en"))["preview_token"]
    again = env.lead.post(
        CHANGE, json={"rows": rows(("c1", "en")), "preview_token": token}
    )
    assert again.json()["change_count"] == 0 and again.json()["undo"] is None
    assert len(_audits(env, final_change_undo.APPLIED)) == 1


def test_undo_previews_and_restores_every_text_as_it_was(env):
    """The earlier choice comes back with its lead, its time and its
    confirmed warnings; the revision moves on; each text is audited."""
    second = logged_in(env.app, "lead2", projects={"proj": ["lead"]}, assignments=[])
    _final(env, "c1")
    # c2: the other lead chose the final result.
    from test_final_panel_api import submit_findings

    submit_findings(env, assign(env, doc("c2", "en"), "anno", "annotate"), "c2-a", [])
    chosen = second.put(
        f"{BASE}/final-selections",
        json={
            "document_id": doc("c2", "en"),
            "submission_id": "c2-a",
            "expected_revision": 0,
        },
    )
    assert chosen.status_code == 200, chosen.text
    _newer(env, "c1")
    _newer(env, "c2")
    with env.db.transaction() as conn:
        conn.execute(
            update(FinalSelectionRow)
            .where(FinalSelectionRow.case_id == "c1")
            .values(acknowledged_cause_ids=["SELECTED_NEWER_RESULT:c1:en:x"])
        )
    before = {case: _selection(env, case) for case in ("c1", "c2")}

    applied = _apply(env, *BOTH)
    assert _finals(env) == {("c1", "en"): ("c1-b", 2), ("c2", "en"): ("c2-b", 2)}
    assert _selection(env, "c2").actor_id == _user_id(env, "leader")

    found = _undo(env, applied, preview=True)
    assert found.status_code == 200, found.text
    body = found.json()
    assert (body["applied"], body["undo_id"]) == (False, applied["undo"]["id"])
    assert (body["texts"], body["restore_count"], body["blocked_count"]) == (2, 2, 0)
    assert body["blocked"] == [] and body["exports_since"] == 0
    first, other = body["restores"]
    assert first == {
        "case_id": "c1",
        "language": "en",
        "document_id": doc("c1", "en"),
        "submission_id": "c1-a",
        "version": 1,
        "from_document_id": doc("c1", "en"),
        "from_submission_id": "c1-b",
        "from_version": 1,
        "selected_by": first["selected_by"],
        "selected_at": first["selected_at"],
    }
    assert first["selected_by"]["is_me"] is True
    assert other["selected_by"]["is_me"] is False
    assert datetime.fromisoformat(first["selected_at"]) == before["c1"].selected_at
    # A preview restores nothing.
    assert _finals(env) == {("c1", "en"): ("c1-b", 2), ("c2", "en"): ("c2-b", 2)}

    done = _undo(env, applied)
    assert done.status_code == 200, done.text
    assert done.json() == body | {"applied": True}
    assert _finals(env) == {("c1", "en"): ("c1-a", 3), ("c2", "en"): ("c2-a", 3)}
    for case in ("c1", "c2"):
        now, was = _selection(env, case), before[case]
        assert (
            now.document_id,
            now.actor_id,
            now.selected_at,
            now.acknowledged_cause_ids,
            now.adjudicator_not_annotator,
        ) == (
            was.document_id,
            was.actor_id,
            was.selected_at,
            was.acknowledged_cause_ids,
            was.adjudicator_not_annotator,
        )
        assert now.updated_at > was.updated_at
    assert _selection(env, "c2").actor_id == _user_id(env, "lead2")

    audits = _audits(env, "project.final_selection")
    assert [(a["case_id"], a["submission_id"], a.get("via")) for a in audits[-4:]] == [
        ("c1", "c1-b", "bulk_change_final"),
        ("c2", "c2-b", "bulk_change_final"),
        ("c1", "c1-a", "bulk_change_final_undo"),
        ("c2", "c2-a", "bulk_change_final_undo"),
    ]
    assert all(a["undo_of"] == applied["undo"]["id"] for a in audits[-2:])
    assert audits[-1]["restored_by"] == _user_id(env, "leader")
    assert _audits(env, final_change_undo.UNDONE) == [
        {
            "undo_of": applied["undo"]["id"],
            "texts": [["c1", "en"], ["c2", "en"]],
            "exports_since": 0,
        }
    ]
    with env.db.transaction() as conn:
        events = [
            payload
            for payload in conn.execute(
                select(FinalSelectionEventRow.payload).order_by(
                    FinalSelectionEventRow.id
                )
            ).scalars()
            if payload.get("restored")
        ]
    assert [(e["case_id"], e["submission_id"], e["revision"]) for e in events] == [
        ("c1", "c1-a", 3),
        ("c2", "c2-a", 3),
    ]

    # Documents names the earlier lead again, and the action is offered anew.
    page = env.lead.get(f"{BASE}/document-rows", params={"q": "c2"}).json()
    [row] = [
        row
        for group in page["groups"]
        for row in group["rows"]
        if (row["case_id"], row["language"]) == ("c2", "en")
    ]
    assert row["final"]["submission_id"] == "c2-a"
    again = preview(env, *BOTH)
    assert [c["submission_id"] for c in again["changes"]] == ["c1-b", "c2-b"]

    # Once.
    for request in ({}, {"preview": True}):
        twice = _undo(env, applied, **request)
        assert twice.status_code == 409
        assert twice.json() == {
            "code": "BULK_UNDO_STALE",
            "details": {"reason": "already_undone"},
        }


def test_one_changed_text_blocks_the_whole_undo(env):
    _final_then_newer(env, "c1")
    _final_then_newer(env, "c2")
    applied = _apply(env, *BOTH)
    # The lead confirms c2's new final result again: its revision moves on.
    confirmed = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": doc("c2", "en"),
            "submission_id": "c2-b",
            "expected_revision": 2,
        },
    )
    assert confirmed.status_code == 200, confirmed.text

    body = _undo(env, applied, preview=True).json()
    assert [r["case_id"] for r in body["restores"]] == ["c1"]
    assert body["blocked"] == [
        {
            "case_id": "c2",
            "language": "en",
            "reason": "final",
            "message": final_change_undo.BLOCKS["final"],
        }
    ]
    refused = _undo(env, applied)
    assert refused.status_code == 409
    assert refused.json()["code"] == "BULK_UNDO_STALE"
    assert _same_preview(refused.json()["details"], body)
    # Nothing was restored, c1 included, and the Undo is not used up.
    assert _finals(env) == {("c1", "en"): ("c1-b", 2), ("c2", "en"): ("c2-b", 3)}
    assert _audits(env, final_change_undo.UNDONE) == []


def _withdraw_final(env: Any) -> None:
    response = env.lead.post(
        f"{BASE}/final-selections/withdraw",
        json={
            "case_id": "c1",
            "language": "en",
            "expected_revision": 2,
            "reason": "Annotate again",
        },
    )
    assert response.status_code == 200, response.text


def _new_version_discarded(env: Any) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            insert(DiscardedVariantRow).values(
                project_id=env.pid,
                document_id=doc("c1", "en"),
                reason="test",
                discarded_by=_user_id(env, "leader"),
            )
        )


def _plan_changed(env: Any) -> None:
    write(env, {RowKey("c1", "en"): PlanFlags(False, False)})


def _task_paused(env: Any) -> None:
    """As a problem report decided meanwhile pauses a task of the text."""
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.document_id == doc("c1", "en"))
            .values(held=True)
        )


def _task_reopened(env: Any) -> None:
    with env.db.transaction() as conn:
        task = conn.execute(
            select(AssignmentRow.id)
            .where(AssignmentRow.document_id == doc("c1", "en"))
            .order_by(AssignmentRow.id)
        ).first()
    assert task is not None
    reopened = env.lead.post(f"/api/v1/assignments/{task.id}/reopen", json={})
    assert reopened.status_code == 200, reopened.text


def _task_assigned(env: Any) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(annotations_per_text=5)
        )
    assign(env, doc("c1", "en"), "ana", "annotate")


def _submission_added(env: Any) -> None:
    """A submission no task names (the tasks stay as they are)."""
    with env.db.transaction() as conn:
        row = dict(
            conn.execute(
                select(SubmissionRow.__table__).where(
                    SubmissionRow.submission_id == "c1-b"
                )
            )
            .mappings()
            .one()
        )
        row.pop("id", None)
        conn.execute(
            insert(SubmissionRow.__table__).values(row | {"submission_id": "c1-c"})
        )


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        (_withdraw_final, "final"),
        (_new_version_discarded, "versions"),
        (_plan_changed, "plan"),
        (_task_paused, "tasks"),
        (_task_reopened, "tasks"),
        (_task_assigned, "tasks"),
        (_submission_added, "submissions"),
    ],
)
def test_undo_is_refused_once_what_the_final_rests_on_changed(env, change, reason):
    _final_then_newer(env, "c1")
    applied = _apply(env, ("c1", "en"))
    change(env)
    body = _undo(env, applied, preview=True).json()
    assert body["restores"] == [] and _blocks(body) == [("c1", reason)]
    assert body["blocked"][0]["message"] == final_change_undo.BLOCKS[reason]
    refused = _undo(env, applied)
    assert refused.status_code == 409
    assert _same_preview(refused.json()["details"], body)
    assert _finals(env).get(("c1", "en"), ("c1-b", 2)) == ("c1-b", 2)


def test_an_export_made_meanwhile_does_not_block_and_is_counted(env):
    """As after Withdraw final…: final exports already made stay as they
    are; the preview says how many hold the changed results."""
    _final_then_newer(env, "c1")
    applied = _apply(env, ("c1", "en"))
    with env.db.transaction() as conn:
        conn.execute(
            insert(ExportSelectionSnapshotRow).values(
                snapshot_id="snap-1",
                project_id=env.pid,
                requester_id=_user_id(env, "leader"),
                request_id="r1",
                sha256="0" * 64,
                payload={"selections": []},
            )
        )
    body = _undo(env, applied, preview=True).json()
    assert (body["exports_since"], body["blocked"]) == (1, [])
    done = _undo(env, applied)
    assert done.status_code == 200, done.text
    assert done.json()["exports_since"] == 1
    assert _finals(env)[("c1", "en")] == ("c1-a", 3)
    with env.db.transaction() as conn:
        assert conn.execute(
            select(ExportSelectionSnapshotRow.payload)
        ).scalar_one() == {"selections": []}
    assert _audits(env, final_change_undo.UNDONE)[0]["exports_since"] == 1


def test_undo_puts_the_plan_restored_marker_back(env):
    """Changing the result clears PLAN_RESTORED (it was about the earlier
    final); the Undo brings that final back, so the marker returns."""
    _final_then_newer(env, "c1")
    key = RowKey("c1", "en")
    with env.db.transaction() as conn:
        work_plan_store.set_restored(conn, env.pid, key, 7)
    applied = _apply(env, ("c1", "en"))
    with env.db.transaction() as conn:
        assert key not in work_plan_store.restored(conn, env.pid)
    assert _undo(env, applied).status_code == 200
    with env.db.transaction() as conn:
        assert work_plan_store.restored(conn, env.pid)[key] == 7


def test_an_undo_keeps_its_lead_its_project_and_its_time(env, monkeypatch):
    _final_then_newer(env, "c1")
    _final_then_newer(env, "c2")
    applied = _apply(env, ("c1", "en"))
    # The request names only the record: no texts, no results.
    extra = env.lead.post(
        UNDO,
        json={"undo_id": applied["undo"]["id"], "rows": rows(("c2", "en"))},
    )
    assert extra.status_code == 422
    # Another lead, an unknown id and another kind of audit event: refused.
    second = logged_in(env.app, "lead2", projects={"proj": ["lead"]}, assignments=[])
    for request in ({}, {"preview": True}):
        other = _undo(env, applied, second, **request)
        assert other.status_code == 409
        assert other.json()["details"] == {"reason": "not_found"}
    with env.db.transaction() as conn:
        single = conn.execute(
            select(AuditEventRow.id)
            .where(AuditEventRow.action == "project.final_selection")
            .limit(1)
        ).scalar_one()
    for undo_id in (single, 10**9):
        refused = env.lead.post(UNDO, json={"undo_id": undo_id})
        assert refused.status_code == 409
        assert refused.json() == {
            "code": "BULK_UNDO_STALE",
            "details": {"reason": "not_found"},
        }
    # People without the lead role.
    assert _undo(env, applied, logged_in(env.app, "anno")).status_code in {403, 404}
    # Expired.
    monkeypatch.setattr(final_change_undo, "UNDO_MINUTES", -1)
    late = _apply(env, ("c2", "en"))
    assert _undo(env, late).json()["details"] == {"reason": "expired"}
    assert _undo(env, late, preview=True).json()["details"] == {"reason": "expired"}
    monkeypatch.undo()
    assert _finals(env) == {("c1", "en"): ("c1-b", 2), ("c2", "en"): ("c2-b", 2)}
    assert _undo(env, applied).status_code == 200
    assert _finals(env) == {("c1", "en"): ("c1-a", 3), ("c2", "en"): ("c2-b", 2)}


def test_a_later_bulk_change_of_the_same_text_keeps_the_earlier_one_from_undoing(env):
    """Only the newest change of a text can be undone: after its Undo the
    text's revision is not the one the earlier action left."""
    from test_final_panel_api import submit_findings

    _final_then_newer(env, "c1")
    first = _apply(env, ("c1", "en"))
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(annotations_per_text=5)
        )
    submit_findings(env, assign(env, doc("c1", "en"), "ana", "annotate"), "c1-c", [])
    second = _apply(env, ("c1", "en"))
    assert _finals(env)[("c1", "en")] == ("c1-c", 3)
    assert _blocks(_undo(env, first, preview=True).json()) == [("c1", "final")]
    assert _undo(env, second).status_code == 200
    assert _finals(env)[("c1", "en")] == ("c1-b", 4)
    assert _blocks(_undo(env, first, preview=True).json()) == [("c1", "final")]


def test_statements_do_not_grow_with_every_restored_text(env):
    _final_then_newer(env, "c1")
    one = _apply(env, ("c1", "en"))
    single = _statements(env, lambda: _undo(env, one, preview=True))
    assert _undo(env, one).status_code == 200
    _final_then_newer(env, "c2")
    two = _apply(env, *BOTH)
    assert two["change_count"] == 2
    assert _statements(env, lambda: _undo(env, two, preview=True)) == single


def _replace(env: Any, case: str, submission: str, revision: int, who: Any = None):
    return (who or env.lead).put(
        f"{BASE}/final-selections",
        json={
            "document_id": doc(case, "en"),
            "submission_id": submission,
            "expected_revision": revision,
        },
    )


def test_one_final_replaced_in_the_card_has_the_same_undo(env):
    """A single choice that replaces a final result records the bulk action's
    Undo for one text; a first choice and a confirmation have none."""
    _final(env, "c1")  # the first choice
    assert len(_audits(env, final_change_undo.APPLIED)) == 0
    _newer(env, "c1")
    confirmed = _replace(env, "c1", "c1-a", 1)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["undo"] is None
    before = _selection(env, "c1")

    replaced = _replace(env, "c1", "c1-b", 2)
    assert replaced.status_code == 200, replaced.text
    handle = replaced.json()["undo"]
    assert set(handle) == {"id", "expires_at"}
    [record] = _audits(env, final_change_undo.APPLIED)
    assert record["rule"] == "single"
    assert [(t["case_id"], t["submission_id"]) for t in record["texts"]] == [
        ("c1", "c1-b")
    ]

    # Another lead cannot undo it; the lead who changed it can, once.
    second = logged_in(env.app, "lead2", projects={"proj": ["lead"]}, assignments=[])
    assert second.post(UNDO, json={"undo_id": handle["id"]}).status_code == 409
    undone = env.lead.post(UNDO, json={"undo_id": handle["id"]})
    assert undone.status_code == 200, undone.text
    assert undone.json()["restore_count"] == 1
    after = _selection(env, "c1")
    assert (after.submission_id, after.selected_at, after.revision) == (
        "c1-a",
        before.selected_at,
        4,
    )
    again = env.lead.post(UNDO, json={"undo_id": handle["id"]})
    assert again.json()["details"]["reason"] == "already_undone"


def test_the_undo_of_one_replaced_final_is_refused_once_it_changed_again(env):
    _final_then_newer(env, "c1")
    replaced = _replace(env, "c1", "c1-b", 1)
    back = _replace(env, "c1", "c1-a", 2)
    assert back.status_code == 200, back.text
    refused = env.lead.post(UNDO, json={"undo_id": replaced.json()["undo"]["id"]})
    assert refused.status_code == 409
    assert refused.json()["code"] == "BULK_UNDO_STALE"
    assert [b["reason"] for b in refused.json()["details"]["preview"]["blocked"]] == [
        "final"
    ]
    assert _selection(env, "c1").submission_id == "c1-a"
