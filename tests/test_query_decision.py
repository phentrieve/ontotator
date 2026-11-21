"""The lead decides a translation review submitted as a query (issue 483).

Under "Resolve…" the lead takes the reviewer's proposed text as the next
version, or answers and accepts the version as it is. Both close the query
as the lead's decision; the reviewer reads the answer at the submitted task.
"""

from typing import Any

import pytest
from browser_lead_workflow_scenarios import QUERY_NEW, QUERY_OLD, QUERY_RATIONALE
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_browser_lead_workflow_fixture import client as client
from test_browser_lead_workflow_fixture import scenario
from test_typo_fix_review import Lead, codes

from ontotator.exchange.reanchor_job import ReanchorPayload
from ontotator.storage.plan_tables import QueryDecisionRow
from ontotator.storage.tables import AssignmentRow, AuditEventRow, JobRow

CODE = "QUERY_DECISION_NOT_AVAILABLE"
ANSWER = "Yes, the short form is meant. Thank you."


class Decider(Lead):
    def path(self, document_id: str) -> str:
        return f"{self.base}/documents/{document_id}/query-decision"

    def preview(self, document_id: str, who: str = "lead") -> Any:
        return self.client.get(self.path(document_id), headers=self.login(who))

    def decide(
        self, document_id: str, kind: str, who: str = "lead", **more: Any
    ) -> Any:
        preview = self.preview(document_id).json()
        body = {
            "kind": kind,
            "expected_text_sha256": preview["text_sha256"],
            "expected_review_id": (preview["review"] or {"id": 1})["id"],
            **more,
        }
        return self.client.post(
            self.path(document_id), json=body, headers=self.login(who)
        )

    def audits(self) -> list[dict[str, Any]]:
        app: Any = self.client.app
        with app.state.repo.db.transaction() as conn:
            return [
                dict(details)
                for details in conn.execute(
                    select(AuditEventRow.details)
                    .where(AuditEventRow.action == "translation.query_decided")
                    .order_by(AuditEventRow.id)
                ).scalars()
            ]

    def reviewer_task(self, document_id: str) -> int:
        app: Any = self.client.app
        with app.state.repo.db.transaction() as conn:
            found: int = conn.execute(
                select(AssignmentRow.id).where(
                    AssignmentRow.document_id == document_id,
                    AssignmentRow.task == "translation_review",
                )
            ).scalar_one()
        return found


@pytest.fixture
def built(client: TestClient) -> dict[str, Any]:
    return scenario(client, "QUERIED_TRANSLATION_FOR_LEAD")


def decider(client: TestClient, built: dict[str, Any], name: str) -> Decider:
    return Decider(client, built, built["cases"][name])


def refusal(response: Any) -> tuple[int, str, Any]:
    body = response.json()
    return response.status_code, body["code"], (body.get("details") or {}).get("reason")


def test_the_preview_shows_the_query_and_the_reviewers_text(
    client: TestClient, built: dict[str, Any]
) -> None:
    lead = decider(client, built, "take_text")
    v1 = f"{lead.case}~de~v1"
    text, sha, status = lead.document(v1)
    shown = lead.preview(v1)
    assert shown.status_code == 200, shown.text
    body = shown.json()
    assert (body["available"], body["reason"]) == (True, None)
    assert (body["version"], body["next_version"]) == (1, 2)
    assert (body["text"], body["text_sha256"]) == (text, sha)
    assert body["translation_status"] == status == "reviewed"
    review = body["review"]
    assert review["document_id"] == v1 and review["version"] == 1
    assert review["rationale"] == QUERY_RATIONALE
    assert review["categories"] == ["terminology"]
    assert review["proposed_text"] == text.replace(QUERY_OLD, QUERY_NEW)
    assert body["proposes_changes"] is True
    assert body["annotations"] == {"submitted": 0, "open": 0}
    # A rejected translation is no query.
    rejected = decider(client, built, "rejected")
    other = rejected.preview(f"{rejected.case}~de~v1").json()
    assert (other["available"], other["reason"]) == (False, "not_a_query")
    assert other["review"] is None and other["proposes_changes"] is False


