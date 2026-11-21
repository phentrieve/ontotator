"""Scheduled backup wrapper with stub sibling scripts; no Docker, no restic."""

import os
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import pytest
from test_check_script import bash_executable

ROOT = Path(__file__).resolve().parents[1]
NAME = "20261120T033000Z"

# Stubs for the three scripts nightly-backup.sh calls from its own directory.
# Each logs its arguments; STUB_<SCRIPT>_EXIT makes one fail.
STUBS = {
    "backup.sh": r"""
printf 'backup %s\n' "$*" >> "$STUB_LOG"
[[ -n "${STUB_BACKUP_EXIT:-}" ]] && exit "$STUB_BACKUP_EXIT"
mkdir "$1/__NAME__"
echo "backup: recovery point complete" >&2
printf '%s\n' "$1/__NAME__"
""",
    "offsite-backup.sh": r"""
printf 'offsite %s\n' "$*" >> "$STUB_LOG"
[[ -n "${STUB_OFFSITE_EXIT:-}" ]] && exit "$STUB_OFFSITE_EXIT"
if [[ "$1" == fetch ]]; then mkdir "$2/$3"; printf '%s\n' "$2/$3"; fi
""",
    "restore-check.sh": r"""
printf 'drill %s %s\n' "$*" "$(test -d "$1" && echo present)" >> "$STUB_LOG"
exit "${STUB_DRILL_EXIT:-0}"
""",
}


def today_iso_weekday():
    return datetime.now(UTC).isoweekday()


@pytest.fixture
def nightly(tmp_path):
    scripts = tmp_path / "deploy"
    scripts.mkdir()
    shutil.copy(ROOT / "scripts/nightly-backup.sh", scripts)
    for name, body in STUBS.items():
        (scripts / name).write_text(
            "#!/usr/bin/env bash\n" + body.replace("__NAME__", NAME),
            encoding="utf-8",
            newline="\n",
        )
    root = tmp_path / "backups"
    root.mkdir()
    drill_dir = tmp_path / "isolated-restore"
    drill_dir.mkdir()
    log = tmp_path / "calls.log"

    def run(*args, **extra):
        env = {k: v for k, v in os.environ.items() if not k.startswith("ONTOTATOR_")}
        env.update(STUB_LOG=str(log), ONTOTATOR_BACKUP_ROOT=str(root))
        env.update(extra)
        env = {k: v for k, v in env.items() if v is not None}
        log.unlink(missing_ok=True)
        result = subprocess.run(
            [bash_executable(), str(scripts / "nightly-backup.sh"), *args],
            cwd=scripts,
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
        )
        calls = log.read_text().splitlines() if log.exists() else []
        return result, calls

    run.root = root
    run.drill_dir = drill_dir
    return run


def test_backs_up_copies_off_host_and_records_success(nightly):
    result, calls = nightly()
    assert result.returncode == 0, result.stderr
    point = nightly.root / NAME
    assert calls == [
        f"backup {nightly.root} --wait-jobs 600 --keep-days 14",
        f"offsite push {point}",
    ]
    status = (nightly.root / "last-success").read_text()
    assert f"recovery point: {NAME}" in status
    assert "off-host: copied" in status
    assert "restore drill: not scheduled" in status


def test_drill_runs_on_the_copy_fetched_back_and_removes_it(nightly):
    result, calls = nightly(
        ONTOTATOR_RESTORE_CHECK_DIR=str(nightly.drill_dir),
        ONTOTATOR_RESTORE_CHECK_DAYS=str(today_iso_weekday()),
    )
    assert result.returncode == 0, result.stderr
    work = nightly.root / ".drill"
    assert calls[2] == f"offsite fetch {work} {NAME}"
    assert calls[3] == f"drill {work / NAME} {nightly.drill_dir} present"
    assert not (work / NAME).exists()
    assert (
        "restore drill: passed (off-host copy)"
        in (nightly.root / "last-success").read_text()
    )


def test_no_drill_on_other_days(nightly):
    other = today_iso_weekday() % 7 + 1
    result, calls = nightly(
        ONTOTATOR_RESTORE_CHECK_DIR=str(nightly.drill_dir),
        ONTOTATOR_RESTORE_CHECK_DAYS=str(other),
    )
    assert result.returncode == 0, result.stderr
    assert not any(c.startswith(("drill", "offsite fetch")) for c in calls)


def test_without_off_host_copy_the_drill_uses_the_local_point(nightly):
    result, calls = nightly(
        ONTOTATOR_OFFSITE="none",
        ONTOTATOR_RESTORE_CHECK_DIR=str(nightly.drill_dir),
    )
    assert result.returncode == 0, result.stderr
    assert not any(c.startswith("offsite") for c in calls)
    assert calls[-1] == f"drill {nightly.root / NAME} {nightly.drill_dir} present"
    assert "this host only" in result.stderr
    assert (nightly.root / NAME).is_dir()


def test_a_failed_drill_fails_the_run_and_records_no_success(nightly):
    result, _ = nightly(
        ONTOTATOR_RESTORE_CHECK_DIR=str(nightly.drill_dir), STUB_DRILL_EXIT="1"
    )
    assert result.returncode == 1
    assert "restore drill" in result.stderr
    assert not (nightly.root / "last-success").exists()
    assert not (nightly.root / ".drill" / NAME).exists()


def test_a_failed_off_host_copy_fails_the_run(nightly):
    result, calls = nightly(
        STUB_OFFSITE_EXIT="1", ONTOTATOR_RESTORE_CHECK_DIR=str(nightly.drill_dir)
    )
    assert result.returncode == 1
    assert not any(c.startswith("drill") for c in calls)
    assert not (nightly.root / "last-success").exists()


def test_running_jobs_keep_the_exit_code_of_backup(nightly):
    result, calls = nightly(STUB_BACKUP_EXIT="75")
    assert result.returncode == 75
    assert calls == [f"backup {nightly.root} --wait-jobs 600 --keep-days 14"]


@pytest.mark.parametrize(
    "extra",
    [
        {"ONTOTATOR_BACKUP_ROOT": None},
        {"ONTOTATOR_OFFSITE": "rsync"},
        {"ONTOTATOR_RESTORE_CHECK_DAYS": "8"},
    ],
)
def test_refuses_bad_configuration(nightly, extra):
    result, calls = nightly(**extra)
    assert result.returncode == 1
    assert calls == []
