"""Segment pairs of a translation review (issue 560, prototype): a reviewer's aid."""

import json

from auth_harness import logged_in
from sqlalchemy import func, select
from test_review_export import exported_env as exported_env
from test_review_export import queued, run
from test_translation_review_service import review_env as review_env
from test_translation_review_service import save

from ontotator.application.translation_reviews import (
    CHECKED_SENTENCES_KEY,
    SEGMENT_PAIRS_KEY,
    CheckedSentences,
    SegmentPairs,
    merged_segment_pairs,
)
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    TranslationReviewDraftRow,
)

PAIRS = {
    "source_hash": "0a1b2c3d",
    "text_hash": "12345678",
    "pairs": [
        {
            "source": {"start": 0, "end": 10},
            "translation": {"start": 0, "end": 12},
            "origin": "aligner",
            "checked": "cafebabe",
        },
        {
            "source": {"start": 11, "end": 20},
            "translation": {"start": 13, "end": 13},
            "origin": "manual",
            "checked": "stale",
        },
        {
            "source": {"start": 21, "end": 30},
            "translation": {"start": 14, "end": 30},
            "origin": "aligner",
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
        # Only the known origins; the prototype's "manual" flag is gone.
        {**PAIRS, "pairs": [{**first, "origin": "imported"}]},
        {**PAIRS, "pairs": [{**first, "origin": None}]},
        {**PAIRS, "pairs": [{**first, "manual": True}]},
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


def _with_checks(*checks):
    """PAIRS with the given checked marks, pair by pair."""
    return SegmentPairs.model_validate(
        {
            **PAIRS,
            "pairs": [
                {**pair, "checked": check}
                for pair, check in zip(PAIRS["pairs"], checks, strict=True)
            ],
        }
    )


def _checks(pairs):
    return [pair.checked for pair in pairs.pairs]


def test_two_tabs_keep_each_others_checks():
    base = _with_checks(None, None, None)
    # Tab B checked pair 3 and saved; tab A, made from base, checked pair 1.
    stored = _with_checks(None, None, "0000000c")
    mine = _with_checks("0000000a", None, None)
    assert _checks(merged_segment_pairs(stored, base, mine)) == [
        "0000000a",
        None,
        "0000000c",
    ]
    # A check taken away in one tab stays away; one set in the other stays set.
    base = _with_checks("0000000a", None, "0000000c")
    stored = _with_checks("0000000a", None, None)
    mine = _with_checks(None, "0000000b", "0000000c")
    assert _checks(merged_segment_pairs(stored, base, mine)) == [
        None,
        "0000000b",
        None,
    ]
    # Both tabs changed the same pair: this tab's save wins.
    stored = _with_checks("0000000a", None, "stale")
    mine = _with_checks("0000000a", None, "0000000d")
    assert _checks(merged_segment_pairs(stored, base, mine)) == [
        "0000000a",
        None,
        "0000000d",
    ]


def test_two_tabs_keep_the_other_tabs_merge_and_this_tabs_checks():
    base = _with_checks(None, None, None)
    # Tab B merged pairs 2 and 3; tab A, which did not change the pairs, checked 1.
    merged_pair = {
        "source": {"start": 11, "end": 30},
        "translation": {"start": 13, "end": 30},
        "origin": "manual",
        "checked": None,
    }
    stored = SegmentPairs.model_validate(
        {**PAIRS, "pairs": [{**PAIRS["pairs"][0], "checked": None}, merged_pair]}
    )
    mine = _with_checks("0000000a", None, None)
    result = merged_segment_pairs(stored, base, mine)
    assert [p.source.end for p in result.pairs] == [10, 30]
    assert _checks(result) == ["0000000a", None]


def test_without_base_or_on_other_texts_the_save_replaces():
    stored = _with_checks("0000000a", None, None)
    mine = _with_checks(None, None, "0000000c")
    assert merged_segment_pairs(stored, None, mine) == mine
    assert merged_segment_pairs(None, stored, mine) == mine
    other_text = mine.model_copy(update={"text_hash": "87654321"})
    assert merged_segment_pairs(stored, mine, other_text) == other_text


def test_http_save_with_base_merges_two_tabs(review_env):
    env = review_env
    client = logged_in(env.app, "alice", assignments=[])
    url = f"/api/v1/translation-reviews/{env.ids['alice']}/segment-pairs"
    base = _with_checks(None, None, None).model_dump(mode="json")
    assert client.put(url, json=base).status_code == 200
    tab_b = _with_checks(None, None, "0000000c").model_dump(mode="json")
    assert client.put(url, json={**tab_b, "base": base}).status_code == 200
    tab_a = _with_checks("0000000a", None, None).model_dump(mode="json")
    response = client.put(url, json={**tab_a, "base": base})
    assert response.status_code == 200, response.text
    assert [p["checked"] for p in response.json()["pairs"]] == [
        "0000000a",
        None,
        "0000000c",
    ]
    assert "base" not in response.json()
    stored = client.get(f"/api/v1/translation-reviews/{env.ids['alice']}").json()
    assert stored["segment_pairs"] == response.json()


def test_saving_pairs_writes_no_audit_event(review_env):
    env = review_env
    env.service.open(env.accesses["alice"], env.ids["alice"])

    def count():
        with env.db.transaction() as conn:
            return conn.execute(
                select(func.count()).select_from(AuditEventRow)
            ).scalar_one()

    before = count()
    _save(env)
    _save(env)
    assert count() == before


def test_pairs_never_reach_the_review_export(exported_env):
    env = exported_env
    env.service.open(env.accesses["alice"], env.ids["alice"])
    _save(env)
    revision = save(env, rationale="Checked.")
    env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    result = run(env, queued(env))
    data = env.db.blobs.get(result.result["sha256"]).decode()
    assert "cafebabe" not in data and SEGMENT_PAIRS_KEY not in data
    with env.db.transaction() as conn:
        details = conn.execute(select(AuditEventRow.details)).scalars().all()
    assert "cafebabe" not in json.dumps(details, default=str)


def test_a_client_that_does_not_know_pairs_keeps_them(review_env):
    """An API client (or an older browser tab) saves the draft with the four form
    fields only: the stored pairs and marks stay."""
    env = review_env
    client = logged_in(env.app, "alice", assignments=[])
    url = f"/api/v1/translation-reviews/{env.ids['alice']}"
    opened = client.get(url).json()
    client.put(url + "/segment-pairs", json=PAIRS)
    response = client.put(
        url + "/draft",
        json={
            "expected_revision": opened["draft"]["revision"],
            "text": opened["draft"]["text"],
            "form": {"decision": "accepted_unchanged", "clinical_change": False},
        },
    )
    assert response.status_code == 200, response.text
    again = client.get(url).json()
    assert again["segment_pairs"] == PAIRS
    assert set(again["draft"]["form"]) == {"decision", "clinical_change"}


def test_every_origin_is_stored_as_it_is_and_none_reads_as_the_aligner(review_env):
    """Pairs by hand (#640) and of the pipeline (ontospan#16) fit the stored format."""
    env = review_env
    client = logged_in(env.app, "alice", assignments=[])
    url = f"/api/v1/translation-reviews/{env.ids['alice']}"
    origins = ["pipeline", "manual", "aligner"]
    pairs = {
        **PAIRS,
        "pairs": [
            {**pair, "origin": origin}
            for pair, origin in zip(PAIRS["pairs"], origins, strict=True)
        ],
    }
    response = client.put(url + "/segment-pairs", json=pairs)
    assert response.status_code == 200, response.text
    stored = client.get(url).json()["segment_pairs"]
    assert [pair["origin"] for pair in stored["pairs"]] == origins
    assert [
        pair["origin"] for pair in _draft_row(env)["form"][SEGMENT_PAIRS_KEY]["pairs"]
    ] == origins
    # A client that leaves the origin out sends pairs of the aligner.
    bare = {
        **PAIRS,
        "pairs": [
            {key: value for key, value in pair.items() if key != "origin"}
            for pair in PAIRS["pairs"]
        ],
    }
    response = client.put(url + "/segment-pairs", json=bare)
    assert [pair["origin"] for pair in response.json()["pairs"]] == ["aligner"] * 3
