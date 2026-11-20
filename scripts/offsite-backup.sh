#!/usr/bin/env bash
# Copy recovery points made by scripts/backup.sh off the host, encrypted, and
# fetch them back. It uses restic: every repository is encrypted (AES-256) and
# authenticated with the repository password, so the off-host copy is never
# stored in plain text. See docs/operations.md ("Scheduled and off-host backups").
#
# Usage:
#   bash offsite-backup.sh push RECOVERY_POINT
#   bash offsite-backup.sh fetch DEST_DIR [NAME|latest]
#
# push  verifies SHA256SUMS of a complete recovery point (not .partial), stores
#       it as one restic snapshot tagged ontotator-recovery-point and NAME (the
#       directory name), then applies the retention below and, if asked,
#       checks a part of the repository's data.
# fetch restores one recovery point (default: the newest) into DEST_DIR/NAME,
#       verifies its SHA256SUMS and prints that path as the last line. DEST_DIR
#       must exist; DEST_DIR/NAME must not.
#
# Configuration, all from the environment (for example a systemd
# EnvironmentFile readable only by the backup user; never commit it):
#   RESTIC_REPOSITORY or RESTIC_REPOSITORY_FILE      where the copy goes (required)
#   RESTIC_PASSWORD_FILE or RESTIC_PASSWORD_COMMAND  the encryption key (required;
#       keep the key itself off this host or at least out of the backup)
#   the storage credentials restic reads for the backend, e.g.
#       AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, B2_ACCOUNT_ID/B2_ACCOUNT_KEY,
#       or an rclone remote (RESTIC_REPOSITORY=rclone:remote:path)
#   ONTOTATOR_OFFSITE_KEEP_DAILY   (default 14)  restic forget --keep-daily
#   ONTOTATOR_OFFSITE_KEEP_WEEKLY  (default 8)   restic forget --keep-weekly
#   ONTOTATOR_OFFSITE_KEEP_MONTHLY (default 12)  restic forget --keep-monthly
#       Set all three to 0 to keep every snapshot.
#   ONTOTATOR_OFFSITE_CHECK_SUBSET (default empty) e.g. 5% to read and verify that
#       part of the repository's data after each push (restic check).
#   ONTOTATOR_RESTIC (default restic)  the restic binary.
#
# The repository must exist (restic init, once, by the operator). The script
# never prints the password or the credentials.
set -euo pipefail
umask 077

tag=ontotator-recovery-point

usage() {
    echo "Usage: bash offsite-backup.sh push RECOVERY_POINT" >&2
    echo "       bash offsite-backup.sh fetch DEST_DIR [NAME|latest]" >&2
    exit 2
}

log() { echo "offsite-backup: $*" >&2; }
fail() { log "FAILED: $*"; exit 1; }

restic_bin="${ONTOTATOR_RESTIC:-restic}"
name_pattern='^[0-9]{8}T[0-9]{6}Z$'

require_config() {
    [[ -n "${RESTIC_REPOSITORY:-}" || -n "${RESTIC_REPOSITORY_FILE:-}" ]] ||
        fail "set RESTIC_REPOSITORY or RESTIC_REPOSITORY_FILE (the off-host restic repository)"
    [[ -n "${RESTIC_PASSWORD_FILE:-}" || -n "${RESTIC_PASSWORD_COMMAND:-}" ]] ||
        fail "set RESTIC_PASSWORD_FILE or RESTIC_PASSWORD_COMMAND (the repository key; not RESTIC_PASSWORD, which would sit in the environment file)"
    if [[ -n "${RESTIC_PASSWORD_FILE:-}" && ! -r "$RESTIC_PASSWORD_FILE" ]]; then
        fail "RESTIC_PASSWORD_FILE $RESTIC_PASSWORD_FILE is not readable"
    fi
    command -v "$restic_bin" > /dev/null || fail "restic not found ($restic_bin); install it on the host"
}

