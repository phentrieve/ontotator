"""New text versions and work from proposals (issue 414, spec 2026-10-23 §1
"New text versions"): work from proposals is moved and carried onto the new
version's own proposals. A decision moves to the proposal the re-anchor job
made from the old one, else to the only new proposal with the same term on
the mapped span; only what touches a changed passage, or an accepted proposal
without counterpart, needs a check; a rejection without counterpart is
dropped. Without proposals on the new version nothing is carried
(``no_target_proposals``)."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from proposal_check_support import (
    BASE,
    assign,
    client,
    open_task,
    proposal_env,
    refused_code,
)
from sqlalchemy import select, update

from ontotator.storage.tables import AssignmentRow, DocumentRow, JobRow

# The correction rewords "Neonatalzeit" (proposal p2); p1 and p3 stay as they are.
OLD_WORD, NEW_WORD = "Neonatalzeit", "Neugeborenenzeit"


def _correction_of_c1(env: Any, annotations: list[dict[str, Any]] | None = None) -> str:
    """Import a correction (v2) of c1-en; its re-anchor job stays queued, so v2
    has no proposals until ``_run_reanchor_jobs`` unless ``annotations`` (an
    independently imported set on the new text) are given. Returns v2's ID."""
    from t1_builders import bundle, correction_unit, native_unit
    from t1_fixtures import TEXT, run_import

    from ontotator.auth.audit import Actor

    text = TEXT.replace(OLD_WORD, NEW_WORD)
    child = correction_unit(env.c1_unit, text)
    if annotations:
        own = native_unit(
            child.document.document_id,
            "en",
            text,
            case_id="c1",
            annotations=annotations,
        )
        child = child.model_copy(
            update={
                "annotation_set": own.annotation_set.model_copy(
                    update={"annotation_set_id": "independent-v2"}
                )
            }
        )
    (env.tmp_path / "v2").mkdir()
    job = run_import(
        env.db, bundle(env.tmp_path / "v2", [env.c1_unit, child]), actor=Actor.cli()
    )
    assert job.status == "succeeded", job.error
    with env.db.transaction() as conn:
        return str(
            conn.execute(
                select(DocumentRow.document_id).where(
                    DocumentRow.project_id == env.pid,
                    DocumentRow.case_id == "c1",
                    DocumentRow.language == "en",
                    DocumentRow.version == 2,
                )
            ).scalar_one()
        )


def _run_reanchor_jobs(env: Any) -> None:
    from ontotator.exchange.jobs import HANDLERS
    from ontotator.jobs.queue import JobQueue

    queue = JobQueue(env.db, HANDLERS)
    with env.db.transaction() as conn:
        ids = list(
            conn.execute(
                select(JobRow.id)
                .where(
                    JobRow.kind == "reanchor",
                    JobRow.project_id == env.pid,
                    JobRow.status == "queued",
                )
                .order_by(JobRow.id)
            ).scalars()
        )
    assert ids
    for job_id in ids:
        job = queue.claim(job_id, "text-change-test")
        assert job is not None
        queue.run(job, "text-change-test")


def _submit(env: Any, assignment_id: int, mode: str) -> str:
    """Record an empty submission of ``mode`` for the assignment's user."""
    from ontotator.domain.review import ReviewTargetSet
    from ontotator.domain.workspace import Submission, WorkspaceKey
    from ontotator.storage.repository import _key_str
    from ontotator.storage.tables import UserRow

    submission_id = f"sub-{assignment_id}"
    with env.db.transaction() as conn:
        row = conn.execute(
            select(AssignmentRow.document_id, UserRow.pseudonym)
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(AssignmentRow.id == assignment_id)
        ).one()
    key = WorkspaceKey(
        project_key="proj",
        document_id=row.document_id,
        annotator_id=row.pseudonym,
        mode=mode,
        target_set_id="targets-0",
    )
    record = Submission(
        submission_id=submission_id,
        origin_key=key,
        targets=ReviewTargetSet.create([]),
        draft_revision=1,
        snapshots=[],
        decisions=[],
        created_at="2026-10-16T10:00:00Z",
    )
    with env.db.transaction() as conn:
        env.app.state.repo._insert_submission(
            conn, env.pid, record, local_key=_key_str(key), imported=False
        )
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(status="submitted", last_submission_id=submission_id)
        )
    return submission_id


