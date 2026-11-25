"""Build tests/fixtures/icd10cm.json, a small ICD-10-CM excerpt, from the CDC tabular list.

Source: the ICD-10-CM tabular list (``icd10cm-tabular_-YYYY.xml`` in
``icd10cm-table-and-index-YYYY.zip``) published by CDC/NCHS at
https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/ ;
ICD-10-CM is a US government work in the public domain. See
tests/fixtures/icd10cm.md.

usage: uv run python -I scripts/make_icd10cm_fixture.py <tabular.xml> tests/fixtures/icd10cm.json
"""

import json
import re
import sys
import xml.etree.ElementTree as ET

SRC, OUT = sys.argv[1], sys.argv[2]
PREFIX = "ICD10CM"
OBO = "http://purl.obolibrary.org/obo/"
# Categories taken whole, and for T36 only the penicillins (T36.0).
CATEGORIES = {"E11", "N18", "I10", "J45", "T36"}
SUBTREE_LIMIT = {"T36": "T36.0"}
# The eye complications of E11 stop at their second level (E11.31 … E11.39):
# their 5th to 7th characters (laterality) add 60 codes and nothing new.
DEEPEST = {"E11.3": 6}

root = ET.parse(SRC).getroot()
version = root.findtext("version")
nodes: list[dict] = []
edges: list[tuple[str, str]] = []


def add(code: str, label: str, parent: str | None, synonyms: list[str] = ()) -> None:
    node = {"id": f"{PREFIX}:{code}", "lbl": label, "type": "CLASS"}
    if synonyms:
        node["meta"] = {
            "synonyms": [{"pred": "hasExactSynonym", "val": s} for s in synonyms]
        }
    nodes.append(node)
    if parent:
        edges.append((code, parent))


def notes(diag: ET.Element) -> list[str]:
    found = [n.text.strip() for n in diag.findall("inclusionTerm/note") if n.text]
    return [s for s in dict.fromkeys(found) if s]


def walk(diag: ET.Element, parent: str, sevens: dict[str, str], category: str) -> None:
    code = diag.findtext("name")
    label = diag.findtext("desc")
    limit = SUBTREE_LIMIT.get(category)
    if limit and code != category and not (code.startswith(limit)):
        return
    if any(
        code.startswith(stem) and len(code) > depth for stem, depth in DEEPEST.items()
    ):
        return
    own = {e.get("char"): e.text for e in diag.findall("sevenChrDef/extension")}
    sevens = own or sevens
    add(code, label, parent, notes(diag))
    children = diag.findall("diag")
    for child in children:
        walk(child, code, sevens, category)
    if not children and sevens:
        # A code that needs a 7th character: the billable codes are its extensions.
        stem = code.ljust(7, "X") if len(code.replace(".", "")) < 6 else code
        for char, meaning in sevens.items():
            add(f"{stem}{char}", f"{label}, {meaning}", code)


for chapter in root.findall("chapter"):
    chapter_desc = chapter.findtext("desc")
    chapter_range = re.search(r"\(([A-Z0-9]+-[A-Z0-9]+)\)", chapter_desc).group(1)
    chapter_added = False
    for section in chapter.findall("section"):
        block = section.get("id")
        section_added = False
        for diag in section.findall("diag"):
            if diag.findtext("name") not in CATEGORIES:
                continue
            if not chapter_added:
                add(chapter_range, re.sub(r"\s*\([^)]*\)$", "", chapter_desc), None)
                chapter_added = True
            if not section_added:
                add(
                    block,
                    re.sub(r"\s*\([^)]*\)$", "", section.findtext("desc")),
                    chapter_range,
                )
                section_added = True
            walk(diag, block, {}, diag.findtext("name"))

ids = [n["id"] for n in nodes]
assert len(ids) == len(set(ids)), "duplicate ids"
payload = {
    "graphs": [
        {
            "id": f"{OBO}icd10cm.json",
            "meta": {
                "version": f"{OBO}icd10cm/releases/{int(version) - 1}-10-01/icd10cm.json",
                "basicPropertyValues": [
                    {
                        "pred": "http://purl.org/dc/terms/source",
                        "val": f"ICD-10-CM FY{version} tabular list, CDC/NCHS (public domain); excerpt for tests",
                    }
                ],
            },
            "nodes": nodes,
            "edges": [
                {"sub": f"{PREFIX}:{s}", "pred": "is_a", "obj": f"{PREFIX}:{o}"}
                for s, o in edges
            ],
        }
    ]
}
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, indent=1, ensure_ascii=False)
    fh.write("\n")
print(len(nodes), "terms")
