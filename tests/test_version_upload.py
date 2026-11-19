"""Upload a new version of one translation from the text card (issue 341 a)."""

from datetime import date
from typing import Any

import pytest
from auth_harness import HARNESS, ORIGIN, logged_in
from fastapi.testclient import TestClient
from sqlalchemy import insert, select
from test_accept_version import accept
from test_lead_correction import accepted as accepted
from test_lead_correction import audits, decide, lead, target_hash, workflow
from test_translation_review_service import review_env as review_env
from work_plan_support import flags_of, write

from ontotator.application.version_uploads import VersionUploadService
from ontotator.assignments.service import AssignmentService
from ontotator.domain.errors import DomainError
from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.exchange.reanchor_job import ReanchorPayload
from ontotator.storage.plan_tables import (
    DiscardedVariantRow,
    TranslationVersionUploadRow,
)
from ontotator.storage.tables import AssignmentRow, DocumentRow, JobRow

BASE = "/api/v1/projects/proj"
NEW = "Bei Aufnahme: Puls regelmäßig, Temperatur 38,2 °C."


def service(env: Any) -> VersionUploadService:
    return VersionUploadService(env.db, env.app.state.jobs)


def upload(env: Any, document_id: str = "target", **kwargs: Any) -> dict[str, Any]:
    kwargs.setdefault("text", NEW)
    kwargs.setdefault("expected_text_sha256", target_hash(env, document_id))
    kwargs.setdefault("method", "manual_correction")
    return service(env).upload(lead(env), "proj", document_id, **kwargs)


def refusal(env: Any, document_id: str = "target", **kwargs: Any) -> DomainError:
    with pytest.raises(DomainError) as caught:
        upload(env, document_id, **kwargs)
    return caught.value


@pytest.fixture
def unreviewed(review_env):
    """``target`` (ready for review) with no open review."""
    for name in ("alice", "bob"):
        AssignmentService(review_env.db).revoke(HARNESS, review_env.ids[name])
    return review_env


def test_upload_becomes_a_correction_ready_for_review_with_review_on(accepted):
    """Decision 341a-C: always a correction of the newest version, Review on,
    nothing accepted; the work on the accepted version stays (341a-E)."""
    env = accepted
    write(env, {RowKey("case", "de"): PlanFlags(False, True)})
    result = upload(
        env,
        text="\ufeff" + NEW + "\r\n",
        method="machine_translation",
        provider=" DeepL ",
        model="deepl-2026-10",
        made_on=date(2026, 11, 12),
        made_by="Dr. Roe",
        note="Checked against the source",
    )
    child = env.app.state.repo.get_variant("proj", result["document_id"])
    assert result == {
        "case_id": "case",
        "language": "de",
        "document_id": child.document_id,
        "version": 2,
        "previous_document_id": "target",
        "previous_version": 1,
        "translation_status": "ready_for_review",
        "text_sha256": child.text_sha256,
    }
    assert (child.origin, child.derived_from, child.version) == (
        "correction",
        "target",
        2,
    )
    assert child.translation_status == "ready_for_review"
    # Structured translation data stays off the correction (ontospan 1.2).
    assert child.translation is None
    assert flags_of(env, "case", "de").review is True
    assert env.app.state.repo.get_variant("proj", "target").translation_status == (
        "accepted"
    )
    with env.db.transaction() as conn:
        text = conn.execute(
            select(DocumentRow.text).where(DocumentRow.document_id == child.document_id)
        ).scalar_one()
        record = conn.execute(select(TranslationVersionUploadRow)).mappings().one()
        annotations = conn.execute(
            select(AssignmentRow.document_id, AssignmentRow.status).where(
                AssignmentRow.task == "annotate", AssignmentRow.revoked_at.is_(None)
            )
        ).all()
        (job,) = conn.execute(
            select(JobRow.payload).where(JobRow.kind == "reanchor")
        ).scalars()
    # Byte order mark and line ends are canonical, as in an import.
    assert text == NEW
    assert {
        key: record[key]
        for key in (
            "document_id",
            "previous_document_id",
            "method",
            "provider",
            "model",
            "made_on",
            "made_by",
            "note",
            "uploaded_by",
        )
    } == {
        "document_id": child.document_id,
        "previous_document_id": "target",
        "method": "machine_translation",
        "provider": "DeepL",
        "model": "deepl-2026-10",
        "made_on": date(2026, 11, 12),
        "made_by": "Dr. Roe",
        "note": "Checked against the source",
        "uploaded_by": env.accesses["leader"].user_id,
    }
    assert sorted(annotations) == [("target", "open"), ("target", "submitted")]
    payload = ReanchorPayload.model_validate(
        {k: v for k, v in job.items() if k != "api_token"}
    )
    assert (payload.old_document_id, payload.new_document_id) == (
        "target",
        child.document_id,
    )
    assert payload.producer.kind == "version_upload"
    (audit,) = audits(env, "translation.version_uploaded")
    assert audit == {
        "document_id": child.document_id,
        "previous_document_id": "target",
        "case_id": "case",
        "language": "de",
        "version": 2,
        "text_sha256": child.text_sha256,
        "previous_text_sha256": target_hash(env),
        "upload_id": record["id"],
        "method": "machine_translation",
        "provider": "DeepL",
        "model": "deepl-2026-10",
        "made_on": "2026-11-12",
        "made_by": "Dr. Roe",
        "note": "Checked against the source",
    }