def test_the_reviewers_text_becomes_the_next_version_accepted(
    client: TestClient, built: dict[str, Any]
) -> None:
    lead = decider(client, built, "take_text")
    v1 = f"{lead.case}~de~v1"
    assert lead.row()["next_step"]["code"] == "resolve_queried"
    proposed = lead.preview(v1).json()["review"]["proposed_text"]
    done = lead.decide(v1, "reviewer_text", text=proposed, answer=ANSWER)
    assert done.status_code == 200, done.text
    saved = done.json()
    v2 = saved["document_id"]
    assert (saved["kind"], saved["version"], saved["decided_document_id"]) == (
        "reviewer_text",
        2,
        v1,
    )
    assert saved["translation_status"] == "accepted" and saved["edited"] is False
    assert lead.document(v2)[::2] == (proposed, "accepted")
    assert lead.document(v1)[2] == "reviewed"
    # The row goes on: the annotation of the new version can be assigned.
    row = lead.row()
    assert "resolve_queried" not in codes(row)
    assert row["next_step"]["code"] == "assign_annotation"
    assert row["next_step"]["document_id"] == v2
    review = row["stages"]["review"]
    assert (review["state"], review["detail"]["note"]) == (
        "accepted",
        "with_corrections",
    )
    by_id = {version["document_id"]: version for version in row["versions"]}
    assert by_id[v1]["query_decision"] is None
    assert by_id[v2]["acceptance"] is None
    decision = by_id[v2]["query_decision"]
    assert (decision["kind"], decision["answer"], decision["edited"]) == (
        "reviewer_text",
        ANSWER,
        False,
    )
    assert decision["decided_document_id"] == decision["reviewed_document_id"] == v1
    assert decision["reviewer_assignment_id"] == lead.reviewer_task(v1)
    assert decision["decided_by"]["display_name"] == "Project Lead"
    # Recorded as the lead's decision, with the answer.
    (audit,) = lead.audits()
    assert (audit["kind"], audit["document_id"], audit["decided_document_id"]) == (
        "reviewer_text",
        v2,
        v1,
    )
    assert (audit["answer"], audit["status_after"], audit["edited"]) == (
        ANSWER,
        "accepted",
        False,
    )
    app: Any = client.app
    with app.state.repo.db.transaction() as conn:
        record = conn.execute(select(QueryDecisionRow)).mappings().one()
        payloads = [
            ReanchorPayload.model_validate(payload)
            for payload in conn.execute(
                select(JobRow.payload).where(JobRow.kind == "reanchor")
            ).scalars()
        ]
    assert (record["document_id"], record["accepted_document_id"]) == (v1, v2)
    # Tool proposals follow the new text, as after a corrected review.
    assert [
        (p.old_document_id, p.new_document_id, p.producer.kind) for p in payloads
    ] == [(v1, v2, "query_decision")]


def test_the_lead_may_change_the_reviewers_text_and_leave_the_answer_out(
    client: TestClient, built: dict[str, Any]
) -> None:
    lead = decider(client, built, "take_text")
    v1 = f"{lead.case}~de~v1"
    proposed = lead.preview(v1).json()["review"]["proposed_text"]
    done = lead.decide(v1, "reviewer_text", text=proposed + " Checked.")
    assert done.status_code == 200, done.text
    assert done.json()["edited"] is True
    (audit,) = lead.audits()
    assert audit["edited"] is True and audit["answer"] is None
    (v2,) = [v for v in lead.row()["versions"] if v["query_decision"]]
    assert v2["query_decision"]["answer"] is None


