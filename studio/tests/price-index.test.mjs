import test from "node:test";
import assert from "node:assert/strict";
import { priceIndexDistribution } from "../price-index.mjs";
test("price index has the requested direction, exact boundaries, and one count per SKU", () => {
  const rows = [80, 90, 95, 100, 105, 110, 120].map((price, id) => ({
    productId: id,
    ourPrice: price,
    byCompetitor: { 1: { price: 100 } },
  }));
  const report = priceIndexDistribution([...rows, rows[0]]);
  assert.deepEqual(
    report.buckets.map((bin) => bin.count),
    [1, 1, 1, 1, 2, 1],
  );
  assert.equal(report.total, 7);
  assert.deepEqual(
    report.buckets.map((bin) => bin.risk),
    [false, false, false, false, true, true],
  );
});
test("median competitor reference excludes unavailable prices and invalid own price", () => {
  const report = priceIndexDistribution([
    {
      productId: 1,
      ourPrice: 90,
      byCompetitor: { 1: { price: 90 }, 2: { price: 110 }, 3: { price: null } },
    },
    { productId: 2, ourPrice: 0, byCompetitor: { 1: { price: 10 } } },
    { productId: 3, ourPrice: 10, byCompetitor: { 1: { price: null } } },
  ]);
  assert.equal(report.total, 1);
  assert.equal(report.buckets[1].count, 1);
  assert.equal(report.skipped, 2);
});
