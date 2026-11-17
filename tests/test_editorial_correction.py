"""Editorial correction of a translation version by a lead (issue 453)."""

from typing import Any

import pytest
from auth_harness import HARNESS, ORIGIN, logged_in
from fastapi.testclient import TestClient
from sqlalchemy import insert, select
from test_accept_version import accept
from test_lead_correction import accepted as accepted
from test_lead_correction import audits, decide, lead, target_hash
from test_translation_review_service import review_env as review_env
from test_version_upload import unreviewed as unreviewed
from work_plan_support import flags_of, write

from ontotator.application import editorial_corrections as module
from ontotator.application.editorial_corrections import (
    EditorialCorrectionService,
    apply_replacements,
    changed_characters_limit,
    changes,
    digit_sequence,
)
from ontotator.assignments.service import AssignmentService
from ontotator.auth.audit import Actor
from ontotator.domain.errors import AccessDenied, DomainError
from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.exchange.reanchor_job import ReanchorPayload
from ontotator.storage.plan_tables import DiscardedVariantRow, EditorialCorrectionRow
from ontotator.storage.tables import AssignmentRow, DocumentRow, JobRow

BASE = "/api/v1/projects/proj"
PATH = f"{BASE}/documents/target/editorial-correction"
# The fixture's translation is "Übersetzt".
FIXED = "Übersetzt."
REASON = "Full stop at the end of the sentence was missing"
CODE = "EDITORIAL_CORRECTION_NOT_AVAILABLE"


def service(env: Any) -> EditorialCorrectionService:
    return EditorialCorrectionService(env.db, env.app.state.jobs)


def correct(env: Any, document_id: str = "target", **kwargs: Any) -> dict[str, Any]:
    if "replacements" not in kwargs:
        kwargs.setdefault("text", FIXED)
    kwargs.setdefault("expected_text_sha256", target_hash(env, document_id))
    kwargs.setdefault("reason", REASON)
    return service(env).correct(lead(env), "proj", document_id, **kwargs)


def refusal(env: Any, document_id: str = "target", **kwargs: Any) -> DomainError:
    with pytest.raises(DomainError) as caught:
        correct(env, document_id, **kwargs)
    return caught.value


def status(env: Any, document_id: str) -> str | None:
    return env.app.state.repo.get_variant("proj", document_id).translation_status


# --- the guards, pure ------------------------------------------------------------- #


def test_the_size_cap_is_five_percent_between_20_and_200_characters():
    assert (
        module.MAX_CHANGED_CHARACTERS,
        module.MAX_CHANGED_SHARE,
        module.MIN_CHANGED_CHARACTERS_LIMIT,
    ) == (200, 0.05, 20)
    # Never less than 20, 5 % of the text in between, at most 200.
    assert [changed_characters_limit(n) for n in (0, 9, 400, 401, 1000, 3999)] == [
        20,
        20,
        20,
        20,
        50,
        199,
    ]
    assert [changed_characters_limit(n) for n in (4000, 4020, 100_000)] == [200] * 3


def test_changes_count_inserted_and_deleted_characters_by_the_text_diff():
    old = "Der Pat ient hat  Fieber"
    new = "Der Patient hat Fieber."
    found = changes(old, new)
    assert [(c.old_text, c.new_text) for c in found] == [
        (" ", ""),
        (" ", ""),
        ("", "."),
    ]
    assert found[0].old_start == 7 and found[-1].new_start == len(new) - 1
    assert changes(old, old) == []


def test_digits_are_compared_as_one_sequence():
    assert digit_sequence("38,2 °C am 3.11., 5 mg/m²") == "3823115²"
    # Moving a space around a number keeps the sequence; a changed dose not.
    assert digit_sequence("5mg") == digit_sequence("5 mg")
    assert digit_sequence("15 mg") != digit_sequence("50 mg")