def test_an_answer_accepts_the_version_as_it_is(
    client: TestClient, built: dict[str, Any]
) -> None:
    lead = decider(client, built, "answer_only")
    v1 = f"{lead.case}~de~v1"
    text = lead.document(v1)[0]
    done = lead.decide(v1, "unchanged", answer=f"  {ANSWER} ")
    assert done.status_code == 200, done.text
    saved = done.json()
    assert (saved["kind"], saved["document_id"], saved["version"]) == (
        "unchanged",
        v1,
        1,
    )
    assert lead.document(v1)[::2] == (text, "accepted")
    row = lead.row()
    assert row["next_step"]["code"] == "assign_annotation"
    assert row["next_step"]["document_id"] == v1
    (version,) = row["versions"]
    assert version["translation_status"] == "accepted"
    assert not version["accepted_without_review"]
    decision = version["query_decision"]
    assert (decision["kind"], decision["answer"]) == ("unchanged", ANSWER)
    assert row["stages"]["review"]["state"] == "accepted"
    (audit,) = lead.audits()
    assert (audit["kind"], audit["document_id"], audit["answer"]) == (
        "unchanged",
        v1,
        ANSWER,
    )
    # Decided once: the query is closed.
    again = lead.preview(v1).json()
    assert (again["available"], again["reason"]) == (False, "already_decided")
    assert refusal(lead.decide(v1, "unchanged", answer=ANSWER)) == (
        409,
        CODE,
        "already_decided",
    )
    assert len(lead.audits()) == 1


def test_the_reviewer_reads_the_answer_at_the_submitted_task(
    client: TestClient, built: dict[str, Any]
) -> None:
    lead = decider(client, built, "take_text")
    v1 = f"{lead.case}~de~v1"
    task = lead.reviewer_task(v1)

    def workspace() -> dict[str, Any]:
        opened = client.get(
            f"/api/v1/translation-reviews/{task}", headers=lead.login("ana")
        )
        assert opened.status_code == 200, opened.text
        body: dict[str, Any] = opened.json()
        return body

    def my_task() -> dict[str, Any]:
        listed = client.get("/api/v1/me/tasks", headers=lead.login("ana")).json()
        (mine,) = [item for item in listed if item["assignment_id"] == task]
        found: dict[str, Any] = mine
        return found

    assert workspace()["query_answer"] is None
    assert my_task()["query_answered_at"] is None
    proposed = lead.preview(v1).json()["review"]["proposed_text"]
    assert (
        lead.decide(v1, "reviewer_text", text=proposed, answer=ANSWER).status_code
        == 200
    )
    answer = workspace()["query_answer"]
    assert (answer["kind"], answer["accepted_version"], answer["answer"]) == (
        "reviewer_text",
        2,
        ANSWER,
    )
    assert answer["edited"] is False
    assert my_task()["query_answered_at"] == answer["decided_at"]
    # The other query is still open.
    other = decider(client, built, "answer_only")
    other_task = other.reviewer_task(f"{other.case}~de~v1")
    opened = client.get(
        f"/api/v1/translation-reviews/{other_task}", headers=lead.login("ana")
    )
    assert opened.json()["query_answer"] is None


def test_only_a_lead_of_the_project_decides(
    client: TestClient, built: dict[str, Any]
) -> None:
    lead = decider(client, built, "answer_only")
    v1 = f"{lead.case}~de~v1"
    body = {
        "kind": "unchanged",
        "expected_text_sha256": lead.document(v1)[1],
        "expected_review_id": lead.preview(v1).json()["review"]["id"],
        "answer": ANSWER,
    }
    for who in ("ana", "ben", "annotator"):
        headers = lead.login(who)
        assert client.get(lead.path(v1), headers=headers).status_code == 403, who
        refused = client.post(lead.path(v1), json=body, headers=headers)
        assert refused.status_code == 403, (who, refused.text)
    # The lead of another project sees no such project.
    foreign = Decider(client, scenario(client, "QUERIED_TRANSLATION_FOR_LEAD"), "x")
    headers = foreign.login()
    assert client.get(lead.path(v1), headers=headers).status_code == 404
    refused = client.post(lead.path(v1), json=body, headers=headers)
    assert (refused.status_code, refused.json()["code"]) == (404, "PROJECT_NOT_FOUND")
    # Without a login nothing is read or decided.
    client.cookies.clear()
    assert client.get(lead.path(v1)).status_code == 401
    assert lead.audits() == []
    assert lead.preview(v1).json()["translation_status"] == "reviewed"


