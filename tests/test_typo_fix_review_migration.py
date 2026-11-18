"""Migration 0046 (review 2, F1), data only: a typo fix left ``reviewed``
behind a review of the old text becomes ``accepted`` like the version it
fixes. It follows 0045 (the lead pause): one head."""

from __future__ import annotations

from typing import Any

from alembic import command
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from pg_harness import owner_engine
from sqlalchemy import text, update
from test_browser_lead_workflow_fixture import client as client
from test_browser_lead_workflow_fixture import scenario
from test_typo_fix_review import Lead

from ontotator.storage.schema import alembic_config, current_revision, head_revision
from ontotator.storage.tables import DocumentRow

REVISION = "0046"
PREVIOUS = "0045"


def test_one_head_follows_the_lead_pause() -> None:
    scripts = ScriptDirectory.from_config(alembic_config())
    assert scripts.get_heads() == [head_revision()] == [REVISION]
    revision = scripts.get_revision(REVISION)
    assert revision is not None and revision.down_revision == PREVIOUS


def test_a_fix_behind_an_accepted_version_becomes_accepted(
    client: TestClient,
) -> None:
    built = scenario(client, "REJECTED_TRANSLATION_FOR_LEAD")
    cases = built["cases"]
    stuck = Lead(client, built, cases["queried"])
    v1 = f"{stuck.case}~de~v1"
    v2 = stuck.fix_typos(v1)
    v3 = stuck.fix_typos(v2)
    # A fix of a text that is still rejected stays as it is.
    rejected = Lead(client, built, cases["rejected"])
    kept = rejected.fix_typos(f"{rejected.case}~de~v1")
    app: Any = client.app
    db = app.state.repo.db
    with db.transaction() as conn:
        # As a review of v1 assigned after the fix left it: v1 accepted, the
        # fixes still "reviewed".
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == v1)
            .values(translation_status="accepted")
        )
    owner = owner_engine(db)
    try:
        with owner.begin() as conn:
            command.downgrade(alembic_config(conn), PREVIOUS)
        with owner.begin() as conn:
            assert current_revision(conn) == PREVIOUS
            # The downgrade changes no data.
            assert stuck.document(v2)[2] == "reviewed"
            command.upgrade(alembic_config(conn), REVISION)
    finally:
        owner.dispose()
    with db.transaction() as conn:
        assert current_revision(conn) == REVISION
        statuses = dict(
            conn.execute(
                text(
                    "SELECT document_id, translation_status FROM ontotator.documents"
                    " WHERE document_id = ANY(:ids)"
                ),
                {"ids": [v1, v2, v3, kept]},
            ).all()
        )
    assert statuses == {
        v1: "accepted",
        v2: "accepted",
        v3: "accepted",
        kept: "reviewed",
    }
    # The row goes on: the annotation of the fixed text can be assigned.
    row = stuck.row()
    assert row["next_step"]["code"] == "assign_annotation"
    assert row["next_step"]["document_id"] == v3
    review = row["stages"]["review"]
    assert (review["state"], review["detail"]["note"]) == ("accepted", "typos_fixed")
    assert rejected.row()["next_step"]["code"] == "resolve_rejected"
