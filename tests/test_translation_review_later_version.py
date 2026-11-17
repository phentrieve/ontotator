"""The review of a version after the first: its own origin, its predecessor
and no failed check carried over from the first version (user review 2026-11)."""

from typing import Any

from auth_harness import HARNESS
from sqlalchemy import insert
from test_editorial_correction import correct
from test_lead_correction import decide
from test_translation_review_service import review_env as review_env
from test_translation_review_service import save
from test_version_upload import upload

from ontotator.assignments.service import AssignmentService
from ontotator.storage.tables import AssignmentRow


def assign_bob(env: Any, document_id: str) -> int:
    """A new open review of ``document_id`` for Bob."""
    with env.db.transaction() as conn:
        return conn.execute(
            insert(AssignmentRow)
            .values(
                project_id=env.pid,
                document_id=document_id,
                user_id=env.accesses["bob"].user_id,
                task="translation_review",
                status="open",
            )
            .returning(AssignmentRow.id)
        ).scalar_one()


def task(env: Any, name: str, assignment_id: int) -> Any:
    tasks = AssignmentService(env.db).my_tasks(env.accesses[name].user_id)
    return next(t for t in tasks if t.assignment_id == assignment_id)


def test_the_first_version_keeps_its_failed_check_and_has_no_origin(review_env):
    env = review_env
    workspace = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert [c.code for c in workspace.failed_checks] == ["units_added"]
    assert workspace.version_origin is None
    assert workspace.previous_version is None
    assert task(env, "alice", env.ids["alice"]).failed_check_count == 1


def test_an_uploaded_version_shows_its_upload_and_carries_no_failed_check(review_env):
    env = review_env
    AssignmentService(env.db).revoke(HARNESS, env.ids["bob"])
    decide(env, "rejected")
    uploaded = upload(
        env,
        text="Von Hand übersetzt",
        method="human_translation",
        made_by="Dr. Roe",
        note="Checked against the source",
    )
    env.ids["bob"] = assign_bob(env, uploaded["document_id"])
    bob = env.accesses["bob"]
    workspace = env.service.open(bob, env.ids["bob"])
    assert workspace.failed_checks == []
    # The run and its checks stay readable as those of the first version.
    assert workspace.translation_ancestor.document_id == "target"
    assert workspace.translation_ancestor.translation["checks"]
    origin = workspace.version_origin
    assert origin is not None
    assert (origin.kind, origin.previous_version, origin.method) == (
        "upload",
        1,
        "human_translation",
    )
    assert (origin.made_by, origin.note) == ("Dr. Roe", "Checked against the source")
    assert origin.at is not None
    previous = workspace.previous_version
    assert previous is not None
    assert (previous.variant.document_id, previous.text) == ("target", "Übersetzt")
    assert task(env, "bob", env.ids["bob"]).failed_check_count == 0
    # "Accepted unchanged" needs no rationale for a check of the first version.
    opened = env.service.open(bob, env.ids["bob"])
    revision = env.service.save_draft(
        bob,
        env.ids["bob"],
        expected_revision=opened.draft.revision,
        text=opened.text,
        form={"decision": "accepted_unchanged", "clinical_change": False},
    )
    record = env.service.submit(bob, env.ids["bob"], expected_revision=revision)
    assert (record.decision, record.status_after) == ("accepted_unchanged", "accepted")


def test_a_version_corrected_in_a_review_says_so(review_env):
    env = review_env
    AssignmentService(env.db).revoke(HARNESS, env.ids["bob"])
    revision = save(env, "accepted_corrected", text="Korrigiert")
    record = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    assert record.created_variant_id is not None
    env.ids["bob"] = assign_bob(env, record.created_variant_id)
    workspace = env.service.open(env.accesses["bob"], env.ids["bob"])
    origin = workspace.version_origin
    assert origin is not None
    assert (origin.kind, origin.previous_version, origin.method) == (
        "review_correction",
        1,
        None,
    )
    assert origin.at == record.created_at
    assert workspace.previous_version is not None
    assert workspace.previous_version.text == "Übersetzt"
    assert workspace.failed_checks == []


def test_a_version_made_by_fix_typos_says_so_and_carries_no_failed_check(review_env):
    """An editorial correction (issue 453) is a later version like the others."""
    env = review_env
    AssignmentService(env.db).revoke(HARNESS, env.ids["bob"])
    AssignmentService(env.db).revoke(HARNESS, env.ids["alice"])
    corrected = correct(env, text="Übersetzt.", reason="Spacing; Typo")
    env.ids["bob"] = assign_bob(env, corrected["document_id"])
    workspace = env.service.open(env.accesses["bob"], env.ids["bob"])
    origin = workspace.version_origin
    assert origin is not None
    assert (origin.kind, origin.previous_version, origin.note, origin.method) == (
        "editorial_correction",
        1,
        "Spacing; Typo",
        None,
    )
    assert origin.at is not None
    previous = workspace.previous_version
    assert previous is not None
    assert (previous.variant.document_id, previous.text) == ("target", "Übersetzt")
    # The version keeps the status of the one it fixes; the failed check of the
    # run is one of the first version only.
    assert workspace.failed_checks == []
    assert task(env, "bob", env.ids["bob"]).failed_check_count == 0