def _decide(
    env: Any, username: str, opened: dict[str, Any], outcomes: list[str | None]
) -> int:
    """Decide the opened task's targets in order (None: leave undecided)."""
    workspace = opened["workspace_id"]
    revision = int(opened["view"]["draft"]["revision"])
    targets = opened["view"]["targets"]["targets"]
    assert len(targets) == len(outcomes)
    person = client(env, username)
    for n, (target, outcome) in enumerate(zip(targets, outcomes, strict=True)):
        if outcome is None:
            continue
        decided = person.post(
            f"/api/v1/workspaces/{workspace}/decisions",
            json={
                "mutation_id": f"d{n}-{uuid4().hex}",
                "expected_revision": revision,
                "payload": {"target": target, "outcome": outcome},
            },
        )
        assert decided.status_code == 200, decided.text
        revision = decided.json()["revision"]
    return revision


def _submit_task(env: Any, username: str, workspace: str, revision: int) -> Any:
    """Submit the task, acknowledging value warnings if asked."""
    payload: dict[str, Any] = {"document_checked": True}
    for _ in range(2):
        submitted = client(env, username).post(
            f"/api/v1/workspaces/{workspace}/submit",
            json={
                "mutation_id": f"submit-{uuid4().hex}",
                "expected_revision": revision,
                "payload": payload,
            },
        )
        body = submitted.json()
        if body.get("code") != "AXIS_CONFIRMATION_WARNING":
            break
        payload["warning_acknowledgement"] = body["details"]["acknowledgement"]
    return submitted


def _proposal_check(env: Any, username: str, outcomes: list[str]) -> tuple[int, str]:
    """A submitted proposal check on c1 (p1, p2, p3 decided in order)."""
    work = assign(env, env.c1, username)
    opened = open_task(env, username, work["id"])
    revision = _decide(env, username, opened, list(outcomes))
    submitted = _submit_task(env, username, opened["workspace_id"], revision)
    assert submitted.status_code == 200, submitted.text
    return work["id"], str(_assignment(env, work["id"]).last_submission_id)


def _assignment(env: Any, assignment_id: int) -> Any:
    with env.db.transaction() as conn:
        return conn.execute(
            select(AssignmentRow).where(AssignmentRow.id == assignment_id)
        ).one()


def _move(env: Any, assignment_id: int, target: str) -> Any:
    return env.lead.post(
        f"/api/v1/assignments/{assignment_id}/move-to-version",
        json={
            "target_document_id": target,
            "expected_workflow_revision": _assignment(
                env, assignment_id
            ).workflow_revision,
            "request_id": f"move-{uuid4().hex}",
        },
    )


def _finish_then_carry(env: Any, assignment_id: int, target: str) -> Any:
    return env.lead.post(
        f"/api/v1/assignments/{assignment_id}/text-change-resolution",
        json={
            "resolution": "finish_then_carry",
            "target_document_id": target,
            "expected_workflow_revision": _assignment(
                env, assignment_id
            ).workflow_revision,
        },
    )


def _preview_carry(env: Any, submission_id: str, target: str) -> Any:
    return env.lead.post(
        f"{BASE}/text-changes/preview",
        json={"submission_id": submission_id, "target_document_id": target},
    )


def _carry(env: Any, submission_id: str, target: str, mode: str = "author") -> Any:
    return env.lead.post(
        f"{BASE}/submissions/{submission_id}/carry",
        json={
            "target_document_id": target,
            "mode": mode,
            "request_id": f"carry-{uuid4().hex}",
        },
    )


