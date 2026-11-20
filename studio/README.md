# Agromat Studio

Isolated read-only dashboard. Production uses `studio/deploy.sh`; never deploy this service with the old application's root deployment script. The ERP parser, application, nginx vhost, databases and scheduled jobs must remain intact. Credentials and customer/order identifiers must never enter browser responses.

## Current overview

The overview has one calendar, one comparison and one filter scope. A fresh visit selects the current month through yesterday in Kyiv with YoY enabled and all channels selected (the last completed month on day one). WoW shifts the dates seven days back and is disabled above seven selected days. MoM shifts to the previous calendar month, clips month ends and is disabled when the interval exceeds the number of days in the selected starting month. YoY uses the same calendar dates one year earlier, including February 29 → February 28. Applying dates selects the next valid comparison when necessary. The comparison's actual dates are visible beside its buttons.

Sales buttons select all channels, the website or marketplaces. Acquisition buttons select Direct, Organic or CPC (`medium=cpc`); device buttons select mobile or desktop. Selecting an acquisition/device chooses website sales. Marketplace traffic does not exist in the website's GA4 property, so those combinations are unavailable rather than populated with website data or invented zeroes.

All sales figures remain ERP shipments. Website orders are joined by the exact verified `ERP webshopId = GA4 transaction_id` relation. No joins by order number, cart number, amount, contact details or nearest date are allowed. Duplicate GA4 records do not duplicate shipments. Conflicting attributes remain unresolved. Missing IDs, absent matches and ambiguous matches are shown in aggregate coverage details. Monomarket cart identifiers and verified Rozetka origin IDs take precedence over website attribution.

The new overview uses the same shipment date at every ERP level: revenue, orders, AOV, daily/channel charts, categories, brands and revenue drivers. Service lines and their returns are excluded using the existing goods/return allocation logic from `src/lib/sales-plan-items.ts` (type-erased into `erp-items.mjs`). Category and brand totals reconcile to shipped revenue. Existing reports elsewhere retain their original date definitions.

Traffic is the distinct count of Ukrainian GA4 users over the complete interval, never a sum of daily unique counts. Website conversion remains GA4 purchases / sessions. Funnel stages through checkout use Ukrainian users. The order stage counts distinct transaction IDs across purchase and payment_unpaid events from all countries, matching the Promotions order definition; all stages share the calendar, acquisition and device. Partial web periods do not produce a misleading comparison. The funnel tooltip specifies its user-based conversion separately.

The revenue waterfall uses the ERP identity `shipped orders × shipped AOV`, marketplace changes and any other ERP channel remainder. Its factors reconcile to the selected ERP revenue without a GA4/ERP adjustment. Missing or zero baselines are handled explicitly. Currency units adapt to the displayed magnitude.

Catalog health and market-price distribution always show the whole current catalog, independently of sales dates/filters, as requested. Catalog health groups the latest catalog into tile, plumbing, flooring and building chemicals, using ERP category keys where available. Stock counts SKUs with quantity ≥ 1. Impressions and CTR use the header’s dates and comparison mode with the product events mart. Inventory shows change since the first day of the snapshot month, with prior-day changes in tooltips. CTR is product detail views divided by product impressions. CS averages the scored SKUs in each segment using the existing daily product snapshots. Its monthly baseline is the last available score from the previous calendar month, or the first available score this month. Selecting the monthly CS change opens the current month’s dated scores, daily changes and cumulative changes. Days with no change show zero. Missing snapshots leave gaps and make the adjacent daily comparison unavailable. The market index is our price / median confirmed competitor price × 100.

The header and KPI row remain visible on desktop. Smaller screens keep the filter header visible and let KPI cards scroll. The content width is capped. A segmented SVG donut keeps its proportions and aligns share/change values in one row. The middle row contains channel revenue, catalog health and revenue drivers. Category and brand treemaps share a 50/50 row, showing up to 24 named tiles each plus a remainder. Quantity mode uses a separate map and comparison for each ERP unit. The worker reads shipped amounts from `rows_count` in the exact S3 revision used by the existing ERP cache. Quantities are as shipped because the export supplies return amounts in currency only. Missing quantities stay unavailable.

## Inventory × Demand

Open **Мікс-аналіз → Наявність × попит**. The GET endpoint serves up to 90 completed Kyiv calendar days, the adjacent equal-length comparison, a filtered and paginated SKU table, SKU history and Excel export. Period-end observations determine status, promotion and price filters. The demand matrix compares daily shipped units against the category median when at least two eligible SKUs exist. High availability requires 90% of observed days, with at least half the selected dates observed.

The forecast uses the archived daily catalogue statuses 5 (in stock) and 3 (preorder) as the available states. States 1, 2, 4 and explicit archive are unavailable. Other statuses and unobserved days stay unknown. Historical price and stock come from full daily snapshots. The existing compact archive continues to accumulate status and promotion history independently of the full snapshot rotation.

Each outage uses the preceding 70 calendar days, limited to observed orderable days covered by ERP. The minimum sample is 21 available days and three sale days in three distinct weeks. SKU turnover comes from deduplicated, fully shipped website ERP documents and includes item returns. Quantities are shipped ERP units. Historical line cost supports a weighted margin estimate when it covers at least 90% of sample turnover. The last seven calendar days of the baseline act as a holdout when sample coverage allows. The report exposes the forecast confidence, coverage, quality flags and holdout error. Incomplete comparison periods display their coverage and suppress deltas.

