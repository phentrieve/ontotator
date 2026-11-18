"""A review after "Fix typos…" is a review of the fix (review 2, F1).

A lead fixes typos in a rejected, queried or accepted translation version
(an editorial correction, issue 453). The fix is the newest text of its
chain: a new review reviews it, the fixed version takes no further review,
and the row has a next step after every decision.
"""

from typing import Any

import pytest
from browser_server import TEST_PASSWORD
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_browser_lead_workflow_fixture import client as client
from test_browser_lead_workflow_fixture import lead_rows, scenario

from ontotator.storage.tables import DocumentRow

REASON = "Typo: Hypotnie"
FIX = " Korrigiert."


class Lead:
    """The scenario's lead, logged in, with one text (case, de)."""

    def __init__(self, client: TestClient, built: dict[str, Any], case: str) -> None:
        self.client, self.built, self.case = client, built, case
        self.base = f"/api/v1/projects/{built['project']}"
        self.headers: dict[str, str] = {}

    def login(self, who: str = "lead") -> dict[str, str]:
        self.client.cookies.clear()
        origin = str(self.client.base_url).rstrip("/")
        done = self.client.post(
            "/api/v1/auth/login",
            json={"username": self.built["users"][who], "password": TEST_PASSWORD},
            headers={"Origin": origin},
        )
        assert done.status_code == 200, done.text
        self.headers = {"Origin": origin, "X-CSRF-Token": done.json()["csrf_token"]}
        return self.headers

    def post(self, path: str, body: dict[str, Any]) -> Any:
        return self.client.post(path, json=body, headers=self.login())

    def row(self) -> dict[str, Any]:
        return lead_rows(self.client, self.built)[1][(self.case, "de")]

    def document(self, document_id: str) -> tuple[str, str, str | None]:
        app: Any = self.client.app
        with app.state.repo.db.transaction() as conn:
            found = conn.execute(
                select(
                    DocumentRow.text,
                    DocumentRow.text_sha256,
                    DocumentRow.translation_status,
                ).where(DocumentRow.document_id == document_id)
            ).one()
        return found.text, found.text_sha256, found.translation_status

    def fix_typos(self, document_id: str) -> str:
        text, sha, _ = self.document(document_id)
        saved = self.post(
            f"{self.base}/documents/{document_id}/editorial-correction",
            {"text": text + FIX, "expected_text_sha256": sha, "reason": REASON},
        )
        assert saved.status_code == 200, saved.text
        fixed: str = saved.json()["document_id"]
        return fixed

    def batch(self, who: str, **more: Any) -> tuple[dict[str, Any], Any]:
        """The row dialog's "Assign review…" / "Assign a new review…"."""
        body = {
            "task": "translation_review",
            "language": "de",
            "case_ids": [self.case],
            "mode": "one",
            "usernames": [self.built["users"][who]],
            **more,
        }
        preview = self.post(f"{self.base}/assignments/batch/preview", body)
        assert preview.status_code == 200, preview.text
        commit = self.post(
            f"{self.base}/assignments/batch",
            {**body, "expected_preview_digest": preview.json()["digest"]},
        )
        assert commit.status_code == 200, commit.text
        return preview.json(), commit.json()

    def assign(self, who: str, document_id: str, **more: Any) -> dict[str, Any]:
        """The single assignment of the API and the MCP tool ``assign``."""
        done = self.post(
            f"{self.base}/assignments",
            {
                "task": "translation_review",
                "rows": [
                    {"document_id": document_id, "username": self.built["users"][who]}
                ],
                "confirm_language": True,
                **more,
            },
        )
        assert done.status_code == 200, done.text
        body: dict[str, Any] = done.json()
        return body

    def review(self, who: str, assignment_id: int, decision: str) -> dict[str, Any]:
        """``who`` opens the review, decides and submits; the workspace."""
        headers = self.login(who)
        path = f"/api/v1/translation-reviews/{assignment_id}"
        opened = self.client.get(path, headers=headers).json()
        form: dict[str, Any] = {"decision": decision, "clinical_change": False}
        if decision in ("rejected", "query"):
            form |= {
                "clinical_change": True,
                "categories": ["omission"],
                "rationale": "A finding is missing.",
            }
        saved = self.client.put(
            f"{path}/draft",
            json={
                "expected_revision": opened["draft"]["revision"],
                "text": opened["text"],
                "form": form,
            },
            headers=headers,
        )
        assert saved.status_code == 200, saved.text
        done = self.client.post(
            f"{path}/submit",
            json={"expected_revision": saved.json()["revision"]},
            headers=headers,
        )
        assert done.status_code == 200, done.text
        workspace: dict[str, Any] = opened
        return workspace


