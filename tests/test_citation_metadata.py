"""CITATION.cff and .zenodo.json agree with the release and with each other."""

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def cff_value(key: str) -> str:
    text = (ROOT / "CITATION.cff").read_text(encoding="utf-8")
    match = re.search(rf"^{re.escape(key)}: (.+)$", text, re.MULTILINE)
    assert match, f"CITATION.cff has no {key}"
    return match.group(1).strip().strip("\"'")


def project_version() -> str:
    with (ROOT / "pyproject.toml").open("rb") as file:
        return tomllib.load(file)["project"]["version"]


def test_citation_names_the_current_release_and_its_date():
    version = project_version()
    assert cff_value("version") == version
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    heading = re.search(
        rf"^## \[{re.escape(version)}\] - (\d{{4}}-\d{{2}}-\d{{2}})$",
        changelog,
        re.MULTILINE,
    )
    assert heading, f"CHANGELOG.md has no heading for {version}"
    assert cff_value("date-released") == heading.group(1)


def test_zenodo_metadata_matches_the_citation():
    zenodo = json.loads((ROOT / ".zenodo.json").read_text(encoding="utf-8"))
    assert zenodo["upload_type"] == "software"
    assert zenodo["title"] == cff_value("title")
    assert zenodo["license"] == cff_value("license")
    assert zenodo["description"] == cff_value("abstract")
    names = re.findall(
        r"- family-names: (.+)\n\s+given-names: (.+)",
        (ROOT / "CITATION.cff").read_text(encoding="utf-8"),
    )
    assert [c["name"] for c in zenodo["creators"]] == [
        f"{family.strip()}, {given.strip()}" for family, given in names
    ]
    # Zenodo takes the version from the release tag; a fixed one would go stale.
    assert "version" not in zenodo