def test_the_uploaded_version_is_accepted_by_its_own_audited_step(unreviewed):
    """Decision 341a-C: accepting stays "Accept this version…" (issue 341 d)."""
    env = unreviewed
    before = env.app.state.repo.get_variant("proj", "target").translation_status
    result = upload(env)
    accept(env, result["document_id"], "Reviewed by Dr. Roe against the source")
    child = env.app.state.repo.get_variant("proj", result["document_id"])
    assert child.translation_status == "accepted"
    # The version it replaced is not accepted along with it.
    assert env.app.state.repo.get_variant("proj", "target").translation_status == before
    assert before != "accepted"
    (audit,) = audits(env, "translation.accept_external_review")
    assert audit["document_id"] == result["document_id"]


def test_the_reanchor_job_of_an_upload_runs(unreviewed):
    env = unreviewed
    upload(env)
    jobs = env.app.state.jobs
    with env.db.transaction() as conn:
        (job_id,) = conn.execute(
            select(JobRow.id).where(JobRow.kind == "reanchor")
        ).scalars()
    finished = jobs.run(jobs.claim(job_id, "upload-test"), "upload-test")
    assert finished.status == "succeeded", finished.error


def test_refusals(review_env):
    """Decision 341a-G: an open review of the version refuses the upload."""
    env = review_env
    error = refusal(env)
    assert error.code == "VERSION_UPLOAD_NOT_AVAILABLE"
    assert error.details == {"reason": "review_open"}
    for name in ("alice", "bob"):
        AssignmentService(env.db).revoke(HARNESS, env.ids[name])
    # Decision 341a-F: a source text is not uploaded here.
    assert refusal(env, "source").code == "NOT_A_TRANSLATION"
    assert refusal(env, "missing").code == "DOCUMENT_NOT_FOUND"
    assert refusal(env, expected_text_sha256="0" * 64).code == "VARIANT_REVIEW_STALE"
    assert refusal(env, text=" \n ").code == "TEXT_EMPTY"
    # The same text (also with other line ends) is no new version.
    assert refusal(env, text="Übersetzt\r\n").details == {"reason": "unchanged"}
    assert audits(env, "translation.version_uploaded") == []
    upload(env)
    assert refusal(env).details == {"reason": "not_newest"}
    with env.db.transaction() as conn:
        conn.execute(
            insert(DiscardedVariantRow).values(
                project_id=env.pid,
                document_id="comparison",
                reason="Wrong text",
                discarded_by=env.accesses["leader"].user_id,
            )
        )
    assert refusal(env, "comparison").details == {"reason": "discarded"}
    assert len(audits(env, "translation.version_uploaded")) == 1


def test_an_open_lead_correction_refuses_the_upload(unreviewed):
    env = unreviewed
    accept(env)
    workflow(env).start_lead_correction(
        lead(env),
        "proj",
        "target",
        expected_text_sha256=target_hash(env),
        confirm_language=True,
    )
    assert refusal(env).details == {"reason": "review_open"}


def test_upload_after_a_rejection_and_onto_an_earlier_upload(review_env):
    """Follow-up versions stay corrections of the exact preceding version."""
    env = review_env
    AssignmentService(env.db).revoke(HARNESS, env.ids["bob"])
    decide(env, "rejected")
    first = upload(env)
    second = upload(env, first["document_id"], text="Noch einmal übersetzt.")
    child = env.app.state.repo.get_variant("proj", second["document_id"])
    assert (child.origin, child.derived_from, child.version) == (
        "correction",
        first["document_id"],
        3,
    )
    # The parallel translation of the row is untouched.
    assert env.app.state.repo.get_variant("proj", "comparison").version == 1


