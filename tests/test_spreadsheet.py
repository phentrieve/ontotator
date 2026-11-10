"""CSV cells of the final export that no spreadsheet runs as a formula (#386)."""

from __future__ import annotations

import csv
import io
from typing import Any

import pytest

from ontotator.exchange.final_export_guide import (
    build_index_csv,
    build_planned_out_csv,
)
from ontotator.exchange.final_tables import (
    ExportedUnit,
    _csv,
    build_findings_csv,
)
from ontotator.exchange.spreadsheet import (
    original_cell,
    spreadsheet_cell,
    spreadsheet_row,
)

LINK = '=HYPERLINK("http://x","y")'


def rows(data: bytes) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline="")))


@pytest.mark.parametrize(
    ("value", "cell"),
    [
        ("=1+1", "'=1+1"),
        (LINK, "'" + LINK),
        ("+49 30 1234", "'+49 30 1234"),
        ("-fever", "'-fever"),
        ("- 5 mg", "'- 5 mg"),
        ("@SUM(A1)", "'@SUM(A1)"),
        ("\tx", "'\tx"),
        ("\rx", "'\rx"),
        # An apostrophe of its own gets a second one, so the rule can be undone.
        ("'quoted", "''quoted"),
        ("'=1", "''=1"),
        # Plain numbers are numbers to a spreadsheet, never formulas.
        ("-1", "-1"),
        ("+0.5", "+0.5"),
        ("-1.25e-3", "-1.25e-3"),
        ("-.5", "-.5"),
        ("0.8000", "0.8000"),
        # Other first characters stay as they are.
        ("case-1", "case-1"),
        ("3-7+9-12", "3-7+9-12"),
        ("a=b", "a=b"),
        (" =1", " =1"),
        ("", ""),
        # Non-ASCII digits are no number.
        ("-" + chr(0x661), "'-" + chr(0x661)),
    ],
)
def test_cells_starting_like_a_formula_get_an_apostrophe(value, cell):
    assert spreadsheet_cell(value) == cell
    assert original_cell(cell) == value


def test_other_values_and_rows_pass_through():
    assert spreadsheet_cell(None) is None
    assert spreadsheet_cell(-3) == -3
    assert spreadsheet_row({"a": "=1+1", "b": "x", "c": 2}) == {
        "a": "'=1+1",
        "b": "x",
        "c": 2,
    }


def test_analysis_tables_escape_every_cell():
    data = _csv(("name", "f1"), [{"name": "=1+1", "f1": "-0.2500"}])
    assert data.decode("utf-8-sig") == "name,f1\r\n'=1+1,-0.2500\r\n"


def _doc(document_id: str, case_id: str, text: str) -> dict[str, Any]:
    return {
        "document": {
            "document_id": document_id,
            "language": "en",
            "text": text,
            "text_sha256": "h",
        },
        "source_text_sha256": "s",
        "variant": {
            "document_id": document_id,
            "case_id": case_id,
            "language": "en",
            "version": 1,
            "origin": "native",
        },
    }


def test_findings_escape_covered_text_and_case_id_and_keep_offsets():
    from t1_fixtures import annotation, unit

    text = "=1+1 seizures since birth."
    payload = {
        "state": {"selections": []},
        "round_kinds": {},
        "content": {
            "documents": {"d1": _doc("d1", LINK, text)},
            "submissions": [
                {
                    "submission_id": "s1",
                    "origin_key": {
                        "document_id": "d1",
                        "annotator_id": "reader-0001",
                        "mode": "annotate",
                    },
                    "snapshots": [],
                }
            ],
        },
    }
    item = unit("d1", text=text, annotations=[annotation("f1", (0, 4), text=text)])
    units = [ExportedUnit("s1", "selected", "x.zip", "documents/00000.json", item)]
    [row] = rows(
        build_findings_csv(
            payload, units, consolidations={}, label=lambda _layer, _term: "Seizure"
        )
    )
    assert row["case_id"] == "'" + LINK
    assert (row["mentions"], row["covered_text"]) == ("0-4", "'=1+1")
    start, end = (int(part) for part in row["mentions"].split("-"))
    assert text[start:end] == original_cell(row["covered_text"])


def test_index_and_planned_out_escape_case_ids_and_reasons():
    payload = {
        "project": "t5",
        "state": {
            "selections": [
                {
                    "case_id": "=1+1",
                    "language": "en",
                    "document_id": "d1",
                    "submission_id": "s1",
                    "revision": 1,
                }
            ],
            "warnings": [],
            "omissions": [{"case_id": "@cmd", "language": "en"}],
        },
        "content": {
            "documents": {"d1": _doc("d1", "=1+1", "x")},
            "submissions": [
                {
                    "submission_id": "s1",
                    "origin_key": {
                        "document_id": "d1",
                        "annotator_id": "reader-0001",
                        "mode": "independent",
                    },
                    "snapshots": [],
                }
            ],
            "guideline_versions": {},
        },
        "round_kinds": {"s1": "ordinary"},
        "selected_submission_ids": ["s1"],
        "planned_out": [
            {
                "case_id": "-2",
                "language": "en",
                "revision": 3,
                "planned_out_at": "2026-10-18T09:15:02.123456Z",
                "reason": LINK,
                "final_result_kept": False,
            }
        ],
    }
    index = rows(build_index_csv(payload, ["s1"], []))
    assert sorted(r["case_id"] for r in index) == ["'=1+1", "'@cmd", "-2"]
    [planned] = rows(build_planned_out_csv(payload))
    assert (planned["case_id"], planned["reason"]) == ("-2", "'" + LINK)


def test_readme_says_how_to_undo_the_apostrophe():
    from datetime import UTC, datetime

    from test_final_export_guide import payload

    from ontotator.exchange.final_export_guide import guide_files

    files = guide_files(
        payload(),
        snapshot_id="s",
        snapshot_sha256="0" * 64,
        snapshot_created_at=datetime(2026, 10, 19, tzinfo=UTC),
    )
    flat = " ".join(files["README.txt"].decode().split())
    assert "remove one leading apostrophe from every cell that starts with one" in flat
