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

  # This script is launched by the running Next.js standalone server. Its
  # process env contains private runtime-only Next variables; if inherited by
  # `next build`, Next can fail before printing a useful stack trace with
  # "[TypeError: generate is not a function]". Build from a clean Next env.
  unset __NEXT_PRIVATE_STANDALONE_CONFIG
  unset __NEXT_PRIVATE_ORIGIN
  unset __NEXT_PRIVATE_RUNTIME_TYPE
  unset __NEXT_PRIVATE_PREBUNDLED_REACT
  unset NEXT_DEPLOYMENT_ID
  unset NEXT_OTEL_FETCH_DISABLED

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

  CURRENT_STEP="install Agromat price sync cron"
  echo "▸ $CURRENT_STEP"
  AGROMAT_PRICE_SYNC_LOG="${AGROMAT_PRICE_SYNC_LOG:-/var/log/agromat-price-sync.log}"
  touch "$AGROMAT_PRICE_SYNC_LOG" 2>/dev/null || true
  chmod +x "$APP_DIR/scripts/run-agromat-price-sync.sh"
  AGROMAT_PRICE_CRON_LINE="10 * * * * APP_DIR=$APP_DIR AGROMAT_PRICE_SYNC_LOG=$AGROMAT_PRICE_SYNC_LOG $APP_DIR/scripts/run-agromat-price-sync.sh"
  TMP_CRON="$(mktemp)"
  crontab -l 2>/dev/null | grep -v "run-agromat-price-sync.sh" > "$TMP_CRON" || true
  if ! grep -q "^CRON_TZ=Europe/Kyiv$" "$TMP_CRON"; then
    echo "CRON_TZ=Europe/Kyiv" >> "$TMP_CRON"
  fi
  echo "$AGROMAT_PRICE_CRON_LINE" >> "$TMP_CRON"
  # LeoCeramika + Plitka.ua now run at the end of the parser's morning chain.
  # Remove the old evening cron to avoid a duplicate second refresh.
  sed -i.bak '/run-simple-price-auto\.sh/d' "$TMP_CRON"
  rm -f "$TMP_CRON.bak"
  crontab "$TMP_CRON"
  rm -f "$TMP_CRON"
  echo "  cron: $AGROMAT_PRICE_CRON_LINE"

  CURRENT_STEP="deploy companion Agromat_Parcer"
  echo "▸ $CURRENT_STEP"
  PARCER_DIR="${PARCER_DIR:-/opt/agromat-parcer}"
  PARCER_PORT="${PARCER_PORT:-8080}"
  if [ -d "$PARCER_DIR/.git" ]; then
    (
      cd "$PARCER_DIR"
      git fetch --quiet origin main
      git reset --hard origin/main
      echo "  parser HEAD: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
      rm -rf /dev/shm/parcer-view-cache 2>/dev/null || true
    )
    PARCER_RESTARTED=0
    PARCER_PM2_NAME=$(pm2 jlist 2>/dev/null \
      | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const a=JSON.parse(d||'[]');const m=a.find(p=>p.pm2_env&&p.pm2_env.pm_cwd&&p.pm2_env.pm_cwd.startsWith('$PARCER_DIR'));if(m)console.log(m.name)}catch(e){}})" \
      2>/dev/null || true)
    if [ -n "$PARCER_PM2_NAME" ]; then
      pm2 restart "$PARCER_PM2_NAME" --update-env
      echo "  parser restarted: $PARCER_PM2_NAME"
      PARCER_RESTARTED=1
    fi

    if command -v systemctl >/dev/null 2>&1; then
      PARCER_SERVICES=$(grep -Rsl -- "$PARCER_DIR" /etc/systemd/system /lib/systemd/system 2>/dev/null \
        | xargs -r -n1 basename \
        | grep '\.service$' \
        | sort -u || true)
      for PARCER_SERVICE in $PARCER_SERVICES; do
        PARCER_SERVICE_TYPE=$(systemctl show "$PARCER_SERVICE" -p Type --value 2>/dev/null || true)
        if [ "$PARCER_SERVICE_TYPE" = "oneshot" ]; then
          echo "  parser scheduled job not restarted: $PARCER_SERVICE"
          continue
        fi
        if timeout 20s systemctl restart --no-block "$PARCER_SERVICE"; then
          echo "  parser restarted via systemd unit match: $PARCER_SERVICE"
          PARCER_RESTARTED=1
        fi
      done
    fi

    if command -v systemctl >/dev/null 2>&1; then
      for proc in /proc/[0-9]*; do
        pid="${proc##*/}"
        cmdline=$(tr '\0' ' ' < "$proc/cmdline" 2>/dev/null || true)
        cwd=$(readlink "$proc/cwd" 2>/dev/null || true)
        if [[ "$cmdline $cwd" == *"$PARCER_DIR"* ]]; then
          PARCER_SERVICE=$(sed -n 's#.*system.slice/\([^/]*\.service\).*#\1#p' "$proc/cgroup" 2>/dev/null | head -1 || true)
          PARCER_SERVICE_TYPE=$(systemctl show "$PARCER_SERVICE" -p Type --value 2>/dev/null || true)
          if [ -n "$PARCER_SERVICE" ] && [ "$PARCER_SERVICE_TYPE" != "oneshot" ] && timeout 20s systemctl restart --no-block "$PARCER_SERVICE"; then
            echo "  parser restarted via process match: $PARCER_SERVICE (pid $pid)"
            PARCER_RESTARTED=1
          fi
        fi
      done
    fi

    if [ "$PARCER_RESTARTED" -eq 0 ] && command -v ss >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1; then
      PARCER_PIDS=$(ss -ltnp 2>/dev/null \
        | awk -v port=":${PARCER_PORT}" '$4 ~ port "$" {print}' \
        | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' \
        | sort -u || true)
      for pid in $PARCER_PIDS; do
        exe=$(readlink "/proc/$pid/exe" 2>/dev/null || true)
        cmdline=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
        if [[ "$exe $cmdline" == *nginx* ]]; then
          continue
        fi
        PARCER_SERVICE=$(sed -n 's#.*system.slice/\([^/]*\.service\).*#\1#p' "/proc/$pid/cgroup" 2>/dev/null | head -1 || true)
        PARCER_SERVICE_TYPE=$(systemctl show "$PARCER_SERVICE" -p Type --value 2>/dev/null || true)
        if [ -n "$PARCER_SERVICE" ] && [ "$PARCER_SERVICE_TYPE" != "oneshot" ]; then
          if timeout 20s systemctl restart --no-block "$PARCER_SERVICE"; then
            echo "  parser restarted via systemd: $PARCER_SERVICE (pid $pid, port $PARCER_PORT)"
            PARCER_RESTARTED=1
            break
          fi
        fi
      done
    fi

    if command -v systemctl >/dev/null 2>&1; then
      for PARCER_SERVICE in agromat-parcer.service agromat-parser.service agromat_parcer.service parcer.service parser.service; do
        if systemctl list-unit-files "$PARCER_SERVICE" >/dev/null 2>&1; then
          if timeout 20s systemctl restart --no-block "$PARCER_SERVICE"; then
            echo "  parser restarted via systemd: $PARCER_SERVICE"
            PARCER_RESTARTED=1
          fi
        fi
      done
    fi

    if [ "$PARCER_RESTARTED" -eq 0 ]; then
      if [ -n "${PARCER_PIDS:-}" ]; then
        echo "  ⚠️ parser code updated, but restart target not found (port $PARCER_PORT pids: $PARCER_PIDS)"
      else
        echo "  ⚠️ parser code updated, but restart target not found"
      fi
    else
      rm -rf /dev/shm/parcer-view-cache 2>/dev/null || true
    fi
  else
    echo "  parser dir not found: $PARCER_DIR — skipped"
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