def test_preview_lists_the_work_and_compares_the_text(accepted):
    """Decisions 341a-B and 341a-E: the stored text, the previous text and
    the work that stays on the version, before anything is saved."""
    env = accepted
    preview = service(env).preview(lead(env), "proj", "target")
    assert preview == {
        "document_id": "target",
        "case_id": "case",
        "language": "de",
        "version": 1,
        "next_version": 2,
        "translation_status": "accepted",
        "text_sha256": target_hash(env),
        "available": True,
        "reason": None,
        "review_on": flags_of(env, "case", "de").review,
        "annotate_accepted_only": True,
        "annotations": {"submitted": 1, "open": 1},
        "open_consolidations": 0,
        "final_result": False,
        "text": None,
        "previous_text": None,
        "unchanged": None,
    }
    checked = service(env).preview(lead(env), "proj", "target", text=NEW + "\r\n")
    assert (checked["text"], checked["previous_text"]) == (NEW, "Übersetzt")
    assert (checked["available"], checked["unchanged"]) == (True, False)
    same = service(env).preview(lead(env), "proj", "target", text="Übersetzt\n")
    assert (same["available"], same["reason"], same["unchanged"]) == (
        False,
        "unchanged",
        True,
    )
    with pytest.raises(DomainError, match="TEXT_EMPTY"):
        service(env).preview(lead(env), "proj", "target", text="  ")
    # The preview writes nothing.
    assert audits(env, "translation.version_uploaded") == []
    assert env.app.state.repo.get_variant("proj", "target").version == 1


def test_preview_names_the_refusal(review_env):
    env = review_env
    preview = service(env).preview(lead(env), "proj", "target", text=NEW)
    assert (preview["available"], preview["reason"]) == (False, "review_open")


def test_routes_for_the_lead_only_and_the_row_shows_the_upload(unreviewed):
    env = unreviewed
    body = {
        "text": NEW,
        "expected_text_sha256": target_hash(env),
        "method": "machine_translation",
        "provider": "DeepL",
        "model": "deepl-2026-10",
        "made_on": "2026-11-12",
        "made_by": "Dr. Roe",
        "note": "Checked against the source",
    }
    path = f"{BASE}/variants/target/versions"
    alice = logged_in(env.app, "alice")
    assert alice.post(path, json=body).status_code == 403
    assert alice.post(f"{path}/preview", json={}).status_code == 403
    client = logged_in(env.app, "leader")
    preview = client.post(f"{path}/preview", json={"text": NEW})
    assert preview.status_code == 200, preview.text
    assert preview.json()["available"] is True
    assert preview.json()["previous_text"] == "Übersetzt"
    # A machine translation names its provider.
    missing = client.post(path, json=body | {"provider": "  "})
    assert missing.status_code == 422, missing.text
    unknown = client.post(path, json=body | {"method": "correction"})
    assert unknown.status_code == 422, unknown.text
    response = client.post(path, json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert (saved["version"], saved["translation_status"]) == (2, "ready_for_review")
    again = client.post(path, json=body)
    assert again.status_code == 409, again.text
    assert again.json() == {
        "code": "VERSION_UPLOAD_NOT_AVAILABLE",
        "details": {"reason": "not_newest"},
    }
    page = client.post(
        f"{BASE}/document-rows/selected",
        json={"rows": [{"case_id": "case", "language": "de"}]},
    )
    assert page.status_code == 200, page.text
    (row,) = [r for g in page.json()["groups"] for r in g["rows"]]
    versions = {v["document_id"]: v for v in row["versions"]}
    record = versions[saved["document_id"]]["upload"]
    assert record["uploaded_by"]["is_me"] is True
    assert record["uploaded_at"]
    assert {k: record[k] for k in body if k in record} == {
        "method": "machine_translation",
        "provider": "DeepL",
        "model": "deepl-2026-10",
        "made_on": "2026-11-12",
        "made_by": "Dr. Roe",
        "note": "Checked against the source",
    }
    assert versions["target"].get("upload") is None
    assert versions[saved["document_id"]]["is_newest_in_chain"] is True


def test_a_project_token_uploads_a_version(unreviewed):
    """Decision 341a-H: ``project-admin`` opens both routes for the MCP tool."""
    env = unreviewed
    session = logged_in(env.app, "leader")
    tokens = {}
    for name, scopes in (("read", ["read"]), ("admin", ["read", "project-admin"])):
        created = session.post(
            f"{BASE}/tokens", json={"name": "pipeline", "scopes": scopes}
        )
        assert created.status_code == 201, created.text
        secret = created.json()["secret"]
        tokens[name] = TestClient(
            env.app, headers={"Authorization": f"Bearer {secret}", **ORIGIN}
        )
    path = f"{BASE}/variants/target/versions"
    body = {
        "text": NEW,
        "expected_text_sha256": target_hash(env),
        "method": "human_translation",
    }
    for route, sent in ((path, body), (f"{path}/preview", {"text": NEW})):
        refused = tokens["read"].post(route, json=sent)
        assert refused.status_code == 403, refused.text
        assert refused.json()["code"] == "TOKEN_SCOPE_MISSING"
    assert tokens["admin"].post(f"{path}/preview", json={}).status_code == 200
    saved = tokens["admin"].post(path, json=body)
    assert saved.status_code == 200, saved.text
    (audit,) = audits(env, "translation.version_uploaded")
    token_id = tokens["admin"].get("/api/v1/me/token").json()["id"]
    assert audit["api_token"]["id"] == token_id
