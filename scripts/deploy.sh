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

# Mark the step that failed in the log — without this, `set -e` exits silently
# and the log just stops mid-stream, making it hard to tell which step blew up.
CURRENT_STEP="(init)"
trap 'echo "❌ FAILED at: $CURRENT_STEP (exit $?)"' ERR

{
  echo
  echo "════════════════════════════════════════════════════════════"
  echo "▸ deploy started: $(date -Iseconds)"
  echo "  node:  $(command -v node && node -v 2>/dev/null || echo MISSING)"
  echo "  npm:   $(command -v npm  && npm -v 2>/dev/null || echo MISSING)"
  cd "$APP_DIR"
  # When invoked by /api/admin/deploy, $APP_DIR points at process.cwd() which
  # for a Next.js standalone build is `.next/standalone/` — NOT the repo root.
  # Walk up until we find .git so git pull / npm install operate on the source
  # tree, not the runtime artifacts.
  while [ "$PWD" != "/" ] && [ ! -d ".git" ]; do cd ..; done
  if [ ! -d ".git" ]; then
    echo "❌ Could not locate git root from $APP_DIR"
    exit 1
  fi
  APP_DIR="$PWD"
  echo "▸ app dir: $APP_DIR"

  CURRENT_STEP="git fetch + reset"
  echo "▸ $CURRENT_STEP"
  git fetch --quiet origin main
  git reset --hard origin/main
  echo "  HEAD: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

  # Wipe any stale build artefacts BEFORE install. `next build` emits the
  # cryptic "[TypeError: generate is not a function]" when it tries to reuse
  # a partial .next/ OR a half-installed node_modules from a prior failed
  # build. `npm ci` is supposed to wipe node_modules on its own but on this
  # VPS we've consistently seen it skip files — wipe it explicitly. Cost:
  # ~30–40s extra per deploy, worth it for determinism.
  CURRENT_STEP="clean .next/ + node_modules"
  echo "▸ $CURRENT_STEP"
  rm -rf .next node_modules

  CURRENT_STEP="npm ci (clean install from lockfile)"
  echo "▸ $CURRENT_STEP"
  # Use `ci` not `install` — deterministic and recovers from prior broken state.
  # CRITICAL: this script is spawned by /api/admin/deploy, which runs *inside* the
  # Next.js standalone server where NODE_ENV=production. Under that env `npm ci`
  # omits devDependencies → only ~46 packages install (instead of ~384) and
  # `next build` dies with the cryptic "[TypeError: generate is not a function]"
  # (typescript/tailwind/postcss live in devDependencies). Force dev deps in.
  NODE_ENV=development npm ci --include=dev --no-audit --no-fund

  CURRENT_STEP="ensure persistent snapshot directory"
  echo "▸ $CURRENT_STEP"
  SNAPSHOT_DIR="${PRODUCT_SNAPSHOTS_DIR:-}"
  if [ -z "$SNAPSHOT_DIR" ] && [ -f ".env" ]; then
    SNAPSHOT_DIR=$(awk -F= '/^PRODUCT_SNAPSHOTS_DIR=/{print substr($0, index($0, "=") + 1)}' .env | tail -1)
  fi
  if [ -n "$SNAPSHOT_DIR" ]; then
    mkdir -p "$SNAPSHOT_DIR"
    echo "  snapshot dir: $SNAPSHOT_DIR"
  else
    echo "  PRODUCT_SNAPSHOTS_DIR not set — using app-local data/product-snapshots"
  fi

  CURRENT_STEP="npm run build"
  echo "▸ $CURRENT_STEP"
  npm run build

  # Next.js standalone output needs static/ + public/ + .env copied into the
  # standalone tree — `next build` does not do this automatically. Mirrors the
  # legacy /opt/.../deploy.sh on the VPS.
  if [ -d ".next/standalone" ]; then
    CURRENT_STEP="copy static/public/.env into standalone"
    echo "▸ $CURRENT_STEP"
    mkdir -p .next/standalone/public
    cp -r .next/static .next/standalone/.next/
    [ -d public ] && cp -r public/. .next/standalone/public/
    [ -d scripts ] && cp -r scripts .next/standalone/
    [ -f .env ] && cp .env .next/standalone/
  fi

  CURRENT_STEP="pm2 restart"
  echo "▸ $CURRENT_STEP"
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
