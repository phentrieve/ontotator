"""Split the backend test files into CI shards, deterministically.

    uv run python scripts/pytest_shard.py --of 4 --shard 2      # the files of shard 2, one per line
    uv run python scripts/pytest_shard.py --of 4 --plan         # every shard's files and expected seconds
    uv run python scripts/pytest_shard.py --of 4 --verify       # collect the suite once; each test in one shard
    uv run python scripts/pytest_shard.py --count-junit a.xml b.xml   # tests the shards ran
    uv run python scripts/pytest_shard.py --update-timings a.xml b.xml   # refresh the timing file

Every ``test_*.py`` / ``*_test.py`` file under ``tests/`` (pytest's default pattern) goes to
exactly one shard. The files are spread by the seconds in ``tests/pytest_timings.json``
(longest first, each to the shard with the least time so far); a file without a timing counts
as the mean of the known ones. Refresh the file from the ``pytest-junit-shard-*`` artifacts
of a CI run when the shards drift apart; a stale file only unbalances the shards, it never
drops a test.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"
TIMINGS = TESTS / "pytest_timings.json"


def discover_test_files() -> list[str]:
    found = {*TESTS.rglob("test_*.py"), *TESTS.rglob("*_test.py")}
    return sorted(path.relative_to(ROOT).as_posix() for path in found)


def load_timings() -> dict[str, float]:
    if not TIMINGS.exists():
        return {}
    data = json.loads(TIMINGS.read_text(encoding="utf-8"))
    return {str(name): float(seconds) for name, seconds in data.items()}


def plan(shards: int) -> list[tuple[float, list[str]]]:
    files = discover_test_files()
    timings = load_timings()
    known = [timings[name] for name in files if name in timings]
    default = sum(known) / len(known) if known else 1.0
    weight = {name: timings.get(name, default) for name in files}
    loads: list[tuple[float, list[str]]] = [(0.0, []) for _ in range(shards)]
    for name in sorted(files, key=lambda name: (-weight[name], name)):
        index = min(range(shards), key=lambda i: (loads[i][0], i))
        total, members = loads[index]
        loads[index] = (total + weight[name], [*members, name])
    return [(total, sorted(members)) for total, members in loads]


def collect() -> list[str]:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "--collect-only", "-q"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stdout + result.stderr)
        raise SystemExit("pytest --collect-only failed")
    return [line for line in result.stdout.splitlines() if "::" in line]


def verify(shards: int) -> int:
    """Collect the whole suite once and check that the shards cover every test once."""
    node_ids = collect()
    owner = {
        name: index
        for index, (_, members) in enumerate(plan(shards))
        for name in members
    }
    counts = [0] * shards
    stray = sorted({node.split("::", 1)[0] for node in node_ids} - owner.keys())
    for node in node_ids:
        file = node.split("::", 1)[0]
        if file in owner:
            counts[owner[file]] += 1
    for index, count in enumerate(counts, start=1):
        print(f"shard {index}/{shards}: {count} tests")
    print(f"unsharded: {len(node_ids)} tests; across shards: {sum(counts)}")
    if stray:
        print("collected but in no shard: " + ", ".join(stray), file=sys.stderr)
        return 1
    return 0 if sum(counts) == len(node_ids) else 1


def junit_cases(paths: list[str]) -> list[ET.Element]:
    return [
        case for path in paths for case in ET.parse(path).getroot().iter("testcase")
    ]


def case_file(case: ET.Element, files: set[str]) -> str | None:
    """``tests.test_x.TestY`` -> ``tests/test_x.py``: the longest prefix that is a test file."""
    parts = case.get("classname", "").split(".")
    for end in range(len(parts), 0, -1):
        candidate = "/".join(parts[:end]) + ".py"
        if candidate in files:
            return candidate
    return None


def update_timings(paths: list[str]) -> int:
    files = set(discover_test_files())
    seconds: dict[str, float] = defaultdict(float)
    for case in junit_cases(paths):
        file = case_file(case, files)
        if file is not None:
            seconds[file] += float(case.get("time", "0") or 0)
    TIMINGS.write_text(
        json.dumps(
            {name: round(seconds[name], 2) for name in sorted(seconds)}, indent=1
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(seconds)} file timings to {TIMINGS.relative_to(ROOT)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--of", type=int, default=4, help="number of shards")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument(
        "--shard", type=int, help="print the files of this shard (1-based)"
    )
    action.add_argument("--plan", action="store_true")
    action.add_argument("--verify", action="store_true")
    action.add_argument("--count-junit", nargs="+", metavar="XML")
    action.add_argument("--update-timings", nargs="+", metavar="XML")
    args = parser.parse_args()
    if args.of < 1:
        parser.error("--of must be at least 1")
    if args.shard is not None:
        if not 1 <= args.shard <= args.of:
            parser.error(f"--shard must be between 1 and {args.of}")
        print("\n".join(plan(args.of)[args.shard - 1][1]))
        return 0
    if args.plan:
        for index, (total, members) in enumerate(plan(args.of), start=1):
            print(f"shard {index}/{args.of}: {len(members)} files, ~{total:.0f}s")
        return 0
    if args.verify:
        return verify(args.of)
    if args.count_junit:
        print(len(junit_cases(args.count_junit)))
        return 0
    return update_timings(args.update_timings)


if __name__ == "__main__":
    raise SystemExit(main())
