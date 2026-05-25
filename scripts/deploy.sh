#!/usr/bin/env bash
# Self-deploy script invoked by POST /api/admin/deploy. Runs detached from the
# Next.js process so it survives the pm2 restart at the end (otherwise the
# restart would kill its own invoker mid-flight).
#
# All output is appended to LOG so the GET /api/admin/deploy/status endpoint
# can tail it. Each run prints a header with timestamp + commit so multiple
# runs in the same log file stay distinguishable.

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/Agromat-Analytics}"
LOG="${DEPLOY_LOG:-/tmp/agromat-deploy.log}"
PM2_NAME="${PM2_NAME:-}"   # leave empty → auto-detect by cwd

{
  echo
  echo "════════════════════════════════════════════════════════════"
  echo "▸ deploy started: $(date -Iseconds)"
  echo "▸ app dir: $APP_DIR"
  cd "$APP_DIR"

  echo "▸ git fetch + reset"
  git fetch --quiet origin main
  git reset --hard origin/main
  echo "  HEAD: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

  echo "▸ npm install"
  npm install --no-audit --no-fund

  echo "▸ npm run build"
  npm run build

  echo "▸ pm2 restart"
  if [ -z "$PM2_NAME" ]; then
    PM2_NAME=$(pm2 jlist 2>/dev/null \
      | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const a=JSON.parse(d||'[]');const m=a.find(p=>p.pm2_env&&p.pm2_env.pm_cwd&&p.pm2_env.pm_cwd.startsWith('$APP_DIR'));if(m)console.log(m.name)}catch(e){}})" \
      2>/dev/null || true)
  fi
  if [ -n "$PM2_NAME" ]; then
    pm2 restart "$PM2_NAME" --update-env
    pm2 save --force
    echo "  restarted: $PM2_NAME"
  else
    echo "  ⚠️ PM2 process for $APP_DIR not found — restart manually"
    exit 2
  fi

  echo "▸ deploy finished OK: $(date -Iseconds)"
} >> "$LOG" 2>&1
