# AGROMAT Studio

Independent AGROMAT read-only dashboard at `studio.agromat-analytics.co.ua`.

## Isolation

- Existing Studio TLS configuration is preserved on updates. Own systemd service `agromat-studio`, own immutable release under `/opt/agromat-studio/releases/<git-sha>/studio`, loopback port 3107 and nginx virtual host.
- Does not rebuild, restart, edit or deploy the old Next.js application, parser, cron jobs or databases. Existing source adapters are accessed using bounded GET requests to the old application on loopback. This adds read traffic but does not trigger syncs or mutations.
- Two upstream requests at a time; 3-minute cache and deduplication; page size 25; 60 cache entries; bounded periods. Public routes expose allowlisted aggregates and catalog fields, without customers, contacts, payment details, source credentials or admin APIs.
- No login, as requested. Commercial aggregates are publicly readable at the new address. Existing dashboard access protection remains unchanged.
- No demo fixtures in production. Unavailable sources and missing historical baselines are identified explicitly. Costs, ROMI, user counts and channel plans are not fabricated when GA4 does not supply them.

## Sources and definitions

Catalog and promotions reuse the synchronized Agromat API data. Competitor prices reuse the monitoring feed. Sales reuse current S3-backed ERP summaries. Channels reuse the existing GA4 report. All credentials remain server side. Studio receives the private loopback header plus a server-only protected copy of the existing Google credential for bounded SELECT queries; AWS and Supabase keys are not copied.

GA4 purchases and purchaseRevenue are attributed ecommerce events, not completed ERP shipments. Sales KPIs reflect the requested dates; the supplied sales-plan slice can have its own monthly scope, labelled in the UI. Default dates cover the current month through yesterday in Kyiv; on the first day they cover the last completed month. Ranges are limited to 365 inclusive days. Chart intervals are selected explicitly: days, calendar weeks within each month, or source monthly totals. The chart settings also select the sales channel, revenue or shipped order count, and business segment; the category/brand ranking uses the same selection. Daily and weekly source data is fetched in bounded 30-day chunks because the upstream compact endpoint truncates daily series. YoY aligns calendar dates before binning, and tooltip percentages require a positive prior-year base. Catalog and price snapshots are current-state data, not historical snapshots for the chosen sales range. Feed KPI counts represent the whole feed; table results use the selected filters.

## Development

Node 24. BigQuery uses the existing server SDK through its fixed installed path. `npm test` and `npm start` from this folder. Environment: `PORT=3107`, `STUDIO_UPSTREAM=http://127.0.0.1:3000`, `STUDIO_UPSTREAM_AUTH=<server-only header>`, `STUDIO_REVISION=<git SHA>`.

## Deployment

Follow the repository AGENTS.md: checks, commit only Studio changes, push the commit first, then deploy exactly that SHA. Archive the pushed tree's `studio/` plus a root `REVISION` file. Copy to VPS and run `studio/deploy.sh <archive> <SHA>`. This is deliberately different from the root `scripts/deploy.sh`, which would redeploy the existing dashboard and must not be used for Studio.

DNS A `studio` must point to 91.239.233.125. Once DNS resolves, run `studio/enable-https.sh` to obtain a separate certificate and install the Studio-only HTTPS vhost. Verify `/api/health` revision matches the pushed commit, all real API endpoints, the external HTTPS response and that the existing dashboard still requires authentication.

For rollback, point `/opt/agromat-studio/current` to a previous Studio release, update `STUDIO_REVISION` in its dedicated runtime environment and restart only `agromat-studio`.

Overview KPIs: shipped ERP revenue; ERP orders by creation date; selected canceled ERP documents; shipped revenue / shipped orders (AOV); GA4 purchases / sessions (CR); programs with source active flag; catalog products with stock ≥ 1; current catalog mean Content Score using the existing source formula. Catalog indicators are current snapshots, not period history.

KPI comparisons: ERP and GA4 use the same calendar dates one year earlier. Stock compares the live count with a historical catalog snapshot at the prior-year period end; absent snapshots remain unavailable. Promotion comparisons require a real source snapshot, never reconstructed history. Content Score compares the current score against the latest available saved score in the preceding calendar month and shows its exact baseline date. Freshness in the header is supplied by each source (GA4 fetch, catalog sync, ERP object modified date, monitoring snapshot); missing times are not invented.

Users: COUNT(DISTINCT user_pseudo_id) from the daily GA4 BigQuery export, filtered to Ukraine over the complete selected range. No summation of per-day distinct counts. Both years use identical definitions. Only aggregate counts and coverage dates leave the server. Queries are parameterized, capped at 10 GB each, serialized, limited to 24 new queries per hour, and cached for six hours on disk. The old dashboard and its credential file permissions are unchanged.

