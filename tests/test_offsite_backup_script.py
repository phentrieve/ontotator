"""Off-host copy script through a stub restic; no real repository."""

import hashlib
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from test_check_script import bash_executable

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/offsite-backup.sh"

# The stub logs each call with its working directory. `backup` copies the named
# directory into STUB_REPO (the "repository"); `restore` puts it back below
# --target at the absolute path it came from, as restic does. STUB_FAIL names a
# subcommand that fails.
RESTIC_STUB = r"""#!/usr/bin/env bash
printf '%s\n' "restic $* (cwd=$PWD)" >> "$STUB_LOG"
[[ "${STUB_FAIL:-}" == "$1" ]] && exit 3
case "$1" in
  backup)
    name="${@: -1}"
    rm -rf "$STUB_REPO/snapshot"; mkdir -p "$STUB_REPO/snapshot$PWD"
    cp -a "$name" "$STUB_REPO/snapshot$PWD/" ;;
  restore)
    while [[ $# -gt 0 ]]; do [[ "$1" == --target ]] && target="$2"; shift; done
    cp -a "$STUB_REPO/snapshot/." "$target/" ;;
esac
"""


def make_point(parent: Path, name="20261120T033000Z") -> Path:
    point = parent / name
    point.mkdir(parents=True)
    files = {
        "database.dump": b"PGDMP-dump",
        "data.tar": b"tar-bytes",
        "image-reference.txt": b"ghcr.io/x/ontotator@sha256:abc\n",
    }
    sums = []
    for file, content in files.items():
        (point / file).write_bytes(content)
        sums.append(f"{hashlib.sha256(content).hexdigest()}  {file}\n")
    (point / "SHA256SUMS").write_text("".join(sums))
    return point


@pytest.fixture
def offsite(tmp_path):
    binaries = tmp_path / "bin"
    binaries.mkdir()
    stub = binaries / "restic"
    stub.write_text(RESTIC_STUB, encoding="utf-8", newline="\n")
    stub.chmod(0o755)
    repo = tmp_path / "repo"
    repo.mkdir()
    password = tmp_path / "restic-password"
    password.write_text("invented-test-key\n")
    log = tmp_path / "calls.log"

    def run(*args, **extra):
        env = {
            k: v
            for k, v in os.environ.items()
            if not k.startswith(("RESTIC_", "ONTOTATOR_"))
        }
        env.update(
            PATH=str(binaries) + os.pathsep + env["PATH"],
            STUB_LOG=str(log),
            STUB_REPO=str(repo),
            RESTIC_REPOSITORY="s3:https://s3.example.org/test",
            RESTIC_PASSWORD_FILE=str(password),
        )
        env.update(extra)
        env = {k: v for k, v in env.items() if v is not None}
        log.unlink(missing_ok=True)
        result = subprocess.run(
            [bash_executable(), str(SCRIPT), *map(str, args)],
            cwd=tmp_path,
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
        )
        calls = log.read_text().splitlines() if log.exists() else []
        return result, calls

    run.tmp = tmp_path
    return run


def test_push_copies_a_verified_point_and_applies_retention(offsite):
    point = make_point(offsite.tmp / "backups")
    result, calls = offsite("push", point)
    assert result.returncode == 0, result.stderr
    backup, forget = calls
    assert backup == (
        "restic backup --tag ontotator-recovery-point --tag 20261120T033000Z "
        f"20261120T033000Z (cwd={point.parent})"
    )
    assert forget.startswith(
        "restic forget --tag ontotator-recovery-point --group-by host --prune "
        "--keep-daily 14 --keep-weekly 8 --keep-monthly 12"
    )


def test_push_runs_a_data_check_when_asked(offsite):
    point = make_point(offsite.tmp / "backups")
    result, calls = offsite("push", point, ONTOTATOR_OFFSITE_CHECK_SUBSET="5%")
    assert result.returncode == 0, result.stderr
    assert calls[-1].startswith("restic check --read-data-subset=5%")


def test_push_with_retention_off_keeps_every_snapshot(offsite):
    point = make_point(offsite.tmp / "backups")
    zero = dict.fromkeys(
        [
            "ONTOTATOR_OFFSITE_KEEP_DAILY",
            "ONTOTATOR_OFFSITE_KEEP_WEEKLY",
            "ONTOTATOR_OFFSITE_KEEP_MONTHLY",
        ],
        "0",
    )
    result, calls = offsite("push", point, **zero)
    assert result.returncode == 0, result.stderr
    assert [c.split()[1] for c in calls] == ["backup"]


