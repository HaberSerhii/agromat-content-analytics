#!/usr/bin/env bash
# Cron-friendly product sync runner for the VPS deployment.

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_PORT="${APP_PORT:-3000}"
LOG="${SYNC_LOG:-/var/log/agromat-products-sync.log}"

cd "$APP_DIR"
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

if [ -z "${CRON_SECRET:-}" ]; then
  echo "$(date -Iseconds) missing CRON_SECRET in $APP_DIR/.env" >> "$LOG"
  exit 1
fi

{
  echo
  echo "==== $(date -Iseconds) products sync ===="
  curl -fsS \
    --max-time "${SYNC_MAX_TIME_SEC:-900}" \
    -X POST \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    "http://127.0.0.1:${APP_PORT}/api/products/sync"
  echo
} >> "$LOG" 2>&1
