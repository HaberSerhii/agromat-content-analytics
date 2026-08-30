#!/usr/bin/env bash
set -euo pipefail

DASHBOARD_APP_DIR="${APP_DIR:-/opt/agromat-content-analytics}"

set -a
. "$DASHBOARD_APP_DIR/.env"
set +a

exec /usr/bin/curl -fsS --max-time 600 -X POST \
  http://127.0.0.1:3000/api/products/sync \
  -H "Authorization: Bearer $CRON_SECRET"
