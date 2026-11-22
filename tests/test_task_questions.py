"""Ask the lead: a question on a task (issue 553, prototype).

A question is a problem report of kind ``question``. It does not pause the
task unless the asker chooses so. The lead answers it; with a proposed
wording the lead can take it into the asker's open review draft in the same
step. Questions stay out of the text-problem views.
"""

from typing import Any

import pytest
from browser_lead_workflow_scenarios import (
    QUESTION_PROPOSED,
    QUESTION_QUOTE,
    QUESTION_TEXT,
)
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from test_browser_lead_workflow_fixture import client as client
from test_browser_lead_workflow_fixture import scenario
from test_typo_fix_review import Lead

from ontotator.domain.errors import DomainError
from ontotator.domain.problem_reports import check_question, take_proposed
from ontotator.storage.tables import AssignmentRow, AuditEventRow

ANSWER = "Yes, muscular hypotonia is meant. I put it into your text."


@pytest.fixture
def built(client: TestClient) -> dict[str, Any]:
    return scenario(client, "QUESTION_FOR_LEAD")


class People(Lead):
    def task(self, case: str) -> dict[str, Any]:
        app: Any = self.client.app
        with app.state.repo.db.transaction() as conn:
            row = (
                conn.execute(
                    select(AssignmentRow).where(
                        AssignmentRow.document_id == f"{case}~de~v1",
                        AssignmentRow.task == "translation_review",
                    )
                )
                .mappings()
                .one()
            )
        return dict(row)

    def ask(self, case: str, who: str = "ana", **more: Any) -> Any:
        task = self.task(case)
        body = {
            "request_id": f"ask-{case}-{len(more)}",
            "expected_workflow_revision": task["workflow_revision"],
            "round_id": task["active_round_id"],
            "reason": "Is the short form meant?",
            "kind": "question",
            **more,
        }
        return self.client.post(
            f"/api/v1/assignments/{task['id']}/problem-reports",
            json=body,
            headers=self.login(who),
        )

    def questions(self, who: str = "lead", **params: Any) -> list[dict[str, Any]]:
        self.login(who)
        found = self.client.get(
            f"{self.base}/problem-reports", params={"kind": "question", **params}
        )
        assert found.status_code == 200, found.text
        listed: list[dict[str, Any]] = found.json()
        return listed

    def answer(self, report: dict[str, Any], who: str = "lead", **more: Any) -> Any:
        body = {
            "request_id": f"answer-{report['report_id']}-{who}",
            "expected_revision": report["revision"],
            "action": "answer",
            "reason": ANSWER,
            **more,
        }
        return self.client.post(
            f"/api/v1/problem-reports/{report['report_id']}/actions",
            json=body,
            headers=self.login(who),
        )

    def draft_text(self, case: str) -> str:
        task = self.task(case)
        self.login("ana")
        opened = self.client.get(f"/api/v1/translation-reviews/{task['id']}")
        assert opened.status_code == 200, opened.text
        value: str = opened.json()["draft"]["text"]
        return value

    def audit_actions(self) -> list[str]:
        app: Any = self.client.app
        with app.state.repo.db.transaction() as conn:
            return list(
                conn.execute(
                    select(AuditEventRow.action)
                    .where(AuditEventRow.action.like("question.%"))
                    .order_by(AuditEventRow.id)
                ).scalars()
            )


def people(client: TestClient, built: dict[str, Any]) -> People:
    return People(client, built, built["cases"]["ask"])


def test_a_question_does_not_pause_the_task(
    client: TestClient, built: dict[str, Any]
) -> None:
    p = people(client, built)
    case = built["cases"]["ask"]
    before = p.task(case)
    asked = p.ask(case)
    assert asked.status_code == 200, asked.text
    body = asked.json()
    assert (body["kind"], body["state"], body["pauses"]) == ("question", "open", False)
    assert body["held_assignment_ids"] == []
    after = p.task(case)
    assert after["held"] is False
    assert after["workflow_revision"] == before["workflow_revision"]
    # The asker keeps working: a draft save goes through.
    assert QUESTION_QUOTE in p.draft_text(case)
    # The question is no text problem: the problem list does not show it.
    p.login("ana")
    problems = client.get(
        f"{p.base}/problem-reports", params={"assignment_id": after["id"]}
    ).json()
    assert problems == []
    assert p.audit_actions() == [
        "question.ask",
        "question.ask",
    ]  # the scenario asked too


