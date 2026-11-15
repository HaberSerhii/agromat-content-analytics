# Studio deployment rules

This is an isolated read-only public dashboard. Preserve the old application, nginx vhost, parser and cron jobs. Use only `studio/deploy.sh` for this service, never the root production deployment script. Commit and push the tested revision before deployment and verify its SHA using `/api/health`. Never publish upstream credentials, customer contacts, payment details, or arbitrary proxy routes. Show missing real data explicitly instead of inventing demo values.
