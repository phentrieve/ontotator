"""Single-term cases of a final-result snapshot (#381).

The export ``ontotator-final-single-terms/v1`` writes the phrase-term pairs a
single-term review accepted, as cases: a phrase that alone maps to an HPO
term, with every place in the selected final results where it occurs.

It reads the same frozen snapshot as the final export. The candidates are
derived from the snapshot's selected results with the review's own
derivation (``exchange.single_terms``, the final export's conversion), and
the single-term decisions frozen into the snapshot when the export was
requested (``single_term_decisions``: their ids, digest and the negation
cues in force) are applied to them. A decision recorded after the request
is not in the snapshot and so not in the file; the same snapshot always
gives the same file.

Per group the newest frozen decision of the primary review applies, as in
the review itself. A group is written when that decision accepts it:

* ``accept``: every occurrence, the phrase as annotated, the annotated term;
* ``adjust_term``: every occurrence with the more general term. The term
  must be active and an ancestor of the annotated term in the release of
  every occurrence; one absent or obsolete in a release makes the group
  stale (not written), one that is active but no ancestor in a release
  fails the job (``SINGLE_TERM_MIXED_RELEASE``);
* ``adjust_span``: the one re-cut occurrence with its verbatim cut; the other
  occurrences of the group were not judged in that cut and are left out.

Cases with the same language, normalised final text and final term merge
into one (``case_id`` is the digest of that key). Rejected, open, blocked
and stale groups are counted in ``report.json``, never written.

The ZIP also holds the selected results as an Ontospan bundle
(``selected-results.ontospan.zip``), byte for byte the final export's bundle
of the same snapshot, which every ``annotation_ref`` points into, and the
source texts as the final export writes them.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import ontospan
from ontospan.profiles import hpo
from sqlalchemy import Connection, RowMapping, select

from ontotator.application.workflow_warnings import state_digest
from ontotator.domain.errors import DomainError
from ontotator.exchange.final_export import load_frozen_final
from ontotator.exchange.final_export_guide import (
    _heading,
    _utc,
    _wrap,
    planned_out_section,
)
from ontotator.exchange.single_terms import (
    PHENOTYPIC_ABNORMALITY,
    CandidateGroup,
    Derivation,
    Occurrence,
    SourceUnit,
    _canonical,
    derive_candidates,
    normalize_phrase,
    occurrence_ref,
    overlaps,
    source_units,
    surface_form,
)
from ontotator.jobs.queue import Job, JobContext, StructuredJobError
from ontotator.storage.guideline_tables import GuidelineVersionRow
from ontotator.storage.single_term_tables import (
    SingleTermBatchStateRow,
    SingleTermDecisionRow,
)

FINAL_SINGLE_TERM_FORMAT = "ontotator-final-single-terms/v1"
# The format name of a final export request (``FinalExportRequest.format``).
SINGLE_TERM_REQUEST_FORMAT = "single-term"
# The snapshot payload key with the frozen decisions (additive, #381).
FROZEN_KEY = "single_term_decisions"
SELECTED_RESULTS_FILE = "selected-results.ontospan.zip"
CASES_FILE = "cases.jsonl"
SOURCE_TEXTS_FILE = "source-texts.jsonl"
CASE_ID_PREFIX = b"ontotator-single-term-case/v1"
ACCEPTING = ("accept", "adjust_span", "adjust_term")
DECISION_KINDS = ("accept", "adjust_span", "adjust_term", "reject")
GROUP_STATES = ("open", "blocked", "decided", "stale")

# Every column of a decision (its JSON record).
_DECISION_COLUMNS = tuple(
    column.key for column in SingleTermDecisionRow.__table__.columns
)
# The columns a project archive import renumbers or renames
# (``--rename-pseudonyms``): left out of the frozen digests, so a snapshot's
# decisions still resolve on the imported project.
_RENUMBERED = frozenset(
    {"id", "project_id", "batch_id", "basis_id", "reviewer_user_id"}
    | {"reviewer_pseudonym"}
)


# --- frozen decisions -------------------------------------------------------


def counted_decisions(conn: Connection, pid: int) -> list[Any]:
    """Every decision that counts (not of an abandoned batch), oldest first."""
    return list(
        conn.execute(
            select(SingleTermDecisionRow)
            .join(
                SingleTermBatchStateRow,
                SingleTermBatchStateRow.batch_id == SingleTermDecisionRow.batch_id,
            )
            .where(
                SingleTermDecisionRow.project_id == pid,
                SingleTermBatchStateRow.state != "abandoned",
            )
            .order_by(SingleTermDecisionRow.id)
        )
        .mappings()
        .all()
    )


def decision_record(row: Mapping[str, Any] | RowMapping) -> dict[str, Any]:
    """A stored decision as JSON: every column, times in UTC."""
    record: dict[str, Any] = {}
    for name in _DECISION_COLUMNS:
        value = row[name]
        if isinstance(value, datetime):
            value = value.astimezone(UTC).isoformat()
        record[name] = value
    return record


def _stable(record: Mapping[str, Any]) -> dict[str, Any]:
    """A decision record without the columns an archive import changes."""
    return {k: v for k, v in record.items() if k not in _RENUMBERED}


def freeze_decisions(
    conn: Connection, pid: int, cues: Mapping[str, Sequence[str]]
) -> dict[str, Any]:
    """The snapshot payload entry: the decisions that count now (their ids
    at the time, and per decision the digest of its content, which survives
    a project archive import), the digest of their content and the negation
    cues in force."""
    records = [decision_record(row) for row in counted_decisions(conn, pid)]
    stable = [_stable(record) for record in records]
    return {
        "ids": [record["id"] for record in records],
        "records": [state_digest(record) for record in stable],
        "sha256": state_digest(stable),
        "negation_cues": {lang: list(items) for lang, items in sorted(cues.items())},
    }


def load_decisions(
    conn: Connection, pid: int, frozen: Mapping[str, Any]
) -> list[dict[str, Any]]:
    """The frozen decisions in their frozen order, found by their content
    (ids and reviewer pseudonyms change in an archive import), checked
    against their digest."""
    wanted = list(frozen["records"])
    rows = (
        conn.execute(
            select(SingleTermDecisionRow)
            .where(SingleTermDecisionRow.project_id == pid)
            .order_by(SingleTermDecisionRow.id)
        )
        .mappings()
        .all()
        if wanted
        else []
    )
    by_digest: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        record = decision_record(row)
        by_digest[state_digest(_stable(record))].append(record)
    records = []
    for digest in wanted:
        found = by_digest.get(digest)
        if not found:
            raise DomainError(
                "INVALID_EXPORT_SNAPSHOT",
                "A frozen single-term decision is unavailable or changed.",
            )
        records.append(found.pop(0))
    if state_digest([_stable(r) for r in records]) != frozen["sha256"]:
        raise DomainError(
            "INVALID_EXPORT_SNAPSHOT",
            "A frozen single-term decision is unavailable or changed.",
        )
    return records


def newest(records: Iterable[Mapping[str, Any]], role: str) -> dict[str, Any]:
    """The newest decision per group of one role (records oldest first)."""
    out: dict[str, Any] = {}
    for record in records:
        if record["role"] == role:
            out[record["group_id"]] = record
    return out


# --- cases ------------------------------------------------------------------


@dataclass(frozen=True)
class _Part:
    """One occurrence as a case writes it."""

    occurrence: Occurrence
    start: int
    end: int
    text: str
    term_id: str
    text_origin: str
    hpo_origin: str
    decision: Mapping[str, Any]
    group: CandidateGroup


def _utc_seconds(value: str) -> str:
    return datetime.fromisoformat(value).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def case_id(language: str, phrase: str, term_id: str) -> str:
    return hashlib.sha256(
        CASE_ID_PREFIX + _canonical([language, phrase, term_id])
    ).hexdigest()


def _binary(kind: str) -> str:
    return "accept" if kind in ACCEPTING else "reject"


def adjusted_term_state(
    group: CandidateGroup,
    term_id: str,
    views: Mapping[str, ontospan.OntologyView],
) -> str:
    """``decided`` when ``term_id`` is an active ancestor of the group's term
    in the release of every occurrence, ``stale`` when it is absent or
    obsolete in one of them.

    Raises:
        StructuredJobError: ``SINGLE_TERM_MIXED_RELEASE`` when it is active
            everywhere but no ancestor in some release.
    """
    not_ancestor: set[tuple[str, str | None]] = set()
    for occurrence in group.occurrences:
        view = views.get(occurrence.ontology_digest or "")
        if view is None or not view.is_active(term_id):
            return "stale"
        if term_id == group.term_id or term_id not in view.ancestors(group.term_id):
            not_ancestor.add((occurrence.ontology_release, occurrence.ontology_digest))
    if not_ancestor:
        raise StructuredJobError(
            "SINGLE_TERM_MIXED_RELEASE",
            {
                "group_id": group.group_id,
                "term_id": group.term_id,
                "adjusted_term_id": term_id,
                "releases": [
                    {"release": release, "digest": digest}
                    for release, digest in sorted(
                        not_ancestor, key=lambda r: (r[0], r[1] or "")
                    )
                ],
            },
        )
    return "decided"


def export_state(
    group: CandidateGroup,
    decision: Mapping[str, Any] | None,
    views: Mapping[str, ontospan.OntologyView],
) -> str:
    """The group's state in the export, as the review decides it (also for
    an adjusted term of a group that became blocked), except for an adjusted
    term that is active but no ancestor (:func:`adjusted_term_state`)."""
    if decision is None or decision["decision"] == "withdrawn":
        return "blocked" if group.blocked else "open"
    kind = decision["decision"]
    # Neither an acceptance nor a term adjustment lifts a block the group
    # has come to have.
    if kind in ("accept", "adjust_term") and group.blocked:
        return "stale"
    if kind == "adjust_term":
        return adjusted_term_state(group, decision["adjusted_term_id"], views)
    if kind == "adjust_span":
        refs = {occurrence_ref(o) for o in group.occurrences}
        return (
            "decided"
            if decision["adjusted_span"]["occurrence_ref"] in refs
            else "stale"
        )
    return "decided"


def _parts(
    group: CandidateGroup,
    decision: Mapping[str, Any],
    sources: Mapping[str, SourceUnit],
) -> list[_Part]:
    kind = decision["decision"]
    if kind == "adjust_span":
        span = decision["adjusted_span"]
        occurrence = next(
            o for o in group.occurrences if occurrence_ref(o) == span["occurrence_ref"]
        )
        text = sources[occurrence.submission_id].unit.document.text
        if text[span["start"] : span["end"]] != span["text"]:
            return []
        return [
            _Part(
                occurrence,
                span["start"],
                span["end"],
                span["text"],
                group.term_id,
                "span_adjusted",
                "annotated",
                decision,
                group,
            )
        ]
    term = decision["adjusted_term_id"] if kind == "adjust_term" else group.term_id
    origin = "generalised" if kind == "adjust_term" else "annotated"
    return [
        _Part(o, o.start, o.end, o.text, term, "verbatim", origin, decision, group)
        for o in group.occurrences
    ]


def _modifier_segments(source: SourceUnit) -> list[tuple[int, int]]:
    layers = {layer.layer_id: layer for layer in source.unit.annotation_set.layers}
    return [
        (segment.start, segment.end)
        for annotation in source.unit.annotation_set.annotations
        if annotation.annotation_id not in source.not_findings
        and layers[annotation.layer_id].profile == hpo.NAME
        for modifier in annotation.modifiers
        for segment in modifier.segments
    ]


def _flags(
    part: _Part,
    sources: Mapping[str, SourceUnit],
    views: Mapping[str, ontospan.OntologyView],
) -> list[str]:
    """The flags of the occurrence as written: its final span and term."""
    flags = []
    source = sources.get(part.occurrence.submission_id)
    if source is not None and any(
        overlaps((part.start, part.end), segment)
        for segment in _modifier_segments(source)
    ):
        flags.append("modifier_in_span")
    view = views.get(part.occurrence.ontology_digest or "")
    if view is not None and not ontospan.is_under(
        view, part.term_id, PHENOTYPIC_ABNORMALITY
    ):
        flags.append("outside_phenotypic_abnormality")
    return flags


def _reviewer_record(
    decision: Mapping[str, Any], guideline_sha256: Mapping[int, str]
) -> dict[str, Any]:
    version = decision["guideline_version"]
    return {
        "decision_id": decision["id"],
        "phrase_only": decision["phrase_only"],
        "decision": decision["decision"],
        "reason": decision["reason"],
        "reviewer": f"ontotator:{decision['reviewer_pseudonym']}",
        "reviewer_independent": decision["reviewer_independent"],
        "guideline_version": version,
        "guideline_sha256": None if version is None else guideline_sha256[version],
        "decided_at": _utc_seconds(decision["created_at"]),
    }


def _review(
    part: _Part,
    second: Mapping[str, Mapping[str, Any]],
    guideline_sha256: Mapping[int, str],
) -> dict[str, Any]:
    decision, group = part.decision, part.group
    original_text = (
        surface_form(part.occurrence.text)
        if decision["decision"] == "adjust_span"
        else group.display_text
    )
    review = {
        **_reviewer_record(decision, guideline_sha256),
        "group_id": group.group_id,
        "original_text": original_text,
        "original_term": group.term_id,
    }
    other = second.get(group.group_id)
    if other is not None and other["decision"] != "withdrawn":
        review["second_review"] = {
            **_reviewer_record(other, guideline_sha256),
            "agrees": _binary(other["decision"]) == _binary(decision["decision"]),
        }
    return review


@dataclass(frozen=True)
class SingleTermResult:
    """The cases and the counts of ``report.json``."""

    cases: list[dict[str, Any]]
    report: dict[str, Any]


def build_cases(
    derivation: Derivation,
    sources: Mapping[str, SourceUnit],
    views: Mapping[str, ontospan.OntologyView],
    decisions: Sequence[Mapping[str, Any]],
    guideline_sha256: Mapping[int, str],
) -> SingleTermResult:
    """Apply the frozen decisions to the derivation: the cases and report.

    ``views`` maps an ontology digest to its release; ``decisions`` are the
    frozen records, oldest first.
    """
    from ontotator.application.single_terms import agreement

    primary = newest(decisions, "primary")
    second = newest(decisions, "second")
    states: dict[str, dict[str, int]] = {}
    kinds = dict.fromkeys(DECISION_KINDS, 0)
    reasons: Counter[str] = Counter()
    pairs: list[tuple[str, str]] = []
    accepted: Counter[str] = Counter()
    merged: dict[tuple[str, str, str], list[_Part]] = defaultdict(list)
    group_states = {
        group.group_id: export_state(group, primary.get(group.group_id), views)
        for group in derivation.groups
    }
    accepting = {
        group_id
        for group_id, state in group_states.items()
        if state == "decided" and primary[group_id]["decision"] in ACCEPTING
    }
    for group in derivation.groups:
        decision = primary.get(group.group_id)
        state = group_states[group.group_id]
        # A phrase conflict is resolved by accepting at most one group: when
        # several were accepted (across bases), none of them is exported.
        if group.group_id in accepting and accepting.intersection(group.conflict_with):
            state = "stale"
        per = states.setdefault(group.language, dict.fromkeys(GROUP_STATES, 0))
        per[state] += 1
        if state != "decided":
            continue
        assert decision is not None
        kinds[decision["decision"]] += 1
        if decision["reason"] is not None:
            reasons[decision["reason"]] += 1
        other = second.get(group.group_id)
        if other is not None and other["decision"] != "withdrawn":
            pairs.append((_binary(decision["decision"]), _binary(other["decision"])))
        if decision["decision"] not in ACCEPTING:
            continue
        accepted[group.language] += 1
        for part in _parts(group, decision, sources):
            key = (group.language, normalize_phrase(part.text), part.term_id)
            merged[key].append(part)
    cases = []
    for key in sorted(merged):
        language, phrase, term = key
        parts = sorted(
            merged[key],
            key=lambda p: (
                p.occurrence.document_id,
                p.start,
                p.end,
                p.occurrence.submission_id,
                p.occurrence.annotation_id,
            ),
        )
        variants = Counter(surface_form(p.text) for p in parts)
        ranked = sorted(variants.items(), key=lambda kv: (-kv[1], kv[0]))
        labelled = sorted(
            (
                (
                    p.occurrence.ontology_release,
                    p.occurrence.ontology_digest or "",
                    _label(views, p.occurrence.ontology_digest, term),
                )
                for p in parts
            ),
            reverse=True,
        )
        # One review per decision: an accepted phrase first, then in the
        # order of the groups.
        by_decision: dict[int, _Part] = {}
        for part in parts:
            by_decision.setdefault(part.decision["id"], part)
        group_order = {g.group_id: i for i, g in enumerate(derivation.groups)}
        reviews = [
            _review(part, second, guideline_sha256)
            for part in sorted(
                by_decision.values(),
                key=lambda p: (
                    p.decision["decision"] != "accept",
                    group_order[p.group.group_id],
                    p.decision["id"],
                ),
            )
        ]
        flags = {flag for p in parts for flag in _flags(p, sources, views)}
        case: dict[str, Any] = {
            "case_id": case_id(language, phrase, term),
            "language": language,
            "text": ranked[0][0],
            "surface_variants": [{"text": t, "count": n} for t, n in ranked],
            "text_origin": "verbatim"
            if any(p.text_origin == "verbatim" for p in parts)
            else "span_adjusted",
            "hpo_id": term,
            "hpo_origin": "annotated"
            if any(p.hpo_origin == "annotated" for p in parts)
            else "generalised",
            "term_label": next((name for _, _, name in labelled if name), None),
            "flags": [
                f
                for f in ("modifier_in_span", "outside_phenotypic_abnormality")
                if f in flags
            ],
            "occurrences": [_occurrence(p) for p in parts],
            "review": reviews[0],
        }
        if len(reviews) > 1:
            case["merged_reviews"] = reviews[1:]
        cases.append(case)
    report_counts = derivation.report()
    yields: dict[str, dict[str, Any]] = {}
    for language, per in sorted(states.items()):
        groups = sum(per.values())
        language_cases = [c for c in cases if c["language"] == language]
        yields[language] = {
            "groups": groups,
            "accepted_groups": accepted[language],
            "cases": len(language_cases),
            "case_occurrences": sum(len(c["occurrences"]) for c in language_cases),
            "percent_of_groups": round(100 * accepted[language] / groups, 2)
            if groups
            else None,
        }
    report = {
        "format": FINAL_SINGLE_TERM_FORMAT,
        "exclusions": report_counts["exclusions"],
        "blocked": report_counts["blocked_groups"],
        "conflicts": report_counts["conflict_groups"],
        "occurrences": report_counts["occurrences"],
        "groups": states,
        "decisions": kinds,
        "reject_reasons": dict(sorted(reasons.items())),
        "second_review": agreement(pairs).model_dump(mode="json"),
        "yield": yields,
        "cases": len(cases),
    }
    return SingleTermResult(cases=cases, report=report)


def _label(
    views: Mapping[str, ontospan.OntologyView], digest: str | None, term_id: str
) -> str | None:
    view = views.get(digest or "")
    return view.label(term_id) if view is not None else None


def _occurrence(part: _Part) -> dict[str, Any]:
    o = part.occurrence
    seen = {item["ref"] for item in part.decision["occurrence_refs"]}
    return {
        "document_id": o.document_id,
        "source_text_sha256": o.source_text_sha256,
        "text_sha256": o.text_sha256,
        "text_version": o.text_version,
        "source_text_line": o.source_text_line,
        "start": part.start,
        "end": part.end,
        "text": part.text,
        "text_origin": part.text_origin,
        "annotated_start": o.start,
        "annotated_end": o.end,
        "hpo_origin": part.hpo_origin,
        "annotated_term": o.term_id,
        "annotation_ref": o.annotation_ref,
        "axes": dict(sorted(o.axes.items())),
        "modifiers": [dict(m) for m in o.modifiers],
        "ontology_release": o.ontology_release,
        "ontology_digest": o.ontology_digest,
        "decision_id": part.decision["id"],
        "seen_by_reviewer": occurrence_ref(o) in seen,
    }


# --- the job ----------------------------------------------------------------


def _dump(data: Any) -> bytes:
    return (
        json.dumps(data, sort_keys=True, ensure_ascii=False, indent=2) + "\n"
    ).encode()


def _jsonl(items: Iterable[Any]) -> bytes:
    return b"".join(
        (json.dumps(item, sort_keys=True, ensure_ascii=False) + "\n").encode()
        for item in items
    )


def _readme(
    payload: Mapping[str, Any],
    *,
    snapshot_id: str,
    snapshot_sha256: str,
    snapshot_created_at: datetime,
    bundle_id: str,
    report: Mapping[str, Any],
) -> bytes:
    key = payload["project"]
    name = payload.get("project_name") or key
    frozen = payload[FROZEN_KEY]
    out: list[str] = [*_heading("Ontotator single-term export", "="), ""]
    out += [
        f"Project:          {name if name == key else f'{name} ({key})'}",
        f"Snapshot ID:      {snapshot_id}",
        f"Snapshot SHA-256: {snapshot_sha256}",
        f"Snapshot time:    {_utc(snapshot_created_at)}",
        f"Decisions:        {len(frozen['ids'])} (SHA-256 {frozen['sha256']})",
        "",
        *_heading("Summary"),
        f"{'Cases (phrase and term):':<38}{report['cases']}",
        f"{'Texts with a final result:':<38}{len(payload['state']['selections'])}",
        f"{'Omitted text and language pairs:':<38}{len(payload['state']['omissions'])}",
        "",
        *_heading("What is in this archive"),
        "README.txt            This guide.",
        f"{CASES_FILE:<22}One case per line: a phrase that alone maps to an",
        "                      HPO term, with its occurrences and the review.",
        "report.json           What was left out, by rule; groups per state;",
        "                      decisions; second-review agreement; yield.",
        f"{SOURCE_TEXTS_FILE:<22}The texts, as in the final export.",
        SELECTED_RESULTS_FILE,
        "                      The selected final results as an Ontospan bundle,",
        "                      the same file as in the final export of this",
        "                      snapshot; every annotation_ref points into it.",
        "receipt.json          The snapshot, the decisions and the SHA-256 of",
        "                      every other file.",
        "",
        *_heading("How to read it"),
        *_wrap(
            "A single-term review asks whether a finding's phrase, read alone, "
            "maps to its term. The candidates are the findings of HPO phenotype "
            "layers in the selected final results whose assertion is present "
            "and whose experiencer is the patient, with one continuous span "
            "that no other finding shares; report.json counts what each rule "
            "left out. Occurrences of the same phrase (ignoring case, soft "
            "hyphens and runs of whitespace) with the same term form a group.",
            "- ",
            "  ",
        ),
        *_wrap(
            "Only groups the review accepted are cases: accepted as they are "
            '(text_origin "verbatim", hpo_origin "annotated"), with a more '
            'general term (hpo_origin "generalised") or re-cut in one '
            'occurrence (text_origin "span_adjusted"; only that occurrence is '
            "written). Cases with the same language, text and term are merged; "
            "each occurrence names its decision_id, and merged_reviews lists "
            "the further decisions. A case is verbatim (annotated) when at "
            "least one of its occurrences is.",
            "- ",
            "  ",
        ),
        *_wrap(
            "The decisions are those recorded when the export was requested; "
            "a later decision is not in this file. seen_by_reviewer is false "
            "for an occurrence the reviewer did not see (it came with a later "
            "review basis). Reviewers are named by pseudonym only.",
            "- ",
            "  ",
        ),
        *_wrap(
            "Offsets (start, end) count Unicode code points in the source text "
            f"of {SOURCE_TEXTS_FILE}; annotation_ref is "
            f"urn:ontospan:{bundle_id}:<annotation set id>:<annotation id>, "
            "each part percent-encoded.",
            "- ",
            "  ",
        ),
    ]
    out += planned_out_section(payload)
    out += [
        "",
        *_heading("Verify"),
        *_wrap(
            'Compute the SHA-256 of each file and compare it with "files" in '
            "receipt.json. receipt.json itself is not listed there."
        ),
    ]
    return ("\n".join(out) + "\n").encode("utf-8")


def final_single_term_export(job: Job, ctx: JobContext) -> dict[str, Any]:
    """The single-term cases of a frozen snapshot and its frozen decisions.

    The project setting is not read here: it was checked when the export
    was requested.
    """
    from ontotator.exchange.jobs import (
        _audit,
        build_t1_units,
        store_file,
        t1_contributors,
        write_t1_bundle,
    )

    frozen = load_frozen_final(job, ctx)
    row, payload = frozen.row, frozen.payload
    if FROZEN_KEY not in payload:
        raise DomainError(
            "INVALID_EXPORT_SNAPSHOT",
            "The snapshot holds no frozen single-term decisions.",
        )
    frozen_decisions = payload[FROZEN_KEY]
    assert job.project_id is not None
    with ctx.db.transaction() as conn:
        decisions = load_decisions(conn, job.project_id, frozen_decisions)
        guideline_sha256 = dict(
            conn.execute(
                select(
                    GuidelineVersionRow.version, GuidelineVersionRow.body_sha256
                ).where(GuidelineVersionRow.project_id == job.project_id)
            )
            .tuples()
            .all()
        )
    views: dict[str, ontospan.OntologyView] = {}
    built = build_t1_units(
        ctx.db,
        frozen.project,
        frozen.selected_content,
        final_snapshot_id=row["snapshot_id"],
        source_ref_overrides=frozen.overrides,
        round_kinds=payload["round_kinds"],
        views=views,
    )
    bundle_id = f"selected-{row['snapshot_id']}"
    selected_results = write_t1_bundle(
        built.units,
        bundle_id=bundle_id,
        created_at=row["created_at"],
        contributors=t1_contributors(frozen.selected_content),
    )
    units = source_units(
        payload, frozen.selected_content.submissions, built.units, built.views
    )
    derivation = derive_candidates(
        units,
        negation_cues=frozen_decisions["negation_cues"],
        bundle_id=bundle_id,
    )
    result = build_cases(
        derivation,
        {unit.submission_id: unit for unit in units},
        views,
        decisions,
        guideline_sha256,
    )
    files: dict[str, bytes] = {
        CASES_FILE: _jsonl(result.cases),
        "report.json": _dump(result.report),
        SOURCE_TEXTS_FILE: _jsonl(payload["content"]["documents"].values()),
        SELECTED_RESULTS_FILE: selected_results,
    }
    files["README.txt"] = _readme(
        payload,
        snapshot_id=row["snapshot_id"],
        snapshot_sha256=row["sha256"],
        snapshot_created_at=row["created_at"],
        bundle_id=bundle_id,
        report=result.report,
    )
    receipt = {
        "format": FINAL_SINGLE_TERM_FORMAT,
        "snapshot_id": row["snapshot_id"],
        "snapshot_sha256": row["sha256"],
        "selected_results": {"file": SELECTED_RESULTS_FILE, "bundle_id": bundle_id},
        "single_term_decisions": {
            "ids": [decision["id"] for decision in decisions],
            "sha256": frozen_decisions["sha256"],
        },
        "negation_cues": frozen_decisions["negation_cues"],
        "selections": payload["state"]["selections"],
        "omissions": payload["state"]["omissions"],
        **({"planned_out": payload["planned_out"]} if "planned_out" in payload else {}),
        "files": {
            name: hashlib.sha256(data).hexdigest() for name, data in files.items()
        },
    }
    # Every entry stamped with the snapshot time: the same snapshot gives the
    # same bytes.
    stamp = row["created_at"].astimezone(UTC).timetuple()[:6]
    entries = {
        **dict(sorted(files.items())),
        "receipt.json": json.dumps(
            receipt, sort_keys=True, ensure_ascii=False
        ).encode(),
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name, date_time=stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    digest = store_file(ctx.db, output.getvalue())
    _audit(
        ctx.db,
        frozen.actor,
        "project.final_single_term_export",
        frozen.project,
        {
            "job_id": job.id,
            "snapshot_id": row["snapshot_id"],
            "artifact_sha256": digest,
            "decisions_sha256": frozen_decisions["sha256"],
        },
    )
    return {
        "sha256": digest,
        "snapshot_id": row["snapshot_id"],
        "cases": result.report["cases"],
        "groups": sum(sum(per.values()) for per in result.report["groups"].values()),
        "omissions": receipt["omissions"],
    }
