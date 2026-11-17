"""Lead pause (issue 464, decision 3): submitted work and final results are
untouched. A final export with paused texts equals the export without the
pause, and so does the agreement."""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any

from sqlalchemy import select
from test_annotation_versions import seed_submission
from test_case_api import BASE, SOURCE, TARGET
from test_case_api import case_env as case_env
from test_translation_review_task import assigned

from ontotator.storage.tables import DocumentRow

# The files that hold the exported results. The receipt, the README and two
# keys of the bundle's manifest name the snapshot and its time, which differ
# between any two exports.
SNAPSHOT_KEYS = ("bundle_id", "created_at")
RESULTS = ("selected-results.ontospan.zip", "source-texts.jsonl", "index.csv")


def _export(env: Any, request_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    state = env.lead.post(f"{BASE}/exports/final/preflight").json()
    queued = env.lead.post(
        f"{BASE}/exports/final",
        json={
            "request_id": request_id,
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": w["id"], "cause_revision": w["cause_revision"]}
                for w in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )
    assert queued.status_code == 200, queued.text
    job_id = queued.json()["job_id"]
    jobs = env.app.state.jobs
    result = jobs.run(jobs.claim(job_id, "pause-test"), "pause-test")
    assert result.status == "succeeded", result.error
    downloaded = env.lead.get(f"/api/v1/jobs/{job_id}/download")
    assert downloaded.status_code == 200, downloaded.text
    archive = zipfile.ZipFile(io.BytesIO(downloaded.content))
    files: dict[str, Any] = {}
    for name in RESULTS:
        data = archive.read(name)
        if name.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as bundle:
                entries = {entry: bundle.read(entry) for entry in bundle.namelist()}
            # The bundle's manifest names the export itself as well.
            manifest = json.loads(entries["manifest.json"])
            for key in SNAPSHOT_KEYS:
                assert manifest.pop(key)
            files[name] = entries | {"manifest.json": manifest}
        else:
            files[name] = data
    return state, files


def test_a_final_export_with_paused_texts_equals_the_export_without(case_env):
    env = case_env
    seed_submission(env, "alice", "original")
    selected = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": SOURCE,
            "submission_id": "original",
            "expected_revision": 0,
        },
    )
    assert selected.status_code == 200, selected.text
    # Work in progress on the translation, so that the pause holds something.
    review = assigned(env)
    agreement = env.lead.get(f"{BASE}/agreement")
    assert agreement.status_code == 200, agreement.text
    state, files = _export(env, "before-pause")

    with env.db.transaction() as conn:
        rows = [
            {"case_id": case_id, "language": language}
            for case_id, language in conn.execute(
                select(DocumentRow.case_id, DocumentRow.language)
                .where(DocumentRow.document_id.in_([SOURCE, TARGET]))
                .distinct()
            )
        ]
    assert len(rows) == 2
    url = f"{BASE}/text-pauses/pause"
    token = env.lead.post(url, json={"rows": rows, "preview": True}).json()
    paused = env.lead.post(
        url,
        json={
            "rows": rows,
            "preview_token": token["preview_token"],
            "reason": "Clarifying the source text",
        },
    )
    assert paused.status_code == 200 and paused.json()["change_count"] == 2
    tasks = {t["assignment_id"]: t for t in env.alice.get("/api/v1/me/tasks").json()}
    assert tasks[review["id"]]["pause_causes"] == ["lead"]

    paused_state, paused_files = _export(env, "with-pause")
    assert paused_state == state
    assert paused_files == files
    assert env.lead.get(f"{BASE}/agreement").json() == agreement.json()