def _refusal(response: Any) -> dict[str, Any]:
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "TEXT_CHANGE_NOT_APPLICABLE", body
    return dict(body["details"])


def _proposals(env: Any, document_id: str) -> list[Any]:
    return list(env.app.state.repo.list_annotations_for_document("proj", document_id))


def _local(snapshot: Any) -> str:
    """The proposal's local ID in its set (``p1`` of ``urn:…#p1``)."""
    return str(snapshot.annotation.annotation_id).rsplit("#", 1)[-1].rsplit(":", 1)[-1]


def _round_on(env: Any, username: str, document_id: str) -> dict[str, Any]:
    """Open the user's live annotate task on ``document_id``."""
    from ontotator.storage.tables import UserRow

    with env.db.transaction() as conn:
        assignment_id = conn.execute(
            select(AssignmentRow.id)
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(
                AssignmentRow.document_id == document_id,
                AssignmentRow.revoked_at.is_(None),
                UserRow.username == username,
            )
        ).scalar_one()
    return open_task(env, username, assignment_id)


def _inputs(env: Any, opened: dict[str, Any]) -> list[dict[str, Any]]:
    round_id = opened["view"]["key"]["round_id"]
    return list(env.app.state.repo.get_round_input_inventory("proj", round_id))


def _decisions(opened: dict[str, Any], by_id: dict[str, str]) -> dict[str, str]:
    """The draft's decisions by the local ID of their (new) proposal."""
    return {
        by_id[d["target"]["annotation_id"]]: d["outcome"]
        for d in opened["view"]["draft"]["decisions"]
    }


def _rows(env: Any) -> dict[tuple[str, str], dict[str, Any]]:
    response = env.lead.get(f"{BASE}/document-rows")
    assert response.status_code == 200, response.text
    return {
        (r["case_id"], r["language"]): r
        for g in response.json()["groups"]
        for r in g["rows"]
    }


def _codes(env: Any) -> list[str]:
    return [step["code"] for step in _rows(env)[("c1", "en")]["steps"]]


# --- the plan, pure ----------------------------------------------------------- #


def _plan(env: Any, v2: str, snapshots: list[Any], decisions: list[Any]) -> Any:
    from ontotator.domain.proposal_carry import plan_proposal_carry
    from ontotator.domain.reanchor import text_map

    repo = env.app.state.repo
    old, new = repo.get_document("proj", env.c1), repo.get_document("proj", v2)
    return plan_proposal_carry(
        snapshots,
        decisions,
        _proposals(env, env.c1),
        _proposals(env, v2),
        old.text,
        new.text,
        text_map(old.text, new.text),
    )


def _decision(target: Any, outcome: str) -> Any:
    from ontotator.domain.annotations import AnnotationRef
    from ontotator.domain.review import ReviewDecision

    return ReviewDecision(
        decision_id=f"d-{_local(target)}",
        target=AnnotationRef(
            annotation_id=target.annotation.annotation_id, version=target.version
        ),
        outcome=outcome,
        reviewer_id="anno",
    )


def test_plan_moves_decisions_through_the_reanchored_link(tmp_path):
    from ontotator.domain.reanchor import Carried, NeedsReview

    env = proposal_env(tmp_path)
    v2 = _correction_of_c1(env)
    _run_reanchor_jobs(env)
    old = {_local(s): s for s in _proposals(env, env.c1)}
    new = _proposals(env, v2)
    # p2's passage changed: the re-anchor job keeps it pending, no counterpart.
    assert sorted(_local(s) for s in new) == ["a1", "a3"]
    linked = {
        s.annotation.provenance.source_refs[0]: s.annotation.annotation_id for s in new
    }
    # An "added" finding: any snapshot without a decision (here p1 itself).
    plan = _plan(
        env,
        v2,
        [old["p1"], old["p2"]],
        [_decision(old["p2"], "confirmed"), _decision(old["p3"], "rejected")],
    )
    assert [(d.target.annotation_id, d.decision.outcome) for d in plan.decisions] == [
        (linked[old["p3"].annotation.annotation_id], "rejected")
    ]
    # p2 accepted in the changed passage: Check needed; p1 added: carried as is.
    by_source = {_local(i.original): i for i in plan.items}
    assert set(by_source) == {"p1", "p2"}
    assert by_source["p2"].checked is False
    assert isinstance(by_source["p2"].mapped, NeedsReview)
    assert by_source["p2"].mapped.reason == "changed_segment"
    assert by_source["p1"].checked is True
    assert isinstance(by_source["p1"].mapped, Carried)