## Browser caching

Studio reuses sanitized API responses in memory and in asynchronous browser CacheStorage for three minutes, including across page reloads. The cache is bounded to 40 entries and 8 MiB per layer; oversized responses and failed sources are not stored. Blocked browser storage falls back to memory. Original source timestamps stay visible. After expiration the next request fetches fresh data; expired data is not silently served on errors.

Cache keys include source-relevant dates, filters, pages and YoY. Chart metric and ranking changes use existing data; day/week intervals share daily series. Identical concurrent requests share one fetch. Overview chart sales start alongside other sources and reuse the main sales response when their filters match. This reduces repeat transfers; the first uncached visit still depends on upstream source latency.

## Calendar overview history

The calendar `Від — До` controls KPI totals, comparisons, and every overview chart. The upper preset selector is removed. KPI sparklines use days for ranges up to 40 inclusive days and clipped ISO weeks for longer ranges. The large chart has an independent `Дні / Тижні` display switch over the same calendar dates. Revenue, shipped orders, and AOV cards select the corresponding large chart. AOV is a ratio of revenue to shipped documents for the selected period or chart bin, never the sum of daily averages. Comparisons align the exact calendar bin dates one year earlier, including clipped first and last weeks.

`/api/overview-history` caches and deduplicates sanitized results by calendar range and sales channel for six hours. It reads two bounded ERP periods, parameterized distinct-user aggregates from Ukraine for the exact mini-chart bins, and a GA4 daily report for conversion. Weekly unique users are calculated with `COUNT(DISTINCT ...)` over the complete bin and are never sums of daily unique users. Missing source coverage creates gaps. ERP reads are serialized. The upstream must include `summary.canceledByDate` from `src/lib/sales-s3.ts`: public document previews contain only 50 shipped rows and cannot define cancellation history. Local review uses real sanitized source snapshots and read-only aggregate queries without deploying or restarting production services.

## Overview infographic sources and private analysis

Traffic sources use stacked weekly GA4 sessions for the latest 13 complete weeks, grouped as organic, advertising, direct, messaging/email, and other. The server reads source as well as default channel group so Viber can be identified when that detail exists. A preview based on channel-only public reports labels the messaging bucket `Email / SMS` rather than claiming an unavailable Viber breakdown. Tooltips expose weekly source counts and the total.

Price-index bars count each active SKU once using `our price / median of validated competitor prices × 100`. The six bins are `<90`, `[90,95)`, `[95,100)`, `[100,105)`, `[105,110]`, and `>110`; the last two are red because our price is higher. Invalid, unavailable, unconfirmed, and missing-reference prices are excluded. The local preview reuses the existing complete parser-price quality calculation over the full active feed, never a 25-row table sample. No Supabase schema changes are made.

The revenue waterfall is disabled by default. Both `/api/capabilities` and `/api/revenue-waterfall` gate it with server-only `STUDIO_PRIVATE_PREVIEW=1`; the latter returns 404 otherwise. The local loopback preview enables it for personal review. Do not enable this flag on the publicly readable Studio service without adding an appropriate private access flow. The chart supports YoY and the equivalent previous-month dates, factors site revenue by sequential traffic/conversion/AOV substitutions, shows the explicit GA4/ERP reconciliation, then adds marketplace and other-channel changes. The factors must reconcile to ERP revenue exactly. It is an accounting decomposition, not a causal claim.

The overview site funnel uses the existing `/api/promotions/web-funnel` definition through a fixed read-only, aggregate-only adapter. Week compares the last complete Monday–Sunday period with the preceding week; month compares the last complete calendar month with the preceding month. CR and unique transaction counts also show the existing prior-year comparison. Pre-checkout stages count Ukrainian users; purchases include all countries and unique purchase/payment_unpaid transaction IDs. Bar heights use a disclosed square-root scale. Transition percentages are green/red according to their rate versus the preceding complete period, with neutral values for unchanged or missing comparisons. The local preview reads sanitized existing aggregate cache snapshots; no credentials are included in browser responses.

Overview layout uses a responsive grid: main trend + channel share; weekly channel totals + private revenue drivers; funnel + traffic + market index; categories + call-source status, followed by catalog health. Compact funnel comparisons remain visible; hover cards on CR, orders, and transition rates show current/previous/prior-year values and exact dates. Narrow layouts collapse to two and then one column.

Prom is temporarily displayed as a zero share pending its own ERP feed. Small category tiles show names only; values depend on rendered tile space and remain available in hover cards. The no-photo count covers the whole current API catalog with imagesCount = 0, regardless of stock; image URL availability is not tested.
