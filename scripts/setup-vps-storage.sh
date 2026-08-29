#!/usr/bin/env bash
# Idempotent VPS setup for local Redis/Valkey-compatible storage and hourly
# product snapshots. Intended for Ubuntu/Debian HostPro VPS servers.

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/Agromat-Analytics}"
APP_PORT="${APP_PORT:-3000}"
APP_USER="${APP_USER:-$(id -un)}"
SNAPSHOT_DIR="${PRODUCT_SNAPSHOTS_DIR:-/var/lib/agromat-analytics/product-snapshots}"
PROMOTIONS_SNAPSHOT_DIR_VALUE="${PROMOTIONS_SNAPSHOT_DIR:-$(dirname "$SNAPSHOT_DIR")/promotion-snapshots}"
SYNC_LOG="${SYNC_LOG:-/var/log/agromat-products-sync.log}"
SIMPLE_PRICE_LOG="${SIMPLE_PRICE_LOG:-/var/log/agromat-simple-price.log}"
AGROMAT_PRICE_SYNC_LOG="${AGROMAT_PRICE_SYNC_LOG:-/var/log/agromat-price-sync.log}"
DASHBOARD_PREWARM_LOG="${DASHBOARD_PREWARM_LOG:-/var/log/agromat-dashboard-prewarm.log}"
DASHBOARD_CACHE_DIR_VALUE="${DASHBOARD_CACHE_DIR:-/var/cache/agromat-analytics}"
REDIS_URL_VALUE="${REDIS_URL:-redis://127.0.0.1:6379}"

if [ ! -d "$APP_DIR" ]; then
  echo "App directory not found: $APP_DIR"
  echo "Run with APP_DIR=/path/to/Agromat-Analytics $0"
  exit 1
fi

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

set_env() {
  local key="$1"
  local value="$2"
  local file="$3"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf "\n%s=%s\n" "$key" "$value" >> "$file"
  fi
}

get_env_value() {
  local key="$1"
  local file="$2"
  grep "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2-
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    date +%s%N | sha256sum | awk '{print $1}'
  fi
}

echo "==> Installing Redis server if needed"
if ! command -v redis-server >/dev/null 2>&1; then
  run_root apt-get update
  run_root apt-get install -y redis-server
fi

echo "==> Hardening Redis for local-only use"
if [ -f /etc/redis/redis.conf ]; then
  run_root cp /etc/redis/redis.conf "/etc/redis/redis.conf.bak.$(date +%Y%m%d%H%M%S)"
  run_root sed -i \
    -e 's/^# *bind .*/bind 127.0.0.1 ::1/' \
    -e 's/^bind .*/bind 127.0.0.1 ::1/' \
    -e 's/^protected-mode .*/protected-mode yes/' \
    -e 's/^appendonly .*/appendonly yes/' \
    -e 's/^appendfsync .*/appendfsync everysec/' \
    /etc/redis/redis.conf
fi

run_root systemctl enable redis-server >/dev/null 2>&1 || true
run_root systemctl restart redis-server

echo "==> Creating persistent snapshot directory"
run_root mkdir -p "$SNAPSHOT_DIR" "$PROMOTIONS_SNAPSHOT_DIR_VALUE" "$DASHBOARD_CACHE_DIR_VALUE"
run_root chown -R "$APP_USER":"$APP_USER" "$(dirname "$SNAPSHOT_DIR")"
run_root chown -R "$APP_USER":"$APP_USER" "$DASHBOARD_CACHE_DIR_VALUE"
run_root touch "$SYNC_LOG"
run_root chown "$APP_USER":"$APP_USER" "$SYNC_LOG"
run_root touch "$SIMPLE_PRICE_LOG"
run_root chown "$APP_USER":"$APP_USER" "$SIMPLE_PRICE_LOG"
run_root touch "$AGROMAT_PRICE_SYNC_LOG"
run_root chown "$APP_USER":"$APP_USER" "$AGROMAT_PRICE_SYNC_LOG"
run_root touch "$DASHBOARD_PREWARM_LOG"
run_root chown "$APP_USER":"$APP_USER" "$DASHBOARD_PREWARM_LOG"