def test_plan_drops_a_rejection_without_counterpart(tmp_path):
    env = proposal_env(tmp_path)
    v2 = _correction_of_c1(env)
    _run_reanchor_jobs(env)
    old = {_local(s): s for s in _proposals(env, env.c1)}
    plan = _plan(env, v2, [], [_decision(old["p2"], "rejected")])
    assert plan.decisions == () and plan.items == ()


def test_plan_matches_an_independent_import_by_span_and_term(tmp_path):
    from t1_fixtures import TEXT, annotation

    env = proposal_env(tmp_path)
    text = TEXT.replace(OLD_WORD, NEW_WORD)
    first, second = text.index("Krampfanfälle"), text.rindex("Krampfanfälle")
    size = len("Krampfanfälle")
    v2 = _correction_of_c1(
        env,
        [
            annotation("q1", (first, first + size), text=text),
            # Two proposals with p3's term on its mapped span: no unique match.
            annotation("q3", (second, second + size), text=text),
            annotation("q4", (second, second + size), text=text, assertion="absent"),
        ],
    )
    old = {_local(s): s for s in _proposals(env, env.c1)}
    new = {s.annotation.annotation_id: _local(s) for s in _proposals(env, v2)}
    assert sorted(new.values()) == ["q1", "q3", "q4"]
    plan = _plan(
        env,
        v2,
        [old["p1"], old["p3"]],
        [_decision(old["p1"], "confirmed"), _decision(old["p3"], "confirmed")],
    )
    assert [
        (new[d.target.annotation_id], d.decision.outcome) for d in plan.decisions
    ] == [("q1", "confirmed")]
    # Accepted without a unique counterpart: an own finding, Check needed.
    [item] = plan.items
    assert (_local(item.original), item.checked, item.proposal) == ("p3", False, None)


# --- carry, move and finish-then-carry ------------------------------------------ #


def test_submitted_work_from_proposals_is_carried(tmp_path):
    env = proposal_env(tmp_path)
    # p1 accepted, p2 accepted (its passage changes), p3 rejected.
    _, submission_id = _proposal_check(
        env, "anno", ["confirmed", "confirmed", "rejected"]
    )
    v2 = _correction_of_c1(env)
    _run_reanchor_jobs(env)
    assert "carry_text_change" in _codes(env)
    preview = _preview_carry(env, submission_id, v2)
    assert preview.status_code == 200, preview.text
    counts = preview.json()
    assert (counts["findings"], counts["placed"], counts["unplaced"]) == (3, 2, 1)
    assert counts["in_changed_passages"] == 1
    carried = _carry(env, submission_id, v2)
    assert carried.status_code == 200, carried.text
    assert carried.json()["resolution"] == "carried"

    opened = _round_on(env, "anno", v2)
    assert opened["view"]["key"]["mode"] == "proposal_check"
    new = {s.annotation.annotation_id: _local(s) for s in _proposals(env, v2)}
    targets = [t["annotation_id"] for t in opened["view"]["targets"]["targets"]]
    assert sorted(new[t] for t in targets) == ["a1", "a3"]
    # Both decisions in unchanged text carried as they are.
    assert _decisions(opened, new) == {"a1": "confirmed", "a3": "rejected"}
    # Only p2 (changed passage) is Check needed.
    [check] = _inputs(env, opened)
    assert check["mapping_status"] == "needs_review"
    assert check["review_reason"] == "changed_segment"
    assert opened["view"]["draft"].get("round_input_resolutions", []) == []

    # Dismissed, the carried work is submitted like any v2 submission.
    person = client(env, "anno")
    dismissed = person.post(
        f"/api/v1/workspaces/{opened['workspace_id']}/round-input-resolutions",
        json={
            "mutation_id": f"dismiss-{uuid4().hex}",
            "expected_revision": opened["view"]["draft"]["revision"],
            "payload": {
                "input_id": check["input_id"],
                "outcome": "dismissed",
                "reason": "reworded",
            },
        },
    )
    assert dismissed.status_code == 200, dismissed.text
    submitted = _submit_task(
        env, "anno", opened["workspace_id"], dismissed.json()["revision"]
    )
    assert submitted.status_code == 200, submitted.text


