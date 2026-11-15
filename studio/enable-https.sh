#!/usr/bin/env bash
set -euo pipefail
DOMAIN=studio.agromat-analytics.co.ua
EXPECTED_IP=91.239.233.125
if ! dig +short A "$DOMAIN" | grep -Fxq "$EXPECTED_IP"; then echo 'Studio DNS is not ready'; exit 2; fi
OLD_NGINX=$(sha256sum /etc/nginx/sites-enabled/agromat-catalog | cut -d' ' -f1)
certbot certonly --webroot --webroot-path /var/www/agromat-studio-acme --non-interactive --cert-name agromat-studio -d "$DOMAIN" --keep-until-expiring
cat > /etc/nginx/sites-available/agromat-studio <<'NGINX'
server {
    listen 80;
    server_name studio.agromat-analytics.co.ua;
    location ^~ /.well-known/acme-challenge/ { root /var/www/agromat-studio-acme; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl http2;
    server_name studio.agromat-analytics.co.ua;
    ssl_certificate /etc/letsencrypt/live/agromat-studio/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/agromat-studio/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    client_max_body_size 8k;
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
nginx -t
systemctl reload nginx
[[ "$OLD_NGINX" == "$(sha256sum /etc/nginx/sites-enabled/agromat-catalog | cut -d' ' -f1)" ]]
curl -fsS "https://$DOMAIN/api/health"