def codes(row: dict[str, Any]) -> list[str]:
    return [step["code"] for step in row["steps"]]


@pytest.fixture(params=["rejected", "queried"])
def decided(client: TestClient, request: pytest.FixtureRequest) -> Lead:
    built = scenario(client, "REJECTED_TRANSLATION_FOR_LEAD")
    return Lead(client, built, built["cases"][request.param])


def test_a_new_review_after_a_typo_fix_reviews_the_fix(decided: Lead) -> None:
    lead = decided
    v1 = f"{lead.case}~de~v1"
    resolve = lead.row()["next_step"]["code"]
    assert resolve in ("resolve_rejected", "resolve_queried")
    v2 = lead.fix_typos(v1)
    row = lead.row()
    # The fix is the row's text: still rejected or queried, for the lead.
    assert row["next_step"]["code"] == resolve
    assert row["next_step"]["document_id"] == v2
    assert row["bulk"]["document_id"] == v2
    assert row["version_marker"] == {"kind": "corrected", "version": 2}
    # "Resolve…" > "Assign a new review…" announces v2 and assigns v2.
    preview, commit = lead.batch("ben")
    (target,) = preview["targets"]
    assert (target["document_id"], target["version"]) == (v2, 2)
    (created,) = commit["created"]
    assert created["document_id"] == v2
    assert lead.row()["next_step"]["code"] == "translation_review_in_progress"
    # Ben reads the fixed text and that the lead fixed typos in v1.
    workspace = lead.review("ben", created["id"], "accepted_unchanged")
    assert workspace["variant"]["document_id"] == v2
    assert workspace["text"].endswith(FIX)
    origin = workspace["version_origin"]
    assert (origin["kind"], origin["previous_version"], origin["note"]) == (
        "editorial_correction",
        1,
        REASON,
    )
    # Accepted: the fix counts, the annotation can be assigned.
    row = lead.row()
    assert lead.document(v2)[2] == "accepted"
    assert lead.document(v1)[2] == "reviewed"
    assert row["next_step"]["code"] == "assign_annotation"
    assert row["next_step"]["document_id"] == v2
    review = row["stages"]["review"]
    assert (review["state"], review["detail"]["note"]) == ("accepted", "unchanged")
    assert review["detail"]["people"] == []


def test_a_rejected_fix_stays_the_text_to_resolve(decided: Lead) -> None:
    """A second rejection never falls back to the text with the typos."""
    lead = decided
    v2 = lead.fix_typos(f"{lead.case}~de~v1")
    _, commit = lead.batch("ben")
    lead.review("ben", commit["created"][0]["id"], "rejected")
    row = lead.row()
    assert row["next_step"]["code"] == "resolve_rejected"
    assert row["next_step"]["document_id"] == v2
    # A further fix and a further review go on from the newest version.
    v3 = lead.fix_typos(v2)
    preview, commit = lead.batch("ana")
    assert [t["document_id"] for t in preview["targets"]] == [v3]
    assert [c["document_id"] for c in commit["created"]] == [v3]
    lead.review("ana", commit["created"][0]["id"], "accepted_unchanged")
    assert lead.row()["next_step"]["code"] == "assign_annotation"


def test_the_fixed_version_takes_no_further_review(decided: Lead) -> None:
    """The API and the MCP tool name a version: the old text is refused."""
    lead = decided
    v1 = f"{lead.case}~de~v1"
    (ana,) = [
        item["assignment_id"]
        for item in lead.row()["work"]
        if item["task"] == "translation_review"
    ]
    v2 = lead.fix_typos(v1)
    stale = {"reason": "typos_fixed", "document_id": v2, "version": 2}
    refused = lead.assign("ben", v1)
    assert refused["created"] == []
    assert [(r["code"], r["reason"]) for r in refused["refused"]] == [
        ("VARIANT_REVIEW_STALE", "typos_fixed")
    ]
    # Reopening the review of v1 would review the old text as well.
    reopened = lead.post(f"/api/v1/assignments/{ana}/reopen", {"reason": "Again"})
    assert reopened.status_code == 409, reopened.text
    assert reopened.json() == {"code": "VARIANT_REVIEW_STALE", "details": stale}
    assert codes(lead.row())[0] in ("resolve_rejected", "resolve_queried")
    # The fix itself is assigned, to the first reviewer too.
    created = lead.assign("ana", v2)["created"]
    assert [item["document_id"] for item in created] == [v2]


