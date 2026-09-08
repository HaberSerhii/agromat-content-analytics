#!/usr/bin/env bash
set -euo pipefail

APP_PORT="${APP_PORT:-3000}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG="${PRICE_POSITION_SNAPSHOT_LOG:-/var/log/agromat-price-position-snapshot.log}"

cd "$APP_DIR"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
if [ -z "${CRON_SECRET:-}" ]; then
  echo "$(date -Iseconds) CRON_SECRET is not configured" >> "$LOG"
  exit 1
fi

curl --fail --silent --show-error \
  -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "http://127.0.0.1:${APP_PORT}/api/parser/price-position-snapshots" >> "$LOG"
echo >> "$LOG"