def test_open_work_from_proposals_is_moved_with_its_decisions(tmp_path):
    env = proposal_env(tmp_path)
    work = assign(env, env.c1, "anno")
    opened = open_task(env, "anno", work["id"])
    _decide(env, "anno", opened, ["confirmed", "rejected", None])
    v2 = _correction_of_c1(env)
    _run_reanchor_jobs(env)
    moved = _move(env, work["id"], v2)
    assert moved.status_code == 200, moved.text
    assert _assignment(env, work["id"]).revoked_at is not None

    again = _round_on(env, "anno", v2)
    new = {s.annotation.annotation_id: _local(s) for s in _proposals(env, v2)}
    # p1 carried to its re-anchored proposal; p2's rejection has no
    # counterpart (changed passage) and is dropped; p3 stays undecided.
    assert _decisions(again, new) == {"a1": "confirmed"}
    assert _inputs(env, again) == []


def test_finish_then_carry_carries_proposals_work_on_submit(tmp_path):
    env = proposal_env(tmp_path)
    work = assign(env, env.c1, "anno")
    opened = open_task(env, "anno", work["id"])
    revision = _decide(env, "anno", opened, ["confirmed", "confirmed", "rejected"])
    v2 = _correction_of_c1(env)
    _run_reanchor_jobs(env)
    decided = _finish_then_carry(env, work["id"], v2)
    assert decided.status_code == 200, decided.text
    submitted = _submit_task(env, "anno", opened["workspace_id"], revision)
    assert submitted.status_code == 200, submitted.text

    carried = _round_on(env, "anno", v2)
    new = {s.annotation.annotation_id: _local(s) for s in _proposals(env, v2)}
    assert _decisions(carried, new) == {"a1": "confirmed", "a3": "rejected"}
    [check] = _inputs(env, carried)
    assert check["mapping_status"] == "needs_review"


def test_without_proposals_on_the_new_version_nothing_is_carried(tmp_path):
    env = proposal_env(tmp_path)
    moving = assign(env, env.c1, "anno")
    submitted = assign(env, env.c1, "anno2")
    submission_id = _submit(env, submitted["id"], "proposal_check")
    v2 = _correction_of_c1(env)
    expected = {"reason": "no_target_proposals"}
    assert _refusal(_move(env, moving["id"], v2)) == expected
    assert _refusal(_finish_then_carry(env, moving["id"], v2)) == expected
    assert _refusal(_preview_carry(env, submission_id, v2)) == expected
    assert _refusal(_carry(env, submission_id, v2)) == expected
    # The row shows the carry as blocked until v2 has proposals; assigning
    # v2 stays offered (rule 8: the waiting author does not count).
    steps = _rows(env)[("c1", "en")]["steps"]
    carries = [s for s in steps if s["code"] == "carry_text_change"]
    assert [s.get("blocked") for s in carries] == ["no_target_proposals"]
    assert "assign_annotation" in _codes(env)
    # Dismissing needs no proposals.
    assert _carry(env, submission_id, v2, mode="dismiss").status_code == 200
    stays = _assignment(env, moving["id"])
    assert stays.revoked_at is None
    assert stays.document_id == env.c1


