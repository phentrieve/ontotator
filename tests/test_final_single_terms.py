"""The single-term export (#381): ``ontotator-final-single-terms/v1``.

Every text, phrase and finding below is invented for the tests.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from types import SimpleNamespace
from typing import Any

import pytest
from auth_harness import logged_in
from pg_harness import database_url_for
from sqlalchemy import insert, select
from t1_builders import bundle, native_unit
from t1_fixtures import create_project
from t1_fixtures import run_import as import_bundle
from test_auth_api import _app
from typer.testing import CliRunner
from work_plan_support import plan_all

from ontotator.cli import app as cli_app
from ontotator.domain.annotations import ActorRef, Annotation, Provenance, snapshot
from ontotator.domain.documents import (
    EvidenceMention,
    EvidenceRef,
    Segment,
    snapshot_evidence,
)
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.workspace import Submission, WorkspaceKey
from ontotator.exchange.final_single_terms import (
    FINAL_SINGLE_TERM_FORMAT,
    SELECTED_RESULTS_FILE,
    adjusted_term_state,
    case_id,
)
from ontotator.exchange.single_terms import CandidateGroup, Occurrence, group_id
from ontotator.jobs.queue import StructuredJobError
from ontotator.storage.final_tables import ExportSelectionSnapshotRow
from ontotator.storage.repository import _key_str
from ontotator.storage.tables import AuditEventRow, JobRow

BASE = "/api/v1/projects/proj"
ST = f"{BASE}/single-terms"
DOC1, DOC2 = "SX-1", "SX-2"
TEXTS = {
    DOC1: "Seit Wochen Krampfanfälle. Keine Areflexie. Hörminderung links.",
    DOC2: "Erneut Krampfanfälle. Areflexie beidseits. Hypotonie.",
}
SEIZURE, HYPOTONIA, AREFLEXIA = "HP:0001250", "HP:0001252", "HP:0001284"
HEARING, SENSORINEURAL = "HP:0000365", "HP:0000407"
FINDINGS: dict[str, list[tuple[str, str, str]]] = {
    DOC1: [
        ("a1", "Krampfanfälle", SEIZURE),
        ("a2", "Keine Areflexie", AREFLEXIA),
        ("a3", "Hörminderung", SENSORINEURAL),
    ],
    DOC2: [
        ("b1", "Krampfanfälle", SEIZURE),
        ("b2", "Areflexie", AREFLEXIA),
        ("b3", "Hypotonie", HYPOTONIA),
    ],
}
G_SEIZURE = group_id("de", "krampfanfälle", SEIZURE)
G_NEGATED = group_id("de", "keine areflexie", AREFLEXIA)
G_AREFLEXIA = group_id("de", "areflexie", AREFLEXIA)
G_HEARING = group_id("de", "hörminderung", SENSORINEURAL)
G_HYPOTONIA = group_id("de", "hypotonie", HYPOTONIA)


def _finding(document, annotation_id, word, term):
    from t1_fixtures import hpo_profile

    start = document.text.index(word)
    evidence = snapshot_evidence(
        EvidenceMention(
            evidence_id=f"ev-{annotation_id}",
            segments=[Segment(start=start, end=start + len(word))],
        ),
        document,
    )
    return snapshot(
        Annotation(
            annotation_id=annotation_id,
            document_id=document.document_id,
            layer_id="hpo",
            term_id=term,
            axes_values={
                "assertion": "present",
                "experiencer": "patient",
                "temporality": "current",
            },
            evidence_refs=[
                EvidenceRef(
                    evidence_id=evidence.mention.evidence_id, version=evidence.version
                )
            ],
            provenance=Provenance(
                actor=ActorRef(actor_id="ann-0001", kind="human"), method="manual"
            ),
        ),
        [evidence],
        document,
        hpo_profile(),
    )


def _submit(app, db, document_id: str, submission_id: str) -> None:
    user = app.state.accounts.get_by_username("alice")
    document = app.state.repo.get_document("proj", document_id)
    key = WorkspaceKey(
        project_key="proj",
        document_id=document_id,
        annotator_id=user.pseudonym,
        mode="independent",
        target_set_id="targets-0",
    )
    record = Submission(
        submission_id=submission_id,
        origin_key=key,
        targets=ReviewTargetSet.create([]),
        draft_revision=1,
        snapshots=[
            _finding(document, aid, word, term)
            for aid, word, term in FINDINGS[document_id]
        ],
        decisions=[],
        created_at="2026-11-01T10:00:00Z",
    )
    with db.transaction() as conn:
        project_id = app.state.repo._require_project(conn, "proj")
        app.state.repo._insert_submission(
            conn, project_id, record, local_key=_key_str(key), imported=False
        )


@pytest.fixture
def env(tmp_path, monkeypatch):
    app = _app(tmp_path)
    db = app.state.repo.db
    monkeypatch.setenv("ONTOTATOR_DATA_DIR", str(db.data_dir))
    create_project(db)
    units = [native_unit(doc, "de", TEXTS[doc], annotations=[]) for doc in TEXTS]
    result = import_bundle(db, bundle(tmp_path, units))
    assert result.status == "succeeded", result.error
    plan_all(db, "proj")
    logged_in(app, "alice", projects={"proj": ["annotator"]}, assignments=[])
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    for doc, sid in ((DOC1, "final-1"), (DOC2, "final-2")):
        _submit(app, db, doc, sid)
        selected = lead.put(
            f"{BASE}/final-selections",
            json={"document_id": doc, "submission_id": sid, "expected_revision": 0},
        )
        assert selected.status_code == 200, selected.text
    settings = lead.patch(
        f"{BASE}/settings",
        json={
            "single_term_review": True,
            "single_term_negation_cues": {"de": ["keine"]},
        },
    )
    assert settings.status_code == 200, settings.text
    rita = logged_in(app, "rita", projects={"proj": ["annotator"]}, assignments=[])
    sam = logged_in(app, "sam", projects={"proj": ["annotator"]}, assignments=[])
    for name in ("rita", "sam"):
        assert lead.put(f"{ST}/reviewers/{name}").status_code == 200
    return SimpleNamespace(
        app=app, db=db, lead=lead, rita=rita, sam=sam, tmp_path=tmp_path
    )


def _post(client, path, body) -> dict[str, Any]:
    response = client.post(path, json=body)
    assert response.status_code == 200, response.text
    return response.json()


def _decide(client, batch_id, request_id, group, decision, **extra):
    body = {"request_id": request_id, "group_id": group, "decision": decision}
    body.setdefault("phrase_only", "would_accept")
    body.update(extra)
    return _post(client, f"{ST}/batches/{batch_id}/decisions", body)


def _review(env) -> dict[str, int]:
    """Basis, a batch with a blind second review and the primary decisions."""
    _post(env.lead, f"{ST}/basis", {"request_id": "basis-1"})
    batch = _post(
        env.lead,
        f"{ST}/batches",
        {
            "request_id": "batch-1",
            "reviewer": "rita",
            "second_review": {"reviewer": "sam"},
        },
    )
    primary = batch["batch_id"]
    [second] = batch["second_batch_ids"]
    _decide(env.rita, primary, "d1", G_SEIZURE, "accept")
    contexts = env.rita.get(
        f"{ST}/groups/{G_NEGATED}/contexts", params={"batch": primary}
    ).json()["contexts"]
    [negated] = contexts
    _decide(
        env.rita,
        primary,
        "d2",
        G_NEGATED,
        "adjust_span",
        adjusted_span={
            "occurrence_ref": negated["occurrence_ref"],
            "start": negated["start"] + len("Keine "),
            "end": negated["end"],
        },
    )
    _decide(env.rita, primary, "d3", G_AREFLEXIA, "accept")
    _decide(env.rita, primary, "d4", G_HEARING, "adjust_term", adjusted_term_id=HEARING)
    # The blind second review disagrees on one group.
    _decide(env.sam, second, "s1", G_SEIZURE, "reject", reason="too_general")
    _decide(env.sam, second, "s2", G_AREFLEXIA, "accept")
    return {"primary": primary, "second": second}


def _request(env, request_id, **extra):
    state = env.lead.post(f"{BASE}/exports/final/preflight").json()
    return {
        "request_id": request_id,
        "state_digest": state["state_digest"],
        "acknowledged_warnings": [
            {"id": w["id"], "cause_revision": w["cause_revision"]}
            for w in state["warnings"]
        ],
        "accepted_omissions": state["omissions"],
        **extra,
    }


def _run(env, job_id, *, ok=True):
    jobs = env.app.state.jobs
    result = jobs.run(jobs.claim(job_id, "st-test"), "st-test")
    if ok:
        assert result.status == "succeeded", result.error
    return result


def _download(env, job_id) -> bytes:
    response = env.lead.get(f"/api/v1/jobs/{job_id}/download")
    assert response.status_code == 200, response.text
    return response.content


def _zip(data: bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(data))


def _cases(archive: zipfile.ZipFile) -> dict[tuple[str, str], dict[str, Any]]:
    lines = archive.read("cases.jsonl").decode().splitlines()
    return {(case["hpo_id"], case["text"]): case for case in map(json.loads, lines)}


def _export(env, request_id="st-1") -> int:
    queued = _post(
        env.lead,
        f"{BASE}/exports/final",
        _request(env, request_id, format="single-term"),
    )
    return queued["job_id"]


def _cli(env, out, *extra):
    args = ["--database-url", database_url_for(env.tmp_path / "auth.db")]
    return CliRunner().invoke(
        cli_app, ["admin", *args, "export", "proj", str(out), *extra]
    )


# --- the file -----------------------------------------------------------------


def test_cases_reviews_merge_and_report(env):
    _review(env)
    job_id = _export(env)
    job = env.lead.get(f"/api/v1/jobs/{job_id}").json()
    assert job["kind"] == "final_single_term_export"
    result = _run(env, job_id)
    assert result.result["cases"] == 3
    downloaded = env.lead.get(f"/api/v1/jobs/{job_id}/download")
    assert "final-single-terms" in downloaded.headers["content-disposition"]
    archive = _zip(downloaded.content)
    assert set(archive.namelist()) == {
        "README.txt",
        "cases.jsonl",
        "report.json",
        "source-texts.jsonl",
        SELECTED_RESULTS_FILE,
        "receipt.json",
    }
    cases = _cases(archive)
    assert set(cases) == {
        (SEIZURE, "Krampfanfälle"),
        (AREFLEXIA, "Areflexie"),
        (HEARING, "Hörminderung"),
    }

    seizure = cases[(SEIZURE, "Krampfanfälle")]
    assert seizure["case_id"] == case_id("de", "krampfanfälle", SEIZURE)
    assert seizure["text_origin"] == "verbatim"
    assert seizure["hpo_origin"] == "annotated"
    assert seizure["surface_variants"] == [{"text": "Krampfanfälle", "count": 2}]
    assert [o["document_id"] for o in seizure["occurrences"]] == [DOC1, DOC2]
    assert all(o["seen_by_reviewer"] for o in seizure["occurrences"])
    review = seizure["review"]
    assert review["decision"] == "accept" and review["phrase_only"] == "would_accept"
    assert review["reviewer"].startswith("ontotator:")
    assert review["original_term"] == SEIZURE
    assert review["decided_at"].endswith("Z") and len(review["decided_at"]) == 20
    assert review["second_review"]["decision"] == "reject"
    assert review["second_review"]["agrees"] is False
    snapshot_id = json.loads(archive.read("receipt.json"))["snapshot_id"]
    first = seizure["occurrences"][0]
    assert first["annotation_ref"].startswith(f"urn:ontospan:selected-{snapshot_id}:")
    assert first["axes"]["assertion"] == "present"
    assert first["ontology_digest"]

    # The re-cut of "Keine Areflexie" merges with the accepted "Areflexie".
    areflexia = cases[(AREFLEXIA, "Areflexie")]
    assert areflexia["case_id"] == case_id("de", "areflexie", AREFLEXIA)
    assert areflexia["text_origin"] == "verbatim"
    by_doc = {o["document_id"]: o for o in areflexia["occurrences"]}
    cut = by_doc[DOC1]
    assert cut["text_origin"] == "span_adjusted" and cut["text"] == "Areflexie"
    assert TEXTS[DOC1][cut["start"] : cut["end"]] == "Areflexie"
    assert cut["annotated_start"] == TEXTS[DOC1].index("Keine Areflexie")
    assert by_doc[DOC2]["text_origin"] == "verbatim"
    assert cut["decision_id"] != by_doc[DOC2]["decision_id"]
    assert areflexia["review"]["decision"] == "accept"
    assert areflexia["review"]["second_review"]["agrees"] is True
    [merged] = areflexia["merged_reviews"]
    assert merged["decision"] == "adjust_span"
    assert merged["original_text"] == "Keine Areflexie"

    hearing = cases[(HEARING, "Hörminderung")]
    assert hearing["hpo_origin"] == "generalised"
    assert hearing["review"]["original_term"] == SENSORINEURAL
    assert hearing["occurrences"][0]["annotated_term"] == SENSORINEURAL
    assert hearing["term_label"]

    report = json.loads(archive.read("report.json"))
    assert report["format"] == FINAL_SINGLE_TERM_FORMAT
    assert report["groups"] == {
        "de": {"open": 1, "blocked": 0, "decided": 4, "stale": 0}
    }
    assert report["decisions"] == {
        "accept": 2,
        "adjust_span": 1,
        "adjust_term": 1,
        "reject": 0,
    }
    assert report["blocked"]["negation_in_span"] == {"de": 1}
    assert report["second_review"]["pairs"] == 2
    assert report["second_review"]["percent"] == 50.0
    assert report["yield"]["de"]["accepted_groups"] == 4
    assert report["yield"]["de"]["cases"] == 3
    assert report["yield"]["de"]["case_occurrences"] == 5
    readme = archive.read("README.txt").decode()
    assert readme.startswith("Ontotator single-term export\n")
    with env.db.transaction() as conn:
        audited = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "project.final_single_term_export"
            )
        ).scalar_one()
    assert audited["job_id"] == job_id


def test_receipt_names_the_snapshot_decisions_and_every_file(env):
    _review(env)
    job_id = _export(env)
    _run(env, job_id)
    archive = _zip(_download(env, job_id))
    receipt = json.loads(archive.read("receipt.json"))
    assert receipt["format"] == FINAL_SINGLE_TERM_FORMAT
    assert set(receipt["files"]) == set(archive.namelist()) - {"receipt.json"}
    for name, digest in receipt["files"].items():
        assert hashlib.sha256(archive.read(name)).hexdigest() == digest, name
    with env.db.transaction() as conn:
        row = (
            conn.execute(
                select(ExportSelectionSnapshotRow).where(
                    ExportSelectionSnapshotRow.snapshot_id == receipt["snapshot_id"]
                )
            )
            .mappings()
            .one()
        )
    frozen = row["payload"]["single_term_decisions"]
    assert receipt["snapshot_sha256"] == row["sha256"]
    assert receipt["single_term_decisions"] == {
        "ids": frozen["ids"],
        "sha256": frozen["sha256"],
    }
    assert len(frozen["ids"]) == 6
    assert receipt["negation_cues"] == {"de": ["keine"]}
    assert receipt["selected_results"]["bundle_id"] == (
        f"selected-{receipt['snapshot_id']}"
    )


def test_the_bundle_equals_the_final_export_of_the_same_snapshot(env, tmp_path):
    """With the review on, a T1 final export freezes the decisions too; the
    single-term export of its snapshot holds the same bundle and texts."""
    _review(env)
    queued = _post(env.lead, f"{BASE}/exports/final", _request(env, "t1-same"))
    _run(env, queued["job_id"])
    final = _zip(_download(env, queued["job_id"]))
    out = tmp_path / "single.zip"
    done = _cli(env, out, "--format", "single-term")
    assert done.exit_code == 0, done.output
    assert "3 single-term cases" in done.output
    archive = _zip(out.read_bytes())
    receipt = json.loads(archive.read("receipt.json"))
    assert (
        receipt["snapshot_id"] == json.loads(final.read("receipt.json"))["snapshot_id"]
    )
    assert archive.read(SELECTED_RESULTS_FILE) == final.read(
        "selected-results.ontospan.zip"
    )
    assert archive.read("source-texts.jsonl") == final.read("source-texts.jsonl")


def test_frozen_decisions_make_the_file_reproducible(env):
    batches = _review(env)
    job_id = _export(env)
    # Recorded after the request: not in the snapshot, not in the file.
    _decide(env.rita, batches["primary"], "late", G_HYPOTONIA, "accept")
    _run(env, job_id)
    first = _download(env, job_id)
    assert (HYPOTONIA, "Hypotonie") not in _cases(_zip(first))
    # A second job of the same snapshot writes the same bytes.
    with env.db.transaction() as conn:
        payload = conn.execute(
            select(JobRow.payload).where(JobRow.id == job_id)
        ).scalar_one()
        again = conn.execute(
            insert(JobRow)
            .values(
                kind="final_single_term_export",
                status="queued",
                project_id=conn.execute(
                    select(JobRow.project_id).where(JobRow.id == job_id)
                ).scalar_one(),
                requested_by=conn.execute(
                    select(JobRow.requested_by).where(JobRow.id == job_id)
                ).scalar_one(),
                requested_label="leader",
                payload=payload,
            )
            .returning(JobRow.id)
        ).scalar_one()
    _run(env, again)
    assert _download(env, again) == first
    # A new export takes the later decision.
    newer = _export(env, "st-2")
    _run(env, newer)
    assert (HYPOTONIA, "Hypotonie") in _cases(_zip(_download(env, newer)))


def test_the_setting_is_checked_at_the_request_not_in_the_job(env, tmp_path):
    _review(env)
    job_id = _export(env)
    off = env.lead.patch(f"{BASE}/settings", json={"single_term_review": False})
    assert off.status_code == 200
    # Requested while on: the job runs.
    assert _run(env, job_id).result["cases"] == 3
    refused = env.lead.post(
        f"{BASE}/exports/final", json=_request(env, "st-off", format="single-term")
    )
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "SINGLE_TERM_REVIEW_OFF"
    # A replay of the earlier request still answers with its job.
    replay = env.lead.post(
        f"{BASE}/exports/final", json=_request(env, "st-1", format="single-term")
    )
    assert replay.status_code == 200, replay.text
    assert replay.json() == {"job_id": job_id}
    done = _cli(env, tmp_path / "off.zip", "--format", "single-term")
    assert done.exit_code == 1
    assert "SINGLE_TERM_REVIEW_OFF" in done.output
    # With the review off, a T1 export freezes no decisions.
    queued = _post(env.lead, f"{BASE}/exports/final", _request(env, "t1-off"))
    with env.db.transaction() as conn:
        payload = conn.execute(
            select(ExportSelectionSnapshotRow.payload).where(
                ExportSelectionSnapshotRow.request_id == "t1-off"
            )
        ).scalar_one()
    assert "single_term_decisions" not in payload
    _run(env, queued["job_id"])
    env.lead.patch(f"{BASE}/settings", json={"single_term_review": True})
    stale = _cli(env, tmp_path / "none.zip", "--format", "single-term")
    assert stale.exit_code == 1
    assert "NO_SINGLE_TERM_DECISIONS" in stale.output


@pytest.mark.parametrize(
    "kind",
    ["final_t1_export", "final_phenopacket_export", "final_single_term_export"],
)
def test_final_jobs_refuse_extra_payload_keys(env, kind):
    _review(env)
    job_id = _export(env)
    with env.db.transaction() as conn:
        job = conn.execute(select(JobRow).where(JobRow.id == job_id)).mappings().one()
        extra = conn.execute(
            insert(JobRow)
            .values(
                kind=kind,
                status="queued",
                project_id=job["project_id"],
                requested_by=job["requested_by"],
                requested_label="leader",
                payload={**job["payload"], "decision_ids": [1]},
            )
            .returning(JobRow.id)
        ).scalar_one()
    failed = _run(env, extra, ok=False)
    assert failed.status == "failed"
    assert "INVALID_EXPORT_SNAPSHOT" in (failed.error or "")


def test_a_changed_frozen_decision_fails_the_job(env):
    from ontotator.domain.errors import DomainError
    from ontotator.exchange.final_single_terms import load_decisions

    _review(env)
    job_id = _export(env)

    with env.db.transaction() as conn:
        pid = conn.execute(
            select(JobRow.project_id).where(JobRow.id == job_id)
        ).scalar_one()
        payload = conn.execute(
            select(ExportSelectionSnapshotRow.payload).where(
                ExportSelectionSnapshotRow.request_id == "st-1"
            )
        ).scalar_one()
        frozen = payload["single_term_decisions"]
        assert len(load_decisions(conn, pid, frozen)) == len(frozen["ids"])
        with pytest.raises(DomainError) as refused:
            load_decisions(conn, pid, {**frozen, "sha256": "0" * 64})
    assert refused.value.code == "INVALID_EXPORT_SNAPSHOT"


# --- a term adjustment across releases --------------------------------------


class _View:
    """An invented release: active terms and each term's ancestors."""

    def __init__(self, ancestors: dict[str, set[str]]):
        self._ancestors = ancestors

    def is_active(self, term_id: str) -> bool:
        return term_id in self._ancestors

    def ancestors(self, term_id: str) -> set[str]:
        return self._ancestors.get(term_id, set())

    def label(self, term_id: str) -> str | None:
        return None


