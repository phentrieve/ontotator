"""Carried work from proposals end to end (issue 414, review of PR 415).

A correction, an added finding and an Unresolved decision are carried to the
new version and submitted there; a handover and a second text change carry
it again; the final export counts the carried submission as a proposal check.
"""

from __future__ import annotations

import csv
import io
import json
import zipfile
from typing import Any
from uuid import uuid4

from proposal_check_support import BASE, assign, client, open_task, proposal_env
from test_text_change_from_proposals import (
    NEW_WORD,
    OLD_WORD,
    _carry,
    _correction_of_c1,
    _local,
    _plan,
    _proposals,
    _round_on,
    _run_reanchor_jobs,
    _submit_task,
)

AXES = {"assertion": "present", "experiencer": "patient", "temporality": "current"}


def _post(env: Any, username: str, workspace: str, path: str, body: Any) -> Any:
    response = client(env, username).post(
        f"/api/v1/workspaces/{workspace}/{path}", json=body
    )
    assert response.status_code == 200, response.text
    return response.json()


def _envelope(revision: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "mutation_id": f"m-{uuid4().hex}",
        "expected_revision": revision,
        "payload": payload,
    }


def _ref(snapshot: Any) -> dict[str, str]:
    return {
        "annotation_id": snapshot.annotation.annotation_id,
        "version": snapshot.version,
    }


def _segments(snapshot: Any) -> list[dict[str, int]]:
    return [
        {"start": s.start, "end": s.end} for s in snapshot.evidence[0].mention.segments
    ]


def _check_on_v1(env: Any, username: str) -> str:
    """A proposal check on c1, submitted: p1 corrected (assertion absent), p2
    accepted (its passage changes), p3 Unresolved with a note, and an added
    finding on "Seit 2 Wochen". Returns the submission ID."""
    from t1_fixtures import TEXT

    old = {_local(s): s for s in _proposals(env, env.c1)}
    opened = open_task(env, username, assign(env, env.c1, username)["id"])
    workspace = opened["workspace_id"]
    revision = int(opened["view"]["draft"]["revision"])
    draft = _post(
        env,
        username,
        workspace,
        "commands",
        _envelope(
            revision,
            {
                "command": "create_annotation",
                "annotation_id": "copy-p1",
                "term_id": old["p1"].annotation.term_id,
                "layer_id": old["p1"].annotation.layer_id,
                "axes_values": AXES | {"assertion": "absent"},
                "chosen_axis_ids": sorted(AXES),
                "segments": _segments(old["p1"]),
                "source_annotation_id": old["p1"].annotation.annotation_id,
                "source_version": old["p1"].version,
            },
        ),
    )
    copy = next(
        a for a in draft["annotations"] if a["annotation"]["annotation_id"] == "copy-p1"
    )
    start = TEXT.index("Seit 2 Wochen")
    draft = _post(
        env,
        username,
        workspace,
        "commands",
        _envelope(
            draft["revision"],
            {
                "command": "create_annotation",
                "annotation_id": "added-1",
                "term_id": "HP:0001250",
                "layer_id": old["p1"].annotation.layer_id,
                "axes_values": AXES,
                "chosen_axis_ids": sorted(AXES),
                "segments": [{"start": start, "end": start + len("Seit 2 Wochen")}],
            },
        ),
    )
    for target, payload in [
        (
            old["p1"],
            {
                "outcome": "changed",
                "replacement": {
                    "annotation_id": "copy-p1",
                    "version": copy["version"],
                },
            },
        ),
        (old["p2"], {"outcome": "confirmed"}),
        (old["p3"], {"outcome": "uncertain", "note": "unsure about absent"}),
    ]:
        draft = _post(
            env,
            username,
            workspace,
            "decisions",
            _envelope(draft["revision"], {"target": _ref(target), **payload}),
        )
    submitted = _submit_task(env, username, workspace, draft["revision"])
    assert submitted.status_code == 200, submitted.text
    return str(submitted.json()["submission_id"])


