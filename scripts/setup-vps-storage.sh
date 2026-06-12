#!/usr/bin/env bash
# Idempotent VPS setup for local Redis/Valkey-compatible storage and hourly
# product snapshots. Intended for Ubuntu/Debian HostPro VPS servers.

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/Agromat-Analytics}"
APP_PORT="${APP_PORT:-3000}"
APP_USER="${APP_USER:-$(id -un)}"
SNAPSHOT_DIR="${PRODUCT_SNAPSHOTS_DIR:-/var/lib/agromat-analytics/product-snapshots}"
SYNC_LOG="${SYNC_LOG:-/var/log/agromat-products-sync.log}"
SIMPLE_PRICE_LOG="${SIMPLE_PRICE_LOG:-/var/log/agromat-simple-price.log}"
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
run_root mkdir -p "$SNAPSHOT_DIR"
run_root chown -R "$APP_USER":"$APP_USER" "$(dirname "$SNAPSHOT_DIR")"
run_root touch "$SYNC_LOG"
run_root chown "$APP_USER":"$APP_USER" "$SYNC_LOG"
run_root touch "$SIMPLE_PRICE_LOG"
run_root chown "$APP_USER":"$APP_USER" "$SIMPLE_PRICE_LOG"

echo "==> Updating $APP_DIR/.env"
set_env "REDIS_URL" "$REDIS_URL_VALUE" "$APP_DIR/.env"
set_env "PRODUCT_SNAPSHOTS_DIR" "$SNAPSHOT_DIR" "$APP_DIR/.env"
if [ -z "$(get_env_value "CRON_SECRET" "$APP_DIR/.env")" ]; then
  set_env "CRON_SECRET" "$(random_secret)" "$APP_DIR/.env"
fi
if [ -z "$(get_env_value "NEXT_PUBLIC_DASHBOARD_SECRET" "$APP_DIR/.env")" ]; then
  set_env "NEXT_PUBLIC_DASHBOARD_SECRET" "$(random_secret)" "$APP_DIR/.env"
fi

echo "==> Making sync runner executable"
chmod +x "$APP_DIR/scripts/run-products-sync.sh"
chmod +x "$APP_DIR/scripts/run-simple-price-auto.sh"

echo "==> Installing hourly cron"
CRON_LINE="0 * * * * APP_DIR=$APP_DIR APP_PORT=$APP_PORT SYNC_LOG=$SYNC_LOG $APP_DIR/scripts/run-products-sync.sh"
PRICE_CRON_LINE="0 18 * * * APP_DIR=$APP_DIR SIMPLE_PRICE_LOG=$SIMPLE_PRICE_LOG $APP_DIR/scripts/run-simple-price-auto.sh"
TMP_CRON="$(mktemp)"
crontab -l 2>/dev/null | grep -v "run-products-sync.sh" | grep -v "run-simple-price-auto.sh" > "$TMP_CRON" || true
echo "$CRON_LINE" >> "$TMP_CRON"
echo "CRON_TZ=Europe/Kyiv" >> "$TMP_CRON"
echo "$PRICE_CRON_LINE" >> "$TMP_CRON"
crontab "$TMP_CRON"
rm -f "$TMP_CRON"

echo "==> Redis ping"
redis-cli -h 127.0.0.1 ping

echo "Done."
echo "Snapshot dir: $SNAPSHOT_DIR"
echo "Sync log:     $SYNC_LOG"
echo "Cron:         $CRON_LINE"
echo "Price log:    $SIMPLE_PRICE_LOG"
echo "Price cron:   $PRICE_CRON_LINE"
