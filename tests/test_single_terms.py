"""Single-term candidates (#381): rules, grouping and the exclusion report.

Every text and term below is invented for the tests.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime

import ontospan
import pytest

from ontotator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Provenance,
    snapshot,
)
from ontotator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    Segment,
    snapshot_evidence,
)
from ontotator.domain.review import ReviewDecision, ReviewTargetSet
from ontotator.domain.workspace import Submission, WorkspaceKey
from ontotator.exchange.single_terms import (
    EXCLUSION_REASONS,
    GROUP_ID_PREFIX,
    SourceUnit,
    annotation_versions,
    derive_candidates,
    group_id,
    normalize_phrase,
    source_units,
    surface_form,
)

CREATED = datetime(2026, 11, 1, 9, 0, tzinfo=UTC)
BUNDLE = "selected-snap-1"

# An invented miniature of HPO: root, phenotypic abnormality and a few terms.
PARENTS = {
    "HP:0000001": frozenset(),
    "HP:0000118": frozenset({"HP:0000001"}),
    "HP:0001250": frozenset({"HP:0000118"}),  # seizure
    "HP:0002315": frozenset({"HP:0000118"}),  # headache
    "HP:0012823": frozenset({"HP:0000001"}),  # clinical modifier
    "HP:0012828": frozenset({"HP:0012823"}),  # severe
    "HP:0001251": frozenset({"HP:0000118"}),  # ataxia
}
LABELS = {
    "HP:0000001": "All",
    "HP:0000118": "Phenotypic abnormality",
    "HP:0001250": "Seizure",
    "HP:0002315": "Headache",
    "HP:0012823": "Clinical modifier",
    "HP:0012828": "Severe",
    "HP:0001251": "Ataxia",
}


class FakeView:
    """An OntologyView over the invented terms above."""

    def __init__(
        self,
        release: str = "2026-06-01",
        *,
        obsolete: frozenset[str] = frozenset(),
        labels: dict[str, str] | None = None,
    ) -> None:
        self._release = release
        self._obsolete = obsolete
        self._labels = {**LABELS, **(labels or {})}

    @property
    def release(self) -> str | None:
        return self._release

    def label(self, term_id: str) -> str | None:
        return self._labels.get(term_id)

    def is_active(self, term_id: str) -> bool:
        return term_id in self._labels and term_id not in self._obsolete

    def ancestors(self, term_id: str) -> frozenset[str]:
        found: set[str] = set()
        todo = list(PARENTS.get(term_id, ()))
        while todo:
            item = todo.pop()
            if item not in found:
                found.add(item)
                todo.extend(PARENTS.get(item, ()))
        return frozenset(found)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _layer(
    layer_id: str = "hpo",
    profile: str = "hpo-phenotype",
    release: str = "2026-06-01",
    digest: str | None = None,
) -> ontospan.Layer:
    return ontospan.Layer(
        layer_id=layer_id,
        profile=profile,
        ontology=ontospan.OntologyResource(
            id="hp" if profile == "hpo-phenotype" else "other",
            version=release,
            sha256=digest or _sha(release),
        ),
    )


def _find(text: str, word: str, nth: int = 0) -> tuple[int, int]:
    start = -1
    for _ in range(nth + 1):
        start = text.index(word, start + 1)
    return start, start + len(word)


def finding(
    text: str,
    annotation_id: str,
    *spans: tuple[int, int] | list[tuple[int, int]],
    term: str = "HP:0001250",
    layer_id: str = "hpo",
    modifiers: tuple[tuple[str, tuple[int, int]], ...] = (),
    resolved: bool = True,
    **axes: str,
) -> ontospan.Annotation:
    """A finding; a list in ``spans`` is one discontinuous mention."""
    values = {
        "assertion": "present",
        "experiencer": "patient",
        "temporality": "current",
    }
    values.update(axes)
    mentions = tuple(
        ontospan.Mention(
            segments=tuple(
                ontospan.segment(text, s, e)
                for s, e in (span if isinstance(span, list) else [span])
            )
        )
        for span in spans
    )
    return ontospan.Annotation(
        annotation_id=annotation_id,
        layer_id=layer_id,
        term_id=term,
        axes={
            k: ontospan.AxisValue(value=v, basis="chosen") for k, v in values.items()
        },
        mentions=mentions,
        document_level=not mentions,
        modifiers=tuple(
            ontospan.Modifier(term_id=m, segments=(ontospan.segment(text, *span),))
            for m, span in modifiers
        ),
        provenance=ontospan.Provenance(
            actor=ontospan.Actor(actor_id="ann-0001", kind="human"), method="manual"
        ),
        review_resolution=None
        if resolved
        else ontospan.ReviewResolution(
            outcome="uncertain",
            reviewer=ontospan.Actor(actor_id="ann-0001", kind="human"),
            note="open",
        ),
    )


def source(
    text: str,
    annotations: list[ontospan.Annotation],
    *,
    sid: str = "s1",
    document_id: str = "DOC-1",
    language: str = "en",
    layers: tuple[ontospan.Layer, ...] | None = None,
    view: FakeView | None = None,
    not_findings: frozenset[str] = frozenset(),
    versions: dict[str, str] | None = None,
) -> SourceUnit:
    layers = layers or (_layer(), _layer("anatomy", "generic"))
    unit = ontospan.AnnotatedDocument(
        document=ontospan.Document(
            document_id=document_id,
            language=language,
            text=text,
            text_sha256=_sha(text),
        ),
        annotation_set=ontospan.AnnotationSet(
            annotation_set_id=f"submission-{sid}",
            set_kind="stage_result",
            actors=(ontospan.Actor(actor_id="ann-0001", kind="human"),),
            created_at=CREATED,
            layers=layers,
            annotations=tuple(annotations),
        ),
    )
    the_view = view or FakeView(layers[0].ontology.version)
    return SourceUnit(
        submission_id=sid,
        unit=unit,
        views={layer.ontology.id: the_view for layer in layers},
        language=language,
        document_id=document_id,
        text_version="1",
        source_text_line=1,
        annotation_versions=versions or {},
        not_findings=not_findings,
    )


def derive(*units: SourceUnit):
    return derive_candidates(units, bundle_id=BUNDLE)


def only_group(derivation):
    [group] = derivation.groups
    return group


# --- rules --------------------------------------------------------------------


def test_a_plain_finding_becomes_one_occurrence_with_its_export_data():
    text = "The child had a seizure at night."
    span = _find(text, "seizure")
    unit = source(text, [finding(text, "a1", span)], versions={"a1": "v7"})
    group = only_group(derive(unit))
    assert group.term_id == "HP:0001250"
    assert group.label == "Seizure"
    assert group.phrase == "seizure"
    assert group.display_text == "seizure"
    assert not group.blocked and not group.conflict and group.flags == ()
    [occ] = group.occurrences
    assert (occ.start, occ.end, occ.text) == (*span, "seizure")
    assert occ.document_id == "DOC-1" and occ.submission_id == "s1"
    assert occ.annotation_version == "v7"
    assert occ.annotation_ref == ontospan.annotation_ref("submission-s1", "a1", BUNDLE)
    assert occ.axes == {
        "assertion": "present",
        "experiencer": "patient",
        "temporality": "current",
    }
    assert occ.ontology_release == "2026-06-01"
    assert occ.ontology_digest == _sha("2026-06-01")
    assert occ.text_sha256 == _sha(text)


@pytest.mark.parametrize(
    ("make", "reason"),
    [
        (lambda t, s: finding(t, "x", s, layer_id="anatomy"), "other_layer"),
        (lambda t, s: finding(t, "x", s, assertion="absent"), "not_present"),
        (lambda t, s: finding(t, "x", s, assertion="uncertain"), "not_present"),
        (lambda t, s: finding(t, "x", s, experiencer="family_member"), "not_patient"),
        (lambda t, s: finding(t, "x", s, experiencer="unknown"), "not_patient"),
        (lambda t, s: finding(t, "x", s, resolved=False), "unresolved"),
        (lambda t, s: finding(t, "x"), "no_span"),
    ],
)
def test_finding_rules_exclude(make, reason):
    text = "The child had a seizure at night."
    derivation = derive(source(text, [make(text, _find(text, "seizure"))]))
    assert derivation.groups == ()
    assert derivation.exclusions == {reason: {"en": 1}}
    report = derivation.report()
    assert list(report["exclusions"]) == list(EXCLUSION_REASONS)
    assert report["exclusions"][reason] == {"en": 1}


def test_rules_apply_in_order_first_wins():
    text = "The child had a seizure at night."
    item = finding(
        text, "x", layer_id="anatomy", assertion="absent", experiencer="other"
    )
    assert derive(source(text, [item])).exclusions == {"other_layer": {"en": 1}}
    item = finding(text, "x", assertion="absent", experiencer="other", resolved=False)
    assert derive(source(text, [item])).exclusions == {"not_present": {"en": 1}}


def test_temporality_is_no_rule():
    text = "The child had a seizure years ago."
    item = finding(text, "a1", _find(text, "seizure"), temporality="historical")
    group = only_group(derive(source(text, [item])))
    assert group.occurrences[0].axes["temporality"] == "historical"


def test_discontinuous_mention_is_excluded_but_other_mentions_pass():
    text = "Seizure, focal; later another seizure."
    item = finding(
        text,
        "a1",
        [_find(text, "Seizure"), _find(text, "focal")],
        _find(text, "seizure"),
    )
    derivation = derive(source(text, [item]))
    assert derivation.exclusions == {"discontinuous": {"en": 1}}
    assert len(only_group(derivation).occurrences) == 1
    assert derivation.occurrences == {"en": 1}


def test_shared_span_excludes_both_findings_on_the_same_span():
    text = "Episodes of ataxia were noted."
    span = _find(text, "ataxia")
    derivation = derive(
        source(
            text,
            [finding(text, "a1", span), finding(text, "a2", span, term="HP:0001251")],
        )
    )
    assert derivation.groups == ()
    assert derivation.exclusions == {"shared_span": {"en": 2}}


def test_shared_span_counts_whatever_the_other_assertion():
    text = "Episodes of ataxia were noted."
    span = _find(text, "ataxia")
    derivation = derive(
        source(
            text,
            [
                finding(text, "a1", span),
                finding(text, "a2", span, term="HP:0001251", assertion="absent"),
            ],
        )
    )
    assert derivation.exclusions == {
        "shared_span": {"en": 1},
        "not_present": {"en": 1},
    }


def test_obsolete_or_unknown_term_is_excluded():
    text = "The child had a seizure at night."
    span = _find(text, "seizure")
    view = FakeView(obsolete=frozenset({"HP:0001250"}))
    derivation = derive(source(text, [finding(text, "a1", span)], view=view))
    assert derivation.exclusions == {"obsolete_term": {"en": 1}}
    unknown = finding(text, "a1", span, term="HP:9999999")
    assert derive(source(text, [unknown])).exclusions == {"obsolete_term": {"en": 1}}


def test_uncertain_proposal_check_targets_are_no_findings():
    text = "Episodes of ataxia with a seizure."
    target = finding(text, "p1", _find(text, "ataxia"), term="HP:0001251")
    own = finding(text, "a1", (_find(text, "ataxia")[0], _find(text, "seizure")[1]))
    derivation = derive(source(text, [target, own], not_findings=frozenset({"p1"})))
    # Neither counted nor blocking the finding that covers its span.
    assert derivation.exclusions == {}
    assert not only_group(derivation).blocked


# --- blocked ------------------------------------------------------------------


@pytest.mark.parametrize("assertion", ["present", "absent", "uncertain"])
def test_span_containing_another_finding_is_blocked_whatever_its_assertion(
    assertion,
):
    text = "Recurrent seizure with ataxia since spring."
    outer = (_find(text, "seizure")[0], _find(text, "ataxia")[1])
    derivation = derive(
        source(
            text,
            [
                finding(text, "outer", outer),
                finding(
                    text,
                    "inner",
                    _find(text, "ataxia"),
                    term="HP:0001251",
                    assertion=assertion,
                ),
            ],
        )
    )
    blocked = {g.term_id: g.blocked_reason for g in derivation.groups}
    assert blocked["HP:0001250"] == "contains_other_finding"
    if assertion == "present":
        # The inner one overlaps the outer one: blocked too.
        assert blocked["HP:0001251"] == "contains_other_finding"
    report = derivation.report()
    assert report["blocked_groups"]["contains_other_finding"]["en"] == len(blocked)


def test_partial_overlap_blocks_but_adjacent_spans_do_not():
    text = "severe headache attack"
    head = _find(text, "headache")
    derivation = derive(
        source(
            text,
            [
                finding(text, "a1", (0, head[1]), term="HP:0002315"),
                finding(text, "a2", (head[0], len(text)), term="HP:0001250"),
            ],
        )
    )
    assert all(g.blocked_reason == "contains_other_finding" for g in derivation.groups)
    adjacent = derive(
        source(
            text,
            [
                finding(text, "a1", (0, head[1]), term="HP:0002315"),
                finding(text, "a2", (head[1] + 1, len(text)), term="HP:0001250"),
            ],
        )
    )
    assert not any(g.blocked for g in adjacent.groups)


def test_another_layer_neither_blocks_nor_shares():
    text = "pain in the left knee"
    derivation = derive(
        source(
            text,
            [
                finding(text, "a1", (0, len(text)), term="HP:0002315"),
                finding(text, "b1", _find(text, "knee"), layer_id="anatomy"),
                finding(text, "b2", (0, len(text)), layer_id="anatomy"),
            ],
        )
    )
    assert not only_group(derivation).blocked
    assert derivation.exclusions == {"other_layer": {"en": 2}}


@pytest.mark.parametrize(
    ("text", "phrase", "language"),
    [
        # Guideline R2: a negation the term names belongs in the span.
        ("Gehen nicht möglich.", "Gehen nicht möglich", "de"),
        ("keine Spontanatmung", "keine Spontanatmung", "de"),
        ("Pulse not palpable.", "Pulse not palpable", "en"),
        ("Nicht-Hodgkin-Lymphom", "Nicht-Hodgkin-Lymphom", "de"),
    ],
)
def test_a_negation_in_the_span_does_not_block(text, phrase, language):
    unit = source(text, [finding(text, "a1", _find(text, phrase))], language=language)
    assert not only_group(derive(unit)).blocked


# --- flags --------------------------------------------------------------------


def test_modifier_in_span_and_outside_phenotypic_abnormality_flags():
    text = "severe headache today"
    severe = _find(text, "severe")
    item = finding(
        text,
        "a1",
        (0, _find(text, "headache")[1]),
        term="HP:0002315",
        modifiers=(("HP:0012828", severe),),
    )
    group = only_group(derive(source(text, [item])))
    assert group.flags == ("modifier_in_span",)
    assert group.occurrences[0].modifiers == (
        {"term_id": "HP:0012828", "segments": [list(severe)]},
    )
    assert not group.blocked
    outside = finding(text, "a1", severe, term="HP:0012828")
    assert only_group(derive(source(text, [outside]))).flags == (
        "outside_phenotypic_abnormality",
    )


def test_modifier_outside_the_span_is_no_flag():
    text = "headache, severe"
    item = finding(
        text,
        "a1",
        _find(text, "headache"),
        term="HP:0002315",
        modifiers=(("HP:0012828", _find(text, "severe")),),
    )
    assert only_group(derive(source(text, [item]))).flags == ()


# --- grouping -----------------------------------------------------------------


def test_normalisation_keeps_sharp_s_and_removes_soft_hyphen():
    assert normalize_phrase("Fuß­schmerz") == "fußschmerz"
    assert normalize_phrase("FUSSSCHMERZ") == "fussschmerz"
    assert normalize_phrase("  Kopf \n  schmerz ") == "kopf schmerz"
    decomposed = "Müdigkeit"
    assert normalize_phrase(decomposed) == "müdigkeit"
    assert surface_form("Kopf­  Schmerz") == "Kopf Schmerz"


def test_surface_variants_group_with_counts_and_most_frequent_display():
    texts = [
        "Kopf­schmerz am Abend",
        "Kopfschmerz seit Tagen",
        "KOPFSCHMERZ beidseits",
        "Kopfschmerz",
        "kopf  schmerz morgens",
    ]
    units = [
        source(
            t,
            [finding(t, "a1", (0, len(t.split(" ")[0])), term="HP:0002315")],
            sid=f"s{i}",
            document_id=f"DOC-{i}",
            language="de",
        )
        for i, t in enumerate(texts[:4])
    ]
    t = texts[4]
    units.append(
        source(
            t,
            [finding(t, "a1", (0, len("kopf  schmerz")), term="HP:0002315")],
            sid="s9",
            document_id="DOC-9",
            language="de",
        )
    )
    derivation = derive(*units)
    groups = {g.phrase: g for g in derivation.groups}
    assert set(groups) == {"kopfschmerz", "kopf schmerz"}
    group = groups["kopfschmerz"]
    assert group.surface_variants == (("Kopfschmerz", 3), ("KOPFSCHMERZ", 1))
    assert group.display_text == "Kopfschmerz"
    assert len(group.occurrences) == 4
    # The occurrence keeps the verbatim text, soft hyphen included.
    assert "Kopf­schmerz" in {o.text for o in group.occurrences}


def test_display_text_tie_is_lexicographic():
    units = [
        source(t, [finding(t, "a1", (0, len(t)))], sid=t, document_id=t)
        for t in ("Seizure", "seizure")
    ]
    group = only_group(derive(*units))
    assert group.surface_variants == (("Seizure", 1), ("seizure", 1))
    assert group.display_text == "Seizure"


def test_language_is_part_of_the_key():
    units = [
        source(
            "ataxia",
            [finding("ataxia", "a1", (0, 6), term="HP:0001251")],
            sid="s1",
            language="en",
        ),
        source(
            "ataxia",
            [finding("ataxia", "a1", (0, 6), term="HP:0001251")],
            sid="s2",
            document_id="DOC-2",
            language="de",
        ),
    ]
    derivation = derive(*units)
    assert [g.language for g in derivation.groups] == ["de", "en"]
    assert len({g.group_id for g in derivation.groups}) == 2


def test_group_id_is_sha256_of_prefix_and_canonical_key():
    expected = hashlib.sha256(
        GROUP_ID_PREFIX
        + json.dumps(
            ["de", "fußschmerz", "HP:0002315"],
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    assert group_id("de", "fußschmerz", "HP:0002315") == expected
    t = "Fußschmerz"
    unit = source(t, [finding(t, "a1", (0, len(t)), term="HP:0002315")], language="de")
    assert only_group(derive(unit)).group_id == expected


def test_conflict_same_phrase_with_several_terms():
    a = "Unsteady gait at times."
    b = "unsteady gait, worse at night"
    units = [
        source(a, [finding(a, "a1", _find(a, "Unsteady gait"), term="HP:0001251")]),
        source(
            b,
            [finding(b, "a1", _find(b, "unsteady gait"), term="HP:0002315")],
            sid="s2",
            document_id="DOC-2",
        ),
        source(
            "ataxia",
            [finding("ataxia", "a1", (0, 6), term="HP:0001251")],
            sid="s3",
            document_id="DOC-3",
        ),
    ]
    derivation = derive(*units)
    by_term = {(g.phrase, g.term_id): g for g in derivation.groups}
    first = by_term[("unsteady gait", "HP:0001251")]
    second = by_term[("unsteady gait", "HP:0002315")]
    assert first.conflict_with == (second.group_id,)
    assert second.conflict_with == (first.group_id,)
    assert not by_term[("ataxia", "HP:0001251")].conflict
    assert derivation.report()["conflict_groups"] == {"en": 2}


def test_groups_are_ordered_by_language_phrase_term():
    text = "ataxia and seizure and ataxia"
    units = [
        source(
            text,
            [
                finding(text, "a1", _find(text, "seizure")),
                finding(text, "a2", _find(text, "ataxia"), term="HP:0001251"),
                finding(text, "a3", _find(text, "ataxia", 1), term="HP:0002315"),
            ],
        ),
        source(
            "Ataxie",
            [finding("Ataxie", "a1", (0, 6), term="HP:0001251")],
            sid="s2",
            document_id="DOC-2",
            language="de",
        ),
    ]
    keys = [(g.language, g.phrase, g.term_id) for g in derive(*units).groups]
    assert keys == sorted(keys)
    assert keys[0] == ("de", "ataxie", "HP:0001251")


def test_one_finding_with_two_mentions_gives_two_occurrences():
    text = "seizure in May, seizure in June"
    item = finding(text, "a1", _find(text, "seizure"), _find(text, "seizure", 1))
    group = only_group(derive(source(text, [item])))
    assert [o.start for o in group.occurrences] == [0, 16]


# --- releases and determinism -------------------------------------------------


def test_occurrences_name_the_release_of_their_unit():
    old = _layer(release="2025-01-01", layer_id="hpo@" + _sha("2025-01-01")[:12])
    new = _layer(release="2026-06-01")
    a = "a seizure"
    b = "one seizure"
    units = [
        source(
            a,
            [finding(a, "a1", _find(a, "seizure"), layer_id=old.layer_id)],
            layers=(old,),
            view=FakeView("2025-01-01", labels={"HP:0001250": "Seizures"}),
        ),
        source(
            b,
            [finding(b, "a1", _find(b, "seizure"))],
            sid="s2",
            document_id="DOC-2",
            layers=(new,),
        ),
    ]
    group = only_group(derive(*units))
    assert group.releases == (
        ("2025-01-01", _sha("2025-01-01")),
        ("2026-06-01", _sha("2026-06-01")),
    )
    assert {o.ontology_release for o in group.occurrences} == {
        "2025-01-01",
        "2026-06-01",
    }
    # The occurrence names the profile layer, the label the newest release's.
    assert {o.layer_id for o in group.occurrences} == {"hpo"}
    assert group.label == "Seizure"
    assert {o.label for o in group.occurrences} == {"Seizures", "Seizure"}


def test_obsolete_in_one_release_only_excludes_that_occurrence():
    old = _layer(release="2025-01-01")
    a = "a seizure"
    units = [
        source(
            a,
            [finding(a, "a1", _find(a, "seizure"))],
            layers=(old,),
            view=FakeView("2025-01-01"),
        ),
        source(
            a,
            [finding(a, "a1", _find(a, "seizure"))],
            sid="s2",
            document_id="DOC-2",
            view=FakeView(obsolete=frozenset({"HP:0001250"})),
        ),
    ]
    derivation = derive(*units)
    assert len(only_group(derivation).occurrences) == 1
    assert derivation.exclusions == {"obsolete_term": {"en": 1}}


def test_derivation_is_deterministic_whatever_the_unit_order():
    texts = ["no seizure", "Seizure here", "ataxia; seizure", "Kopf­schmerz"]
    units = [
        source(
            t,
            [
                finding(t, "a1", (0, len(t.split(" ")[0]) if " " in t else len(t))),
                finding(
                    t,
                    "a2",
                    _find(t, "seizure") if "seizure" in t else (0, 1),
                    term="HP:0001251",
                    assertion="absent",
                ),
            ],
            sid=f"s{i}",
            document_id=f"DOC-{i}",
            language="de" if "Kopf" in t else "en",
        )
        for i, t in enumerate(texts)
    ]
    first = derive(*units)
    second = derive(*reversed(units))
    assert first.to_json() == second.to_json()
    assert first.sha256() == second.sha256()
    assert first.sha256() == derive(*units).sha256()
    assert first.to_json()["format"] == "ontotator-single-term-candidates/v1"


def test_report_holds_counts_only_and_every_reason():
    text = "Seizure with ataxia. Ataxia in the father."
    derivation = derive(
        source(
            text,
            [
                finding(text, "a1", _find(text, "Seizure with ataxia")),
                finding(text, "a3", _find(text, "ataxia"), term="HP:0001251"),
                finding(
                    text,
                    "a2",
                    _find(text, "Ataxia"),
                    term="HP:0001251",
                    experiencer="family_member",
                ),
            ],
        )
    )
    report = derivation.report()
    assert report["exclusions"]["not_patient"] == {"en": 1}
    assert report["exclusions"]["no_span"] == {}
    assert report["blocked_groups"] == {"contains_other_finding": {"en": 2}}
    assert report["groups"] == {"en": 2}
    assert report["occurrences"] == {"en": 2}
    assert "seizure" not in json.dumps(report)


def test_missing_view_for_a_passing_finding_is_an_error():
    text = "a seizure"
    unit = source(text, [finding(text, "a1", _find(text, "seizure"))])
    broken = SourceUnit(**{**unit.__dict__, "views": {}})
    with pytest.raises(ValueError, match="no ontology view"):
        derive(broken)


# --- input from a frozen snapshot --------------------------------------------


def _domain_document(text: str) -> Document:
    return Document(document_id="d-1", language="en", text=text, text_sha256=_sha(text))


def _snapshot(document: Document, annotation_id: str, word: str):
    start = document.text.index(word)
    evidence = snapshot_evidence(
        EvidenceMention(
            evidence_id=f"ev-{annotation_id}",
            segments=[Segment(start=start, end=start + len(word))],
        ),
        document,
    )
    from t1_fixtures import hpo_profile

    return snapshot(
        Annotation(
            annotation_id=annotation_id,
            document_id=document.document_id,
            layer_id="hpo",
            term_id="HP:0001250",
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
        hpo_profile(),
    )


def test_annotation_versions_and_source_units_from_a_proposal_check():
    document = _domain_document("A seizure and ataxia were seen.")
    own = _snapshot(document, "own", "seizure")
    confirmed = _snapshot(document, "p-ok", "ataxia")
    unsure = _snapshot(document, "p-unsure", "seen")
    targets = ReviewTargetSet.create(
        [
            AnnotationRef(annotation_id="p-ok", version=confirmed.version),
            AnnotationRef(annotation_id="p-unsure", version=unsure.version),
        ]
    )
    sub = Submission(
        submission_id="s1",
        origin_key=WorkspaceKey(
            project_key="proj",
            document_id="d-1",
            annotator_id="ann-0001",
            mode="proposal_check",
            target_set_id=targets.target_set_id,
        ),
        targets=targets,
        draft_revision=1,
        snapshots=[own],
        decisions=[
            ReviewDecision(
                decision_id="dec-1",
                target={"annotation_id": "p-ok", "version": confirmed.version},
                outcome="confirmed",
                reviewer_id="ann-0001",
            ),
            ReviewDecision(
                decision_id="dec-2",
                target={"annotation_id": "p-unsure", "version": unsure.version},
                outcome="uncertain",
                note="unclear",
                reviewer_id="ann-0001",
            ),
        ],
        created_at=CREATED.isoformat(),
    )
    assert annotation_versions(sub) == {
        "own": own.version,
        "p-ok": confirmed.version,
        "p-unsure": unsure.version,
    }
    payload = {
        "content": {
            "documents": {
                "d-1": {
                    "document": {"language": "en"},
                    "variant": {"case_id": "case-1", "language": "en", "version": 2},
                }
            },
            "submissions": [sub.model_dump(mode="json")],
        },
        "round_kinds": {},
        "state": {
            "selections": [
                {"submission_id": "s1", "case_id": "case-1", "language": "en"}
            ]
        },
    }
    text = document.text
    unit = source(text, [finding(text, "own", _find(text, "seizure"))]).unit
    [item] = source_units(payload, [sub], [unit], [{"hp": FakeView()}])
    assert item.not_findings == frozenset({"p-unsure"})
    assert item.document_id == "d-1"
    assert item.language == "en"
    assert item.text_version == "2"
    assert item.source_text_line == 1
    occ = only_group(derive(item)).occurrences[0]
    assert occ.annotation_version == own.version