def _occurrence(digest: str, release: str) -> Occurrence:
    return Occurrence(
        language="en",
        document_id=f"doc-{release}",
        text_version="v1",
        source_text_line=1,
        text_sha256="a" * 64,
        source_text_sha256=None,
        submission_id=f"s-{release}",
        annotation_id="a1",
        annotation_version="1",
        annotation_ref="urn:ontospan:x:y:z",
        layer_id="hpo",
        term_id="HP:0000002",
        start=0,
        end=4,
        text="pale",
        axes={},
        modifiers=(),
        ontology_release=release,
        ontology_digest=digest,
        label=None,
        blocked=(),
        flags=(),
    )


def _group(*occurrences: Occurrence) -> CandidateGroup:
    return CandidateGroup(
        group_id="g" * 64,
        language="en",
        phrase="pale",
        term_id="HP:0000002",
        label=None,
        display_text="pale",
        surface_variants=(("pale", len(occurrences)),),
        occurrences=occurrences,
        flags=(),
        blocked_reasons=(),
        conflict_with=(),
        releases=(),
    )


def test_a_generalised_term_must_be_an_ancestor_in_every_release():
    older = _View({"HP:0000002": {"HP:0000001"}, "HP:0000001": set()})
    newer = _View({"HP:0000002": {"HP:0000003"}, "HP:0000001": set()})
    group = _group(_occurrence("d1", "2026-01-01"), _occurrence("d2", "2026-06-01"))
    with pytest.raises(StructuredJobError) as refused:
        adjusted_term_state(group, "HP:0000001", {"d1": older, "d2": newer})
    assert refused.value.code == "SINGLE_TERM_MIXED_RELEASE"
    assert refused.value.details["releases"] == [
        {"release": "2026-06-01", "digest": "d2"}
    ]
    assert adjusted_term_state(group, "HP:0000001", {"d1": older, "d2": older}) == (
        "decided"
    )
    # Absent in one release: the group is stale, not an error.
    gone = _View({"HP:0000002": {"HP:0000001"}})
    assert adjusted_term_state(group, "HP:0000001", {"d1": older, "d2": gone}) == (
        "stale"
    )
