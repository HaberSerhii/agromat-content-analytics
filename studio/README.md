# AGROMAT Studio

Independent AGROMAT read-only dashboard at `studio.agromat-analytics.co.ua`.

## Isolation

- Existing Studio TLS configuration is preserved on updates. Own systemd service `agromat-studio`, own immutable release under `/opt/agromat-studio/releases/<git-sha>/studio`, loopback port 3107 and nginx virtual host.
- Does not rebuild, restart, edit or deploy the old Next.js application, parser, cron jobs or databases. Existing source adapters are accessed using bounded GET requests to the old application on loopback. This adds read traffic but does not trigger syncs or mutations.
- Two upstream requests at a time; 3-minute cache and deduplication; page size 25; 60 cache entries; bounded periods. Public routes expose allowlisted aggregates and catalog fields, without customers, contacts, payment details, source credentials or admin APIs.
- No login, as requested. Commercial aggregates are publicly readable at the new address. Existing dashboard access protection remains unchanged.
- No demo fixtures in production. Unavailable sources and missing historical baselines are identified explicitly. Costs, ROMI, user counts and channel plans are not fabricated when GA4 does not supply them.

## Sources and definitions

Catalog and promotions reuse the synchronized Agromat API data. Competitor prices reuse the monitoring feed. Sales reuse current S3-backed ERP summaries. Channels reuse the existing GA4 report. All credentials remain server side; Studio only receives the private loopback header, not AWS, Google or Supabase keys.

GA4 purchases and purchaseRevenue are attributed ecommerce events, not completed ERP shipments. Sales KPIs reflect the requested dates; the supplied sales-plan slice can have its own monthly scope, labelled in the UI. Default dates cover the current month through yesterday in Kyiv; on the first day they cover the last completed month. Ranges are limited to 365 inclusive days. Charts use daily intervals for 1–30 days, calendar weeks within each month for 31–90 days, and source monthly totals for 91–365 days. Weekly source data is fetched in bounded 30-day chunks because the upstream compact endpoint truncates daily series. YoY aligns calendar dates before binning, and tooltip percentages require a positive prior-year base. Catalog and price snapshots are current-state data, not historical snapshots for the chosen sales range. Feed KPI counts represent the whole feed; table results use the selected filters.

## Development

Node 24, no dependencies. `npm test` and `npm start` from this folder. Environment: `PORT=3107`, `STUDIO_UPSTREAM=http://127.0.0.1:3000`, `STUDIO_UPSTREAM_AUTH=<server-only header>`, `STUDIO_REVISION=<git SHA>`.

## Deployment

Follow the repository AGENTS.md: checks, commit only Studio changes, push the commit first, then deploy exactly that SHA. Archive the pushed tree's `studio/` plus a root `REVISION` file. Copy to VPS and run `studio/deploy.sh <archive> <SHA>`. This is deliberately different from the root `scripts/deploy.sh`, which would redeploy the existing dashboard and must not be used for Studio.

DNS A `studio` must point to 91.239.233.125. Once DNS resolves, run `studio/enable-https.sh` to obtain a separate certificate and install the Studio-only HTTPS vhost. Verify `/api/health` revision matches the pushed commit, all real API endpoints, the external HTTPS response and that the existing dashboard still requires authentication.

For rollback, point `/opt/agromat-studio/current` to a previous Studio release, update `STUDIO_REVISION` in its dedicated runtime environment and restart only `agromat-studio`.

Overview KPIs: shipped ERP revenue; ERP orders by creation date; selected canceled ERP documents; shipped revenue / shipped orders (AOV); GA4 purchases / sessions (CR); programs with source active flag; catalog products with stock ≥ 1; current catalog mean Content Score using the existing source formula. Catalog indicators are current snapshots, not period history.

KPI comparisons: ERP and GA4 use the same calendar dates one year earlier. Stock compares the live count with a historical catalog snapshot at the prior-year period end; absent snapshots remain unavailable. Promotion comparisons require a real source snapshot, never reconstructed history. Content Score compares the current score against the latest available saved score in the preceding calendar month and shows its exact baseline date. Freshness in the header is supplied by each source (GA4 fetch, catalog sync, ERP object modified date, monitoring snapshot); missing times are not invented.