def test_replacements_apply_once_each_and_do_not_overlap():
    text = "Die Pat ientin hat Feiber. Die Mutter hat Feiber nicht."
    assert (
        apply_replacements(
            text,
            [
                {"old": "hat Feiber.", "new": "hat Fieber."},
                {"old": "Pat ientin", "new": "Patientin"},
            ],
        )
        == "Die Patientin hat Fieber. Die Mutter hat Feiber nicht."
    )
    for replacements, reason, index in (
        ([{"old": "Feiber", "new": "Fieber"}], "replacement_ambiguous", 0),
        ([{"old": "Husten", "new": "Hüsteln"}], "replacement_not_found", 0),
        (
            [
                {"old": "Pat ientin", "new": "Patientin"},
                {"old": "ientin hat", "new": "x"},
            ],
            "replacements_overlap",
            1,
        ),
    ):
        with pytest.raises(DomainError) as caught:
            apply_replacements(text, replacements)
        assert caught.value.code == CODE
        assert caught.value.details == {"reason": reason, "index": index}
    # Overlapping occurrences of one passage are ambiguous too.
    with pytest.raises(DomainError) as caught:
        apply_replacements("aaa", [{"old": "aa", "new": "a"}])
    assert caught.value.details == {"reason": "replacement_ambiguous", "index": 0}


# --- the correction ----------------------------------------------------------------- #


def test_an_accepted_text_stays_accepted_without_a_review(accepted):
    """The new version inherits the status; the corrected version keeps its
    own (as after a lead correction or an upload); Review is not turned on."""
    env = accepted
    write(env, {RowKey("case", "de"): PlanFlags(False, True)})
    result = correct(env)
    child = env.app.state.repo.get_variant("proj", result["document_id"])
    assert result == {
        "case_id": "case",
        "language": "de",
        "document_id": child.document_id,
        "version": 2,
        "previous_document_id": "target",
        "previous_version": 1,
        "translation_status": "accepted",
        "text_sha256": child.text_sha256,
        "inserted_characters": 1,
        "deleted_characters": 0,
        "tasks_following": 1,
    }
    assert (child.origin, child.derived_from, child.version, child.translation) == (
        "correction",
        "target",
        2,
        None,
    )
    assert (status(env, child.document_id), status(env, "target")) == (
        "accepted",
        "accepted",
    )
    assert child.status_reason == "editorial correction"
    assert flags_of(env, "case", "de").review is False
    with env.db.transaction() as conn:
        text = conn.execute(
            select(DocumentRow.text).where(DocumentRow.document_id == child.document_id)
        ).scalar_one()
        record = conn.execute(select(EditorialCorrectionRow)).mappings().one()
        annotations = conn.execute(
            select(AssignmentRow.document_id, AssignmentRow.status).where(
                AssignmentRow.task == "annotate", AssignmentRow.revoked_at.is_(None)
            )
        ).all()
        (job,) = conn.execute(
            select(JobRow.payload).where(JobRow.kind == "reanchor")
        ).scalars()
    assert text == FIXED
    assert {
        key: record[key]
        for key in (
            "document_id",
            "previous_document_id",
            "reason",
            "inserted_characters",
            "deleted_characters",
            "corrected_by",
        )
    } == {
        "document_id": child.document_id,
        "previous_document_id": "target",
        "reason": REASON,
        "inserted_characters": 1,
        "deleted_characters": 0,
        "corrected_by": env.accesses["leader"].user_id,
    }
    # The task nobody opened follows; the submitted annotation stays.
    assert sorted(annotations) == [
        ("target", "submitted"),
        (child.document_id, "open"),
    ]
    payload = ReanchorPayload.model_validate(
        {k: v for k, v in job.items() if k != "api_token"}
    )
    assert (payload.old_document_id, payload.new_document_id) == (
        "target",
        child.document_id,
    )
    assert payload.producer.kind == "editorial_correction"
    assert payload.producer.correction_id == record["id"]
    # Who (the audit's actor), what and why.
    (audit,) = audits(env, "translation.editorial_correction")
    assert audit == {
        "document_id": child.document_id,
        "previous_document_id": "target",
        "case_id": "case",
        "language": "de",
        "version": 2,
        "translation_status": "accepted",
        "text_sha256": child.text_sha256,
        "previous_text_sha256": target_hash(env),
        "correction_id": record["id"],
        "reason": REASON,
        "inserted_characters": 1,
        "deleted_characters": 0,
        "diff": [
            {
                "old_start": 9,
                "old_end": 9,
                "new_start": 9,
                "new_end": 10,
                "old_text": "",
                "new_text": ".",
            }
        ],
        "tasks_following": 1,
    }
    (moved,) = audits(env, "assignment.follow_correction")
    assert moved == {"from_document_id": "target", "to": child.document_id}


