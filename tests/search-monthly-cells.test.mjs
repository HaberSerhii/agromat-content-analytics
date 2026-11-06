import test from "node:test";
import assert from "node:assert/strict";
import { createMonthlyMetricPool } from "../src/lib/search-monthly-cells.ts";
import { mapWithConcurrency } from "../src/lib/dashboard-work.ts";

test("zero and equal monthly cells share memory without merging different dates or counts", () => {
  const cell = createMonthlyMetricPool();
  const zero = { month: "2026-10", from: "2026-10-01", to: "2026-10-31", bigQueryCount: 0, multisearchFoundCount: 0, multisearchNoResultsCount: 0, totalSearches: 0 };
  const a = cell({ ...zero }), b = cell({ ...zero });
  assert.equal(a, b);
  assert.deepEqual(a, zero);
  assert.ok(Object.isFrozen(a));
  assert.notEqual(cell({ ...zero, to: "2026-10-07" }), a);
  assert.notEqual(cell({ ...zero, totalSearches: 1 }), a);
});
test("monthly source loading is bounded and preserves result order", async () => {
  let active = 0, peak = 0;
  const result = await mapWithConcurrency([1,2,3,4,5], 2, async value => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--; return value * 2;
  });
  assert.deepEqual(result, [2,4,6,8,10]);
  assert.equal(peak, 2);
});