echo "==> Updating $APP_DIR/.env"
set_env "REDIS_URL" "$REDIS_URL_VALUE" "$APP_DIR/.env"
set_env "PRODUCT_SNAPSHOTS_DIR" "$SNAPSHOT_DIR" "$APP_DIR/.env"
set_env "PROMOTIONS_SNAPSHOT_DIR" "$PROMOTIONS_SNAPSHOT_DIR_VALUE" "$APP_DIR/.env"
set_env "DASHBOARD_CACHE_DIR" "$DASHBOARD_CACHE_DIR_VALUE" "$APP_DIR/.env"
if [ -z "$(get_env_value "CRON_SECRET" "$APP_DIR/.env")" ]; then
  set_env "CRON_SECRET" "$(random_secret)" "$APP_DIR/.env"
fi
if [ -z "$(get_env_value "DASHBOARD_PROXY_SECRET" "$APP_DIR/.env")" ]; then
  set_env "DASHBOARD_PROXY_SECRET" "$(random_secret)" "$APP_DIR/.env"
fi
if [ -z "$(get_env_value "DEPLOY_SECRET" "$APP_DIR/.env")" ]; then
  set_env "DEPLOY_SECRET" "$(random_secret)" "$APP_DIR/.env"
fi

echo "==> Making sync runner executable"
chmod +x "$APP_DIR/scripts/run-products-sync.sh"
chmod +x "$APP_DIR/scripts/run-simple-price-auto.sh"
chmod +x "$APP_DIR/scripts/run-agromat-price-sync.sh"
chmod +x "$APP_DIR/scripts/prewarm-dashboard-cache.sh"

echo "==> Installing hourly cron"
CRON_LINE="0 * * * * APP_DIR=$APP_DIR APP_PORT=$APP_PORT SYNC_LOG=$SYNC_LOG $APP_DIR/scripts/run-products-sync.sh"
AGROMAT_PRICE_CRON_LINE="10 * * * * APP_DIR=$APP_DIR AGROMAT_PRICE_SYNC_LOG=$AGROMAT_PRICE_SYNC_LOG $APP_DIR/scripts/run-agromat-price-sync.sh"
SIMPLE_PRICE_CRON_LINE="30 9,13 * * * APP_DIR=$APP_DIR SIMPLE_PRICE_LOG=$SIMPLE_PRICE_LOG $APP_DIR/scripts/run-simple-price-auto.sh"
DASHBOARD_PREWARM_CRON_LINE="4,19,34,49 * * * * APP_DIR=$APP_DIR APP_PORT=$APP_PORT DASHBOARD_PREWARM_LOG=$DASHBOARD_PREWARM_LOG $APP_DIR/scripts/prewarm-dashboard-cache.sh"
TMP_CRON="$(mktemp)"
crontab -l 2>/dev/null | grep -v "run-products-sync.sh" | grep -v "run-agromat-price-sync.sh" | grep -v "run-simple-price-auto.sh" | grep -v "prewarm-dashboard-cache.sh" > "$TMP_CRON" || true
echo "$CRON_LINE" >> "$TMP_CRON"
echo "CRON_TZ=Europe/Kyiv" >> "$TMP_CRON"
echo "$AGROMAT_PRICE_CRON_LINE" >> "$TMP_CRON"
echo "$SIMPLE_PRICE_CRON_LINE" >> "$TMP_CRON"
echo "$DASHBOARD_PREWARM_CRON_LINE" >> "$TMP_CRON"
crontab "$TMP_CRON"
rm -f "$TMP_CRON"

echo "==> Redis ping"
redis-cli -h 127.0.0.1 ping

echo "Done."
echo "Snapshot dir: $SNAPSHOT_DIR"
echo "Promotion snapshots: $PROMOTIONS_SNAPSHOT_DIR_VALUE"
echo "Sync log:     $SYNC_LOG"
echo "Cron:         $CRON_LINE"
echo "Agromat price sync log:  $AGROMAT_PRICE_SYNC_LOG"
echo "Agromat price sync cron: $AGROMAT_PRICE_CRON_LINE"
echo "Price log:    $SIMPLE_PRICE_LOG"
echo "Price cron:   $SIMPLE_PRICE_CRON_LINE"
echo "Dashboard prewarm log:  $DASHBOARD_PREWARM_LOG"
echo "Dashboard prewarm cron: $DASHBOARD_PREWARM_CRON_LINE"
