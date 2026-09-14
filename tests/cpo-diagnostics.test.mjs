import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";

const load = sourceLoader();
const { buildCpoDiagnostic, shapleyRevenueContributions } = load("@/lib/cpo-analytics/engine");

function row(periodYear, periodNumber, overrides = {}) {
  return {
    periodKind: "week",
    periodYear,
    periodNumber,
    dimension: "overall",
    dimensionValue: "all",
    users: 80_000,
    sessions: 100_000,
    viewItemSessions: 40_000,
    addToCartSessions: 8_000,
    beginCheckoutSessions: 4_000,
    purchaseSessions: 2_000,
    orders: 2_000,
    revenue: 12_000_000,
    viewItemEvents: 80_000,
    addToCartEvents: 10_000,
    beginCheckoutEvents: 4_500,
    purchaseEvents: 2_000,
    ...overrides,
  };
}

function segment(base, dimension, dimensionValue, overrides = {}) {
  return { ...base, dimension, dimensionValue, ...overrides };
}

test("Shapley business decomposition reconciles exactly to revenue change", () => {
  const previous = row(2026, 36);
  const current = row(2026, 37, { sessions: 110_000, orders: 1_800, revenue: 11_700_000 });
  const contribution = shapleyRevenueContributions(previous, current);
  const total = contribution.traffic + contribution.conversion + contribution.aov;
  assert.ok(Math.abs(total - (current.revenue - previous.revenue)) < 0.1);
  assert.ok(contribution.conversion < 0);
});

test("diagnostic ranks volume-weighted funnel and segment losses", () => {
  const current = row(2026, 37, { beginCheckoutSessions: 4_200, purchaseSessions: 1_500, orders: 1_500, revenue: 9_000_000 });
  const previous = row(2026, 36, { beginCheckoutSessions: 4_000, purchaseSessions: 2_000, orders: 2_000, revenue: 12_000_000 });
  const yearAgo = row(2025, 37, { beginCheckoutSessions: 3_800, purchaseSessions: 1_850, orders: 1_850, revenue: 10_500_000 });
  const rows = [current, previous, yearAgo];
  for (const [base, mobilePurchases, desktopPurchases] of [[current, 900, 600], [previous, 1_400, 600], [yearAgo, 1_250, 600]]) {
    rows.push(
      segment(base, "device", "mobile", { sessions: 70_000, beginCheckoutSessions: 3_000, purchaseSessions: mobilePurchases, orders: mobilePurchases, revenue: mobilePurchases * 6_000 }),
      segment(base, "device", "desktop", { sessions: 30_000, beginCheckoutSessions: 1_000, purchaseSessions: desktopPurchases, orders: desktopPurchases, revenue: desktopPurchases * 6_000 }),
    );
  }
  const cube = { version: 1, countryFilter: "Ukraine", savedAt: "2026-09-14T00:00:00Z", projectId: "p", datasetId: "d", datasetLocation: "EU", dataFrom: "2024-12-30", dataTo: "2026-09-13", bytesProcessed: 1, rows };
  const result = buildCpoDiagnostic({ cube, cubeCompressedBytes: 100, periodKind: "week", selectedPeriod: 37, selectedYear: 2026 });
  assert.equal(result.primaryFunnelStage, "begin_checkout_to_purchase");
  assert.equal(result.segmentContributions.device[0].dimensionValue, "mobile");
  assert.ok(result.segmentContributions.device[0].estimatedLostOrders > 0);
  assert.ok(result.topSignals.length <= 5);
  assert.equal(result.countryFilter, "Ukraine");
});

test("small segments are excluded from Top Signals", () => {
  const current = row(2026, 37, { beginCheckoutSessions: 4_000, purchaseSessions: 1_500, orders: 1_500, revenue: 9_000_000 });
  const previous = row(2026, 36);
  const yearAgo = row(2025, 37);
  const tiny = segment(current, "city", "Tiny", { sessions: 20, beginCheckoutSessions: 20, purchaseSessions: 1, orders: 1, revenue: 6_000 });
  const tinyPrevious = segment(previous, "city", "Tiny", { sessions: 20, beginCheckoutSessions: 20, purchaseSessions: 15, orders: 15, revenue: 90_000 });
  const cube = { version: 1, countryFilter: "Ukraine", savedAt: "2026-09-14T00:00:00Z", projectId: "p", datasetId: "d", datasetLocation: "EU", dataFrom: "2024-12-30", dataTo: "2026-09-13", bytesProcessed: 1, rows: [current, previous, yearAgo, tiny, tinyPrevious] };
  const result = buildCpoDiagnostic({ cube, cubeCompressedBytes: 100, periodKind: "week", selectedPeriod: 37, selectedYear: 2026 });
  assert.equal(result.segmentContributions.city.length, 0);
  assert.equal(result.topSignals.some((signal) => signal.dimensionValue === "Tiny"), false);
});