def test_an_unreviewed_text_stays_ready_for_review(unreviewed):
    env = unreviewed
    before = status(env, "target")
    assert before != "accepted"
    result = correct(env, replacements=[{"old": "Übersetzt", "new": "Übersetzt."}])
    assert result["translation_status"] == before
    assert status(env, result["document_id"]) == before
    # It is reviewed and accepted like any newest version.
    accept(env, result["document_id"], "Reviewed by Dr. Roe against the source")
    assert status(env, result["document_id"]) == "accepted"


def test_the_reanchor_job_of_an_editorial_correction_runs(accepted):
    env = accepted
    correct(env)
    jobs = env.app.state.jobs
    with env.db.transaction() as conn:
        (job_id,) = conn.execute(
            select(JobRow.id).where(JobRow.kind == "reanchor")
        ).scalars()
    finished = jobs.run(jobs.claim(job_id, "editorial-test"), "editorial-test")
    assert finished.status == "succeeded", finished.error


def test_the_reanchor_job_checks_the_correction_it_names(accepted):
    """The authority check: the job's pair and requester are the record's."""
    from ontotator.exchange.reanchor_job import enqueue_editorial_pair

    env = accepted
    result = correct(env)
    jobs = env.app.state.jobs
    with env.db.transaction() as conn:
        correction_id = conn.execute(select(EditorialCorrectionRow.id)).scalar_one()
    other = Actor.user(env.accesses["alice"].user_id, "alice")
    for actor, correction in ((other, correction_id), (lead(env), correction_id + 1)):
        job_id = enqueue_editorial_pair(
            jobs, "proj", env.pid, "target", result["document_id"], correction, actor
        )
        finished = jobs.run(jobs.claim(job_id, "editorial-test"), "editorial-test")
        assert finished.status == "failed"
        assert "REANCHOR_PRODUCER_INVALID" in str(finished.error)


def test_preconditions(review_env):
    env = review_env
    error = refusal(env)
    assert (error.code, error.details) == (CODE, {"reason": "review_open"})
    for name in ("alice", "bob"):
        AssignmentService(env.db).revoke(HARNESS, env.ids[name])
    # Translations only; the hash names the corrected text.
    assert refusal(env, "source", text="Source text.").code == "NOT_A_TRANSLATION"
    assert refusal(env, "missing").code == "DOCUMENT_NOT_FOUND"
    assert refusal(env, expected_text_sha256="0" * 64).code == "VARIANT_REVIEW_STALE"
    assert refusal(env, text=" \n ").code == "TEXT_EMPTY"
    assert refusal(env, reason="  ").details == {"reason": "reason_required"}
    assert refusal(env, text="Übersetzt").details == {"reason": "unchanged"}
    assert audits(env, "translation.editorial_correction") == []
    first = correct(env)
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
    assert refusal(env, "comparison", text="Alternative.").details == {
        "reason": "discarded"
    }
    # A correction of a correction stays a correction of the exact version.
    second = correct(env, first["document_id"], text="Übersetzt!")
    child = env.app.state.repo.get_variant("proj", second["document_id"])
    assert (child.derived_from, child.version) == (first["document_id"], 3)
    assert len(audits(env, "translation.editorial_correction")) == 2


