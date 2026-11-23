"""The ICD-10-CM excerpt in tests/fixtures (icd10cm.md) loads and is searched by code."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from ontotator.domain.documents import OntologyRef
from ontotator.domain.workspace import WorkspaceKey
from ontotator.ontology.provenance import SearchRequest
from ontotator.ontology.service import OntologyService
from ontotator.ontology.tree import tree_for

PATH = Path(__file__).parent / "fixtures" / "icd10cm.json"


@pytest.fixture(scope="module")
def icd() -> OntologyService:
    sha = hashlib.sha256(PATH.read_bytes()).hexdigest()
    return OntologyService.load(PATH, OntologyRef(release="2026-10-01", sha256=sha))


def _request(query: str) -> SearchRequest:
    key = WorkspaceKey(
        project_key="icd",
        document_id="doc-1",
        annotator_id="ana",
        mode="independent",
        target_set_id="targets-1",
    )
    return SearchRequest(workspace_key=key, annotation_id="ann-1", query=query)


def test_the_excerpt_keeps_its_codes_and_hierarchy(icd: OntologyService) -> None:
    ontology = icd.ontology
    assert ontology.dominant_prefix == "ICD10CM"
    assert 50 <= len(ontology.terms) <= 150
    assert ontology.ancestors_of("ICD10CM:E11.621") == [
        "ICD10CM:E11.62",
        "ICD10CM:E11.6",
        "ICD10CM:E11",
        "ICD10CM:E08-E13",
        "ICD10CM:E00-E89",
    ]
    assert ontology.label_of("ICD10CM:N18.1") == "Chronic kidney disease, stage 1"
    assert ontology.get("ICD10CM:T36.0X1A") is not None
    assert {"ICD10CM:I10", "ICD10CM:J45.909"} <= set(ontology.terms)
    # The chapters are the tree's roots.
    assert set(tree_for(ontology).roots()) == {
        "ICD10CM:E00-E89",
        "ICD10CM:I00-I99",
        "ICD10CM:J00-J99",
        "ICD10CM:N00-N99",
        "ICD10CM:S00-T88",
    }


@pytest.mark.parametrize(
    ("query", "term"),
    [
        ("E11.621", "ICD10CM:E11.621"),
        ("ICD10CM:E11.621", "ICD10CM:E11.621"),
        ("t36.0x1a", "ICD10CM:T36.0X1A"),
        ("N18.1", "ICD10CM:N18.1"),
        ("I10", "ICD10CM:I10"),
    ],
)
def test_a_typed_code_goes_straight_to_its_term(
    icd: OntologyService, query: str, term: str
) -> None:
    result = icd.search(_request(query))
    assert [c.term_id for c in result.candidates] == [term]
    assert result.candidates[0].route == "id"


def test_words_find_codes_by_their_names(icd: OntologyService) -> None:
    result = icd.search(_request("foot ulcer"))
    assert "ICD10CM:E11.621" in [c.term_id for c in result.candidates]
