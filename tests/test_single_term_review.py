"""Single-term review (#381): setting, basis, batches, decisions, carry-over,
access, idempotency, purge and archive.

Every text, phrase and finding below is invented for the tests.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from auth_harness import add_ontology, logged_in
from fastapi.testclient import TestClient
from pg_harness import owner_engine
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from t1_builders import bundle, native_unit
from t1_fixtures import HP_PATH, create_project
from t1_fixtures import run_import as import_bundle
from test_auth_api import _app
from work_plan_support import plan_all

from ontotator.auth.audit import Actor
from ontotator.domain.annotations import ActorRef, Annotation, Provenance, snapshot
from ontotator.domain.documents import (
    EvidenceMention,
    EvidenceRef,
    Segment,
    snapshot_evidence,
)
from ontotator.domain.errors import DomainError
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.workspace import Submission, WorkspaceKey
from ontotator.exchange.single_terms import group_id
from ontotator.projects.service import ProjectService, ProjectSettingsChange
from ontotator.storage.repository import _key_str
from ontotator.storage.single_term_tables import (
    SingleTermBasisRow,
    SingleTermBatchRow,
    SingleTermBatchStateRow,
    SingleTermDecisionRow,
)
from ontotator.storage.tables import AuditEventRow, ProjectRow
from ontotator.storage.work_purge import purge
from ontotator.storage.workflow_tables import WorkflowCommandReceiptRow

BASE = "/api/v1/projects/proj"
ST = f"{BASE}/single-terms"
S = "ontotator"
DOC1, DOC2, DOC3 = "ST-1", "ST-2", "ST-3"
TEXTS = {
    DOC1: "Seit dem Sommer Krampfanfälle und Hypotonie. Keine Areflexie. Hörminderung links.",
    DOC2: "Erneut Krampfanfälle in der Nacht. Hypotonie der Rumpfmuskulatur.",
    DOC3: "Bekannte Krampfanfälle seit Jahren.",
}
SEIZURE, STATUS, HYPOTONIA, AREFLEXIA = (
    "HP:0001250",
    "HP:0002133",
    "HP:0001252",
    "HP:0001284",
)
HEARING, SENSORINEURAL = "HP:0000365", "HP:0000407"
FINDINGS: dict[str, list[tuple[str, str, str]]] = {
    DOC1: [
        ("a1", "Krampfanfälle", SEIZURE),
        ("a2", "Hypotonie", HYPOTONIA),
        ("a3", "Keine Areflexie", AREFLEXIA),
        ("a4", "Hörminderung", SENSORINEURAL),
    ],
    # Hypotonia mapped to another term: a phrase conflict.
    DOC2: [("b1", "Krampfanfälle", SEIZURE), ("b2", "Hypotonie", AREFLEXIA)],
    DOC3: [("c1", "Krampfanfälle", SEIZURE)],
}
G_SEIZURE = group_id("de", "krampfanfälle", SEIZURE)
G_HYPOTONIA = group_id("de", "hypotonie", HYPOTONIA)
G_HYPO_WRONG = group_id("de", "hypotonie", AREFLEXIA)
G_NEGATED = group_id("de", "keine areflexie", AREFLEXIA)
G_HEARING = group_id("de", "hörminderung", SENSORINEURAL)


def _finding(document, annotation_id, word, term):
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
        _profile(),
    )


def _profile():
    from t1_fixtures import hpo_profile

    return hpo_profile()


def _submit(env, document_id: str, submission_id: str, revision: int = 1) -> None:
    """A final result of alice on the text, as an inserted submission."""
    app = env.app
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
        draft_revision=revision,
        snapshots=[
            _finding(document, aid, word, term)
            for aid, word, term in FINDINGS[document_id]
        ],
        decisions=[],
        created_at="2026-11-01T10:00:00Z",
    )
    with env.db.transaction() as conn:
        project_id = app.state.repo._require_project(conn, "proj")
        app.state.repo._insert_submission(
            conn, project_id, record, local_key=_key_str(key), imported=False
        )


def _select(env, document_id: str, submission_id: str, revision: int = 0) -> None:
    selected = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": document_id,
            "submission_id": submission_id,
            "expected_revision": revision,
        },
    )
    assert selected.status_code == 200, selected.text


@pytest.fixture
def env(tmp_path):
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    units = [native_unit(doc, "de", TEXTS[doc], annotations=[]) for doc in TEXTS]
    result = import_bundle(db, bundle(tmp_path, units))
    assert result.status == "succeeded", result.error
    plan_all(db, "proj")
    logged_in(app, "alice", projects={"proj": ["annotator"]}, assignments=[])
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    env = SimpleNamespace(app=app, db=db, lead=lead, tmp_path=tmp_path)
    for doc, sid in ((DOC1, "final-1"), (DOC2, "final-2")):
        _submit(env, doc, sid)
        _select(env, doc, sid)
    settings = lead.patch(
        f"{BASE}/settings",
        json={
            "single_term_review": True,
            "single_term_negation_cues": {"de": ["keine", " kein "]},
        },
    )
    assert settings.status_code == 200, settings.text
    env.rita = logged_in(app, "rita", projects={"proj": ["annotator"]}, assignments=[])
    env.sam = logged_in(app, "sam", projects={"proj": ["annotator"]}, assignments=[])
    env.otto = logged_in(app, "otto", projects={"proj": ["annotator"]}, assignments=[])
    for name in ("rita", "sam"):
        granted = lead.put(f"{ST}/reviewers/{name}")
        assert granted.status_code == 200, granted.text
    return env


def _basis(env, request_id: str = "basis-1") -> dict[str, Any]:
    started = env.lead.post(f"{ST}/basis", json={"request_id": request_id})
    assert started.status_code == 200, started.text
    return started.json()


def _batch(env, request_id: str = "batch-1", **extra) -> dict[str, Any]:
    created = env.lead.post(
        f"{ST}/batches", json={"request_id": request_id, "reviewer": "rita", **extra}
    )
    assert created.status_code == 200, created.text
    return created.json()


def _decide(client, batch_id, request_id, group, decision, **extra):
    body = {
        "request_id": request_id,
        "group_id": group,
        "decision": decision,
        **extra,
    }
    if decision != "withdrawn":
        body.setdefault("phrase_only", "would_accept")
    return client.post(f"{ST}/batches/{batch_id}/decisions", json=body)


def _groups(client, **params) -> dict[str, dict[str, Any]]:
    listed = client.get(f"{ST}/groups", params=params)
    assert listed.status_code == 200, listed.text
    return {item["group_id"]: item for item in listed.json()}


def _ref(client, batch_id: int, group: str, document_id: str) -> dict[str, Any]:
    contexts = client.get(
        f"{ST}/groups/{group}/contexts", params={"batch": batch_id, "limit": 50}
    )
    assert contexts.status_code == 200, contexts.text
    return next(
        c for c in contexts.json()["contexts"] if c["document_id"] == document_id
    )


# --- setting -----------------------------------------------------------------


def test_setting_and_cues_are_stored_normalised_and_audited(env):
    settings = env.lead.get(f"{BASE}/settings").json()
    assert settings["single_term_review"] is True
    assert settings["single_term_negation_cues"] == {"de": ["kein", "keine"]}
    with env.db.transaction() as conn:
        details = conn.execute(
            select(AuditEventRow.details)
            .where(AuditEventRow.action == "project.update")
            .order_by(AuditEventRow.id.desc())
            .limit(1)
        ).scalar_one()
    assert details["fields"] == ["single_term_negation_cues", "single_term_review"]
    refused = env.lead.patch(
        f"{BASE}/settings", json={"single_term_negation_cues": {"de": ["x" * 101]}}
    )
    assert refused.status_code == 422
    assert refused.json()["code"] == "NEGATION_CUES_INVALID"


def test_with_the_setting_off_every_route_refuses_and_data_stays(env):
    _basis(env)
    off = env.lead.patch(f"{BASE}/settings", json={"single_term_review": False})
    assert off.status_code == 200
    for response in (
        env.lead.get(f"{ST}/summary"),
        env.lead.get(f"{ST}/groups"),
        env.lead.post(f"{ST}/basis", json={"request_id": "b-off"}),
        env.lead.get(f"{ST}/reviewers"),
    ):
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "SINGLE_TERM_REVIEW_OFF"
    env.lead.patch(f"{BASE}/settings", json={"single_term_review": True})
    assert env.lead.get(f"{ST}/summary").json()["bases"] == 1


def test_a_practice_project_cannot_enable_the_review(env):
    from t1_fixtures import PIN, hpo_profile

    from ontotator.authz.policy import Access
    from ontotator.authz.scoped import ScopedRepository

    ScopedRepository(
        env.db, Access(user_id=0, pseudonym="op", is_system_admin=True), Actor.cli()
    ).create_project("drill", "Drill", None, hpo_profile(), {"hp": PIN}, practice=True)
    service = ProjectService(env.db, env.app.state.ontology_store)
    with pytest.raises(DomainError) as refused:
        service.update_settings(
            Actor(None, "cli:test"),
            "drill",
            ProjectSettingsChange.model_validate({"single_term_review": True}),
        )
    assert refused.value.code == "SINGLE_TERM_PRACTICE"


# --- basis and groups ----------------------------------------------------------


def test_the_basis_freezes_a_snapshot_and_derives_the_groups(env):
    basis = _basis(env)
    assert basis["report"]["groups"] == {"de": 5}
    assert basis["report"]["blocked_groups"]["negation_in_span"] == {"de": 1}
    # The same request returns the same basis.
    assert _basis(env)["basis_id"] == basis["basis_id"]
    groups = _groups(env.lead)
    assert set(groups) == {G_SEIZURE, G_HYPOTONIA, G_HYPO_WRONG, G_NEGATED, G_HEARING}
    assert groups[G_SEIZURE]["occurrences"] == 2
    assert groups[G_NEGATED]["state"] == "blocked"
    assert groups[G_HYPOTONIA]["conflict_with"] == [G_HYPO_WRONG]
    assert {g["state"] for g in groups.values()} == {"open", "blocked"}
    with env.db.transaction() as conn:
        row = conn.execute(select(SingleTermBasisRow)).mappings().one()
        purpose = conn.execute(
            text(
                f"SELECT payload->'request'->>'purpose' FROM {S}.export_selection_snapshots"
                " WHERE snapshot_id = :s"
            ),
            {"s": row["snapshot_id"]},
        ).scalar_one()
        audit = conn.execute(
            select(func.count())
            .select_from(AuditEventRow)
            .where(AuditEventRow.action == "project.single_term_basis")
        ).scalar_one()
    assert purpose == "single_term_basis"
    assert row["negation_cues"] == {"de": ["kein", "keine"]}
    assert audit == 1


def test_the_derivation_is_recomputed_from_the_basis_after_a_cache_loss(env):
    from ontotator.application import single_terms

    basis = _basis(env)
    before = _groups(env.lead)
    single_terms._derivations.clear()
    after = _groups(env.lead)
    assert after == before
    with env.db.transaction() as conn:
        stored = conn.execute(select(SingleTermBasisRow.derivation_sha256)).scalar_one()
    assert stored == basis["derivation_sha256"]


def test_contexts_show_the_text_around_each_occurrence(env):
    _basis(env)
    contexts = env.lead.get(f"{ST}/groups/{G_SEIZURE}/contexts", params={"limit": 1})
    assert contexts.status_code == 200, contexts.text
    body = contexts.json()
    assert body["total"] == 2 and len(body["contexts"]) == 1
    [first] = body["contexts"]
    assert first["text"] == "Krampfanfälle"
    assert first["before"] == "Seit dem Sommer "
    assert first["after"].startswith(" und Hypotonie.")
    assert "annotator" not in str(body) and "ann-" not in str(body)


# --- batches -------------------------------------------------------------------


def test_a_batch_freezes_open_groups_and_samples_a_second_review(env):
    _basis(env)
    batch = _batch(env, second_review={"reviewer": "sam", "share": 0.2})
    assert batch["groups"] == 5 and batch["role"] == "primary"
    assert batch["warnings"] == []
    [second_id] = batch["second_batch_ids"]
    second = env.lead.get(f"{ST}/batches/{second_id}").json()
    # Fewer than 50 groups per language: all of them.
    assert second["groups"] == 5 and second["role"] == "second"
    assert second["parent_batch_id"] == batch["batch_id"]
    # The groups are taken: another batch finds none.
    refused = env.lead.post(
        f"{ST}/batches", json={"request_id": "batch-2", "reviewer": "sam"}
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == "SINGLE_TERM_BATCH_EMPTY"


def test_batch_filters_and_reviewer_rules(env):
    _basis(env)
    only = _batch(env, document_ids=[DOC2], limit=1)
    assert only["groups"] == 1
    assert only["filter"]["document_ids"] == [DOC2]
    for body, code in (
        ({"reviewer": "otto"}, "SINGLE_TERM_NOT_A_REVIEWER"),
        (
            {"reviewer": "rita", "second_review": {"reviewer": "rita"}},
            "SINGLE_TERM_SAME_REVIEWER",
        ),
        ({"reviewer": "nobody"}, "USER_NOT_FOUND"),
    ):
        refused = env.lead.post(
            f"{ST}/batches", json={"request_id": f"r-{code}", **body}
        )
        assert refused.status_code == 422, refused.text
        assert refused.json()["code"] == code


def test_a_reviewer_who_annotated_the_texts_is_flagged(env):
    _basis(env)
    assert env.lead.put(f"{ST}/reviewers/alice").status_code == 200
    batch = env.lead.post(
        f"{ST}/batches", json={"request_id": "b-alice", "reviewer": "alice"}
    ).json()
    assert batch["warnings"] == [
        {"code": "SINGLE_TERM_REVIEWER_NOT_INDEPENDENT", "groups": 5}
    ]
    alice = logged_in(env.app, "alice")
    decided = _decide(alice, batch["batch_id"], "d-a", G_SEIZURE, "accept")
    assert decided.status_code == 200, decided.text
    assert decided.json()["reviewer_independent"] is False


def test_batch_states_submit_reopen_abandon(env):
    _basis(env)
    batch_id = _batch(env)["batch_id"]
    submitted = env.rita.post(
        f"{ST}/batches/{batch_id}/submit", json={"request_id": "s-1"}
    )
    assert submitted.status_code == 200 and submitted.json()["state"] == "submitted"
    refused = _decide(env.rita, batch_id, "d-late", G_SEIZURE, "accept")
    assert refused.json()["code"] == "SINGLE_TERM_BATCH_NOT_OPEN"
    # Only a lead reopens or abandons.
    assert (
        env.rita.post(f"{ST}/batches/{batch_id}/reopen", json={"request_id": "r-1"})
    ).status_code == 403
    reopened = env.lead.post(
        f"{ST}/batches/{batch_id}/reopen", json={"request_id": "r-2"}
    )
    assert reopened.json()["state"] == "open"
    assert _decide(env.rita, batch_id, "d-1", G_SEIZURE, "accept").status_code == 200
    assert _groups(env.lead)[G_SEIZURE]["state"] == "decided"
    abandoned = env.lead.post(
        f"{ST}/batches/{batch_id}/abandon", json={"request_id": "a-1"}
    )
    assert abandoned.json()["state"] == "abandoned"
    # The decisions of an abandoned batch stop counting.
    assert _groups(env.lead)[G_SEIZURE]["state"] == "open"
    again = env.lead.post(f"{ST}/batches/{batch_id}/reopen", json={"request_id": "r-3"})
    assert again.status_code == 409
    assert again.json()["code"] == "SINGLE_TERM_BATCH_STATE"
    with env.db.transaction() as conn:
        actions = set(
            conn.execute(
                select(AuditEventRow.action).where(
                    AuditEventRow.action.like("project.single_term_batch_%")
                )
            ).scalars()
        )
    assert actions == {
        "project.single_term_batch_create",
        "project.single_term_batch_submit",
        "project.single_term_batch_reopen",
        "project.single_term_batch_abandon",
    }


# --- decisions -----------------------------------------------------------------


def test_decision_rules_for_blocked_groups_terms_spans_and_reasons(env):
    _basis(env)
    batch_id = _batch(env)["batch_id"]
    rita = env.rita

    def code(response):
        return response.json()["code"]

    # A blocked group: no accept, no term adjustment; a re-cut or a rejection.
    assert code(_decide(rita, batch_id, "x1", G_NEGATED, "accept")) == (
        "SINGLE_TERM_GROUP_BLOCKED"
    )
    assert (
        code(
            _decide(
                rita,
                batch_id,
                "x2",
                G_NEGATED,
                "adjust_term",
                adjusted_term_id="HP:0000707",
            )
        )
        == "SINGLE_TERM_GROUP_BLOCKED"
    )
    negated = _ref(rita, batch_id, G_NEGATED, DOC1)
    span = {"occurrence_ref": negated["occurrence_ref"]}
    still_negated = _decide(
        rita,
        batch_id,
        "x3",
        G_NEGATED,
        "adjust_span",
        adjusted_span={**span, "start": negated["start"], "end": negated["end"] + 1},
    )
    assert code(still_negated) == "SINGLE_TERM_SPAN_NEGATED"
    outside = _decide(
        rita,
        batch_id,
        "x4",
        G_NEGATED,
        "adjust_span",
        adjusted_span={**span, "start": 0, "end": 4},
    )
    assert code(outside) == "SINGLE_TERM_SPAN_INVALID"
    beyond = _decide(
        rita,
        batch_id,
        "x5",
        G_NEGATED,
        "adjust_span",
        adjusted_span={**span, "start": negated["start"], "end": 10_000},
    )
    assert code(beyond) == "SINGLE_TERM_SPAN_INVALID"
    recut = _decide(
        rita,
        batch_id,
        "x6",
        G_NEGATED,
        "adjust_span",
        adjusted_span={**span, "start": negated["start"] + 6, "end": negated["end"]},
    )
    assert recut.status_code == 200, recut.text
    assert recut.json()["adjusted_span"]["text"] == "Areflexie"

    seizure = _ref(rita, batch_id, G_SEIZURE, DOC1)
    overlapping = _decide(
        rita,
        batch_id,
        "x7",
        G_SEIZURE,
        "adjust_span",
        adjusted_span={
            "occurrence_ref": seizure["occurrence_ref"],
            "start": seizure["start"],
            "end": seizure["end"] + len(" und Hypotonie"),
        },
    )
    assert code(overlapping) == "SINGLE_TERM_SPAN_OVERLAPS_FINDING"

    # A term adjustment: an ancestor in every occurrence's release.
    assert (
        code(
            _decide(
                rita, batch_id, "x8", G_HEARING, "adjust_term", adjusted_term_id=SEIZURE
            )
        )
        == "SINGLE_TERM_NOT_ANCESTOR"
    )
    general = _decide(
        rita, batch_id, "x9", G_HEARING, "adjust_term", adjusted_term_id=HEARING
    )
    assert general.status_code == 200, general.text

    # One adjustment per decision; a reason exactly for a rejection.
    for extra in (
        {"reason": "other"},
        {"adjusted_term_id": HEARING},
        {"phrase_only": None},
    ):
        invalid = _decide(rita, batch_id, f"x-{extra}", G_SEIZURE, "accept", **extra)
        assert code(invalid) == "SINGLE_TERM_DECISION_INVALID", extra
    no_reason = _decide(rita, batch_id, "x10", G_SEIZURE, "reject")
    assert code(no_reason) == "SINGLE_TERM_DECISION_INVALID"
    not_conflict = _decide(
        rita, batch_id, "x11", G_SEIZURE, "reject", reason="conflict"
    )
    assert code(not_conflict) == "SINGLE_TERM_NOT_IN_CONFLICT"


def test_a_conflict_accepts_one_group_and_rejects_the_other(env):
    _basis(env)
    batch_id = _batch(env)["batch_id"]
    assert _decide(env.rita, batch_id, "c1", G_HYPOTONIA, "accept").status_code == 200
    second = _decide(env.rita, batch_id, "c2", G_HYPO_WRONG, "accept")
    assert second.status_code == 409
    assert second.json()["details"] == {"accepted_group_ids": [G_HYPOTONIA]}
    rejected = _decide(
        env.rita,
        batch_id,
        "c3",
        G_HYPO_WRONG,
        "reject",
        reason="conflict",
        phrase_only="would_reject",
    )
    assert rejected.status_code == 200, rejected.text
    states = {g: v["state"] for g, v in _groups(env.lead).items()}
    assert states[G_HYPOTONIA] == states[G_HYPO_WRONG] == "decided"


def test_withdrawn_returns_the_group_to_open_and_the_newest_wins(env):
    _basis(env)
    batch_id = _batch(env)["batch_id"]
    _decide(env.rita, batch_id, "w1", G_SEIZURE, "accept")
    _decide(env.rita, batch_id, "w2", G_SEIZURE, "reject", reason="too_general")
    lead_view = _groups(env.lead)[G_SEIZURE]
    assert lead_view["decision"]["decision"] == "reject"
    withdrawn = _decide(env.rita, batch_id, "w3", G_SEIZURE, "withdrawn")
    assert withdrawn.status_code == 200, withdrawn.text
    assert _groups(env.lead)[G_SEIZURE]["state"] == "open"
    own = _groups(env.rita, batch=batch_id)[G_SEIZURE]
    assert own["state"] == "open" and own["decision"]["decision"] == "withdrawn"


def test_a_decision_request_is_idempotent(env):
    _basis(env)
    batch_id = _batch(env)["batch_id"]
    first = _decide(env.rita, batch_id, "same", G_SEIZURE, "accept", note="clear")
    again = _decide(env.rita, batch_id, "same", G_SEIZURE, "accept", note="clear")
    assert first.status_code == again.status_code == 200
    assert first.json() == again.json()
    other = _decide(env.rita, batch_id, "same", G_HEARING, "accept")
    assert other.status_code == 409
    assert other.json()["code"] == "WORKFLOW_REQUEST_CONFLICT"
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count()).select_from(SingleTermDecisionRow)
            ).scalar_one()
            == 1
        )
        receipt = conn.execute(
            select(WorkflowCommandReceiptRow.response).where(
                WorkflowCommandReceiptRow.request_id == "same"
            )
        ).scalar_one()
    assert receipt["decision_id"] == first.json()["decision_id"]


# --- carry-over ----------------------------------------------------------------


def test_a_refresh_opens_only_new_and_stale_groups(env):
    _basis(env)
    batch_id = _batch(env)["batch_id"]
    rita = env.rita
    assert _decide(rita, batch_id, "k1", G_SEIZURE, "accept").status_code == 200
    negated = _ref(rita, batch_id, G_NEGATED, DOC1)
    assert (
        _decide(
            rita,
            batch_id,
            "k2",
            G_NEGATED,
            "adjust_span",
            adjusted_span={
                "occurrence_ref": negated["occurrence_ref"],
                "start": negated["start"] + 6,
                "end": negated["end"],
            },
        ).status_code
        == 200
    )
    assert (
        _decide(
            rita, batch_id, "k3", G_HEARING, "adjust_term", adjusted_term_id=HEARING
        ).status_code
        == 200
    )
    rita.post(f"{ST}/batches/{batch_id}/submit", json={"request_id": "k-s"})

    # Unchanged results: every decision carries over.
    _basis(env, "basis-2")
    states = {g: v["state"] for g, v in _groups(env.lead).items()}
    assert states[G_SEIZURE] == states[G_NEGATED] == states[G_HEARING] == "decided"
    assert _groups(env.lead)[G_SEIZURE]["unseen_occurrences"] == 0

    # A new text with the phrase and a new final result of the first text: the
    # accepted group keeps its decision with unseen occurrences; the re-cut
    # occurrence is gone, so that group is stale.
    _submit(env, DOC3, "final-3")
    _select(env, DOC3, "final-3")
    _submit(env, DOC1, "final-1b", revision=2)
    _select(env, DOC1, "final-1b", revision=1)
    _basis(env, "basis-3")
    groups = _groups(env.lead)
    assert groups[G_SEIZURE]["state"] == "decided"
    assert groups[G_SEIZURE]["occurrences"] == 3
    assert groups[G_SEIZURE]["unseen_occurrences"] == 2
    assert groups[G_NEGATED]["state"] == "stale"
    assert groups[G_HEARING]["state"] == "decided"
    assert groups[G_HYPOTONIA]["state"] == "open"
    # A new batch takes the open and stale groups only, or the stale ones.
    stale = _batch(env, "batch-stale", stale_only=True)
    assert stale["groups"] == 1
    rest = env.lead.get(f"{ST}/batches/{stale['batch_id']}").json()
    assert rest["current_basis"] is True
    summary = env.lead.get(f"{ST}/summary").json()
    assert summary["bases"] == 3
    [german] = summary["languages"]
    assert german["decided"] == 2 and german["stale"] == 1
    assert german["conflicts"] == 2


# --- summary and agreement -------------------------------------------------------


def test_summary_reports_second_review_agreement(env):
    from ontotator.application.single_terms import agreement

    _basis(env)
    batch = _batch(env, second_review={"reviewer": "sam"})
    [second] = batch["second_batch_ids"]
    for group, first, other in (
        (G_SEIZURE, "accept", "accept"),
        (G_HEARING, "accept", "reject"),
        (G_HYPO_WRONG, "reject", "reject"),
    ):
        for client, batch_id, kind in (
            (env.rita, batch["batch_id"], first),
            (env.sam, second, other),
        ):
            extra = {"reason": "too_general"} if kind == "reject" else {}
            decided = _decide(
                client, batch_id, f"{group[:8]}-{batch_id}", group, kind, **extra
            )
            assert decided.status_code == 200, decided.text
    # The second reviewer never sees the first decision.
    blind = _groups(env.sam, batch=second)
    assert all(g["second_decision"] is None for g in blind.values())
    assert blind[G_HEARING]["decision"]["decision"] == "reject"
    summary = env.lead.get(f"{ST}/summary").json()
    expected = agreement(
        [("accept", "accept"), ("accept", "reject"), ("reject", "reject")]
    )
    assert summary["agreement"] == expected.model_dump()
    assert summary["agreement"]["pairs"] == 3
    assert summary["agreement"]["percent"] == pytest.approx(66.67)
    # Cohen's kappa: p_o = 2/3, p_e = 2/3*1/3 + 1/3*2/3 = 4/9.
    assert summary["agreement"]["kappa"] == pytest.approx(
        (2 / 3 - 4 / 9) / (5 / 9), abs=1e-4
    )
    assert summary["batches"] == {"open": 2, "submitted": 0, "abandoned": 0}


def test_agreement_without_pairs_or_with_certain_chance():
    from ontotator.application.single_terms import agreement

    assert agreement([]).kappa is None
    certain = agreement([("accept", "accept"), ("accept", "accept")])
    assert certain.percent == 100.0 and certain.kappa is None


# --- access -------------------------------------------------------------------------


def test_permissions_of_lead_reviewer_and_other_member(env):
    _basis(env)
    batch = _batch(env, second_review={"reviewer": "sam"})
    batch_id, [second] = batch["batch_id"], batch["second_batch_ids"]
    rita, otto, sam = env.rita, env.otto, env.sam

    # Lead-only routes.
    for client in (rita, otto):
        assert client.get(f"{ST}/summary").status_code == 403
        assert client.get(f"{ST}/groups").status_code == 403
        assert client.post(f"{ST}/basis", json={"request_id": "z"}).status_code == 403
        assert client.get(f"{ST}/reviewers").status_code == 403
        assert client.put(f"{ST}/reviewers/otto").status_code == 403
        assert (
            client.post(
                f"{ST}/batches", json={"request_id": "z", "reviewer": "rita"}
            ).status_code
            == 403
        )
    # A reviewer sees their own batch only.
    assert len(_groups(rita, batch=batch_id)) == 5
    assert rita.get(f"{ST}/groups", params={"batch": second}).status_code == 404
    assert (
        rita.get(
            f"{ST}/groups/{G_SEIZURE}/contexts", params={"batch": second}
        ).status_code
        == 404
    )
    assert [b["batch_id"] for b in rita.get(f"{ST}/batches").json()] == [batch_id]
    assert _decide(rita, second, "p1", G_SEIZURE, "accept").status_code == 404
    assert _decide(sam, batch_id, "p2", G_SEIZURE, "accept").status_code == 404
    # The lead reads every batch but decides only in their own.
    assert len(env.lead.get(f"{ST}/batches").json()) == 2
    assert len(_groups(env.lead, batch=second)) == 5
    assert _decide(env.lead, batch_id, "p3", G_SEIZURE, "accept").status_code == 403
    # Another member sees nothing.
    assert otto.get(f"{ST}/batches").status_code == 403
    assert otto.get(f"{ST}/groups", params={"batch": batch_id}).status_code == 404
    # A revoked reviewer can no longer decide in their batch.
    assert env.lead.delete(f"{ST}/reviewers/rita").status_code == 200
    assert _decide(rita, batch_id, "p4", G_SEIZURE, "accept").status_code == 403
    # A lead may review without the capability.
    own = env.lead.post(
        f"{ST}/batches",
        json={"request_id": "lead-own", "reviewer": "leader", "stale_only": False},
    )
    assert own.status_code == 409  # every group is in an open batch
    with env.db.transaction() as conn:
        actions = list(
            conn.execute(
                select(AuditEventRow.action)
                .where(AuditEventRow.action.like("project.single_term_reviewer%"))
                .order_by(AuditEventRow.id)
            ).scalars()
        )
    assert actions == [
        "project.single_term_reviewer_add",
        "project.single_term_reviewer_add",
        "project.single_term_reviewer_remove",
    ]


def test_tokens_reach_the_summary_but_never_phrases_or_decisions(env):
    _basis(env)
    batch_id = _batch(env)["batch_id"]
    created = env.lead.post(
        "/api/v1/me/tokens",
        json={"name": "st", "scopes": ["read", "project-admin"]},
    )
    assert created.status_code == 201, created.text
    token = TestClient(
        env.app, headers={"Authorization": f"Bearer {created.json()['secret']}"}
    )
    assert token.get(f"{ST}/summary").status_code == 200
    assert token.get(f"{ST}/batches").status_code == 200
    assert token.get(f"{ST}/reviewers").status_code == 200
    for response in (
        token.get(f"{ST}/groups"),
        token.get(f"{ST}/groups/{G_SEIZURE}/contexts"),
        token.post(
            f"{ST}/batches/{batch_id}/decisions",
            json={
                "request_id": "t",
                "group_id": G_SEIZURE,
                "decision": "accept",
                "phrase_only": "would_accept",
            },
        ),
        token.post(f"{ST}/batches/{batch_id}/submit", json={"request_id": "t"}),
    ):
        assert response.status_code == 403, response.text
    abandoned = token.post(
        f"{ST}/batches/{batch_id}/abandon", json={"request_id": "t-a"}
    )
    assert abandoned.status_code == 200, abandoned.text


# --- storage: history, purge, archive -------------------------------------------------


def _history(env):
    _basis(env)
    batch_id = _batch(env)["batch_id"]
    assert _decide(env.rita, batch_id, "h1", G_SEIZURE, "accept").status_code == 200
    return batch_id


@pytest.mark.parametrize(
    "table", ["single_term_bases", "single_term_batches", "single_term_decisions"]
)
def test_history_tables_are_append_only(env, table):
    _history(env)
    with pytest.raises(DBAPIError), env.db.engine.begin() as conn:
        conn.execute(text(f"DELETE FROM {S}.{table}"))
    with pytest.raises(DBAPIError), owner_engine(env.db).begin() as conn:
        conn.execute(text(f"UPDATE {S}.{table} SET project_id = project_id"))


def test_purging_a_selected_submission_removes_its_review(env):
    _history(env)
    with env.db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
    with owner_engine(env.db).begin() as conn:
        counts = purge(conn, subs=[(pid, "final-1")])
    assert counts["single_term_bases"] == 1
    assert counts["single_term_batches"] == 1
    assert counts["single_term_batch_state"] == 1
    assert counts["single_term_decisions"] == 1
    with env.db.transaction() as conn:
        for row in (
            SingleTermBasisRow,
            SingleTermBatchRow,
            SingleTermBatchStateRow,
            SingleTermDecisionRow,
        ):
            assert conn.execute(select(func.count()).select_from(row)).scalar_one() == 0


def test_the_archive_carries_the_review(env, tmp_path):
    from ontotator.exchange import archive as project_archive

    _history(env)
    built = project_archive.build_archive(env.db, "proj", tmp_path / "proj.zip")
    target = _app(tmp_path / "target")
    add_ontology(target, HP_PATH)
    result = project_archive.import_archive(
        target.state.repo.db, Actor(None, "test:operator"), built.path.read_bytes()
    )
    assert result["verification"]["ok"], result
    with target.state.repo.db.transaction() as conn:
        decision = conn.execute(select(SingleTermDecisionRow)).mappings().one()
        batch = conn.execute(select(SingleTermBatchRow)).mappings().one()
        basis = conn.execute(select(SingleTermBasisRow)).mappings().one()
        state = conn.execute(select(SingleTermBatchStateRow.state)).scalar_one()
    assert decision["batch_id"] == batch["id"] and batch["basis_id"] == basis["id"]
    assert decision["group_id"] == G_SEIZURE and state == "open"


def test_the_cli_export_ignores_a_basis_snapshot(env):
    import typer

    from ontotator.cli import _newest_final_snapshot

    _basis(env)
    with pytest.raises(typer.Exit):
        _newest_final_snapshot(env.db, "proj")