def test_push_refuses_a_point_that_does_not_verify(offsite):
    point = make_point(offsite.tmp / "backups")
    (point / "data.tar").write_bytes(b"changed")
    result, calls = offsite("push", point)
    assert result.returncode == 1
    assert "SHA256SUMS does not verify" in result.stderr
    assert calls == []


def test_push_refuses_a_partial_point(offsite):
    point = make_point(offsite.tmp / "backups", "20261120T033000Z.partial")
    result, calls = offsite("push", point)
    assert result.returncode == 1
    assert ".partial" in result.stderr
    assert calls == []


@pytest.mark.parametrize(
    ("unset", "message"),
    [
        ("RESTIC_REPOSITORY", "RESTIC_REPOSITORY"),
        ("RESTIC_PASSWORD_FILE", "RESTIC_PASSWORD_FILE"),
    ],
)
def test_push_needs_a_repository_and_a_key_file(offsite, unset, message):
    point = make_point(offsite.tmp / "backups")
    result, calls = offsite("push", point, **{unset: None})
    assert result.returncode == 1
    assert message in result.stderr
    assert calls == []


def test_a_plain_password_in_the_environment_is_not_enough(offsite):
    point = make_point(offsite.tmp / "backups")
    result, _ = offsite(
        "push", point, RESTIC_PASSWORD_FILE=None, RESTIC_PASSWORD="invented"
    )
    assert result.returncode == 1
    assert "not RESTIC_PASSWORD" in result.stderr
    assert "invented" not in result.stderr + result.stdout


def test_a_failed_upload_fails_the_push(offsite):
    point = make_point(offsite.tmp / "backups")
    result, calls = offsite("push", point, STUB_FAIL="backup")
    assert result.returncode != 0
    assert len(calls) == 1


def test_fetch_restores_and_verifies_the_point(offsite):
    point = make_point(offsite.tmp / "backups")
    assert offsite("push", point)[0].returncode == 0
    shutil.rmtree(point)
    dest = offsite.tmp / "drill"
    dest.mkdir()
    result, calls = offsite("fetch", dest, "20261120T033000Z")
    assert result.returncode == 0, result.stderr
    fetched = Path(result.stdout.strip().splitlines()[-1])
    assert fetched == dest / "20261120T033000Z"
    assert (fetched / "database.dump").read_bytes() == b"PGDMP-dump"
    assert sorted(p.name for p in dest.iterdir()) == ["20261120T033000Z"]
    assert calls[0].startswith(
        "restic restore latest --tag ontotator-recovery-point,20261120T033000Z"
    )


def test_fetch_latest_selects_by_tag_only(offsite):
    point = make_point(offsite.tmp / "backups")
    assert offsite("push", point)[0].returncode == 0
    dest = offsite.tmp / "drill"
    dest.mkdir()
    result, calls = offsite("fetch", dest)
    assert result.returncode == 0, result.stderr
    assert calls[0].startswith(
        "restic restore latest --tag ontotator-recovery-point --target"
    )


def test_fetch_refuses_a_copy_that_does_not_verify(offsite):
    point = make_point(offsite.tmp / "backups")
    assert offsite("push", point)[0].returncode == 0
    stored = next((offsite.tmp / "repo").rglob("data.tar"))
    stored.write_bytes(b"bit rot")
    dest = offsite.tmp / "drill"
    dest.mkdir()
    result, _ = offsite("fetch", dest)
    assert result.returncode == 1
    assert "does not verify" in result.stderr
    assert list(dest.iterdir()) == []


@pytest.mark.parametrize(
    "args",
    [(), ("push",), ("fetch",), ("bogus", "x"), ("fetch", "DIR", "not-a-name")],
)
def test_refuses_bad_arguments(offsite, args):
    (offsite.tmp / "DIR").mkdir(exist_ok=True)
    args = [str(offsite.tmp / "DIR") if a == "DIR" else a for a in args]
    result, calls = offsite(*args)
    assert result.returncode == 2
    assert "Usage" in result.stderr
    assert calls == []
