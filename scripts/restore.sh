#!/usr/bin/env bash
# Restore a dump made by backup.sh:  scripts/restore.sh backups/mailflow-YYYYmmdd-HHMMSS.sql.gz
# Stops web + worker, recreates the database, loads the dump, starts everything again.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?usage: scripts/restore.sh <dump.sql.gz>}"
C="docker compose -f docker-compose.prod.yml"
$C stop web worker
$C exec -T postgres psql -U mailflow -d postgres -c "DROP DATABASE IF EXISTS mailflow WITH (FORCE);" -c "CREATE DATABASE mailflow OWNER mailflow;"
gzip -cd "$FILE" | $C exec -T postgres psql -U mailflow -d mailflow -q
$C up -d
echo "restored $FILE"
