#!/usr/bin/env bash
# Nightly (systemd timer, provision/cloud-init.yml) and before every deploy: an encrypted, verified database backup.
#   ./backup.sh
# 1. pg_dump inside the db container (custom format), into a root-only temporary file;
# 2. pg_restore --list on it, so an unreadable dump fails here and not at a restore;
# 3. age-encrypted to the owner's PUBLIC key (BACKUP_AGE_RECIPIENT): the server can write backups but never read them;
# 4. the plaintext shredded; the .age file kept in /var/backups/fitworkoutfoodtracker, and copied offsite with rclone
#    when BACKUP_RCLONE_REMOTE is set; anything older than BACKUP_RETENTION_DAYS removed in both places.
# Prints sizes and counts, never data. Exit non-zero on any failure (the timer's failure is the alert, G6).
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./single-server.env; set +a
: "${BACKUP_AGE_RECIPIENT:?}" "${POSTGRES_DB:?}"
[[ "$BACKUP_AGE_RECIPIENT" == age1* ]] && [[ "$BACKUP_AGE_RECIPIENT" != *CHANGE_ME* ]] || { echo "REFUSED: BACKUP_AGE_RECIPIENT must be an age public key"; exit 4; }
DIR="${BACKUP_DIR:-/var/backups/fitworkoutfoodtracker}"
DAYS="${BACKUP_RETENTION_DAYS:-14}"
umask 077; mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
plain=$(mktemp "$DIR/.dump-XXXXXX"); trap 'shred -u "$plain" 2>/dev/null || rm -f "$plain"' EXIT
dc() { docker compose -f compose.production.yml -f compose.single-server.yml --env-file production.env --env-file single-server.env "$@"; }

dc exec -T db pg_dump -U postgres -d "$POSTGRES_DB" -Fc --no-owner --no-privileges > "$plain"
entries=$(dc exec -T db pg_restore --list < "$plain" | grep -c 'TABLE DATA' || true)
[ "$entries" -gt 0 ] || { echo "FAILED: the dump lists no table data"; exit 1; }
out="$DIR/$POSTGRES_DB-$STAMP.dump.age"
age -r "$BACKUP_AGE_RECIPIENT" -o "$out" "$plain"
echo "backup: $(basename "$out"), $(stat -c %s "$out") bytes encrypted, $entries tables of data"

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  rclone copy "$out" "$BACKUP_RCLONE_REMOTE" --immutable
  rclone delete "$BACKUP_RCLONE_REMOTE" --min-age "${DAYS}d" --include "$POSTGRES_DB-*.dump.age"
  echo "offsite: copied to $BACKUP_RCLONE_REMOTE; older than $DAYS days removed there"
fi
find "$DIR" -maxdepth 1 -name "$POSTGRES_DB-*.dump.age" -mtime +"$DAYS" -delete
echo "local: $(find "$DIR" -maxdepth 1 -name "$POSTGRES_DB-*.dump.age" | wc -l) backups kept"
