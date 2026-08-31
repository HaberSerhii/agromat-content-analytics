#!/usr/bin/env bash
# Daily control measurement for product cards processed by content managers.

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_PORT_OVERRIDE="${APP_PORT:-}"
LOG_OVERRIDE="${CONTENT_REVIEW_LOG:-}"

cd "$APP_DIR"
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

APP_PORT="${APP_PORT_OVERRIDE:-${APP_PORT:-3000}}"
LOG="${LOG_OVERRIDE:-${CONTENT_REVIEW_LOG:-/tmp/agromat-content-review.log}}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "$(date -Iseconds) missing CRON_SECRET in $APP_DIR/.env" >> "$LOG"
  exit 1
fi

{
  echo
  echo "==== $(date -Iseconds) content review check ===="
  curl -fsS \
    --max-time "${CONTENT_REVIEW_MAX_TIME_SEC:-300}" \
    -X POST \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    "http://127.0.0.1:${APP_PORT}/api/products/content-reviews/check"
  echo
} >> "$LOG" 2>&1
