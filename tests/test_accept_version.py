"""Accept exactly one translation version as reviewed outside (issue 341 d)."""

from typing import Any

import pytest
from auth_harness import HARNESS, logged_in
from sqlalchemy import insert, select
from test_translation_review_service import review_env as review_env

from ontotator.application.work_plans import WorkPlanService
from ontotator.assignments.service import AssignmentService
from ontotator.auth.audit import Actor
from ontotator.domain.errors import DomainError
from ontotator.storage import work_plan_store as store
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.tables import AuditEventRow

BASE = "/api/v1/projects/proj"


def sha(env: Any, document_id: str = "target") -> str:
    return env.app.state.repo.get_variant("proj", document_id).text_sha256


def status(env: Any, document_id: str) -> str | None:
    return env.app.state.repo.get_variant("proj", document_id).translation_status


def accept(env: Any, document_id: str = "target", reason: str = "Checked") -> Any:
    service = WorkPlanService(
        env.db,
        Actor.user(env.accesses["leader"].user_id, "leader"),
        env.accesses["leader"],
    )
    return service.accept_version("proj", document_id, reason, sha(env, document_id))


@pytest.fixture
def unreviewed(review_env):
    """``target`` and its parallel root ``comparison``, no open review."""
    for name in ("alice", "bob"):
        AssignmentService(review_env.db).revoke(HARNESS, review_env.ids[name])
    return review_env


def test_accepts_only_this_version_with_the_acceptance_record(unreviewed):
    env = unreviewed
    before = status(env, "target")
    result = accept(env, reason="  Checked against the DeepL output  ")
    assert result == {
        "case_id": "case",
        "language": "de",
        "document_id": "target",
        "version": 1,
        "translation_status": "accepted",
    }
    assert status(env, "target") == "accepted"
    # The parallel translation of the row stays as it was.
    assert status(env, "comparison") != "accepted"
    with env.db.transaction() as conn:
        record = store.acceptances(conn, env.pid)["target"]
        (details,) = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "translation.accept_external_review"
            )
        ).scalars()
    assert record["source"] == "lead"
    assert record["reason"] == "Checked against the DeepL output"
    assert record["accepted_by"] == env.accesses["leader"].user_id
    assert details == {
        "document_id": "target",
        "case_id": "case",
        "language": "de",
        "from": before,
        "to": "accepted",
        "reason": "Checked against the DeepL output",
        "scope": "version",
    }


def test_reason_is_required(unreviewed):
    with pytest.raises(DomainError, match="OVERRIDE_REASON_REQUIRED"):
        accept(unreviewed, reason="  ")


def test_stale_text_is_refused(unreviewed):
    env = unreviewed
    service = WorkPlanService(
        env.db,
        Actor.user(env.accesses["leader"].user_id, "leader"),
        env.accesses["leader"],
    )
    with pytest.raises(DomainError, match="VARIANT_REVIEW_STALE"):
        service.accept_version("proj", "target", "Checked", "0" * 64)


def test_refusals(review_env):
    env = review_env
    # Alice's and Bob's reviews of the version are open.
    with pytest.raises(DomainError) as caught:
        accept(env)
    assert caught.value.code == "VERSION_NOT_ACCEPTABLE"
    assert caught.value.details == {"reason": "review_open"}
    for name in ("alice", "bob"):
        AssignmentService(env.db).revoke(HARNESS, env.ids[name])
    accept(env)
    with pytest.raises(DomainError) as caught:
        accept(env)
    assert caught.value.details == {"reason": "accepted"}
    with pytest.raises(DomainError) as caught:
        accept(env, "source")
    assert caught.value.code == "NOT_A_TRANSLATION"
    with env.db.transaction() as conn:
        conn.execute(
            insert(DiscardedVariantRow).values(
                project_id=env.pid,
                document_id="comparison",
                reason="Wrong text",
                discarded_by=env.accesses["leader"].user_id,
            )
        )
    with pytest.raises(DomainError) as caught:
        accept(env, "comparison")
    assert caught.value.details == {"reason": "discarded"}


