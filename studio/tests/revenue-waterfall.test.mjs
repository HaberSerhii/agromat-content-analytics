import test from "node:test";
import assert from "node:assert/strict";
import {
  revenueWaterfall,
  waterfallComparison,
} from "../revenue-waterfall.mjs";
const sales = (revenue, docs = 10) => ({
  available: true,
  metrics: { shippedRevenue: revenue, shippedDocs: docs },
});
const current = {
  all: sales(4040000),
  site: sales(3000000, 150),
  rozetka: sales(6000000 / 10),
  monomarket: sales(440000),
  traffic: { available: true, rows: [{ sessions: 1100, purchases: 150 }] },
};
const previous = {
  all: sales(3590000),
  site: sales(2800000, 140),
  rozetka: sales(450000),
  monomarket: sales(340000),
  traffic: { available: true, rows: [{ sessions: 1000, purchases: 140 }] },
};
test("waterfall reconciles exactly to ERP with an explicit cross-system adjustment", () => {
  const report = revenueWaterfall(
    current,
    previous,
    { from: "2026-11-01", to: "2026-11-15" },
    { from: "2025-11-01", to: "2025-11-15" },
  );
  assert.equal(report.available, true);
  assert.ok(
    Math.abs(
      report.start +
        report.steps.reduce((sum, step) => sum + step.value, 0) -
        report.end,
    ) < 0.01,
  );
  assert.ok(report.steps.some((step) => step.key === "marketplaces"));
  assert.ok(Math.abs(report.residual) < 0.01);
  const changed = {
    ...current,
    traffic: { available: true, rows: [{ sessions: 2000, purchases: 200 }] },
  };
  assert.ok(
    revenueWaterfall(changed, previous, {}, {}).steps.some(
      (step) => step.key === "reconcile",
    ),
  );
});
test("invalid or missing baselines are explicit rather than fabricated", () => {
  assert.equal(
    revenueWaterfall(
      { ...current, traffic: { available: false } },
      previous,
      {},
      {},
    ).available,
    false,
  );
  assert.deepEqual(
    waterfallComparison({ from: "2026-03-01", to: "2026-03-31" }, "month"),
    { from: "2026-02-01", to: "2026-02-28" },
  );
  assert.deepEqual(
    waterfallComparison({ from: "2026-11-01", to: "2026-11-15" }, "month"),
    { from: "2026-10-01", to: "2026-10-15" },
  );
});
