#!/usr/bin/env bash
# Cron-friendly Agromat price sync runner for the competitor-price dashboard.
# It refreshes Supabase products.actual_price through the legacy parser action.

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOG="${AGROMAT_PRICE_SYNC_LOG:-/var/log/agromat-price-sync.log}"

cd "$APP_DIR"
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

PARSER_URL="${PARCER_INTERNAL_URL:-http://127.0.0.1:8080}"
PASSWORD="${PARCER_RUN_PASSWORD:-Agromat2026}"
payload="$(PARCER_RUN_PASSWORD_PAYLOAD="$PASSWORD" node -e 'process.stdout.write(JSON.stringify({ password: process.env.PARCER_RUN_PASSWORD_PAYLOAD || "" }))')"

{
  echo
  echo "==== $(date -Iseconds) agromat price sync ===="
  response="$(
    curl -fsS \
      --max-time "${AGROMAT_PRICE_SYNC_START_MAX_TIME_SEC:-60}" \
      -X POST \
      -H "Content-Type: application/json" \
      --data "$payload" \
      "${PARSER_URL%/}/api/run/agromat-sync"
  )"
  echo "$response"

  job_id="$(node -e 'let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{try{const j=JSON.parse(s); if(j.job_id || j.active_job_id) process.stdout.write(j.job_id || j.active_job_id)}catch{}})' <<< "$response")"
  if [ -z "$job_id" ]; then
    echo "No job_id returned; sync did not start."
    exit 1
  fi

  for _ in $(seq 1 "${AGROMAT_PRICE_SYNC_POLL_ATTEMPTS:-240}"); do
    sleep "${AGROMAT_PRICE_SYNC_POLL_INTERVAL_SEC:-5}"
    status_response="$(
      curl -fsS \
        --max-time "${AGROMAT_PRICE_SYNC_STATUS_MAX_TIME_SEC:-30}" \
        "${PARSER_URL%/}/api/job/${job_id}"
    )"
    echo "$status_response"
    status="$(node -e 'let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{try{const j=JSON.parse(s); if(j.status) process.stdout.write(j.status)}catch{}})' <<< "$status_response")"
    if [ "$status" = "done" ] || [ "$status" = "error" ]; then
      break
    fi
  done
} >> "$LOG" 2>&1
