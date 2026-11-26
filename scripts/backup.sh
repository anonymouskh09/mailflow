#!/usr/bin/env bash
# Daily PostgreSQL backup. Run from the project directory (cron example in DEPLOY.md).
#   BACKUP_DIR   where dumps are kept (default ./backups)
#   KEEP_DAYS    how many days to keep locally (default 14)
#   RCLONE_REMOTE  optional rclone destination for an off-server copy, e.g. "b2:mailflow-backups"
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/mailflow-$(date -u +%Y%m%d-%H%M%S).sql.gz"
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U mailflow --no-owner mailflow | gzip -9 > "$FILE"
# fail loudly on an empty dump
[ "$(gzip -cd "$FILE" | head -c 100 | wc -c)" -gt 0 ] || { echo "backup is empty" >&2; rm -f "$FILE"; exit 1; }
find "$BACKUP_DIR" -name 'mailflow-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$FILE" "$RCLONE_REMOTE" --quiet
fi
echo "backup written: $FILE"