def test_a_question_pauses_the_task_when_the_asker_chooses_so(
    client: TestClient, built: dict[str, Any]
) -> None:
    p = people(client, built)
    case = built["cases"]["ask"]
    asked = p.ask(case, pause=True)
    assert asked.status_code == 200, asked.text
    body = asked.json()
    assert body["pauses"] is True and body["held_assignment_ids"] == [
        p.task(case)["id"]
    ]
    assert p.task(case)["held"] is True
    # The answer releases the pause.
    answered = p.answer(body)
    assert answered.status_code == 200, answered.text
    assert answered.json()["held_assignment_ids"] == []
    assert p.task(case)["held"] is False


def test_a_pausing_question_is_named_as_a_question_and_the_asker_can_resume(
    client: TestClient, built: dict[str, Any]
) -> None:
    """Issue 590: the task says its pause is a question, the export leads to
    the Questions page, and the asker can resume while the question stays
    open."""
    p = people(client, built)
    case = built["cases"]["ask"]
    asked = p.ask(case, pause=True)
    assert asked.status_code == 200, asked.text
    body = asked.json()
    task_id = p.task(case)["id"]
    p.login("ana")
    meta = client.get(f"/api/v1/assignments/{task_id}")
    assert meta.status_code == 200, meta.text
    held = meta.json()
    assert held["held"] is True and held["pause_causes"] == ["report"]
    assert [(h["kind"], h["own_report_id"]) for h in held["active_holds"]] == [
        ("question", body["report_id"])
    ]
    # The export's cause for the paused task leads to the Questions page.
    app: Any = client.app
    repo = app.state.repo
    with repo.db.transaction() as conn:
        pid = repo._require_project(conn, built["project"])
        causes = repo.workflow_causes_in(conn, built["project"], pid)
    (cause,) = [
        c
        for c in causes
        if c["code"] == "TASK_ON_HOLD" and c["report_id"] == body["report_id"]
    ]
    assert cause["destination"] == f"#/projects/{built['project']}/questions"
    assert cause["reason"] == "Waiting for your answer to a question: " + body["reason"]
    # The asker resumes: the task opens, the question stays open for the lead.
    resumed = client.post(
        f"/api/v1/problem-reports/{body['report_id']}/actions",
        json={
            "request_id": f"resume-{body['report_id']}",
            "expected_revision": body["revision"],
            "action": "resume",
            "reason": "I can go on with the rest.",
            "assignment_ids": [task_id],
        },
        headers=p.login("ana"),
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["state"] == "open"
    assert resumed.json()["held_assignment_ids"] == []
    assert p.task(case)["held"] is False
    assert [q["report_id"] for q in p.questions(state="open")].count(
        body["report_id"]
    ) == 1
    # The lead still answers it.
    fresh = next(q for q in p.questions() if q["report_id"] == body["report_id"])
    answered = p.answer(fresh)
    assert answered.status_code == 200, answered.text


def test_an_ordinary_problem_hold_keeps_its_kind_and_destination(
    client: TestClient, built: dict[str, Any]
) -> None:
    p = people(client, built)
    case = built["cases"]["ask"]
    task = p.task(case)
    reported = client.post(
        f"/api/v1/assignments/{task['id']}/problem-reports",
        json={
            "request_id": "report-590",
            "expected_workflow_revision": task["workflow_revision"],
            "round_id": task["active_round_id"],
            "reason": "The source text is cut off.",
        },
        headers=p.login("ana"),
    )
    assert reported.status_code == 200, reported.text
    meta = client.get(f"/api/v1/assignments/{task['id']}").json()
    assert [h["kind"] for h in meta["active_holds"]] == ["problem"]
    app: Any = client.app
    repo = app.state.repo
    with repo.db.transaction() as conn:
        pid = repo._require_project(conn, built["project"])
        causes = repo.workflow_causes_in(conn, built["project"], pid)
    (cause,) = [c for c in causes if c["code"] == "TASK_ON_HOLD"]
    assert "/problem-reports/" in cause["destination"]
    assert cause["reason"] == "The source text is cut off."


def test_the_lead_sees_open_questions_with_quote_and_proposed_text(
    client: TestClient, built: dict[str, Any]
) -> None:
    p = people(client, built)
    listed = p.questions(state="open")
    assert [q["report_id"] for q in listed] == [built["report_id"]]
    question = listed[0]
    assert question["reason"] == QUESTION_TEXT
    assert (question["quote"], question["proposed_text"]) == (
        QUESTION_QUOTE,
        QUESTION_PROPOSED,
    )
    assert question["task"] == "translation_review"
    assert question["answer"] is None
    # The asker sees their own question; another reviewer sees none.
    assert [q["report_id"] for q in p.questions("ana")] == [built["report_id"]]
    assert p.questions("ben") == []


def test_the_lead_answers_and_takes_the_proposed_text_in_one_step(
    client: TestClient, built: dict[str, Any]
) -> None:
    p = people(client, built)
    case = built["cases"]["asked"]
    before = p.draft_text(case)
    question = p.questions(state="open")[0]
    answered = p.answer(question, take_proposed_text=True)
    assert answered.status_code == 200, answered.text
    body = answered.json()
    assert (body["state"], body["answer"], body["took_proposed_text"]) == (
        "resolved",
        ANSWER,
        True,
    )
    assert body["answered_by"]["pseudonym"] == built["pseudonyms"]["lead"]
    after = p.draft_text(case)
    assert after == before.replace(QUESTION_QUOTE, QUESTION_PROPOSED, 1)
    # The asker reads the answer at their task.
    mine = p.questions("ana")[0]
    assert (mine["answer"], mine["took_proposed_text"]) == (ANSWER, True)
    assert p.questions(state="open") == []
    assert p.audit_actions() == ["question.ask", "question.answer"]


def test_only_the_lead_answers_and_only_once(
    client: TestClient, built: dict[str, Any]
) -> None:
    p = people(client, built)
    question = p.questions(state="open")[0]
    assert p.answer(question, who="ana").status_code == 403
    assert p.answer(question).status_code == 200
    # The same request again is replayed, not answered twice.
    again = p.answer(question)
    assert again.status_code == 200 and again.json()["answer"] == ANSWER
    other = client.post(
        f"/api/v1/problem-reports/{question['report_id']}/actions",
        json={
            "request_id": "second-answer",
            "expected_revision": question["revision"] + 1,
            "action": "answer",
            "reason": "Another answer",
        },
        headers=p.login("lead"),
    )
    assert other.status_code == 409


def test_the_proposed_text_is_refused_when_the_passage_has_moved_on(
    client: TestClient, built: dict[str, Any]
) -> None:
    p = people(client, built)
    case = built["cases"]["ask"]
    asked = p.ask(case, quote="no such passage", proposed_text="other words")
    assert asked.status_code == 200, asked.text
    refused = p.answer(asked.json(), take_proposed_text=True)
    assert refused.status_code == 409
    body = refused.json()
    assert (body["code"], body["details"]["reason"]) == (
        "QUESTION_ANSWER_NOT_AVAILABLE",
        "quote_not_found",
    )
    # Answering without taking it still works.
    assert p.answer(asked.json()).status_code == 200


def test_a_problem_report_is_not_answered_as_a_question(
    client: TestClient, built: dict[str, Any]
) -> None:
    p = people(client, built)
    task = p.task(built["cases"]["ask"])
    reported = client.post(
        f"/api/v1/assignments/{task['id']}/problem-reports",
        json={
            "request_id": "problem-1",
            "expected_workflow_revision": task["workflow_revision"],
            "round_id": task["active_round_id"],
            "reason": "The text is cut off.",
        },
        headers=p.login("ana"),
    )
    assert reported.status_code == 200, reported.text
    assert reported.json()["kind"] == "problem"
    refused = p.answer(reported.json())
    assert refused.status_code == 409
    assert refused.json()["details"]["reason"] == "not_a_question"


def test_question_parts_rules() -> None:
    assert check_question("question", " ", "") == (None, None)
    assert check_question("question", "a", "b") == ("a", "b")
    for kind, quote, proposed, reason in (
        ("question", None, "b", "quote_required"),
        ("problem", "a", None, "not_a_question"),
        ("question", "a" * 2001, None, "too_long"),
    ):
        with pytest.raises(DomainError) as refused:
            check_question(kind, quote, proposed)
        assert refused.value.details == {"reason": reason}
    assert take_proposed("one two three", "two", "2") == "one 2 three"
    with pytest.raises(DomainError):
        take_proposed("two two", "two", "2")


def test_existing_reports_became_problems(
    client: TestClient, built: dict[str, Any]
) -> None:
    app: Any = client.app
    with app.state.repo.db.transaction() as conn:
        kinds = set(
            conn.execute(
                text("SELECT DISTINCT kind FROM ontotator.problem_reports")
            ).scalars()
        )
    assert kinds <= {"problem", "question"}