The stock signals retain the existing threshold rules and use GA4 product views for the seven-day window ending on the selected report date. The forecast uses ERP and catalogue status history. GA4 availability affects stock signals.

The **Пріоритет поповнення** subsection below the report shares the active filters. Pick a day to rank products confirmed unavailable on that date by estimated daily margin loss. Products without a margin estimate follow in estimated turnover order. When forecast history is insufficient, the historical-sales list shows actual ERP turnover from observed orderable days before the outage. Both lists are limited to ten products with separate coverage totals. The initial report response includes the last day's priority snapshot. Pass `priorityDate` within the selected report range to request another day's snapshot.

## Content × Conversion

Open **Мікс-аналіз → Контент × Конверсія**. The report uses up to 90 completed Kyiv calendar days. Previous-period and year-over-year comparisons use an equal number of days, with the year-over-year start anchored to the anniversary. Category, brand, price, stock, promotion membership, and content components come from the current catalogue. The attribute slice uses the required-attribute configuration and product attribute index from the same catalogue sync. The reviews slice uses catalogue review counts.

GA4 links numeric `item_id` to a unique catalogue `goodsRef`. Each SKU and session contributes once per period. A cart or purchase must follow the first PDP event for that SKU within the same session and period. Groups add session numerators and denominators. GA4 purchases are deduplicated by transaction and SKU, so counts across different SKUs can include the same order. Revenue uses item revenue for UAH-tagged transactions. ERP shows net shipped goods on the shipment date, with repeats deduplicated by document, across ERP sales channels. ERP is available when device and acquisition are set to All. The amounts are shown with their source labels.

Content Score groups use the exact daily snapshot at the first PDP date. The KPI and score filter use the last available snapshot within the relevant window. The report displays snapshot dates, gaps, and unmatched traffic. Before/after uses seven full days on each side of the latest detected score change, excluding the change date. When the sample permits, it also displays the change relative to a stable comparable group. The optimization scenario uses the median purchase rate of at least five comparable SKUs with a score of at least 80 and applies the difference to observed SKU sessions. The estimated revenue uses average GA4 revenue per comparable SKU purchase.

The **Покращені SKU** button shows products whose latest score change was an increase and whose add-to-cart or purchase conversion subsequently changed. It uses the longest pair of complete, equal windows available, up to seven days on each side, and requires observed SKU sessions in both windows. The table and Excel export include the windows, sample sizes and both conversion movements.

The public GET endpoint returns summary data and a paginated SKU table. Excel export follows the selected table, filters, and group. The fixed aggregate worker reads existing snapshots and runs parameterized, byte-capped BigQuery SELECTs. It keeps raw catalogue and event match identifiers within the worker and exposes only catalogue SKU details and aggregates. The Studio report does not create or mutate source data.

## Local review

From this directory:

```sh
STUDIO_PREVIEW_SSH=root@agromat-analytics.co.ua npm run preview
```

Open `http://127.0.0.1:3112/`. The optional `STUDIO_PREVIEW_PORT` changes the loopback port. The SSH target uses an existing authorized key; no credentials are stored in the repository.

The local preview serves local assets and reads published, sanitized catalog/price aggregates. `/api/overview`, `/api/catalog-health`, `/api/inventory-demand`, and `/api/content-conversion` run the fixed aggregate source worker through SSH. Its code runs in a separate read-only process on the data server; it is not installed there, and does not deploy/restart production, change permissions or write source files. Existing ERP cache and origin data are read there; bounded GA4 SELECTs execute there. Only sanitized aggregates return to the local browser. ERP documents, transaction IDs, user IDs, contacts and credentials remain on the source server. The SSH worker ends when the local preview stops.

The source worker caches the GA4 matrix by date ranges and ERP revision, so changing acquisition/device does not repeat the queries. Source reads are serialized. At most 24 query attempts per hour, 20 GB per query, six cached range pairs and twelve queued requests are allowed. Oversized transaction lookups split into complete date partitions; whole-period unique-user counts are never reconstructed by summing partition counts. Partial GA4 failures keep unfiltered ERP figures available. A source/device slice requires a successful exact-ID lookup; otherwise that slice is explicitly unavailable. Partial results retry after one minute. Cache files older than 24 hours are rejected; no raw data is refreshed or rewritten by this worker.

Production runs the aggregate worker through `agromat-studio-source.socket`. The public Studio process connects as `www-data` and reads only aggregates. The worker reads existing ERP and catalog snapshots in place and uses the existing source credentials server-side. The deployment script checks both datasets before switching the web service and restores the previous Studio configuration if the release fails.

## Checks and publishing

Node 24. Run `npm test`. Tests cover exact/ambiguous joins, unknown coverage, services and returns, reconciliation across charts/maps, comparison constraints, query/cache scopes, missing data and the read-only public HTTP boundary. Browser review must check desktop and mobile, sticky behavior, date/comparison changes and acquisition/device combinations against actual aggregates.

When publishing is requested: commit only relevant source/instructions, push that commit, deploy the pushed revision with `studio/deploy.sh`, and verify `/api/health` reports its full SHA. A trigger or local commit is not proof of deployment. Keep generated previews out of the commit. For rollback, use the existing Studio release directory and restart only its service.
