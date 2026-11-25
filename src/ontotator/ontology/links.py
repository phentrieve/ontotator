"""Where a term can be looked up outside Ontotator.

HPO and MONDO have term pages addressed by the CURIE. Every other ontology is
looked up through the EBI Ontology Lookup Service search, which finds a term
by its CURIE.

A project can set its own link per ontology (Settings > Annotation, card
**Term codes**): a template such as
``https://www.icd10data.com/search?s={code}``, where ``{code}`` is the local
part of the id (``E11.621``) and ``{id}`` the full id (``ICD10CM:E11.621``).
A template replaces the default link for that ontology only.
"""

from __future__ import annotations

import re
from urllib.parse import quote, urlsplit

_TERM_PAGES = {
    "HP": "https://hpo.jax.org/browse/term/{id}",
    "MONDO": "https://monarchinitiative.org/{id}",
}
_FALLBACK = "https://www.ebi.ac.uk/ols4/search?q={id}"

# The placeholders a project's link template may hold.
LINK_PLACEHOLDERS = ("{code}", "{id}")
LINK_TEMPLATE_MAX_LENGTH = 500
_BRACES = re.compile(r"\{[^{}]*\}|[{}]")


def link_template_problem(template: str) -> str | None:
    """Why ``template`` is no usable link template, or None when it is.

    A template is an https address without blanks that holds ``{code}`` or
    ``{id}`` and no other braces.
    """
    if len(template) > LINK_TEMPLATE_MAX_LENGTH:
        return f"Use at most {LINK_TEMPLATE_MAX_LENGTH} characters."
    if any(char.isspace() for char in template):
        return "Remove the blanks."
    # The host is fixed: a placeholder there could send the link anywhere.
    host = re.split(r"[/?#]", template.removeprefix("https://"), maxsplit=1)[0]
    if not template.startswith("https://"):
        return "Use an https:// address."
    if "{" in host or "}" in host:
        return "Put {code} or {id} after the host, not in it."
    if not urlsplit(template).hostname:
        return "Use an https:// address."
    if any(brace not in LINK_PLACEHOLDERS for brace in _BRACES.findall(template)):
        return "Use only {code} and {id} in braces."
    if not any(placeholder in template for placeholder in LINK_PLACEHOLDERS):
        return "Put {code} or {id} where the code goes."
    return None


def external_term_url(term_id: str, template: str | None = None) -> str | None:
    """The page of a term, or None for something that is no CURIE.

    With a project's ``template`` that page is the template filled in;
    without one, the official page (HPO, MONDO) or the OLS search.
    """
    prefix, _, local = term_id.partition(":")
    if not prefix or not local:
        return None
    if template:
        return template.replace("{code}", quote(local, safe="")).replace(
            "{id}", quote(term_id, safe=":")
        )
    page = _TERM_PAGES.get(prefix)
    if page is None:
        return _FALLBACK.format(id=quote(term_id, safe=""))
    # A plain CURIE stays readable; anything unusual is encoded.
    safe = ":" if local.isalnum() else ""
    return page.format(id=quote(term_id, safe=safe))