def test_only_a_lead_corrects(accepted):
    env = accepted
    for name in ("alice", "root"):  # an annotator; a system admin without the role
        actor = Actor.user(env.accesses[name].user_id, name)
        with pytest.raises(AccessDenied):
            service(env).correct(
                actor,
                "proj",
                "target",
                text=FIXED,
                expected_text_sha256=target_hash(env),
                reason=REASON,
            )
        with pytest.raises(AccessDenied):
            service(env).preview(actor, "proj", "target")


def test_a_rejected_version_is_not_corrected_editorially(review_env):
    """Its text is decided in a translation review or a lead correction."""
    env = review_env
    AssignmentService(env.db).revoke(HARNESS, env.ids["bob"])
    decide(env, "rejected")
    assert refusal(env).details == {"reason": "rejected_or_queried"}


def test_content_guards(accepted):
    env = accepted
    with env.db.transaction() as conn:
        # A longer text with numbers: 400 characters, so the cap is 20.
        long = ("Temperatur 38,2 °C, Puls 96/min. " * 13)[:400]
        import hashlib

        from sqlalchemy import update

        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == "target")
            .values(text=long, text_sha256=hashlib.sha256(long.encode()).hexdigest())
        )
    assert changed_characters_limit(len(long)) == 20
    # A changed number, also when the count of digits stays the same.
    assert refusal(env, text=long.replace("38,2", "39,2", 1)).details == {
        "reason": "digits_changed"
    }
    assert refusal(env, text=long.replace("96/min", "69/min", 1)).details == {
        "reason": "digits_changed"
    }
    # 21 changed characters: one more than the cap.
    assert refusal(env, text=long + " " + "x" * 20).details == {
        "reason": "too_large",
        "changed_characters": 21,
        "changed_characters_limit": 20,
    }
    assert audits(env, "translation.editorial_correction") == []
    # Spacing around a number is editorial: the digits stay in order.
    result = correct(env, text=long.replace("38,2 °C", "38,2°C", 1) + " " + "x" * 18)
    assert (result["inserted_characters"], result["deleted_characters"]) == (19, 1)


def test_preview_is_a_dry_run_with_the_diff_and_the_consequences(accepted):
    env = accepted
    plain = service(env).preview(lead(env), "proj", "target")
    assert plain == {
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
        "tasks_following": 1,
        "changed_characters_limit": 20,
        "text": None,
        "previous_text": None,
        "new_text_sha256": None,
        "inserted_characters": None,
        "deleted_characters": None,
        "changed_characters": None,
        "digits_changed": None,
        "diff": None,
        "findings": None,
        "proposals": None,
    }
    checked = service(env).preview(
        lead(env), "proj", "target", replacements=[{"old": "setzt", "new": "setzt."}]
    )
    assert (checked["text"], checked["previous_text"]) == (FIXED, "Übersetzt")
    assert (checked["available"], checked["changed_characters"]) == (True, 1)
    assert checked["diff"] == [
        {
            "old_start": 9,
            "old_end": 9,
            "new_start": 9,
            "new_end": 10,
            "old_text": "",
            "new_text": ".",
        }
    ]
    # The fixture's annotations are bare task rows: nothing to place.
    assert checked["findings"] == {"submitted": 0, "needs_check": 0}
    assert checked["proposals"] == {"sets": 0, "carried": 0, "needs_check": 0}
    for text, reason in (
        ("Übersetzt", "unchanged"),
        ("Übersetzt 2", "digits_changed"),
        ("Übersetzt und noch viel mehr dazu", "too_large"),
    ):
        refused = service(env).preview(lead(env), "proj", "target", text=text)
        assert (refused["available"], refused["reason"]) == (False, reason)
    with pytest.raises(DomainError) as caught:
        service(env).preview(
            lead(env), "proj", "target", replacements=[{"old": "x", "new": "y"}]
        )
    assert caught.value.details == {"reason": "replacement_not_found", "index": 0}
    # The preview writes nothing.
    assert audits(env, "translation.editorial_correction") == []
    assert env.app.state.repo.get_variant("proj", "target").version == 1