def test_route_accepts_for_the_lead_only(unreviewed):
    env = unreviewed
    body = {"reason": "Checked", "expected_text_sha256": sha(env)}
    refused = logged_in(env.app, "alice").post(
        f"{BASE}/variants/target/accept", json=body
    )
    assert refused.status_code == 403, refused.text
    response = logged_in(env.app, "leader").post(
        f"{BASE}/variants/target/accept", json=body
    )
    assert response.status_code == 200, response.text
    assert response.json()["translation_status"] == "accepted"
    again = logged_in(env.app, "leader").post(
        f"{BASE}/variants/target/accept", json=body
    )
    assert again.status_code == 409, again.text
    assert again.json() == {
        "code": "VERSION_NOT_ACCEPTABLE",
        "details": {"reason": "accepted"},
    }
    # The row reads the acceptance like the work plan's (Text versions).
    page = logged_in(env.app, "leader").post(
        f"{BASE}/document-rows/selected",
        json={"rows": [{"case_id": "case", "language": "de"}]},
    )
    assert page.status_code == 200, page.text
    (row,) = [r for g in page.json()["groups"] for r in g["rows"]]
    versions = {v["document_id"]: v for v in row["versions"]}
    assert versions["target"]["acceptance"]["source"] == "lead"
    assert versions["target"]["acceptance"]["reason"] == "Checked"
    assert versions["comparison"].get("acceptance") is None


def _review(env: Any, name: str, decision: str, text: str) -> Any:
    access = env.accesses[name]
    opened = env.service.open(access, env.ids[name])
    clinical = decision in ("rejected", "query")
    form: dict[str, Any] = {"decision": decision, "clinical_change": clinical}
    if clinical:
        form |= {"categories": ["omission"], "rationale": "Missing"}
    revision = env.service.save_draft(
        access,
        env.ids[name],
        expected_revision=opened.draft.revision,
        text=text,
        form=form,
    )
    return env.service.submit(access, env.ids[name], expected_revision=revision)


def test_refuses_an_older_version(review_env):
    env = review_env
    AssignmentService(env.db).revoke(HARNESS, env.ids["bob"])
    record = _review(env, "alice", "accepted_corrected", "Korrigiert")
    # v1 was corrected into v2: an older version.
    with pytest.raises(DomainError) as caught:
        accept(env)
    assert caught.value.details == {"reason": "not_newest"}
    with pytest.raises(DomainError) as caught:
        accept(env, record.created_variant_id)
    assert caught.value.details == {"reason": "accepted"}


def test_refuses_a_rejected_version_and_previews_the_refusal(review_env):
    env = review_env
    AssignmentService(env.db).revoke(HARNESS, env.ids["bob"])
    _review(env, "alice", "rejected", "Übersetzt")
    with pytest.raises(DomainError) as caught:
        accept(env)
    assert caught.value.code == "VERSION_NOT_ACCEPTABLE"
    assert caught.value.details == {"reason": "reviewed"}
    client = logged_in(env.app, "leader")
    preview = client.get(f"{BASE}/variants/target/accept")
    assert preview.status_code == 200, preview.text
    assert preview.json() == {
        "case_id": "case",
        "language": "de",
        "document_id": "target",
        "version": 1,
        "translation_status": "reviewed",
        "acceptable": False,
        "reason": "reviewed",
        "text_sha256": sha(env),
    }
    other = client.get(f"{BASE}/variants/comparison/accept").json()
    assert (other["acceptable"], other["reason"]) == (True, None)
    assert other["text_sha256"] == sha(env, "comparison")
    # The preview writes nothing.
    assert status(env, "comparison") != "accepted"
    refused = logged_in(env.app, "alice").get(f"{BASE}/variants/target/accept")
    assert refused.status_code == 403
