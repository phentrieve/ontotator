"""An API token of a blinded consolidator reads no author through the text
and submission routes (issues 302 and 442).

The MCP server's content tools (``get_text_version``, ``list_annotation_versions``,
``get_annotation_version``, ``get_submission``) return what these routes
return for the token's owner. With ``blind_consolidation`` on, a ``read``
token of the consolidator must get neither a name, a username nor a
pseudonym of an input author, nor a hash that names one, and must not reach
drafts or unsubmitted work.
"""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from test_consolidation_blinding_ids import _bare_hashes, _candidates, _version
from test_consolidation_resolve_api import FIRST, SECOND, build_round
from work_plan_support import doc

from ontotator.auth.audit import Actor

PROJECT = "/api/v1/projects/proj"
DOCUMENT = f"{PROJECT}/documents/{quote(doc('c1', 'en'), safe='')}"
AUTHORS = ("anno", "anno2")


@pytest.fixture
def ns(tmp_path: Any) -> Any:
    return build_round(tmp_path)


def _token(ns: Any, owner: str, **options: Any) -> TestClient:
    issued = ns.env.app.state.api_tokens.create(
        Actor.cli(), owner, name="mcp read", scopes=["read"], **options
    )
    return TestClient(ns.env.app, headers={"Authorization": f"Bearer {issued.secret}"})


def _hide(ns: Any) -> None:
    response = ns.env.lead.patch(
        f"{PROJECT}/settings", json={"blind_consolidation": True}
    )
    assert response.status_code == 200, response.text


def _identities(ns: Any) -> list[str]:
    """Display name, username and pseudonym of each input author."""
    accounts = ns.env.app.state.accounts
    found = []
    for username in AUTHORS:
        user = accounts.get_by_username(username)
        found += [str(user.pseudonym), user.display_name, username]
    return found


def _leaks(ns: Any, payload: Any) -> list[str]:
    text = json.dumps(payload, ensure_ascii=False)
    return [
        identity
        for identity in _identities(ns)
        # A whole word: the username "anno" is also part of "annotation".
        if re.search(rf"(?<![\w-]){re.escape(identity)}(?![\w-])", text)
    ]


def _reads(client: TestClient) -> dict[str, Any]:
    """The routes behind the four MCP content tools, as the token reads them."""
    out = {
        "variant": client.get(f"{DOCUMENT}/variant"),
        "text": client.get(f"{DOCUMENT}/text"),
        "versions": client.get(f"{DOCUMENT}/annotation-versions"),
        "submissions": client.get(f"{DOCUMENT}/submissions"),
    }
    for sid in (FIRST, SECOND):
        out[sid] = client.get(f"{DOCUMENT}/submissions/{quote(sid, safe='')}")
    for name, response in out.items():
        assert response.status_code == 200, (name, response.text)
    return {name: response.json() for name, response in out.items()}


def test_the_routes_name_the_authors_to_a_token_while_names_show(ns: Any) -> None:
    # What the setting must prevent: without it the history names the authors.
    reads = _reads(_token(ns, "adj"))
    assert _leaks(ns, reads[FIRST]) != []


def test_a_blinded_consolidators_token_reads_no_author(ns: Any) -> None:
    _hide(ns)
    client = _token(ns, "adj")
    reads = _reads(client)
    for name, body in reads.items():
        assert _leaks(ns, body) == [], name
        assert _bare_hashes(body) == [], name
    labels = {row["submission_id"]: row["author_label"] for row in reads["submissions"]}
    assert labels == {FIRST: "Annotator A", SECOND: "Annotator B"}
    # No snapshot's version can be recomputed with a member's pseudonym.
    for sid in (FIRST, SECOND):
        assert reads[sid]["annotations"]
        for snap in reads[sid]["annotations"]:
            actor = snap["annotation"]["provenance"]["actor"]["actor_id"]
            assert actor in {"annotator-a", "annotator-b"}
            assert all(
                _version(snap, candidate) != snap["version"]
                for candidate in _candidates(ns)
            )
    # The consolidator is offered no version of another person, and a single
    # annotation version of one is refused, whatever kind is asked for.
    assert all(ref["kind"] not in {"submission", "final"} for ref in reads["versions"])
    for kind in ("submission", "own", "final", "stage_result", "release"):
        for sid in (FIRST, SECOND):
            refused = client.get(
                f"{DOCUMENT}/annotation-versions/{kind}/{quote(sid, safe='')}"
            )
            assert refused.status_code == 404, (kind, sid, refused.text)
            assert refused.json()["code"] == "VERSION_NOT_FOUND"
    # Every version the token is offered reads without an author as well.
    for ref in reads["versions"]:
        one = client.get(
            f"{DOCUMENT}/annotation-versions/{ref['kind']}/{quote(ref['id'], safe='')}"
        )
        assert one.status_code == 200, one.text
        assert _leaks(ns, one.json()) == [], ref


def test_a_leads_token_reads_the_single_annotation_version(ns: Any) -> None:
    # Issue 442: the one route of its list that was not tried with a token.
    client = _token(ns, "leader", kind="project", project_key="proj")
    versions = client.get(f"{DOCUMENT}/annotation-versions")
    assert versions.status_code == 200, versions.text
    offered = {(ref["kind"], ref["id"]) for ref in versions.json()}
    assert {("submission", FIRST), ("submission", SECOND)} <= offered
    one = client.get(
        f"{DOCUMENT}/annotation-versions/submission/{quote(FIRST, safe='')}"
    )
    assert one.status_code == 200, one.text
    body = one.json()
    assert body["ref"]["id"] == FIRST
    assert [s["annotation"]["annotation_id"] for s in body["annotations"]] == [
        "a1",
        "a2",
        "a3",
    ]
    assert body["evidence"]


def test_drafts_and_unsubmitted_work_stay_out_of_reach(ns: Any) -> None:
    """The consolidation round of ``adj`` is open: nothing of it is offered or
    readable through the content routes, to its owner's token or a lead's."""
    round_id = ns.round.round_id
    for client in (
        _token(ns, "adj"),
        _token(ns, "leader", kind="project", project_key="proj"),
    ):
        submissions = client.get(f"{DOCUMENT}/submissions").json()
        assert {row["submission_id"] for row in submissions} == {FIRST, SECOND}
        versions = client.get(f"{DOCUMENT}/annotation-versions").json()
        assert all(
            ref["id"] in {FIRST, SECOND} or ref["kind"] == "proposals"
            for ref in versions
        )
        for kind in ("own", "submission", "final"):
            refused = client.get(
                f"{DOCUMENT}/annotation-versions/{kind}/{quote(round_id, safe='')}"
            )
            assert refused.status_code == 404, refused.text
        refused = client.get(f"{DOCUMENT}/submissions/{quote(round_id, safe='')}")
        assert refused.status_code == 404, refused.text
        # Opening a round or a workspace (the draft) stays session-only.
        for path in (f"/api/v1/rounds/{round_id}/open", "/api/v1/workspaces/open"):
            refused = client.post(path, json={})
            assert refused.status_code == 403, (path, refused.text)
            assert refused.json()["code"] == "TOKEN_NOT_ALLOWED", path