def test_new_version_with_proposals_is_assigned_from_proposals(tmp_path):
    env = proposal_env(tmp_path)
    work = assign(env, env.c1, "anno")
    _submit(env, work["id"], "proposal_check")
    v2 = _correction_of_c1(env)
    _run_reanchor_jobs(env)
    assert assign(env, v2, "anno2")["annotation_mode"] == "proposals"


def test_new_version_without_proposals_is_refused(tmp_path):
    env = proposal_env(tmp_path)
    work = assign(env, env.c1, "anno")
    _submit(env, work["id"], "proposal_check")
    v2 = _correction_of_c1(env)
    assert refused_code(env, v2, "anno2") == "NO_PROPOSALS_ON_VERSION"


def test_work_from_scratch_still_moves_and_carries(tmp_path):
    env = proposal_env(tmp_path, mode="scratch")
    moving = assign(env, env.c1, "anno")
    carried = assign(env, env.c1, "anno2")
    assert moving["annotation_mode"] == carried["annotation_mode"] == "scratch"
    submission_id = _submit(env, carried["id"], "independent")
    v2 = _correction_of_c1(env)
    moved = _move(env, moving["id"], v2)
    assert moved.status_code == 200, moved.text
    assert moved.json()["assignment"]["document_id"] == v2
    preview = _preview_carry(env, submission_id, v2)
    assert preview.status_code == 200, preview.text


# --- issue 650: proposals that wait for a check ------------------------------ #


def _correction(env: Any, parent: Any, text: str, version: int) -> tuple[str, Any]:
    """Import a correction of ``parent`` (a unit) with ``text``; runs its
    re-anchor jobs. Returns the new version's document ID and its unit."""
    from t1_builders import bundle, correction_unit
    from t1_fixtures import run_import

    from ontotator.auth.audit import Actor

    child = correction_unit(parent, text)
    units = [env.c1_unit, *([parent] if parent is not env.c1_unit else []), child]
    folder = env.tmp_path / f"v{version}"
    folder.mkdir()
    job = run_import(env.db, bundle(folder, units), actor=Actor.cli())
    assert job.status == "succeeded", job.error
    _run_reanchor_jobs(env)
    with env.db.transaction() as conn:
        document_id = conn.execute(
            select(DocumentRow.document_id).where(
                DocumentRow.project_id == env.pid,
                DocumentRow.case_id == "c1",
                DocumentRow.language == "en",
                DocumentRow.version == version,
            )
        ).scalar_one()
    return str(document_id), child


def _items(env: Any, document_id: str) -> list[dict[str, Any]]:
    return list(env.app.state.repo.get_reanchor_items("proj", document_id))


def _text(env: Any, document_id: str) -> str:
    return str(env.app.state.repo.get_document("proj", document_id).text)


def test_all_proposals_waiting_for_a_check_still_count_as_proposals(tmp_path):
    from t1_fixtures import TEXT

    env = proposal_env(tmp_path)
    work = assign(env, env.c1, "anno")
    # The correction changes the words of every proposal: v2's carried set
    # has no proposal, only three needs-review items.
    reworded = TEXT.replace(OLD_WORD, NEW_WORD).replace("Krampfanfälle", "Anfälle")
    v2, _ = _correction(env, env.c1_unit, reworded, 2)
    assert _proposals(env, v2) == []
    assert len(_items(env, v2)) == 3

    # Counts stay honest; the mode stays "from proposals".
    row = _rows(env)[("c1", "en")]
    assert row["proposal_count"] == 0
    assert row["annotation_mode"]["mode"] == "proposals"
    assert row["annotation_mode"]["source"] != "no_proposals"

    # A batch assignment does not skip it.
    shown = env.lead.post(
        f"{BASE}/assignments/batch/preview",
        json={
            "task": "annotate",
            "language": "en",
            "case_ids": ["c1"],
            "mode": "one",
            "usernames": ["tom"],
        },
    )
    assert shown.status_code == 200, shown.text
    assert [t["document_id"] for t in shown.json()["targets"]] == [v2]
    assert shown.json()["skipped"] == []

    # The open task moves to v2 and shows the items there.
    moved = _move(env, work["id"], v2)
    assert moved.status_code == 200, moved.text
    opened = _round_on(env, "anno", v2)
    view = opened["view"]
    assert view["key"]["mode"] == "proposal_check"
    assert view["targets"]["targets"] == []
    pending = view["pending_reanchor_items"]
    assert sorted(item["term_id"] for item in pending) == sorted(
        item["term_id"] for item in _items(env, v2)
    )
    assert all(item["type_id"] == "phenotype" for item in pending)

    # A new assignment of v2 is from proposals, with the same items.
    again = assign(env, v2, "anno2")
    assert again["annotation_mode"] == "proposals"
    second = open_task(env, "anno2", again["id"])
    assert len(second["view"]["pending_reanchor_items"]) == 3