def _carried_round(env: Any, username: str, v2: str) -> tuple[dict[str, Any], Any]:
    opened = _round_on(env, username, v2)
    inputs = client(env, username).get(
        f"/api/v1/rounds/{opened['view']['key']['round_id']}/inputs"
    )
    assert inputs.status_code == 200, inputs.text
    return opened, inputs.json()


def _by_source(inputs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(i["source_ref"]["annotation_id"]).rsplit("#", 1)[-1].rsplit(":", 1)[-1]: i
        for i in inputs
    }


def _finish(env: Any, username: str, opened: dict[str, Any], inputs: Any) -> str:
    """Dismiss the inputs that still need a check, submit; the submission ID."""
    revision = _dismiss_open(env, username, opened, inputs)
    submitted = _submit_task(env, username, opened["workspace_id"], revision)
    assert submitted.status_code == 200, submitted.text
    return str(submitted.json()["submission_id"])


def _dismiss_open(env: Any, username: str, opened: dict[str, Any], inputs: Any) -> int:
    """Dismiss the inputs that still need a check; the draft revision."""
    workspace = opened["workspace_id"]
    revision = int(opened["view"]["draft"]["revision"])
    done = {
        r["input_id"]
        for r in opened["view"]["draft"].get("round_input_resolutions", [])
    }
    for item in inputs:
        if item["input_id"] in done:
            continue
        revision = _post(
            env,
            username,
            workspace,
            "round-input-resolutions",
            _envelope(
                revision,
                {
                    "input_id": item["input_id"],
                    "outcome": "dismissed",
                    "reason": "reworded",
                },
            ),
        )["revision"]
    return revision


