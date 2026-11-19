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
# Preserve the active Studio configuration until both new sources respond.
BACKUP=$(mktemp -d "$ROOT/.deploy-backup.XXXXXX")
OLD_CURRENT=$(readlink "$ROOT/current" || true)
for file in "$ROOT/runtime.env" /etc/systemd/system/agromat-studio.service /etc/systemd/system/agromat-studio-source.{service,socket}; do
  if [[ -f "$file" ]]; then cp -p "$file" "$BACKUP/"; fi
done
SOURCE_WAS_ACTIVE=$(systemctl is-active agromat-studio-source.socket || true)
WEB_SWITCHED=0
rollback() {
  local status=$?
  trap - EXIT
  if (( status != 0 )); then
    echo "Studio deployment failed, restoring previous configuration" >&2
    systemctl stop agromat-studio-source.socket agromat-studio-source.service || true
    if [[ "$SOURCE_WAS_ACTIVE" != active ]]; then
      systemctl disable agromat-studio-source.socket || true
    fi
    for file in "$ROOT/runtime.env" /etc/systemd/system/agromat-studio.service /etc/systemd/system/agromat-studio-source.{service,socket}; do
      if [[ -f "$BACKUP/${file##*/}" ]]; then
        cp -p "$BACKUP/${file##*/}" "$file"
      else
        rm -f "$file"
      fi
    done
    if [[ -n "$OLD_CURRENT" ]]; then ln -sfn "$OLD_CURRENT" "$ROOT/current"; fi
    systemctl daemon-reload
    if [[ "$SOURCE_WAS_ACTIVE" == active ]]; then systemctl start agromat-studio-source.socket; fi
    if (( WEB_SWITCHED )); then systemctl restart agromat-studio.service; fi
  fi
  rm -rf "$BACKUP"
  exit "$status"
}
trap rollback EXIT
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
 output.write('GOOGLE_APPLICATION_CREDENTIALS=/opt/agromat-studio/google-credentials.json\nBIGQUERY_PROJECT_ID=maximal-furnace-385413\nBIGQUERY_DATASET_ID=analytics_321347682\nSTUDIO_BQ_CACHE_DIR=/opt/agromat-studio/bigquery-cache\nSTUDIO_SOURCE_SOCKET=/run/agromat-studio-source.sock\n')
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
cat > /etc/systemd/system/agromat-studio-source.socket <<'UNIT'
[Unit]
Description=Private Studio aggregate socket
[Socket]
ListenStream=/run/agromat-studio-source.sock
SocketUser=root
SocketGroup=www-data
SocketMode=0660
RemoveOnStop=yes
[Install]
WantedBy=sockets.target
UNIT
cat > /etc/systemd/system/agromat-studio-source.service <<UNIT
[Unit]
Description=Read-only Studio aggregate worker
After=network.target
[Service]
Type=simple
WorkingDirectory=$ROOT/releases/$REVISION/studio
EnvironmentFile=$ROOT/runtime.env
ExecStart=$NODE_BIN --max-old-space-size=288 $ROOT/releases/$REVISION/studio/production-source.mjs
MemoryMax=384M
Nice=10
UMask=0077
CapabilityBoundingSet=
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
UNIT
systemctl stop agromat-studio-source.socket agromat-studio-source.service 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now agromat-studio-source.socket
QUERY=$(cd "$ROOT/releases/$REVISION/studio" && "$NODE_BIN" --input-type=module -e '
  import {overviewDefaults} from "./public/overview-filters.mjs";
  const today = new Date().toLocaleDateString("sv-SE", {timeZone:"Europe/Kyiv"});
  console.log(new URLSearchParams(overviewDefaults(today)).toString());
')
runuser -u www-data -- curl -fsS --max-time 125 --unix-socket /run/agromat-studio-source.sock "http://localhost/overview?$QUERY" > "$BACKUP/overview.json"
runuser -u www-data -- curl -fsS --max-time 80 --unix-socket /run/agromat-studio-source.sock http://localhost/catalog-health > "$BACKUP/catalog.json"
runuser -u www-data -- curl -fsS --max-time 125 --unix-socket /run/agromat-studio-source.sock http://localhost/inventory-demand > "$BACKUP/inventory-demand.json"
runuser -u www-data -- curl -fsS --max-time 125 --unix-socket /run/agromat-studio-source.sock 'http://localhost/content-conversion?table=improved' > "$BACKUP/content-conversion.json"
python3 - "$BACKUP" <<'PY_CHECK'
import json, pathlib, sys
directory = pathlib.Path(sys.argv[1])
overview = json.loads((directory / 'overview.json').read_text())
catalog = json.loads((directory / 'catalog.json').read_text())
inventory = json.loads((directory / 'inventory-demand.json').read_text())
content = json.loads((directory / 'content-conversion.json').read_text())
assert overview['available'] and not overview.get('partial'), 'Overview source incomplete'
assert overview['sales']['available'] and overview['siteFunnel']['available'], 'ERP or funnel unavailable'
assert catalog['available'] and len(catalog['segments']) == 4 and not catalog.get('partial'), 'Catalog source incomplete'
assert content['available'] and content['coveredCurrent'] > 0 and content['current']['sessions'] > 0, 'Content conversion source incomplete'
assert content['detail']['total'] == content['improvements']['results'], 'Improved SKU total differs'
for row in content['detail']['rows']:
    assert row['score'] > row['scoreBefore'] and (row['change'] != 0 or row['atcChange'] != 0), 'Ineligible SKU in improved results'
assert inventory['available'] and inventory['trafficAvailable'] and inventory['sourceDays'] > 0 and len(inventory['sections']) == 6, 'Inventory demand source incomplete'
watch = inventory['stockWatch']
assert watch['available'] and watch['salesFrom'].endswith('-01-01'), 'Stock watch source incomplete'
assert (watch['minRevenue'], watch['minViews'], watch['viewDays']) == (5000, 100, 7), 'Stock watch thresholds differ'
assert watch['alerts'] == sum(row['status'] == 'low' for row in watch['rows']), 'Stock signal count differs'
products = {row['code']: row for row in inventory['products']}
for row in watch['rows']:
    product = products[row['code']]
    assert row['revenue'] >= watch['minRevenue'] and row['views'] >= watch['minViews'], 'Stock watch includes ineligible product'
    assert row['views'] == sum(day['views'] or 0 for day in product['days'][-7:]), 'Weekly views differ'
    stock = row['stock']
    threshold = watch['stockThresholds'][product['segment']]
    assert row['threshold'] == threshold and row['status'] == ('unknown' if stock is None else 'low' if stock <= threshold else 'ok'), 'Stock status differs'
for section in inventory['sections']:
    for category in section['categorySlices']:
        assert all(products[code]['category'] == category['name'] for code in category['rows']), 'Category filter includes other products'
print(f"Studio ERP, GA4, catalog and stock watch verified ({len(watch['rows'])} monitored, {watch['alerts']} alerts)")
PY_CHECK
WEB_SWITCHED=1
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
curl -fsS --max-time 125 "http://127.0.0.1:3107/api/overview?$QUERY" > /dev/null
curl -fsS --max-time 80 http://127.0.0.1:3107/api/catalog-health > /dev/null
curl -fsS --max-time 125 'http://127.0.0.1:3107/api/content-conversion?table=improved' > /dev/null
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
