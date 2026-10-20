import test from "node:test";
import assert from "node:assert/strict";
import { ga4ReportRequest, parseGa4Rows, validateGa4Dates } from "../src/lib/ga4-marketing-report.ts";

test("GA4 report uses session attribution, UAH and pagination without an orders-only filter", () => {
  const request = ga4ReportRequest("2026-10-01", "2026-10-20", 10000);
  assert.equal(request.offset, "10000");
  assert.equal(request.currencyCode, "UAH");
  assert.deepEqual(request.dimensions.map(d => d.name), ["sessionDefaultChannelGroup", "sessionSource", "sessionMedium", "sessionCampaignName"]);
  assert.deepEqual(request.metrics.map(d => d.name), ["sessions", "ecommercePurchases", "purchaseRevenue"]);
  assert.equal(request.metricFilter, undefined);
});

test("invalid, reversed and excessive periods are rejected before querying Google", () => {
  for (const [from, to] of [["2026-02-30", "2026-03-01"], ["2026-10-20", "2026-10-01"], ["2024-01-01", "2026-01-01"], ["yesterday", "today"], ["", ""]])
    assert.throws(() => validateGa4Dates(from, to));
  assert.doesNotThrow(() => validateGa4Dates("2024-02-29", "2024-02-29"));
});

test("sources with no purchases survive parsing; missing attribution stays unknown", () => {
  const rows = parseGa4Rows({ rows: [{ dimensionValues: [{ value: "Organic Search" }, { value: "google" }, { value: "organic" }], metricValues: [{ value: "42" }, { value: "0" }, { value: "0" }] }] });
  assert.deepEqual(rows, [{ channel: "Organic Search", source: "google", medium: "organic", campaign: "(not set)", sessions: 42, purchases: 0, revenue: 0 }]);
  assert.deepEqual(parseGa4Rows({}), []);
  assert.throws(() => parseGa4Rows({ rows: [{ metricValues: [{ value: "NaN" }] }] }));
});