def _export(env: Any, document_id: str, submission_id: str) -> dict[str, Any]:
    from work_plan_support import select_final

    select_final(env, document_id, submission_id)
    state = env.lead.post(f"{BASE}/exports/final/preflight").json()
    queued = env.lead.post(
        f"{BASE}/exports/final",
        json={
            "request_id": f"export-{uuid4().hex}",
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": w["id"], "cause_revision": w["cause_revision"]}
                for w in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )
    assert queued.status_code == 200, queued.text
    jobs = env.app.state.jobs
    result = jobs.run(jobs.claim(queued.json()["job_id"], "t"), "t")
    assert result.status == "succeeded", result.error
    downloaded = env.lead.get(f"/api/v1/jobs/{queued.json()['job_id']}/download")
    archive = zipfile.ZipFile(io.BytesIO(downloaded.content))

    def table(name: str) -> list[dict[str, str]]:
        raw = archive.read(name).decode("utf-8-sig")
        return list(csv.DictReader(io.StringIO(raw, newline="")))

    return {
        "receipt": json.loads(archive.read("receipt.json")),
        "index": table("index.csv"),
        "findings": table("findings.csv"),
        "proposals": table("proposals.csv"),
    }


def test_corrections_added_and_unresolved_work_is_carried_and_exported(tmp_path):
    env = proposal_env(tmp_path)
    submission_id = _check_on_v1(env, "anno")
    v2 = _correction_of_c1(env)
    _run_reanchor_jobs(env)
    assert _carry(env, submission_id, v2).status_code == 200

    opened, inputs = _carried_round(env, "anno", v2)
    new = {_local(s): s for s in _proposals(env, v2)}
    by_input = _by_source(inputs)
    assert set(by_input) == {"copy-p1", "added-1", "p2"}
    copy = by_input["copy-p1"]["target_snapshot"]
    added = by_input["added-1"]["target_snapshot"]
    # The carried correction names its new proposal first, then its input.
    assert copy["annotation"]["provenance"]["source_refs"] == [
        f"{new['a1'].annotation.annotation_id}:{new['a1'].version}",
        f"round-input:{by_input['copy-p1']['input_id']}",
    ]
    assert added["annotation"]["provenance"]["source_refs"] == [
        f"round-input:{by_input['added-1']['input_id']}"
    ]
    assert by_input["p2"]["mapping_status"] == "needs_review"
    decisions = {
        _local_of(d["target"]["annotation_id"], new): d
        for d in opened["view"]["draft"]["decisions"]
    }
    assert {k: d["outcome"] for k, d in decisions.items()} == {
        "a1": "changed",
        "a3": "uncertain",
    }
    assert decisions["a1"]["replacement"] == {
        "annotation_id": copy["annotation"]["annotation_id"],
        "version": copy["version"],
    }
    # Uncertain with counterpart: Unresolved on the new proposal, note kept.
    assert decisions["a3"]["note"] == "unsure about absent"
    # The correction and the added finding are in unchanged text: checked.
    resolved = {
        r["input_id"] for r in opened["view"]["draft"]["round_input_resolutions"]
    }
    assert resolved == {
        by_input["copy-p1"]["input_id"],
        by_input["added-1"]["input_id"],
    }

    # Editing the carried correction drops its changed decision (the editor
    # asks for a fresh one) and needs a new check of the input.
    workspace = opened["workspace_id"]
    revision = _dismiss_open(env, "anno", opened, inputs)
    copy_id = copy["annotation"]["annotation_id"]
    draft = _post(
        env,
        "anno",
        workspace,
        "commands",
        _envelope(
            revision,
            {
                "command": "set_annotation_note",
                "annotation_id": copy_id,
                "note": "absent after all",
            },
        ),
    )
    [edited] = [
        a for a in draft["annotations"] if a["annotation"]["annotation_id"] == copy_id
    ]
    edited_ref = {"annotation_id": copy_id, "version": edited["version"]}
    assert not [d for d in draft["decisions"] if d["outcome"] == "changed"]
    # The fresh decision binds the edited copy; it still names a1 first, so
    # it passes UNRESOLVED_ADOPTED_COPY on submit.
    assert edited["annotation"]["provenance"]["source_refs"][0] == (
        f"{new['a1'].annotation.annotation_id}:{new['a1'].version}"
    )
    draft = _post(
        env,
        "anno",
        workspace,
        "decisions",
        _envelope(
            draft["revision"],
            {
                "target": _ref(new["a1"]),
                "outcome": "changed",
                "replacement": edited_ref,
            },
        ),
    )
    stale = _submit_task(env, "anno", workspace, draft["revision"])
    assert stale.json().get("code") == "ROUND_INPUT_RESOLUTION_STALE", stale.text
    draft = _post(
        env,
        "anno",
        workspace,
        "round-input-resolutions",
        _envelope(
            draft["revision"],
            {
                "input_id": by_input["copy-p1"]["input_id"],
                "outcome": "completed",
                "annotation_ref": edited_ref,
            },
        ),
    )
    submitted = _submit_task(env, "anno", workspace, draft["revision"])
    assert submitted.status_code == 200, submitted.text
    carried_id = str(submitted.json()["submission_id"])

    # The export counts the carried submission as annotation from proposals.
    exported = _export(env, v2, carried_id)
    row = next(r for r in exported["index"] if r["submission_id"] == carried_id)
    assert row["submission_kind"] == "carry_forward"
    origins = {
        r["annotation_id"]: r["origin"]
        for r in exported["findings"]
        if r["submission_id"] == carried_id
    }
    assert origins == {
        copy_id: "changed",
        new["a3"].annotation.annotation_id: "uncertain",
        added["annotation"]["annotation_id"]: "carried",
    }
    # The carried submission is counted for the tool of v2's proposals (the
    # re-anchor job's set); the v1 submission for the original tool.
    person = opened["view"]["key"]["annotator_id"]
    [row] = [
        r
        for r in exported["proposals"]
        if r["row_type"] == "annotator"
        and r["pseudonym"] == person
        and r["tool"] == "ontotator-reanchor"
    ]
    assert (row["submissions"], row["changed"], row["uncertain"], row["added"]) == (
        "1",
        "1",
        "1",
        "1",
    )
    # The Unresolved proposal is no finding of the person: 2 final findings.
    sources = [r for r in exported["proposals"] if r["row_type"] == "source"]
    assert sources and {r["final_findings"] for r in sources} == {"2"}


def _local_of(annotation_id: str, new: dict[str, Any]) -> str:
    return next(
        k for k, s in new.items() if s.annotation.annotation_id == annotation_id
    )


def test_unresolved_without_counterpart_keeps_its_note(tmp_path):
    env = proposal_env(tmp_path)
    work = assign(env, env.c1, "anno")
    opened = open_task(env, "anno", work["id"])
    old = {_local(s): s for s in _proposals(env, env.c1)}
    revision = int(opened["view"]["draft"]["revision"])
    for local, payload in [
        ("p1", {"outcome": "confirmed"}),
        # p2's passage changes: no counterpart on v2.
        ("p2", {"outcome": "uncertain", "note": "is this the neonatal period?"}),
        ("p3", {"outcome": "rejected"}),
    ]:
        revision = _post(
            env,
            "anno",
            opened["workspace_id"],
            "decisions",
            _envelope(revision, {"target": _ref(old[local]), **payload}),
        )["revision"]
    submitted = _submit_task(env, "anno", opened["workspace_id"], revision)
    assert submitted.status_code == 200, submitted.text
    v2 = _correction_of_c1(env)
    _run_reanchor_jobs(env)
    carried = _carry(env, submitted.json()["submission_id"], v2)
    assert carried.status_code == 200, carried.text
    # One count for preview and carry: two decisions and one finding.
    assert carried.json()["carried_findings"] == 3

    _, inputs = _carried_round(env, "anno", v2)
    [item] = inputs
    assert item["mapping_status"] == "needs_review"
    assert item["unresolved_note"] == "is this the neonatal period?"


def test_independent_import_with_other_values_needs_a_check(tmp_path):
    """Same span, layer and term but other values: no silent carry. An
    Unresolved proposal becomes the person's own adopted finding, Check
    needed, with the Unresolved note in its note."""
    from t1_fixtures import TEXT, annotation

    from ontotator.application.work_rounds import adopted_decision, carried_note
    from ontotator.domain.reanchor import Carried

    env = proposal_env(tmp_path)
    text = TEXT.replace(OLD_WORD, NEW_WORD)
    first = text.index("Krampfanfälle")
    v2 = _correction_of_c1(
        env,
        [
            annotation(
                "q1",
                (first, first + len("Krampfanfälle")),
                text=text,
                assertion="absent",
            )
        ],
    )
    old = {_local(s): s for s in _proposals(env, env.c1)}
    from test_text_change_from_proposals import _decision

    unsure = _decision(old["p1"], "uncertain").model_copy(update={"note": "absent?"})
    plan = _plan(env, v2, [old["p1"]], [unsure])
    assert plan.decisions == ()
    [item] = plan.items
    assert (_local(item.original), item.checked) == ("p1", False)
    assert isinstance(item.mapped, Carried)
    assert adopted_decision(item) == unsure
    assert carried_note(item.original.annotation.note, unsure).endswith("absent?")

    # End to end: the carried finding is the person's, adopted, with the note.
    work = assign(env, env.c1, "anno")
    opened = open_task(env, "anno", work["id"])
    revision = int(opened["view"]["draft"]["revision"])
    for local, payload in [
        ("p1", {"outcome": "uncertain", "note": "absent?"}),
        ("p2", {"outcome": "rejected"}),
        ("p3", {"outcome": "rejected"}),
    ]:
        revision = _post(
            env,
            "anno",
            opened["workspace_id"],
            "decisions",
            _envelope(revision, {"target": _ref(old[local]), **payload}),
        )["revision"]
    submitted = _submit_task(env, "anno", opened["workspace_id"], revision)
    assert submitted.status_code == 200, submitted.text
    assert _carry(env, submitted.json()["submission_id"], v2).status_code == 200
    carried, inputs = _carried_round(env, "anno", v2)
    [input_] = inputs
    target = input_["target_snapshot"]["annotation"]
    # The person who left it Unresolved (pseudonym of anno) adopted it.
    assert target["provenance"]["actor"] == {
        "actor_id": submitted.json()["origin_key"]["annotator_id"],
        "kind": "human",
    }
    assert target["provenance"]["method"] == "adopted"
    assert target["note"].endswith("absent?")
    assert carried["view"]["draft"].get("round_input_resolutions", []) == []
    assert carried["view"]["draft"]["decisions"] == []


def test_handover_and_a_second_text_change_carry_proposals_work(tmp_path):
    from t1_builders import bundle, correction_unit
    from t1_fixtures import TEXT, run_import

    from ontotator.auth.audit import Actor

    env = proposal_env(tmp_path)
    submission_id = _check_on_v1(env, "anno")
    v2 = _correction_of_c1(env)
    _run_reanchor_jobs(env)
    handed = env.lead.post(
        f"{BASE}/submissions/{submission_id}/carry",
        json={
            "target_document_id": v2,
            "mode": "other",
            "username": "anno2",
            "confirm_language": True,
            "request_id": f"carry-{uuid4().hex}",
        },
    )
    assert handed.status_code == 200, handed.text
    assert handed.json()["resolution"] == "handed_over"
    opened, inputs = _carried_round(env, "anno2", v2)
    assert opened["view"]["key"]["mode"] == "proposal_check"
    # The decisions are the new owner's.
    owner = opened["view"]["key"]["annotator_id"]
    assert {d["reviewer_id"] for d in opened["view"]["draft"]["decisions"]} == {owner}
    assert sorted(d["outcome"] for d in opened["view"]["draft"]["decisions"]) == [
        "changed",
        "uncertain",
    ]
    on_v2 = _finish(env, "anno2", opened, inputs)

    # v2 is corrected again (v3): the carried work is carried once more.
    text2 = TEXT.replace(OLD_WORD, NEW_WORD)
    v2_unit = correction_unit(env.c1_unit, text2)
    v3_unit = correction_unit(
        v2_unit, text2.replace("Seit 2 Wochen", "Seit zwei Wochen")
    )
    (env.tmp_path / "v3").mkdir()
    job = run_import(
        env.db,
        bundle(env.tmp_path / "v3", [env.c1_unit, v2_unit, v3_unit]),
        actor=Actor.cli(),
    )
    assert job.status == "succeeded", job.error
    _run_reanchor_jobs(env)
    v3 = _newest_c1(env)
    assert v3 != v2
    carried = _carry(env, on_v2, v3)
    assert carried.status_code == 200, carried.text
    again, inputs = _carried_round(env, "anno2", v3)
    assert sorted(d["outcome"] for d in again["view"]["draft"]["decisions"]) == [
        "changed",
        "uncertain",
    ]
    # Only the added finding sat in the changed passage.
    open_inputs = {i["input_id"] for i in inputs} - {
        r["input_id"] for r in again["view"]["draft"].get("round_input_resolutions", [])
    }
    assert [i["mapping_status"] for i in inputs if i["input_id"] in open_inputs] == [
        "needs_review"
    ]
    _finish(env, "anno2", again, inputs)


def _newest_c1(env: Any) -> str:
    from sqlalchemy import select

    from ontotator.storage.tables import DocumentRow

    with env.db.transaction() as conn:
        return str(
            conn.execute(
                select(DocumentRow.document_id)
                .where(
                    DocumentRow.project_id == env.pid,
                    DocumentRow.case_id == "c1",
                    DocumentRow.language == "en",
                )
                .order_by(DocumentRow.version.desc())
                .limit(1)
            ).scalar_one()
        )