def test_started_work_moves_onto_a_version_whose_proposals_all_wait(tmp_path):
    from t1_fixtures import TEXT

    env = proposal_env(tmp_path)
    work = assign(env, env.c1, "anno")
    opened = open_task(env, "anno", work["id"])
    _decide(env, "anno", opened, ["confirmed", None, None])
    reworded = TEXT.replace(OLD_WORD, NEW_WORD).replace("Krampfanfälle", "Anfälle")
    v2, _ = _correction(env, env.c1_unit, reworded, 2)
    moved = _move(env, work["id"], v2)
    assert moved.status_code == 200, moved.text
    again = _round_on(env, "anno", v2)
    # The accepted p1 has no counterpart: it is the person's own finding,
    # marked Check needed (#414).
    [check] = _inputs(env, again)
    assert check["mapping_status"] == "needs_review"


def test_a_waiting_proposal_survives_a_second_correction(tmp_path):
    from t1_fixtures import TEXT

    env = proposal_env(tmp_path)
    # v1 -> v2 rewords only p2's words: p2 waits for a check on v2.
    v2, v2_unit = _correction(env, env.c1_unit, TEXT.replace(OLD_WORD, NEW_WORD), 2)
    [waiting] = _items(env, v2)
    # v2 -> v3 changes another sentence only (and moves the text by 3).
    v3_text = "Bef: " + TEXT.replace(OLD_WORD, NEW_WORD).replace("2 Wochen", "3 Wochen")
    v3, _ = _correction(env, v2_unit, v3_text, 3)
    assert sorted(_local(s) for s in _proposals(env, v3)) == ["a1", "a2"]
    [carried] = _items(env, v3)
    # The proposal and its old words stay those of v1 ...
    for field in ("source_ref", "term_id", "layer_id", "reason", "old_mentions"):
        assert carried[field] == waiting[field]
    assert carried["old_context"] == waiting["old_context"]
    assert OLD_WORD in carried["old_context"]["text"]
    # ... the new context is that of v3.
    new = carried["new_context"]
    assert new["text"] == _text(env, v3)[new["start"] : new["end"]]
    assert NEW_WORD in new["text"]
    assert new["start"] == waiting["new_context"]["start"] + len("Bef: ")
    assert carried["diff"][0]["new_start"] == new["start"]

    # A task on v3 shows it, located in v3's text, and can decide it.
    work = assign(env, v3, "anno")
    opened = open_task(env, "anno", work["id"])
    [item] = opened["view"]["pending_reanchor_items"]
    assert item["type_id"] == "phenotype"
    assert item["changed_at"]["text"] == NEW_WORD
    assert _text(env, v3)[item["changed_at"]["start"] :].startswith(NEW_WORD)
    dismissed = client(env, "anno").post(
        f"/api/v1/workspaces/{opened['workspace_id']}/reanchor-resolutions",
        json={
            "mutation_id": f"dismiss-{uuid4().hex}",
            "expected_revision": opened["view"]["draft"]["revision"],
            "payload": {
                "item": {
                    "proposal_set_id": item["proposal_set_id"],
                    "source_ref": item["source_ref"],
                },
                "outcome": "dismissed",
                "reason": "not in the text",
            },
        },
    )
    assert dismissed.status_code == 200, dismissed.text


