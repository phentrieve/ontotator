"""Cells of exported CSV files that a spreadsheet cannot run as a formula (#386).

Excel, LibreOffice and Google Sheets treat a cell that starts with ``=``,
``+``, ``-``, ``@``, a tab or a carriage return as a formula, so a display
name, a reason or a passage of an uploaded text such as
``=HYPERLINK("http://x","y")`` would run when someone opens the file. As
OWASP recommends, such a cell gets a leading apostrophe, which makes the
spreadsheet show it as text; the ``csv`` module already quotes every cell with
a delimiter, quote or line break.

Two kinds of cells stay unchanged: a plain number (``-1``, ``+0.5``,
``-1e-3``), which a spreadsheet reads as a number and never as a formula, and
every cell with another first character. A cell that itself starts with an
apostrophe gets a second one, so the rule can be undone without guessing: a
reader that wants the exact values removes one leading apostrophe from every
cell that starts with one (:func:`original_cell`).
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import TypeVar

# The formula starts, and the apostrophe so that the prefix can be undone.
ESCAPED_START = ("=", "+", "-", "@", "\t", "\r", "'")
_NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", re.ASCII)

V = TypeVar("V")


def spreadsheet_cell(value: V) -> V | str:
    """``value`` as a CSV cell no spreadsheet runs as a formula."""
    if (
        isinstance(value, str)
        and value.startswith(ESCAPED_START)
        and _NUMBER.fullmatch(value) is None
    ):
        return "'" + value
    return value


def spreadsheet_row(row: Mapping[str, V]) -> dict[str, V | str]:
    """Every cell of a ``csv.DictWriter`` row through :func:`spreadsheet_cell`."""
    return {key: spreadsheet_cell(value) for key, value in row.items()}


def original_cell(cell: str) -> str:
    """The value :func:`spreadsheet_cell` was given for ``cell``."""
    return cell[1:] if cell.startswith("'") else cell