def test_refused_unless_the_version_is_queried_and_current(
    client: TestClient, built: dict[str, Any]
) -> None:
    # A rejected translation is no query.
    rejected = decider(client, built, "rejected")
    r1 = f"{rejected.case}~de~v1"
    assert refusal(rejected.decide(r1, "unchanged", answer=ANSWER)) == (
        409,
        CODE,
        "not_a_query",
    )
    lead = decider(client, built, "take_text")
    v1 = f"{lead.case}~de~v1"
    preview = lead.preview(v1).json()
    proposed = preview["review"]["proposed_text"]
    body = {
        "kind": "reviewer_text",
        "expected_text_sha256": preview["text_sha256"],
        "expected_review_id": preview["review"]["id"],
        "text": proposed,
    }
    headers = lead.login()
    # Another text or another review than the one shown: stale.
    for stale in (
        {"expected_text_sha256": "0" * 64},
        {"expected_review_id": preview["review"]["id"] + 1000},
    ):
        refused = client.post(lead.path(v1), json={**body, **stale}, headers=headers)
        assert (refused.status_code, refused.json()["code"]) == (
            409,
            "VARIANT_REVIEW_STALE",
        ), refused.text
    # The version's own text is no new version; an empty text is none either.
    same = client.post(
        lead.path(v1), json={**body, "text": preview["text"]}, headers=headers
    )
    assert refusal(same) == (409, CODE, "unchanged")
    # The request names its fields: a text only with reviewer_text, an answer
    # with unchanged.
    for wrong in (
        {**body, "kind": "unchanged", "answer": ANSWER},
        {k: v for k, v in body.items() if k != "text"},
        {**{k: v for k, v in body.items() if k != "text"}, "kind": "unchanged"},
        {
            **{k: v for k, v in body.items() if k != "text"},
            "kind": "unchanged",
            "answer": "  ",
        },
    ):
        assert (
            client.post(lead.path(v1), json=wrong, headers=headers).status_code == 422
        )
    # An open translation review of the version: withdraw it first.
    _, commit = lead.batch("ben")
    assert refusal(client.post(lead.path(v1), json=body, headers=lead.login())) == (
        409,
        CODE,
        "review_open",
    )
    assert lead.document(v1)[2] == "reviewed" and lead.audits() == []
    # Ben accepts it: the query is no longer the version's decision.
    lead.review("ben", commit["created"][0]["id"], "accepted_unchanged")
    assert refusal(client.post(lead.path(v1), json=body, headers=lead.login())) == (
        409,
        CODE,
        "not_a_query",
    )


def test_decided_once_and_never_on_an_older_version(
    client: TestClient, built: dict[str, Any]
) -> None:
    lead = decider(client, built, "take_text")
    v1 = f"{lead.case}~de~v1"
    proposed = lead.preview(v1).json()["review"]["proposed_text"]
    v2 = lead.decide(v1, "reviewer_text", text=proposed).json()["document_id"]
    assert refusal(lead.decide(v1, "reviewer_text", text=proposed + "!")) == (
        409,
        CODE,
        "already_decided",
    )
    # The accepted version carries no query.
    assert refusal(lead.decide(v2, "unchanged", answer=ANSWER)) == (
        409,
        CODE,
        "not_a_query",
    )
    assert len(lead.audits()) == 1


