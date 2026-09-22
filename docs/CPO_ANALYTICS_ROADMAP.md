# CPO Analytics Hub — implementation roadmap

## Architecture audit

The existing BigQuery audit snapshot is intentionally frozen and contains event-level period totals and parameter presence. It does not contain numeric purchase revenue or dimension values, so it cannot support correct Revenue/AOV or segment contribution calculations. The existing promotion funnel contains reusable period and funnel concepts, but its 35-day read-through cache may issue new BigQuery queries and therefore is not used as the CPO source of truth.

The CPO module is isolated from current imports:

```text
GA4 BigQuery (initial import + scheduled incremental refresh)
  → Ukraine session-level aggregate cube
  → deterministic metric/funnel/contribution/scoring services
  → immutable diagnostic snapshots per cube version and period
  → /api/cpo-diagnostics
  → /cpo-analytics
```

Automatic weekly snapshot refresh is implemented; see [CPO_AUTO_REFRESH.md](CPO_AUTO_REFRESH.md) for readiness checks, late-event corrections and recovery.

Normal dashboard reads never call BigQuery. The cube stores aggregates only, not raw user identifiers.

## Phase 1 — MVP

- Executive KPI: Revenue, Orders, Sessions, CR, AOV and three funnel rates.
- Shapley decomposition of `Revenue = Sessions × CR × AOV`; contributions reconcile to the exact revenue delta.
- Session-based funnel: `view_item → add_to_cart → begin_checkout → purchase`, plus session-level reference rates.
- Automatic drill-down by device, source/medium, city and landing page.
- Volume thresholds, estimated lost conversions/orders/revenue, contribution, confidence and impact scoring.
- Rule-based Top Signals, Diagnostic Tree, Requires Attention, explanations and recommendations.
- Idempotent diagnostic snapshots for every period and CPO cube version.

Covered target requirements: 4–19 (MVP scope), 27–30, 32–36, 39–49 and 53. Partial periods are deliberately not exposed in the current selector; only completed weeks/months are selectable.

## Phase 2 — commercial and checkout depth

- Payment, delivery, browser, OS and campaign dimensions.
- Category, brand and product aggregates with category/product AOV.
- Multi-dimensional paths such as `mobile → card → browser`.
- Stronger PAYMENT/DELIVERY/COMMERCIAL classifiers.

## Phase 3 — UX diagnostics

- Search, filters, menu, calculator and merchandising signals.
- Search/filter/menu assisted-funnel attribution.
- Problem pages and product-level investigation views.

## Phase 4 — time and technical causality

- Daily/hourly series, anomaly start detection and `detectedSince`.
- Snapshot lifecycle reconciliation and `resolvedAt`.
- ERP, payment, API, frontend and backend error inputs.
- Correlation between GA4 anomalies, releases and technical incidents.

## Explicit MVP limitations

- Dimension analysis is single-dimension in Phase 1; intersections are not inferred.
- Estimated losses are analytical counterfactuals based on previous-period conversion, not accounting figures.
- `detectedSince` and `resolvedAt` require at least two data-cube generations plus daily/hourly facts, so MVP returns them as `null` rather than fabricating values.
- The new CPO data cube requires a separate explicit BigQuery build because the existing audit snapshot cannot be losslessly upgraded.

