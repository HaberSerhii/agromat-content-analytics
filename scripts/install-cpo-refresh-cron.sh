#!/usr/bin/env bash
# Install only the CPO schedule; preserve all other application jobs.
set -euo pipefail
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CPO_REFRESH_LOG="${CPO_REFRESH_LOG:-/var/log/agromat-cpo-refresh.log}"
chmod +x "$APP_DIR/scripts/run-cpo-refresh.sh"
touch "$CPO_REFRESH_LOG"
TEMP_CRON=$(mktemp)
trap 'rm -f "$TEMP_CRON"' EXIT
crontab -l 2>/dev/null | grep -v 'scripts/run-cpo-refresh.sh' > "$TEMP_CRON" || true
# Hourly schedule is independent of cron's timezone/DST. The worker calculates
# completed weeks and daily refresh eligibility explicitly in Europe/Kyiv.
printf '20 * * * * APP_DIR=%s %s/scripts/run-cpo-refresh.sh >> %s 2>&1\n' "$APP_DIR" "$APP_DIR" "$CPO_REFRESH_LOG" >> "$TEMP_CRON"
crontab "$TEMP_CRON"
echo 'CPO readiness check installed: hourly at minute 20 (week boundaries: Europe/Kyiv)'
