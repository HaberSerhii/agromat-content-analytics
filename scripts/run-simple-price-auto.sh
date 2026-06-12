#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG_FILE="${SIMPLE_PRICE_LOG:-/var/log/agromat-simple-price.log}"
LOCK_DIR="${SIMPLE_PRICE_LOCK_DIR:-/tmp/agromat-simple-price.lock}"

cd "$APP_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  printf '[%s] simple price refresh skipped: another run is active\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" >>"$LOG_FILE"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

{
  printf '\n[%s] Starting Plitka.ua + LeoCeramika refresh\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')"
  node scripts/simple-price-worker.mjs --adapter plitka
  node scripts/simple-price-worker.mjs --adapter leoceramika
  printf '[%s] Finished Plitka.ua + LeoCeramika refresh\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')"
} >>"$LOG_FILE" 2>&1
