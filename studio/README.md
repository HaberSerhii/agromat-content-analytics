# Agromat Studio

Isolated read-only dashboard. Production uses `studio/deploy.sh`; never deploy this service with the old application's root deployment script. The ERP parser, application, nginx vhost, databases and scheduled jobs must remain intact. Credentials and customer/order identifiers must never enter browser responses.

## Current overview

The overview has one calendar, one comparison and one filter scope. A fresh visit selects the last seven completed days in Kyiv with WoW enabled. WoW shifts the dates seven days back and is disabled above seven selected days. MoM shifts to the previous calendar month, clips month ends and is disabled when the interval exceeds the number of days in the selected starting month. YoY uses the same calendar dates one year earlier, including February 29 → February 28. Applying dates selects the next valid comparison when necessary. The comparison's actual dates are visible beside its buttons.

Sales buttons select all channels, the website or marketplaces. Acquisition buttons select Direct, Organic or CPC (`medium=cpc`); device buttons select mobile or desktop. Selecting an acquisition/device chooses website sales. Marketplace traffic does not exist in the website's GA4 property, so those combinations are unavailable rather than populated with website data or invented zeroes.

All sales figures remain ERP shipments. Website orders are joined by the exact verified `ERP webshopId = GA4 transaction_id` relation. No joins by order number, cart number, amount, contact details or nearest date are allowed. Duplicate GA4 records do not duplicate shipments. Conflicting attributes remain unresolved. Missing IDs, absent matches and ambiguous matches are shown in aggregate coverage details. Monomarket cart identifiers and verified Rozetka origin IDs take precedence over website attribution.

The new overview uses the same shipment date at every ERP level: revenue, orders, AOV, daily/channel charts, categories, brands and revenue drivers. Service lines and their returns are excluded using the existing goods/return allocation logic from `src/lib/sales-plan-items.ts` (type-erased into `erp-items.mjs`). Category and brand totals reconcile to shipped revenue. Existing reports elsewhere retain their original date definitions.

Traffic is the distinct count of Ukrainian GA4 users over the complete interval, never a sum of daily unique counts. Website conversion remains GA4 purchases / sessions. Funnel stages through checkout use Ukrainian users. The order stage counts distinct transaction IDs across purchase and payment_unpaid events from all countries, matching the Promotions order definition; all stages share the calendar, acquisition and device. Partial web periods do not produce a misleading comparison. The funnel tooltip specifies its user-based conversion separately.

The revenue waterfall uses the ERP identity `shipped orders × shipped AOV`, marketplace changes and any other ERP channel remainder. Its factors reconcile to the selected ERP revenue without a GA4/ERP adjustment. Missing or zero baselines are handled explicitly. Currency units adapt to the displayed magnitude.

Catalog health and market-price distribution always show the whole current catalog, independently of sales dates/filters, as requested. Catalog health groups the latest catalog into tile, plumbing, flooring and building chemicals, using ERP category keys where available. Stock counts SKUs with quantity ≥ 1. Impressions and CTR use the product events mart for the current month through yesterday (last completed month on day 1). CTR is product detail views divided by product impressions, and CS is the mean of the latest scored SKUs. The market index is our price / median confirmed competitor price × 100. Missing snapshots are not reconstructed.

The header and KPI row remain visible on desktop. Smaller screens keep the filter header visible and let KPI cards scroll. The content width is capped. A segmented SVG donut keeps its proportions and aligns share/change values in one row. The middle row contains channel revenue, catalog health and revenue drivers. Category and brand treemaps share a 50/50 row, showing up to 24 named tiles each plus a remainder. Each map can use ERP revenue or shipped units for area and 2% growth/decline bands.

## Local review

From this directory:

```sh
STUDIO_PREVIEW_SSH=root@agromat-analytics.co.ua npm run preview
```

Open `http://127.0.0.1:3112/`. The optional `STUDIO_PREVIEW_PORT` changes the loopback port. The SSH target uses an existing authorized key; no credentials are stored in the repository.

The local preview serves local assets and reads published, sanitized catalog/price aggregates. `/api/overview` and `/api/catalog-health` run the fixed aggregate source worker through SSH. Its code runs in a separate read-only process on the data server; it is not installed there, and does not deploy/restart production, change permissions or write source files. Existing ERP cache and origin data are read there; bounded GA4 SELECTs execute there. Only sanitized aggregates return to the local browser. ERP documents, transaction IDs, user IDs, contacts and credentials remain on the source server. The SSH worker ends when the local preview stops.

The source worker caches the GA4 matrix by date ranges and ERP revision, so changing acquisition/device does not repeat the queries. Source reads are serialized. At most 24 query attempts per hour, 20 GB per query, six cached range pairs and twelve queued requests are allowed. Oversized transaction lookups split into complete date partitions; whole-period unique-user counts are never reconstructed by summing partition counts. Partial GA4 failures keep unfiltered ERP figures available. A source/device slice requires a successful exact-ID lookup; otherwise that slice is explicitly unavailable. Partial results retry after one minute. Cache files older than 24 hours are rejected; no raw data is refreshed or rewritten by this worker.

Production runs the aggregate worker through `agromat-studio-source.socket`. The public Studio process connects as `www-data` and reads only aggregates. The worker reads existing ERP and catalog snapshots in place and uses the existing source credentials server-side. The deployment script checks both datasets before switching the web service and restores the previous Studio configuration if the release fails.

## Checks and publishing

Node 24. Run `npm test`. Tests cover exact/ambiguous joins, unknown coverage, services and returns, reconciliation across charts/maps, comparison constraints, query/cache scopes, missing data and the read-only public HTTP boundary. Browser review must check desktop and mobile, sticky behavior, date/comparison changes and acquisition/device combinations against actual aggregates.

When publishing is requested: commit only relevant source/instructions, push that commit, deploy the pushed revision with `studio/deploy.sh`, and verify `/api/health` reports its full SHA. A trigger or local commit is not proof of deployment. Keep generated previews out of the commit. For rollback, use the existing Studio release directory and restart only its service.