def test_a_resolved_waiting_proposal_does_not_come_back_for_its_task(tmp_path):
    from t1_fixtures import TEXT

    env = proposal_env(tmp_path)
    v2, v2_unit = _correction(env, env.c1_unit, TEXT.replace(OLD_WORD, NEW_WORD), 2)
    work = assign(env, v2, "anno")
    opened = open_task(env, "anno", work["id"])
    [item] = opened["view"]["pending_reanchor_items"]
    dismissed = client(env, "anno").post(
        f"/api/v1/workspaces/{opened['workspace_id']}/reanchor-resolutions",
        json={
            "mutation_id": f"dismiss-{uuid4().hex}",
            "expected_revision": opened["view"]["draft"]["revision"],
            "payload": {
                "item": {
                    "proposal_set_id": item["proposal_set_id"],
                    "source_ref": item["source_ref"],
                },
                "outcome": "dismissed",
                "reason": "not meant",
            },
        },
    )
    assert dismissed.status_code == 200, dismissed.text
    v3_text = TEXT.replace(OLD_WORD, NEW_WORD).replace("2 Wochen", "3 Wochen")
    v3, _ = _correction(env, v2_unit, v3_text, 3)
    assert len(_items(env, v3)) == 1  # the tool's proposal still waits on v3

    # The task that decided it moves on without it ...
    moved = _move(env, work["id"], v3)
    assert moved.status_code == 200, moved.text
    again = _round_on(env, "anno", v3)
    assert again["view"]["pending_reanchor_items"] == []
    # ... while a new task on v3 checks it for itself.
    other = assign(env, v3, "anno2")
    fresh = open_task(env, "anno2", other["id"])
    assert len(fresh["view"]["pending_reanchor_items"]) == 1


def test_a_set_stored_before_the_fix_is_no_collision(tmp_path, monkeypatch):
    """Upgrade: a v2 -> v3 set stored before #650 lacks the item carried on
    from v2. The v3 -> v4 job re-processes v2 -> v3: that is the same set, it
    stays as stored, and v4 carries the item on all the same."""
    from dataclasses import replace

    from t1_fixtures import TEXT

    from ontotator.exchange import reanchor_job

    env = proposal_env(tmp_path)
    v2_text = TEXT.replace(OLD_WORD, NEW_WORD)
    v2, v2_unit = _correction(env, env.c1_unit, v2_text, 2)
    [waiting] = _items(env, v2)
    # The release before the fix carried no pending item on.
    sources = reanchor_job.reanchor_sources
    with monkeypatch.context() as before:
        before.setattr(
            reanchor_job,
            "reanchor_sources",
            lambda *args: [replace(s, pending_items=()) for s in sources(*args)],
        )
        v3_text = v2_text.replace("2 Wochen", "3 Wochen")
        v3, v3_unit = _correction(env, v2_unit, v3_text, 3)
    assert _items(env, v3) == []

    v4, _ = _correction(env, v3_unit, "Bef: " + v3_text, 4)
    with env.db.transaction() as conn:
        jobs = conn.execute(
            select(JobRow.status, JobRow.error).where(JobRow.kind == "reanchor")
        ).all()
    assert {status for status, _ in jobs} == {"succeeded"}, jobs
    assert _items(env, v3) == []  # stays as stored
    [carried] = _items(env, v4)
    assert carried["source_ref"] == waiting["source_ref"]
    assert carried["old_context"] == waiting["old_context"]
    new = carried["new_context"]
    assert new["text"] == _text(env, v4)[new["start"] : new["end"]]
    assert NEW_WORD in new["text"]
    # The item leads back to the proposal across the set stored before.
    work = assign(env, v4, "anno")
    [item] = open_task(env, "anno", work["id"])["view"]["pending_reanchor_items"]
    assert item["type_id"] == "phenotype"
