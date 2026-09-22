#!/usr/bin/env bash
# Hourly readiness check, daily late-event correction through Thursday (Kyiv).
set -euo pipefail
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
CPO_ANALYTICS_DIR="${CPO_ANALYTICS_DIR:-${BIGQUERY_AUDIT_DIR:+$(dirname "$BIGQUERY_AUDIT_DIR")/cpo-analytics}}"
CPO_ANALYTICS_DIR="${CPO_ANALYTICS_DIR:-${PRODUCT_SNAPSHOTS_DIR:+$(dirname "$PRODUCT_SNAPSHOTS_DIR")/cpo-analytics}}"
export CPO_ANALYTICS_DIR="${CPO_ANALYTICS_DIR:-$APP_DIR/data/cpo-analytics}"
mkdir -p "$CPO_ANALYTICS_DIR"
# flock releases on crashes/reboots, unlike a stale PID lock file.
exec 9>"$CPO_ANALYTICS_DIR/refresh.lock"
flock -n 9 || exit 0
exec node "$APP_DIR/scripts/cpo-refresh.mjs" "$@"
