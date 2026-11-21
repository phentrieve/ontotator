"""Segment pairs of a translation review (issue 560, prototype): a reviewer's aid."""

import json

from auth_harness import logged_in
from sqlalchemy import select
from test_review_export import exported_env as exported_env
from test_translation_review_service import review_env as review_env
from test_translation_review_service import save

from ontotator.application.translation_reviews import (
    CHECKED_SENTENCES_KEY,
    SEGMENT_PAIRS_KEY,
    CheckedSentences,
    SegmentPairs,
)
from ontotator.storage.tables import AssignmentRow, TranslationReviewDraftRow

PAIRS = {
    "source_hash": "0a1b2c3d",
    "text_hash": "12345678",
    "pairs": [
        {
            "source": {"start": 0, "end": 10},
            "translation": {"start": 0, "end": 12},
            "manual": False,
            "checked": "cafebabe",
        },
        {
            "source": {"start": 11, "end": 20},
            "translation": {"start": 13, "end": 13},
            "manual": True,
            "checked": "stale",
        },
        {
            "source": {"start": 21, "end": 30},
            "translation": {"start": 14, "end": 30},
            "manual": False,
            "checked": None,
        },
    ],
}


def _save(env, pairs=PAIRS):
    return env.service.save_segment_pairs(
        env.accesses["alice"], env.ids["alice"], SegmentPairs.model_validate(pairs)
    )


def _draft_row(env):
    with env.db.transaction() as conn:
        return (
            conn.execute(
                select(TranslationReviewDraftRow).where(
                    TranslationReviewDraftRow.assignment_id == env.ids["alice"]
                )
            )
            .mappings()
            .one()
        )


def test_pairs_round_trip_and_survive_draft_saves(review_env):
    env = review_env
    opened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert opened.segment_pairs is None
    before = _draft_row(env)
    _save(env)
    row = _draft_row(env)
    # A working aid: no new revision, no new time stamp, the task is not started.
    assert row["revision"] == before["revision"]
    assert row["updated_at"] == before["updated_at"]
    with env.db.transaction() as conn:
        status = conn.execute(
            select(AssignmentRow.status).where(AssignmentRow.id == env.ids["alice"])
        ).scalar_one()
    assert status == "open"
    revision = save(env, "accepted_corrected", "Geändert")
    reopened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert reopened.segment_pairs is not None
    assert reopened.segment_pairs.model_dump() == PAIRS
    assert SEGMENT_PAIRS_KEY not in reopened.draft.form
    assert reopened.draft.revision == revision
    # A client that echoes the key in the form cannot overwrite the stored pairs.
    env.service.save_draft(
        env.accesses["alice"],
        env.ids["alice"],
        expected_revision=revision,
        text="Geändert",
        form={**reopened.draft.form, SEGMENT_PAIRS_KEY: {"pairs": []}},
    )
    again = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert again.segment_pairs is not None
    assert again.segment_pairs.model_dump() == PAIRS
    # Checked sentences and pairs are stored side by side.
    env.service.save_checked_sentences(
        env.accesses["alice"],
        env.ids["alice"],
        CheckedSentences(),
    )
    form = _draft_row(env)["form"]
    assert SEGMENT_PAIRS_KEY in form and CHECKED_SENTENCES_KEY in form


def test_stored_pairs_that_no_longer_fit_read_as_none(review_env):
    env = review_env
    env.service.open(env.accesses["alice"], env.ids["alice"])
    with env.db.transaction() as conn:
        conn.execute(
            TranslationReviewDraftRow.__table__.update()
            .where(TranslationReviewDraftRow.assignment_id == env.ids["alice"])
            .values(form={SEGMENT_PAIRS_KEY: {"pairs": "broken"}})
        )
    assert (
        env.service.open(env.accesses["alice"], env.ids["alice"]).segment_pairs is None
    )


def test_http_contract_validates(review_env):
    env = review_env
    client = logged_in(env.app, "alice", assignments=[])
    url = f"/api/v1/translation-reviews/{env.ids['alice']}"
    assert client.get(url).json()["segment_pairs"] is None
    response = client.put(url + "/segment-pairs", json=PAIRS)
    assert response.status_code == 200, response.text
    assert response.json() == PAIRS
    assert client.get(url).json()["segment_pairs"] == PAIRS
    first = PAIRS["pairs"][0]
    for bad in (
        {**PAIRS, "text_hash": "XYZ"},
        {**PAIRS, "pairs": [{**first, "checked": "nothex!!"}]},
        {**PAIRS, "pairs": [{**first, "source": {"start": 5, "end": 2}}]},
        {**PAIRS, "pairs": [first, first]},
        {**PAIRS, "other": 1},
    ):
        assert client.put(url + "/segment-pairs", json=bad).status_code == 422
    bob = logged_in(env.app, "bob", assignments=[])
    assert bob.put(url + "/segment-pairs", json=PAIRS).status_code == 404


def test_pairs_never_reach_the_review_result(exported_env):
    env = exported_env
    env.service.open(env.accesses["alice"], env.ids["alice"])
    _save(env)
    revision = save(env, rationale="Checked.")
    record = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    dumped = record.model_dump_json()
    assert SEGMENT_PAIRS_KEY not in dumped and "cafebabe" not in dumped
    reopened = env.service.open(env.accesses["alice"], env.ids["alice"])
    assert reopened.segment_pairs is None
    records = env.lead.get(
        "/api/v1/projects/proj/documents/target/translation-reviews"
    ).json()
    assert records and "cafebabe" not in json.dumps(records)
