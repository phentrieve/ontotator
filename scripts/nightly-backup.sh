#!/usr/bin/env bash
# The scheduled backup: one recovery point (backup.sh), its encrypted off-host
# copy (offsite-backup.sh) and, on the chosen days, a restore drill of that
# copy fetched back from off-host storage (restore-check.sh). Run it from a
# systemd timer (examples/systemd/) or by hand, in the deployment directory,
# with the three scripts next to it. See docs/operations.md ("Scheduled and
# off-host backups").
#
# Usage:
#   bash nightly-backup.sh
#
# Configuration, all from the environment (examples/systemd/ontotator-backup.env):
#   ONTOTATOR_BACKUP_ROOT           local backup directory (required, mode 0700)
#   ONTOTATOR_BACKUP_KEEP_DAYS      local retention in days (default 14)
#   ONTOTATOR_BACKUP_WAIT_JOBS      seconds to wait for running jobs (default 600)
#   ONTOTATOR_OFFSITE               restic or none; unset (default) means
#                                   not configured. The off-host copy is
#                                   optional and off until set to restic:
#                                   unset or none skips it with a warning and
#                                   keeps the backup on this host only.
#   RESTIC_* and backend credentials, ONTOTATOR_OFFSITE_*: see offsite-backup.sh
#   ONTOTATOR_RESTORE_CHECK_DIR     prepared isolated restore target; empty
#                                   (default) runs no drill
#   ONTOTATOR_RESTORE_CHECK_DAYS    days of the week (1 = Monday ... 7 = Sunday,
#                                   UTC) with a drill, e.g. "7" or "1 4";
#                                   default every day
#   ONTOTATOR_RESTORE_CHECK_WORK    where the fetched copy is put for the drill
#                                   and deleted afterwards (default
#                                   ONTOTATOR_BACKUP_ROOT/.drill)
#
# On success it writes ONTOTATOR_BACKUP_ROOT/last-success (UTC time, recovery
# point, off-host and drill result) for monitoring. Exit 0 only when every
# step that ran passed; 75 when backup.sh found jobs still running.
set -euo pipefail
umask 077

[[ $# -eq 0 ]] || { echo "Usage: bash nightly-backup.sh (configured through the environment)" >&2; exit 2; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log() { echo "nightly-backup: $*" >&2; }
fail() { log "FAILED: $*"; exit 1; }

root="${ONTOTATOR_BACKUP_ROOT:-}"
[[ -n "$root" ]] || fail "set ONTOTATOR_BACKUP_ROOT"
keep_days="${ONTOTATOR_BACKUP_KEEP_DAYS:-14}"
wait_jobs="${ONTOTATOR_BACKUP_WAIT_JOBS:-600}"
offsite="${ONTOTATOR_OFFSITE:-}"
[[ -z "$offsite" || "$offsite" == restic || "$offsite" == none ]] || fail "ONTOTATOR_OFFSITE must be restic or none"
drill_dir="${ONTOTATOR_RESTORE_CHECK_DIR:-}"
drill_days="${ONTOTATOR_RESTORE_CHECK_DAYS:-1 2 3 4 5 6 7}"
[[ "$drill_days" =~ ^[1-7]([[:space:]]+[1-7])*$ ]] || fail "ONTOTATOR_RESTORE_CHECK_DAYS must list days 1 to 7"
drill_work="${ONTOTATOR_RESTORE_CHECK_WORK:-$root/.drill}"

# 1. Recovery point on this host.
point="$(bash "$here/backup.sh" "$root" --wait-jobs "$wait_jobs" --keep-days "$keep_days" | tail -n 1)"
[[ -n "$point" && -d "$point" ]] || fail "backup.sh printed no recovery point"
log "recovery point $point"

# 2. Encrypted copy off the host.
if [[ "$offsite" == restic ]]; then
    bash "$here/offsite-backup.sh" push "$point"
    offsite_result=copied
elif [[ "$offsite" == none ]]; then
    offsite_result="skipped (ONTOTATOR_OFFSITE=none)"
    log "warning: ONTOTATOR_OFFSITE=none; this recovery point exists on this host only"
else
    offsite_result="skipped (not configured)"
    log "warning: no off-host copy configured (set ONTOTATOR_OFFSITE=restic to enable it); this recovery point exists on this host only"
fi

# 3. Restore drill, of the off-host copy when there is one.
drill_result="not scheduled"
today="$(date -u +%u)"
if [[ -n "$drill_dir" && " $drill_days " == *" $today "* ]]; then
    drill_point="$point"
    if [[ "$offsite" == restic ]]; then
        mkdir -p "$drill_work"
        rm -rf -- "${drill_work:?}/$(basename "$point")" # left by an interrupted run
        drill_point="$(bash "$here/offsite-backup.sh" fetch "$drill_work" "$(basename "$point")" | tail -n 1)"
        trap 'rm -rf -- "$drill_point"' EXIT
    fi
    bash "$here/restore-check.sh" "$drill_point" "$drill_dir" >&2 || fail "restore drill of $(basename "$point") failed"
    drill_result="passed ($([[ "$offsite" == restic ]] && echo "off-host copy" || echo "local copy"))"
fi

printf 'time: %s\nrecovery point: %s\noff-host: %s\nrestore drill: %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$point")" "$offsite_result" "$drill_result" \
    > "$root/last-success.tmp"
mv "$root/last-success.tmp" "$root/last-success"
log "done: off-host $offsite_result, restore drill $drill_result"
