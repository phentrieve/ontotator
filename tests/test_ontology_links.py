"""Where a term can be looked up outside Ontotator."""

import pytest

from ontotator.ontology.links import external_term_url, link_template_problem


@pytest.mark.parametrize(
    ("term_id", "expected"),
    [
        ("HP:0001250", "https://hpo.jax.org/browse/term/HP:0001250"),
        ("MONDO:0007739", "https://monarchinitiative.org/MONDO:0007739"),
        ("GO:0008150", "https://www.ebi.ac.uk/ols4/search?q=GO%3A0008150"),
        ("TEST:0000001", "https://www.ebi.ac.uk/ols4/search?q=TEST%3A0000001"),
    ],
)
def test_each_prefix_links_to_its_term_page(term_id: str, expected: str) -> None:
    assert external_term_url(term_id) == expected


def test_the_id_is_encoded_where_it_could_break_the_url() -> None:
    assert (
        external_term_url("HP:12 3/4")
        == "https://hpo.jax.org/browse/term/HP%3A12%203%2F4"
    )


@pytest.mark.parametrize("term_id", ["", "no-prefix", ":0001", "HP:"])
def test_something_that_is_no_curie_has_no_link(term_id: str) -> None:
    assert external_term_url(term_id) is None


ICD = "https://www.icd10data.com/search?s={code}"


@pytest.mark.parametrize(
    ("template", "term_id", "expected"),
    [
        (ICD, "ICD10CM:E11.621", "https://www.icd10data.com/search?s=E11.621"),
        (ICD, "ICD10CM:T36.0X1A", "https://www.icd10data.com/search?s=T36.0X1A"),
        (
            "https://example.org/terms/{id}",
            "ICD10CM:E11.621",
            "https://example.org/terms/ICD10CM:E11.621",
        ),
        (
            "https://example.org/{code}?full={id}",
            "HP:0001250",
            "https://example.org/0001250?full=HP:0001250",
        ),
        (ICD, "ICD10CM:E11 6/1", "https://www.icd10data.com/search?s=E11%206%2F1"),
    ],
)
def test_a_project_template_replaces_the_default_link(
    template: str, term_id: str, expected: str
) -> None:
    assert external_term_url(term_id, template) == expected


def test_without_a_template_the_default_link_stays() -> None:
    assert (
        external_term_url("ICD10CM:E11.621", None)
        == "https://www.ebi.ac.uk/ols4/search?q=ICD10CM%3AE11.621"
    )


@pytest.mark.parametrize(
    "template",
    [ICD, "https://example.org/terms/{id}", "https://example.org/{code}/{id}"],
)
def test_usable_templates(template: str) -> None:
    assert link_template_problem(template) is None


@pytest.mark.parametrize(
    ("template", "problem"),
    [
        ("http://www.icd10data.com/search?s={code}", "Use an https:// address."),
        ("javascript:alert({code})", "Use an https:// address."),
        ("https://{code}", "Put {code} or {id} after the host, not in it."),
        ("https://{code}.example.org/", "Put {code} or {id} after the host, not in it."),
        ("https://example.org.{code}/x", "Put {code} or {id} after the host, not in it."),
        ("https:///search?s={code}", "Use an https:// address."),
        ("https://www.icd10data.com/search", "Put {code} or {id} where the code goes."),
        ("https://example.org/{label}", "Use only {code} and {id} in braces."),
        ("https://example.org/{code", "Use only {code} and {id} in braces."),
        ("https://example.org/ {code}", "Remove the blanks."),
        ("https://example.org/{code}" + "x" * 500, "Use at most 500 characters."),
    ],
)
def test_unusable_templates_are_named(template: str, problem: str) -> None:
    assert link_template_problem(template) == problem