def test_a_typo_fix_of_a_queried_version_is_decided_with_its_query(
    client: TestClient, built: dict[str, Any]
) -> None:
    """ "Fix typos…" on a queried version keeps the query: the lead decides it
    at the fixed version."""
    lead = decider(client, built, "answer_only")
    v1 = f"{lead.case}~de~v1"
    v2 = lead.fix_typos(v1)
    assert lead.row()["next_step"]["document_id"] == v2
    older = lead.preview(v1).json()
    assert (older["available"], older["reason"]) == (False, "not_newest")
    shown = lead.preview(v2).json()
    assert shown["available"] is True
    assert (shown["review"]["document_id"], shown["review"]["version"]) == (v1, 1)
    done = lead.decide(v2, "unchanged", answer=ANSWER)
    assert done.status_code == 200, done.text
    assert lead.document(v2)[2] == "accepted"
    row = lead.row()
    assert row["next_step"]["code"] == "assign_annotation"
    assert row["next_step"]["document_id"] == v2
    by_id = {version["document_id"]: version for version in row["versions"]}
    decision = by_id[v2]["query_decision"]
    assert (decision["decided_document_id"], decision["reviewed_document_id"]) == (
        v2,
        v1,
    )
    # Ana reads the answer at her review of v1.
    opened = client.get(
        f"/api/v1/translation-reviews/{lead.reviewer_task(v1)}",
        headers=lead.login("ana"),
    ).json()
    assert opened["query_answer"]["kind"] == "unchanged"
    assert opened["query_answer"]["accepted_version"] == 2


def test_the_decision_is_the_rows_last_activity(
    client: TestClient, built: dict[str, Any]
) -> None:
    """Issue 545 (U2-03): "Last activity" moves to the lead's decision; the
    History has the time of the reviewer's query on its review line."""
    lead = decider(client, built, "answer_only")
    v1 = f"{lead.case}~de~v1"
    before = lead.row()
    (review,) = [
        item for item in before["work"] if item["task"] == "translation_review"
    ]
    assert review["submitted_at"] is not None
    assert before["last_activity_at"] >= review["submitted_at"]
    assert lead.decide(v1, "unchanged", answer=ANSWER).status_code == 200
    row = lead.row()
    (version,) = row["versions"]
    decided_at = version["query_decision"]["decided_at"]
    assert decided_at > before["last_activity_at"]
    assert row["last_activity_at"] == decided_at


def test_a_query_on_the_accepted_reviewer_text_is_decided_there(
    client: TestClient, built: dict[str, Any]
) -> None:
    """Issue 574 F1: the lead accepts the reviewer's text as v2, asks a
    reviewer to correct v2, and the reviewer queries v2. The row's Resolve
    step and its decision dialogs name v2, not the decided v1."""
    lead = decider(client, built, "take_text")
    v1 = f"{lead.case}~de~v1"
    proposed = lead.preview(v1).json()["review"]["proposed_text"]
    v2 = lead.decide(v1, "reviewer_text", text=proposed).json()["document_id"]
    _, sha, _ = lead.document(v2)
    asked = lead.post(
        f"{lead.base}/documents/{v2}/translation-correction-assignment",
        {
            "username": built["users"]["ben"],
            "expected_text_sha256": sha,
            "reason": "Check the dose.",
            "confirm_language": True,
        },
    )
    assert asked.status_code == 200, asked.text
    lead.review("ben", asked.json()["id"], "query")
    assert lead.document(v2)[2] == "reviewed"
    step = lead.row()["next_step"]
    assert step["code"] == "resolve_queried"
    assert (step["document_id"], step["detail"]["version"]) == (v2, 2)
    shown = lead.preview(v2).json()
    assert (shown["available"], shown["reason"], shown["version"]) == (True, None, 2)
    # "Correct the translation…" names v2 and v3 as well.
    correcting = client.get(
        f"{lead.base}/documents/{v2}/lead-correction", headers=lead.login()
    ).json()
    assert (correcting["available"], correcting["version"]) == (True, 2)
    assert correcting["next_version"] == 3
    done = lead.decide(v2, "unchanged", answer=ANSWER)
    assert done.status_code == 200, done.text
    assert lead.document(v2)[2] == "accepted"
    assert "resolve_queried" not in codes(lead.row())
