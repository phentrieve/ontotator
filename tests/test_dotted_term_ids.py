"""Term ids with dots in the local part, as ICD-10 and ATC codes have them.

A tiny made-up ontology (prefix ``XMPL``) stands in for such a catalogue:
``XMPL:A01`` is a group, ``XMPL:A01.1`` and ``XMPL:A01.1X2B`` are codes in it.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from ontotator.domain.annotations import (
    CURIE_PATTERN,
    ActorRef,
    Annotation,
    Modifier,
    Provenance,
)
from ontotator.domain.documents import OntologyRef
from ontotator.domain.errors import InvalidAnnotation
from ontotator.domain.workspace import WorkspaceKey
from ontotator.ontology.provenance import SearchRequest
from ontotator.ontology.service import OntologyService
from ontotator.vendor.hpo_span_annotator.hpo import curie
from ontotator.vendor.hpo_span_annotator.hpo import load as load_ontology

OBO = "http://purl.obolibrary.org/obo/"
PROVENANCE = Provenance(actor=ActorRef(actor_id="ana", kind="human"), method="manual")

VALID = ["HP:0001250", "XMPL:A01.1", "XMPL:A01.1X2B", "XMPL:A.B.C", "XMPL:A00-A09"]
INVALID = [
    "XMPL:.A01",
    "XMPL:A01.",
    "XMPL:A01..1",
    "XMPL:",
    "XMPL.A:A01",
    "XMPL:A01 1",
    "A01.1",
]


@pytest.mark.parametrize("term_id", VALID)
def test_curie_pattern_accepts_inner_dots(term_id: str) -> None:
    assert CURIE_PATTERN.match(term_id)


@pytest.mark.parametrize("term_id", INVALID)
def test_curie_pattern_rejects_edge_and_double_dots(term_id: str) -> None:
    assert not CURIE_PATTERN.match(term_id)


def _annotation(term_id: str, modifiers: list[Modifier] | None = None) -> Annotation:
    return Annotation(
        annotation_id="a-1",
        document_id="doc-1",
        term_id=term_id,
        provenance=PROVENANCE,
        modifiers=modifiers or [],
    )


def test_annotation_and_modifier_take_dotted_ids() -> None:
    annotation = _annotation("XMPL:A01.1X2B", [Modifier(term_id="XMPL:A01.1")])
    assert annotation.term_id == "XMPL:A01.1X2B"
    assert [m.term_id for m in annotation.modifiers] == ["XMPL:A01.1"]


def test_annotation_rejects_trailing_dot() -> None:
    with pytest.raises(InvalidAnnotation, match="term_id"):
        _annotation("XMPL:A01.")
    with pytest.raises(InvalidAnnotation, match="modifier"):
        _annotation("XMPL:A01.1", [Modifier(term_id="XMPL:.A01")])


def _key() -> WorkspaceKey:
    return WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="ana",
        mode="independent",
        target_set_id="targets-1",
    )


def _request(query: str, **overrides: object) -> SearchRequest:
    fields: dict[str, object] = {
        "workspace_key": _key(),
        "annotation_id": "ann-1",
        "query": query,
    }
    fields.update(overrides)
    return SearchRequest.model_validate(fields)


def test_search_within_takes_dotted_roots() -> None:
    assert _request("x", within=["XMPL:A01.1"]).within == ["XMPL:A01.1"]
    with pytest.raises(ValidationError):
        _request("x", within=["XMPL:A01."])


@pytest.mark.parametrize(
    ("iri", "expected"),
    [
        (f"{OBO}XMPL_A01.1", "XMPL:A01.1"),
        (f"{OBO}XMPL_A01.1X2B", "XMPL:A01.1X2B"),
        (f"{OBO}XMPL_A00-A09", "XMPL:A00-A09"),
        (f"{OBO}HP_0001250", "HP:0001250"),
        ("XMPL:A01.1", "XMPL:A01.1"),
        (f"{OBO}XMPL_A01.", None),
        (f"{OBO}XMPL_.A01", None),
        (f"{OBO}XMPL_A01..1", None),
        (f"{OBO}XMPL_A_01", None),
    ],
)
def test_curie_parses_dotted_obo_iris(iri: str, expected: str | None) -> None:
    assert curie(iri) == expected


def _write_ontology(tmp_path: Path) -> Path:
    # Ids as OBO IRIs on two nodes and as a plain CURIE on the third, so both
    # forms the loader reads are covered. Edges use IRIs.
    payload = {
        "graphs": [
            {
                "id": "http://example.org/xmpl.json",
                "meta": {"version": "http://example.org/releases/2026-01-01/xmpl.json"},
                "nodes": [
                    {"id": f"{OBO}XMPL_A01", "lbl": "Example group", "type": "CLASS"},
                    {
                        "id": f"{OBO}XMPL_A01.1",
                        "lbl": "Example code one",
                        "type": "CLASS",
                        "meta": {
                            "synonyms": [{"pred": "hasExactSynonym", "val": "A01.1"}],
                            "basicPropertyValues": [
                                {
                                    "pred": "oboInOwl:hasAlternativeId",
                                    "val": f"{OBO}XMPL_A01.0",
                                }
                            ],
                        },
                    },
                    {
                        "id": "XMPL:A01.1X2B",
                        "lbl": "Example code one, second kind",
                        "type": "CLASS",
                    },
                    {"id": f"{OBO}XMPL_A01.", "lbl": "Broken id", "type": "CLASS"},
                ],
                "edges": [
                    {
                        "sub": f"{OBO}XMPL_A01.1",
                        "pred": "is_a",
                        "obj": f"{OBO}XMPL_A01",
                    },
                    {
                        "sub": f"{OBO}XMPL_A01.1X2B",
                        "pred": "is_a",
                        "obj": f"{OBO}XMPL_A01.1",
                    },
                ],
            }
        ]
    }
    path = tmp_path / "xmpl.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_obo_graph_import_keeps_dotted_ids(tmp_path: Path) -> None:
    ontology = load_ontology(_write_ontology(tmp_path))

    assert set(ontology.terms) == {"XMPL:A01", "XMPL:A01.1", "XMPL:A01.1X2B"}
    assert ontology.dominant_prefix == "XMPL"
    code = ontology.get("XMPL:A01.1")
    assert code is not None
    assert code.parents == ["XMPL:A01"]
    assert code.alt_ids == ["XMPL:A01.0"]
    assert ontology.children_of("XMPL:A01.1") == ["XMPL:A01.1X2B"]
    assert ontology.ancestors_of("XMPL:A01.1X2B") == ["XMPL:A01.1", "XMPL:A01"]


def _service(path: Path) -> OntologyService:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return OntologyService.load(path, OntologyRef(release="2026-01-01", sha256=digest))


def test_search_finds_dotted_terms(tmp_path: Path) -> None:
    service = _service(_write_ontology(tmp_path))

    by_id = service.search(_request("XMPL:A01.1X2B", route="id"))
    assert [c.term_id for c in by_id.candidates] == ["XMPL:A01.1X2B"]

    # The bare code is a keyword; it finds the term through its exact synonym.
    by_code = service.search(_request("A01.1"))
    assert by_code.candidates[0].term_id == "XMPL:A01.1"

    within = service.search(_request("example", within=["XMPL:A01.1"]))
    assert {c.term_id for c in within.candidates} == {"XMPL:A01.1", "XMPL:A01.1X2B"}