def test_the_lead_corrects_or_uploads_after_the_fix(decided: Lead) -> None:
    """ "Correct it myself…" and "Upload a corrected text…" start from the fix."""
    lead = decided
    v1 = f"{lead.case}~de~v1"
    v2 = lead.fix_typos(v1)
    for old in ("lead-correction", "editorial-correction"):
        text, sha, _ = lead.document(v1)
        body = {"expected_text_sha256": sha} | (
            {"confirm_language": True}
            if old == "lead-correction"
            else {"text": text + "!", "reason": REASON}
        )
        refused = lead.post(f"{lead.base}/documents/{v1}/{old}", body)
        assert refused.status_code == 409, refused.text
        assert refused.json()["details"] == {"reason": "not_newest"}
    available = lead.client.get(
        f"{lead.base}/documents/{v2}/lead-correction", headers=lead.login()
    )
    assert available.status_code == 200, available.text
    assert available.json()["available"] is True
    text, sha, _ = lead.document(v2)
    uploaded = lead.post(
        f"{lead.base}/variants/{v2}/versions",
        {
            "text": text + " Neu.",
            "expected_text_sha256": sha,
            "method": "manual_correction",
        },
    )
    assert uploaded.status_code == 200, uploaded.text
    v3 = uploaded.json()["document_id"]
    row = lead.row()
    assert row["next_step"]["code"] == "assign_translation_review"
    preview, _ = lead.batch("ben")
    assert [t["document_id"] for t in preview["targets"]] == [v3]


def test_an_accepted_fix_names_the_lead_and_is_reviewed_itself(
    client: TestClient,
) -> None:
    """Review 2, F5: the Translation cell credits the lead, not the reviewer
    of the fixed version. A new review of the accepted text is of the fix."""
    built = scenario(client, "ACCEPTED_TRANSLATION_FOR_LEAD")
    lead = Lead(client, built, built["cases"]["accepted"])
    v1 = f"{lead.case}~de~v1"
    before = lead.row()["stages"]["review"]
    assert (before["state"], before["detail"]["note"]) == ("accepted", "unchanged")
    v2 = lead.fix_typos(v1)
    review = lead.row()["stages"]["review"]
    assert (review["state"], review["detail"]["note"]) == ("accepted", "typos_fixed")
    assert (review["detail"]["from_version"], review["detail"]["version"]) == (1, 2)
    assert [p["display_name"] for p in review["detail"]["people"]] == ["Project Lead"]
    # "Ask a reviewer to correct…" names a version: v1 is refused, v2 taken.
    for document_id, status in ((v1, 409), (v2, 200)):
        asked = lead.post(
            f"{lead.base}/documents/{document_id}/translation-correction-assignment",
            {
                "username": built["users"]["ben"],
                "expected_text_sha256": lead.document(document_id)[1],
                "reason": "Check the dose",
                "confirm_language": True,
            },
        )
        assert asked.status_code == status, asked.text
    assert asked.json()["document_id"] == v2
    lead.review("ben", asked.json()["id"], "rejected")
    # The rejected fix is the text to resolve, not the accepted v1 again.
    row = lead.row()
    assert row["next_step"]["code"] == "resolve_rejected"
    assert row["next_step"]["document_id"] == v2
    assert row["stages"]["annotation"]["state"] != "unassigned"
    preview, _ = lead.batch("ana")
    assert [t["document_id"] for t in preview["targets"]] == [v2]


def test_the_fix_of_a_rejected_correction_does_not_count_either(
    client: TestClient,
) -> None:
    """A rejected correction leaves the version before it as the text of the
    row; fixing typos in the correction does not change that."""
    built = scenario(client, "REJECTED_TRANSLATION_FOR_LEAD")
    lead = Lead(client, built, built["cases"]["to_assign"])
    v1 = f"{lead.case}~de~v1"
    text, sha, _ = lead.document(v1)
    uploaded = lead.post(
        f"{lead.base}/variants/{v1}/versions",
        {
            "text": text + " Neu.",
            "expected_text_sha256": sha,
            "method": "manual_correction",
        },
    )
    assert uploaded.status_code == 200, uploaded.text
    v2 = uploaded.json()["document_id"]
    _, commit = lead.batch("ben")
    assert [c["document_id"] for c in commit["created"]] == [v2]
    lead.review("ben", commit["created"][0]["id"], "rejected")
    before = lead.row()
    assert before["bulk"]["document_id"] == v1
    v3 = lead.fix_typos(v2)
    row = lead.row()
    assert row["bulk"]["document_id"] == v1
    assert codes(row) == codes(before)
    assert v3 in [v["document_id"] for v in row["versions"]]
