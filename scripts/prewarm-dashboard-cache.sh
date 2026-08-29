#!/usr/bin/env bash
# Rebuilds the expensive default promotions response before a user needs it.

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_PORT_OVERRIDE="${APP_PORT:-}"
LOG_OVERRIDE="${DASHBOARD_PREWARM_LOG:-}"
MAX_TIME_OVERRIDE="${DASHBOARD_PREWARM_MAX_TIME_SEC:-}"

cd "$APP_DIR"
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

# Explicit runtime overrides must take precedence over values loaded from .env.
APP_PORT="${APP_PORT_OVERRIDE:-${APP_PORT:-3000}}"
LOG="${LOG_OVERRIDE:-${DASHBOARD_PREWARM_LOG:-/var/log/agromat-dashboard-prewarm.log}}"
DASHBOARD_PREWARM_MAX_TIME_SEC="${MAX_TIME_OVERRIDE:-${DASHBOARD_PREWARM_MAX_TIME_SEC:-240}}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "$(date -Iseconds) missing CRON_SECRET in $APP_DIR/.env" >> "$LOG"
  exit 1
fi

failed=0
warm_url() {
  local label="$1"
  local url="$2"
  local authorization="${3:-}"
  local args=(
    --max-time "$DASHBOARD_PREWARM_MAX_TIME_SEC"
    -o /dev/null
    -w "status=%{http_code} total=%{time_total}s bytes=%{size_download}\n"
  )
  if [ -n "$authorization" ]; then
    args+=( -H "Authorization: $authorization" )
  fi
  printf "%s " "$label"
  if ! curl -fsS "${args[@]}" "$url"; then
    failed=1
  fi
}

today="$(TZ=Europe/Kyiv date +%F)"
month_start="${today%-*}-01"
read -r promotion_week_from promotion_week_to < <(node -e '
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const today = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  const daysSinceSunday = today.getUTCDay() || 7;
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() - daysSinceSunday);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 6);
  process.stdout.write(`${from.toISOString().slice(0, 10)} ${to.toISOString().slice(0, 10)}\n`);
')

{
  echo
  echo "==== $(date -Iseconds) dashboard prewarm ===="
  warm_url \
    "promotions_catalog" \
    "http://127.0.0.1:${APP_PORT}/api/promotions/catalog?refresh=1" \
    "Bearer ${CRON_SECRET}"
  warm_url \
    "products_catalog_default" \
    "http://127.0.0.1:${APP_PORT}/api/products?page=1&limit=50&status_ids=5%2C3&sort_by=firstSeenAt&sort_dir=desc"
  # Keep the legacy comparison report warm too. Its 15-minute server cache is
  # invalidated immediately by parser jobs and manual report mutations.
  warm_url \
    "parser_comparison_default" \
    "http://127.0.0.1:5000/"
  warm_url \
    "parser_prices_default" \
    "http://127.0.0.1:${APP_PORT}/api/parser/prices?page=1&limit=50&refresh=1"
  warm_url \
    "sales_compact" \
    "http://127.0.0.1:${APP_PORT}/api/sales?from=${month_start}&to=${today}&compact=1"
  warm_url \
    "promotion_sales_compact" \
    "http://127.0.0.1:${APP_PORT}/api/promotions/sales?from=${month_start}&to=${today}&compact=1"
  warm_url \
    "sales_web_metrics" \
    "http://127.0.0.1:${APP_PORT}/api/sales/web-metrics?from=${month_start}&to=${today}"
  warm_url \
    "promotion_web_funnel" \
    "http://127.0.0.1:${APP_PORT}/api/promotions/web-funnel?url=https%3A%2F%2Fwww.agromat.ua%2F&period=week"
  warm_url \
    "promotion_product_metrics_compact" \
    "http://127.0.0.1:${APP_PORT}/api/promotions/product-metrics?url=https%3A%2F%2Fwww.agromat.ua%2F&from=${promotion_week_from}&to=${promotion_week_to}&channel=all&device=all&include_out_of_stock=0&compact=1"
} >> "$LOG" 2>&1

exit "$failed"