retention() {
    local daily="${ONTOTATOR_OFFSITE_KEEP_DAILY:-14}"
    local weekly="${ONTOTATOR_OFFSITE_KEEP_WEEKLY:-8}"
    local monthly="${ONTOTATOR_OFFSITE_KEEP_MONTHLY:-12}"
    local value
    for value in "$daily" "$weekly" "$monthly"; do
        [[ "$value" =~ ^[0-9]+$ ]] || fail "ONTOTATOR_OFFSITE_KEEP_* must be whole numbers"
    done
    if [[ "$daily$weekly$monthly" =~ ^0+$ ]]; then
        log "retention off; every snapshot is kept"
        return
    fi
    # Group by host only: every point has its own path and name tag, and
    # grouping by either would keep every snapshot.
    "$restic_bin" forget --tag "$tag" --group-by host --prune \
        --keep-daily "$daily" --keep-weekly "$weekly" --keep-monthly "$monthly" >&2
}

push() {
    local given="$1" point name subset
    point="$(cd "$given" 2>/dev/null && pwd)" || fail "recovery point $given does not exist"
    name="$(basename "$point")"
    [[ "$name" != *.partial ]] || fail "$point is an incomplete recovery point (.partial)"
    [[ "$name" =~ $name_pattern ]] || fail "$point is not a recovery point of backup.sh (name YYYYMMDDTHHMMSSZ)"
    [[ -f "$point/SHA256SUMS" ]] || fail "$point/SHA256SUMS is missing"
    (cd "$point" && sha256sum --check --quiet SHA256SUMS) >&2 || fail "SHA256SUMS does not verify"
    require_config
    log "copying $name off the host"
    (cd "$(dirname "$point")" && "$restic_bin" backup --tag "$tag" --tag "$name" "$name") >&2
    retention
    subset="${ONTOTATOR_OFFSITE_CHECK_SUBSET:-}"
    if [[ -n "$subset" ]]; then
        [[ "$subset" =~ ^[0-9]+(\.[0-9]+)?%$|^[0-9]+/[0-9]+$ ]] || fail "ONTOTATOR_OFFSITE_CHECK_SUBSET must look like 5% or 1/10"
        "$restic_bin" check --read-data-subset="$subset" >&2
    fi
    log "off-host copy of $name complete"
}

fetch() {
    local dest="$1" which="${2:-latest}" found name
    [[ -d "$dest" ]] || fail "$dest does not exist"
    dest="$(cd "$dest" && pwd)"
    require_config
    local select=(--tag "$tag")
    if [[ "$which" != latest ]]; then
        [[ "$which" =~ $name_pattern ]] || usage
        select=(--tag "$tag,$which")
    fi
    work="$(mktemp -d "$dest/.fetch.XXXXXX")" # global: the EXIT trap reads it
    trap 'rm -rf -- "$work"' EXIT
    "$restic_bin" restore latest "${select[@]}" --target "$work" >&2
    # restic restores below the original absolute path; find the point in it.
    found="$(find "$work" -type f -name SHA256SUMS -printf '%h\n')"
    [[ -n "$found" && "$(printf '%s\n' "$found" | wc -l)" -eq 1 ]] ||
        fail "the snapshot does not hold exactly one recovery point"
    name="$(basename "$found")"
    [[ "$name" =~ $name_pattern ]] || fail "the snapshot holds $name, not a recovery point"
    [[ "$which" == latest || "$which" == "$name" ]] || fail "the snapshot holds $name, not $which"
    [[ ! -e "$dest/$name" ]] || fail "$dest/$name already exists"
    (cd "$found" && sha256sum --check --quiet SHA256SUMS) >&2 ||
        fail "SHA256SUMS of the fetched copy does not verify"
    mv "$found" "$dest/$name"
    log "fetched $name; SHA256SUMS verified"
    printf '%s\n' "$dest/$name"
}

case "${1:-}" in
    push) [[ $# -eq 2 && -n "$2" && "$2" != -* ]] || usage; push "$2" ;;
    fetch) [[ ($# -eq 2 || $# -eq 3) && -n "$2" && "$2" != -* ]] || usage; fetch "$2" "${3:-latest}" ;;
    *) usage ;;
esac