def test_routes_for_the_lead_only_and_the_row_shows_the_correction(accepted):
    env = accepted
    body = {
        "text": FIXED,
        "expected_text_sha256": target_hash(env),
        "reason": REASON,
    }
    alice = logged_in(env.app, "alice")
    assert alice.post(PATH, json=body).status_code == 403
    assert alice.post(f"{PATH}/preview", json={}).status_code == 403
    client = logged_in(env.app, "leader")
    preview = client.post(f"{PATH}/preview", json={"text": FIXED})
    assert preview.status_code == 200, preview.text
    assert preview.json()["available"] is True
    assert preview.json()["diff"][0]["new_text"] == "."
    # The reason is required; the text or the replacements, not both.
    for wrong in (
        {k: v for k, v in body.items() if k != "reason"},
        body | {"reason": "   "},
        body | {"replacements": [{"old": "a", "new": "b"}]},
        {k: v for k, v in body.items() if k != "text"},
        {k: v for k, v in body.items() if k != "text"}
        | {"replacements": [{"old": "", "new": "b"}]},
    ):
        assert client.post(PATH, json=wrong).status_code == 422, wrong
    large = client.post(
        PATH, json=body | {"text": "Übersetzt, aber ganz anders als es war"}
    )
    assert large.status_code == 409, large.text
    assert large.json()["code"] == CODE
    assert large.json()["details"]["reason"] == "too_large"
    response = client.post(PATH, json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert (saved["version"], saved["translation_status"]) == (2, "accepted")
    again = client.post(PATH, json=body)
    assert again.status_code == 409, again.text
    assert again.json() == {"code": CODE, "details": {"reason": "not_newest"}}
    page = client.post(
        f"{BASE}/document-rows/selected",
        json={"rows": [{"case_id": "case", "language": "de"}]},
    )
    assert page.status_code == 200, page.text
    (row,) = [r for g in page.json()["groups"] for r in g["rows"]]
    versions = {v["document_id"]: v for v in row["versions"]}
    record = versions[saved["document_id"]]["editorial_correction"]
    assert record["corrected_by"]["is_me"] is True
    assert record["corrected_at"]
    assert {k: v for k, v in record.items() if not k.startswith("corrected_")} == {
        "reason": REASON,
        "previous_document_id": "target",
        "inserted_characters": 1,
        "deleted_characters": 0,
    }
    assert versions["target"].get("editorial_correction") is None
    assert versions[saved["document_id"]]["translation_status"] == "accepted"
    assert versions[saved["document_id"]]["is_newest_in_chain"] is True


def test_a_project_token_corrects_with_replacements(accepted):
    """``project-admin`` opens both routes for the MCP tool."""
    env = accepted
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
    replacements = [{"old": "setzt", "new": "setzt."}]
    body = {
        "replacements": replacements,
        "expected_text_sha256": target_hash(env),
        "reason": REASON,
    }
    for route, sent in (
        (PATH, body),
        (f"{PATH}/preview", {"replacements": replacements}),
    ):
        refused = tokens["read"].post(route, json=sent)
        assert refused.status_code == 403, refused.text
        assert refused.json()["code"] == "TOKEN_SCOPE_MISSING"
    dry = tokens["admin"].post(f"{PATH}/preview", json={"replacements": replacements})
    assert dry.status_code == 200, dry.text
    assert dry.json()["text_sha256"] == body["expected_text_sha256"]
    saved = tokens["admin"].post(PATH, json=body)
    assert saved.status_code == 200, saved.text
    (audit,) = audits(env, "translation.editorial_correction")
    token_id = tokens["admin"].get("/api/v1/me/token").json()["id"]
    assert audit["api_token"]["id"] == token_id
    assert audit["reason"] == REASON
