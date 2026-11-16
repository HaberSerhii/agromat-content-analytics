#!/usr/bin/env bash
# Runs only for Studio. Never invokes scripts/deploy.sh of the existing dashboard.
set -euo pipefail
ARCHIVE="${1:?archive path required}"
EXPECTED="${2:?pushed revision required}"
ROOT=/opt/agromat-studio
case "$EXPECTED" in *[!0-9a-f]*|'') echo 'Invalid revision'; exit 1;; esac
[[ ${#EXPECTED} == 40 ]]
REVISION=$(tar -xOf "$ARCHIVE" REVISION | tr -d '\r\n')
[[ "$REVISION" == "$EXPECTED" ]] || { echo 'Archive revision mismatch'; exit 1; }
OLD_NGINX=$(sha256sum /etc/nginx/sites-enabled/agromat-catalog | cut -d' ' -f1)
OLD_PID=$(pm2 pid agromat-catalog | tail -1)
mkdir -p "$ROOT/releases/$REVISION" /var/www/agromat-studio-acme
chmod 755 "$ROOT" "$ROOT/releases" "$ROOT/releases/$REVISION" /var/www/agromat-studio-acme
tar -xzf "$ARCHIVE" -C "$ROOT/releases/$REVISION"
node --test "$ROOT/releases/$REVISION/studio/tests/"*.test.mjs
# Copy only the existing private nginx-to-app header; no AWS/Google credentials
# or old application runtime files are exported or changed.
python3 - "$ROOT/runtime.env" "$REVISION" <<'PY'
import sys,re,json,pathlib,os,shutil
config=pathlib.Path('/etc/nginx/sites-enabled/agromat-catalog').read_text()
m=re.search(r'proxy_set_header X-Agromat-Dashboard-Auth\s+([^;]+);',config)
if not m:raise SystemExit('Private upstream authentication header not found')
secret=m.group(1).strip().strip('"')
if not secret or secret.startswith('$'):raise SystemExit('Unsupported upstream authentication configuration')
path=pathlib.Path(sys.argv[1])
path.write_text('PORT=3107\nSTUDIO_UPSTREAM=http://127.0.0.1:3000\nSTUDIO_REVISION='+sys.argv[2]+'\nSTUDIO_UPSTREAM_AUTH='+json.dumps(secret)+'\n')
credentials=pathlib.Path('/opt/agromat-studio/google-credentials.json')
shutil.copyfile('/var/lib/agromat-analytics/credentials/ga4-bigquery.json',credentials)
shutil.chown(credentials,user='root',group='www-data')
os.chmod(credentials,0o640)
with path.open('a') as output:
 output.write('GOOGLE_APPLICATION_CREDENTIALS=/opt/agromat-studio/google-credentials.json\nBIGQUERY_PROJECT_ID=maximal-furnace-385413\nBIGQUERY_DATASET_ID=analytics_321347682\nSTUDIO_BQ_CACHE_DIR=/opt/agromat-studio/bigquery-cache\n')
for env_name in ['.env.local', '.env']:
 env_file=pathlib.Path('/opt/agromat-content-analytics')/env_name
 if env_file.exists():
  match=re.search(r'^GA4_PROPERTY_ID=[\"\']?(\d+)',env_file.read_text(),re.M)
  if match:
   with path.open('a') as output:output.write('GA4_PROPERTY_ID='+match.group(1)+'\n')
   break
os.chmod(path,0o600)
PY
mkdir -p "$ROOT/bigquery-cache"
chown www-data:www-data "$ROOT/bigquery-cache"
chmod 700 "$ROOT/bigquery-cache"
NODE_BIN=$(node -p 'process.execPath')
[[ "$NODE_BIN" != /root/* ]] || { echo 'Studio requires a system Node installation'; exit 1; }
ln -sfn "$ROOT/releases/$REVISION/studio" "$ROOT/current"
cat > /etc/systemd/system/agromat-studio.service <<UNIT
[Unit]
Description=AGROMAT Studio read-only dashboard
After=network.target
[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$ROOT/current
EnvironmentFile=$ROOT/runtime.env
ExecStart=$NODE_BIN --max-old-space-size=96 $ROOT/current/server.mjs
Restart=on-failure
RestartSec=5
MemoryMax=160M
Nice=10
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/agromat-studio/bigquery-cache
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable agromat-studio.service
systemctl restart agromat-studio.service
for n in $(seq 1 20); do if curl -fsS http://127.0.0.1:3107/api/health > "$ROOT/health.json"; then break; fi; sleep 1; done
python3 - "$ROOT/health.json" "$REVISION" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['revision']==sys.argv[2]
PY
if [[ ! -f /etc/letsencrypt/live/agromat-studio/fullchain.pem ]]; then
cat > /etc/nginx/sites-available/agromat-studio <<'NGINX'
server {
    listen 80;
    server_name studio.agromat-analytics.co.ua;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    client_max_body_size 8k;
    location ^~ /.well-known/acme-challenge/ { root /var/www/agromat-studio-acme; }
    location / {
        auth_basic off;
        proxy_pass http://127.0.0.1:3107;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_read_timeout 150s;
        gzip on;
        gzip_types text/css application/javascript application/json;
    }
}
NGINX
ln -sfn /etc/nginx/sites-available/agromat-studio /etc/nginx/sites-enabled/agromat-studio
nginx -t
systemctl reload nginx
fi
[[ "$OLD_NGINX" == "$(sha256sum /etc/nginx/sites-enabled/agromat-catalog | cut -d' ' -f1)" ]]
[[ "$OLD_PID" == "$(pm2 pid agromat-catalog | tail -1)" ]] || echo 'Note: old process PID changed externally; Studio did not restart it.'
echo "Studio ready at pushed revision $REVISION"
