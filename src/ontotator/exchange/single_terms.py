"""Single-term candidates derived from the selected final results (#381).

A single-term review asks whether a finding's phrase, read alone, maps to
its term. Its candidates come from the selected units of a final-result
snapshot, built with the same conversion as the final export
(``t1_export_content_exact`` + ``submission_to_unit``), so a candidate is
always a finding the final export holds. The derivation here is pure and
deterministic: given the units, the ontology view of each unit's layers and
the negation cues, it returns the same groups and the same report.

What counts as a finding is the export's definition: findings on an HPO
phenotype layer (``layer.profile == hpo.NAME``), the person's own findings
only (proposals a proposal check left uncertain are kept in the bundle but
are no finding, as in ``findings.csv`` and the agreement tables), unresolved
when the finding carries a ``review_resolution``.

Each mention of a finding is one occurrence. The rules, in order, the first
that applies deciding:

* excluded: ``other_layer``, ``not_present``, ``not_patient``,
  ``unresolved``, ``no_span`` (document level), ``discontinuous`` (a mention
  of several segments), ``shared_span`` (another finding of the unit has a
  mention with exactly this span), ``obsolete_term`` (the term is not active
  in the unit's release; an unknown term counts too).
* blocked (a candidate, but it cannot be accepted as it is):
  ``contains_other_finding`` (the span overlaps or contains a segment of
  another finding of the unit, whatever its assertion) and
  ``negation_in_span`` (the span contains a negation cue of its language as
  a whole word, ignoring case).
* flags: ``modifier_in_span`` (a modifier segment of a finding of the unit
  overlaps the span) and ``outside_phenotypic_abnormality`` (the term is not
  under HP:0000118 in the unit's release).

"Another finding" is another own finding on an HPO phenotype layer of the
same unit; findings of other layers neither share nor block a span.
Temporality is no rule. A rule for non-verbalised measurements is not
applied: neither the profile nor a finding marks a measurement, so there is
nothing to read it from (spec section 2).

The exclusion report counts occurrences: one per mention, and one for a
finding without mentions (``no_span``, or an earlier rule).

Occurrences are grouped by ``(language, phrase, term)``; the phrase is the
covered text without soft hyphens, with runs of whitespace collapsed to one
space, in NFC and lower case (``str.lower``, so "ß" stays "ß").
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

import ontospan
from ontospan.profiles import hpo

from ontotator.domain.scopes import is_review_like
from ontotator.domain.workspace import Submission
from ontotator.exchange.final_tables import (
    SubmissionFacts,
    _uncertain_targets,
    base_layer,
)

SINGLE_TERM_DERIVATION_FORMAT = "ontotator-single-term-candidates/v1"
GROUP_ID_PREFIX = b"ontotator-single-term-group/v1"
PHENOTYPIC_ABNORMALITY = "HP:0000118"
SOFT_HYPHEN = "­"

ExclusionReason = Literal[
    "other_layer",
    "not_present",
    "not_patient",
    "unresolved",
    "no_span",
    "discontinuous",
    "shared_span",
    "obsolete_term",
]
BlockedReason = Literal["contains_other_finding", "negation_in_span"]
Flag = Literal["modifier_in_span", "outside_phenotypic_abnormality"]
# In the order the rules apply; the report lists every reason.
EXCLUSION_REASONS: tuple[ExclusionReason, ...] = (
    "other_layer",
    "not_present",
    "not_patient",
    "unresolved",
    "no_span",
    "discontinuous",
    "shared_span",
    "obsolete_term",
)
BLOCKED_REASONS: tuple[BlockedReason, ...] = (
    "contains_other_finding",
    "negation_in_span",
)
FLAGS: tuple[Flag, ...] = ("modifier_in_span", "outside_phenotypic_abnormality")


# --- input ------------------------------------------------------------------


@dataclass(frozen=True)
class SourceUnit:
    """One selected final result as the export converts it.

    ``views`` maps each layer's ontology id to the view of the release the
    unit's layer names (``T1Units.views``). ``not_findings`` are annotation
    ids the bundle holds that are no finding of the person (proposals a
    proposal check left uncertain). ``annotation_versions`` names the
    version of each annotation (the unit holds only its id).
    """

    submission_id: str
    unit: ontospan.AnnotatedDocument
    views: Mapping[str, ontospan.OntologyView]
    language: str
    document_id: str
    text_version: str = ""
    source_text_line: int | None = None
    annotation_versions: Mapping[str, str] = field(default_factory=dict)
    not_findings: frozenset[str] = frozenset()


def annotation_versions(submission: Submission) -> dict[str, str]:
    """Annotation id -> version of every annotation the submission exports.

    As ``submission_to_unit`` collects them: the snapshots, then the
    proposals a review-like submission confirmed or left uncertain.
    """
    versions = {s.annotation.annotation_id: s.version for s in submission.snapshots}
    if is_review_like(submission.origin_key.mode):
        for decision in submission.decisions:
            if decision.outcome in {"confirmed", "uncertain"}:
                versions.setdefault(
                    decision.target.annotation_id, decision.target.version
                )
    return versions


def source_units(
    payload: Mapping[str, Any],
    submissions: Sequence[Submission],
    units: Sequence[ontospan.AnnotatedDocument],
    views: Sequence[Mapping[str, ontospan.OntologyView]],
) -> list[SourceUnit]:
    """The selected units of a frozen snapshot as derivation input.

    ``submissions``, ``units`` and ``views`` are the selected submissions and
    what ``build_t1_units`` made of them, in the same order. Case, language,
    text version and line are those of index.csv and findings.csv.
    """
    facts = SubmissionFacts(payload)
    out = []
    for sub, unit, unit_views in zip(submissions, units, views, strict=True):
        sid = sub.submission_id
        text = facts.of_submission(sid)
        out.append(
            SourceUnit(
                submission_id=sid,
                unit=unit,
                views=unit_views,
                language=text["language"],
                document_id=text["document_id"],
                text_version=text["text_version"],
                source_text_line=int(text["source_text_line"]),
                annotation_versions=annotation_versions(sub),
                not_findings=frozenset(_uncertain_targets(facts, sid)),
            )
        )
    return out


# --- normalisation ----------------------------------------------------------


def surface_form(text: str) -> str:
    """The covered text without soft hyphens, whitespace collapsed, in NFC."""
    stripped = text.replace(SOFT_HYPHEN, "")
    return unicodedata.normalize("NFC", " ".join(stripped.split()))


def normalize_phrase(text: str) -> str:
    """The grouping phrase: :func:`surface_form` in lower case.

    ``str.lower``, not ``casefold``: "ß" stays "ß", so "Fuß" and "FUSS"
    remain different phrases.
    """
    return surface_form(text).lower()


def _canonical(data: Any) -> bytes:
    return json.dumps(
        data, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")


def group_id(language: str, phrase: str, term_id: str) -> str:
    """sha256 of the prefix and the canonical JSON of the grouping key."""
    return hashlib.sha256(
        GROUP_ID_PREFIX + _canonical([language, phrase, term_id])
    ).hexdigest()


def _cue_pattern(cue: str) -> re.Pattern[str] | None:
    words = surface_form(cue).split(" ")
    if not words or words == [""]:
        return None
    body = r"\s+".join(re.escape(word) for word in words)
    return re.compile(rf"(?<!\w){body}(?!\w)", re.IGNORECASE)


def negation_patterns(
    cues: Mapping[str, Sequence[str]],
) -> dict[str, list[re.Pattern[str]]]:
    """Per language the compiled whole-word, case-insensitive cue patterns."""
    patterns: dict[str, list[re.Pattern[str]]] = {}
    for language, items in cues.items():
        compiled = [p for cue in sorted(set(items)) if (p := _cue_pattern(cue))]
        patterns[language] = compiled
    return patterns


# --- output -----------------------------------------------------------------


@dataclass(frozen=True)
class Occurrence:
    """One mention of a passing finding."""

    language: str
    document_id: str
    text_version: str
    source_text_line: int | None
    text_sha256: str
    source_text_sha256: str | None
    submission_id: str
    annotation_id: str
    annotation_version: str | None
    annotation_ref: str
    layer_id: str
    term_id: str
    start: int
    end: int
    text: str
    axes: Mapping[str, str]
    modifiers: tuple[Mapping[str, Any], ...]
    ontology_release: str
    ontology_digest: str | None
    label: str | None
    blocked: tuple[BlockedReason, ...]
    flags: tuple[Flag, ...]

    def to_json(self) -> dict[str, Any]:
        return {
            "language": self.language,
            "document_id": self.document_id,
            "text_version": self.text_version,
            "source_text_line": self.source_text_line,
            "text_sha256": self.text_sha256,
            "source_text_sha256": self.source_text_sha256,
            "submission_id": self.submission_id,
            "annotation_id": self.annotation_id,
            "annotation_version": self.annotation_version,
            "annotation_ref": self.annotation_ref,
            "layer_id": self.layer_id,
            "term_id": self.term_id,
            "start": self.start,
            "end": self.end,
            "text": self.text,
            "axes": dict(sorted(self.axes.items())),
            "modifiers": [dict(m) for m in self.modifiers],
            "ontology_release": self.ontology_release,
            "ontology_digest": self.ontology_digest,
            "label": self.label,
            "blocked": list(self.blocked),
            "flags": list(self.flags),
        }


@dataclass(frozen=True)
class CandidateGroup:
    """The occurrences of one phrase with one term in one language."""

    group_id: str
    language: str
    phrase: str
    term_id: str
    label: str | None
    display_text: str
    surface_variants: tuple[tuple[str, int], ...]
    occurrences: tuple[Occurrence, ...]
    flags: tuple[Flag, ...]
    blocked_reasons: tuple[BlockedReason, ...]
    # Groups of the same phrase and language with another term.
    conflict_with: tuple[str, ...]
    releases: tuple[tuple[str, str | None], ...]

    @property
    def blocked_reason(self) -> BlockedReason | None:
        return self.blocked_reasons[0] if self.blocked_reasons else None

    @property
    def blocked(self) -> bool:
        return bool(self.blocked_reasons)

    @property
    def conflict(self) -> bool:
        return bool(self.conflict_with)

    def to_json(self) -> dict[str, Any]:
        return {
            "group_id": self.group_id,
            "language": self.language,
            "phrase": self.phrase,
            "term_id": self.term_id,
            "label": self.label,
            "display_text": self.display_text,
            "surface_variants": [
                {"text": text, "count": count} for text, count in self.surface_variants
            ],
            "flags": list(self.flags),
            "blocked_reason": self.blocked_reason,
            "blocked_reasons": list(self.blocked_reasons),
            "conflict_with": list(self.conflict_with),
            "releases": [
                {"release": release, "digest": digest}
                for release, digest in self.releases
            ],
            "occurrences": [o.to_json() for o in self.occurrences],
        }


@dataclass(frozen=True)
class Derivation:
    """Every candidate group and what was left out, per reason and language."""

    groups: tuple[CandidateGroup, ...]
    # reason -> language -> occurrences
    exclusions: Mapping[str, Mapping[str, int]]
    # Passing occurrences per language (blocked ones included).
    occurrences: Mapping[str, int]

    def group(self, group_id: str) -> CandidateGroup | None:
        for item in self.groups:
            if item.group_id == group_id:
                return item
        return None

    def report(self) -> dict[str, Any]:
        """Counts only: no phrase, no text."""
        blocked: dict[str, dict[str, int]] = {r: {} for r in BLOCKED_REASONS}
        conflicts: dict[str, int] = {}
        groups: dict[str, int] = {}
        for item in self.groups:
            groups[item.language] = groups.get(item.language, 0) + 1
            if item.blocked_reason is not None:
                per = blocked[item.blocked_reason]
                per[item.language] = per.get(item.language, 0) + 1
            if item.conflict:
                conflicts[item.language] = conflicts.get(item.language, 0) + 1
        return {
            "exclusions": {
                reason: dict(sorted(self.exclusions.get(reason, {}).items()))
                for reason in EXCLUSION_REASONS
            },
            "blocked_groups": {
                reason: dict(sorted(per.items())) for reason, per in blocked.items()
            },
            "conflict_groups": dict(sorted(conflicts.items())),
            "groups": dict(sorted(groups.items())),
            "occurrences": dict(sorted(self.occurrences.items())),
        }

    def to_json(self) -> dict[str, Any]:
        return {
            "format": SINGLE_TERM_DERIVATION_FORMAT,
            "groups": [item.to_json() for item in self.groups],
            "report": self.report(),
        }

    def sha256(self) -> str:
        """The derivation's digest: canonical JSON of :meth:`to_json`."""
        return hashlib.sha256(_canonical(self.to_json())).hexdigest()


# --- derivation -------------------------------------------------------------


def _overlaps(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


@dataclass(frozen=True)
class _Finding:
    annotation: ontospan.Annotation
    layer: ontospan.Layer
    hpo: bool


def _axis(annotation: ontospan.Annotation, axis: str) -> str | None:
    value = annotation.axes.get(axis)
    return value.value if value is not None else None


def _finding_exclusion(finding: _Finding) -> ExclusionReason | None:
    """The first rule about the finding as a whole (mentions aside)."""
    annotation = finding.annotation
    if not finding.hpo:
        return "other_layer"
    if _axis(annotation, "assertion") != "present":
        return "not_present"
    if _axis(annotation, "experiencer") != "patient":
        return "not_patient"
    if annotation.review_resolution is not None:
        return "unresolved"
    if annotation.document_level or not annotation.mentions:
        return "no_span"
    return None


def derive_candidates(
    units: Iterable[SourceUnit],
    *,
    negation_cues: Mapping[str, Sequence[str]],
    bundle_id: str,
) -> Derivation:
    """The candidate groups of the units and the exclusion report.

    ``bundle_id`` is the bundle id of the selected results the annotation
    references point into (``selected-<snapshot id>``, as the Phenopacket
    export forms them).
    """
    patterns = negation_patterns(negation_cues)
    exclusions: dict[str, dict[str, int]] = defaultdict(dict)
    passing: list[Occurrence] = []

    def exclude(reason: ExclusionReason, language: str) -> None:
        per = exclusions[reason]
        per[language] = per.get(language, 0) + 1

    for source in units:
        unit = source.unit
        language = source.language
        layers = {layer.layer_id: layer for layer in unit.annotation_set.layers}
        findings = [
            _Finding(a, layers[a.layer_id], layers[a.layer_id].profile == hpo.NAME)
            for a in unit.annotation_set.annotations
            if a.annotation_id not in source.not_findings
        ]
        hpo_findings = [f for f in findings if f.hpo]
        for finding in findings:
            annotation = finding.annotation
            reason = _finding_exclusion(finding)
            mentions = annotation.mentions or (None,)
            if reason is not None:
                for _ in mentions:
                    exclude(reason, language)
                continue
            view = source.views.get(finding.layer.ontology.id)
            if view is None:
                raise ValueError(
                    f"no ontology view for {finding.layer.ontology.id!r} "
                    f"(submission {source.submission_id})"
                )
            others = [
                f.annotation
                for f in hpo_findings
                if f.annotation.annotation_id != annotation.annotation_id
            ]
            other_spans = {
                tuple((s.start, s.end) for s in mention.segments)
                for other in others
                for mention in other.mentions
            }
            other_segments = [
                (s.start, s.end)
                for other in others
                for mention in other.mentions
                for s in mention.segments
            ]
            modifier_segments = [
                (s.start, s.end)
                for f in hpo_findings
                for modifier in f.annotation.modifiers
                for s in modifier.segments
            ]
            term = annotation.term_id
            obsolete = not view.is_active(term)
            outside = not ontospan.is_under(view, term, PHENOTYPIC_ABNORMALITY)
            for mention in annotation.mentions:
                if len(mention.segments) > 1:
                    exclude("discontinuous", language)
                    continue
                [segment] = mention.segments
                span = (segment.start, segment.end)
                if (span,) in other_spans:
                    exclude("shared_span", language)
                    continue
                if obsolete:
                    exclude("obsolete_term", language)
                    continue
                blocked: list[BlockedReason] = []
                if any(_overlaps(span, other) for other in other_segments):
                    blocked.append("contains_other_finding")
                normalized = surface_form(segment.text)
                if any(p.search(normalized) for p in patterns.get(language, ())):
                    blocked.append("negation_in_span")
                flags: list[Flag] = []
                if any(_overlaps(span, m) for m in modifier_segments):
                    flags.append("modifier_in_span")
                if outside:
                    flags.append("outside_phenotypic_abnormality")
                passing.append(
                    Occurrence(
                        language=language,
                        document_id=source.document_id,
                        text_version=source.text_version,
                        source_text_line=source.source_text_line,
                        text_sha256=unit.document.text_sha256,
                        source_text_sha256=unit.document.source_text_sha256,
                        submission_id=source.submission_id,
                        annotation_id=annotation.annotation_id,
                        annotation_version=source.annotation_versions.get(
                            annotation.annotation_id
                        ),
                        annotation_ref=ontospan.annotation_ref(
                            unit.annotation_set.annotation_set_id,
                            annotation.annotation_id,
                            bundle_id,
                        ),
                        layer_id=base_layer(annotation.layer_id),
                        term_id=term,
                        start=segment.start,
                        end=segment.end,
                        text=segment.text,
                        axes={a: v.value for a, v in annotation.axes.items()},
                        modifiers=tuple(
                            {
                                "term_id": m.term_id,
                                "segments": [[s.start, s.end] for s in m.segments],
                            }
                            for m in annotation.modifiers
                        ),
                        ontology_release=finding.layer.ontology.version,
                        ontology_digest=finding.layer.ontology.sha256,
                        label=view.label(term),
                        blocked=tuple(blocked),
                        flags=tuple(flags),
                    )
                )
    return _derivation(passing, exclusions)


def _derivation(
    passing: Sequence[Occurrence], exclusions: Mapping[str, Mapping[str, int]]
) -> Derivation:
    by_key: dict[tuple[str, str, str], list[Occurrence]] = defaultdict(list)
    for occurrence in passing:
        key = (
            occurrence.language,
            normalize_phrase(occurrence.text),
            occurrence.term_id,
        )
        by_key[key].append(occurrence)
    terms_of: dict[tuple[str, str], list[str]] = defaultdict(list)
    for language, phrase, term in sorted(by_key):
        terms_of[(language, phrase)].append(term)
    groups = []
    for key in sorted(by_key):
        language, phrase, term = key
        items = tuple(
            sorted(
                by_key[key],
                key=lambda o: (
                    o.document_id,
                    o.start,
                    o.end,
                    o.submission_id,
                    o.annotation_id,
                ),
            )
        )
        variants = Counter(surface_form(o.text) for o in items)
        ranked = sorted(variants.items(), key=lambda kv: (-kv[1], kv[0]))
        releases = sorted(
            {(o.ontology_release, o.ontology_digest) for o in items},
            key=lambda r: (r[0], r[1] or ""),
        )
        # The label of the newest release that names the term.
        labelled = sorted(
            ((o.ontology_release, o.ontology_digest or "", o.label) for o in items),
            reverse=True,
        )
        label = next((name for _, _, name in labelled if name), None)
        groups.append(
            CandidateGroup(
                group_id=group_id(language, phrase, term),
                language=language,
                phrase=phrase,
                term_id=term,
                label=label,
                display_text=ranked[0][0],
                surface_variants=tuple(ranked),
                occurrences=items,
                flags=tuple(f for f in FLAGS if any(f in o.flags for o in items)),
                blocked_reasons=tuple(
                    r for r in BLOCKED_REASONS if any(r in o.blocked for o in items)
                ),
                conflict_with=tuple(
                    group_id(language, phrase, other)
                    for other in terms_of[(language, phrase)]
                    if other != term
                ),
                releases=tuple(releases),
            )
        )
    return Derivation(
        groups=tuple(groups),
        exclusions={
            reason: dict(per) for reason, per in sorted(exclusions.items()) if per
        },
        occurrences=dict(sorted(Counter(o.language for o in passing).items())),
    )
