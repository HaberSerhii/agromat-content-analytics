import test from "node:test";
import assert from "node:assert/strict";
import { buildPromotionMonthly } from "../src/lib/promotion-monthly.ts";
const periods = [{ from: "2026-10-01", to: "2026-10-31" }, { from: "2026-11-01", to: "2026-11-07" }];
const promotions = [
  { idinc: 1, productCodes: [1], startDate: "2026-10-02", endDate: "2026-11-05" },
  { idinc: 2, productCodes: [1,2], startDate: "2026-10-02", endDate: "2026-11-05" },
];
const item = (code, brand = "Golden Tile", segment = "Плитка") => ({ code, brand, category: segment, segment, qty: 2, revenue: 150 });
const orders = [
  { id: "a", created: "2026-10-03", shipped: "2026-10-04", items: [item(1), item(2), item(3)] },
  { id: "b", created: "2026-11-03", shipped: "2026-11-04", items: [item(2, "Grohe", "Сантехніка")] },
  { id: "c", created: "2026-11-04", shipped: "2026-11-06", items: [item(1)] },
  { id: "d", created: "2026-11-06", shipped: "2026-11-07", items: [item(1)] },
  { id: "e", created: "2026-11-03", shipped: null, items: [item(1)] },
  { id: "f", created: "2026-10-31", shipped: "2026-11-02", items: [item(1)] },
];
test("monthly promotional shipments count overlapping memberships once and mixed receipts only for promotional items", () => {
  const report = buildPromotionMonthly(orders, periods, promotions, "brands", "shipped");
  assert.deepEqual(report[0].items, [{ label: "Golden Tile", docs: 1, goods: 4, revenue: 300 }]);
  assert.deepEqual(report[1].items, [{ label: "Grohe", docs: 1, goods: 2, revenue: 150 }]);
});
test("received promotional orders use creation date, including pending shipments and excluding expired offers", () => {
  const report = buildPromotionMonthly(orders, periods, promotions, "categories", "received");
  assert.deepEqual(report[0].items, [{ label: "Плитка", docs: 2, goods: 6, revenue: 450 }]);
  assert.deepEqual(report[1].items, [{ label: "Сантехніка", docs: 1, goods: 2, revenue: 150 }, { label: "Плитка", docs: 2, goods: 4, revenue: 300 }]);
});
test("segments, partial final month, prior-year periods and unknown brands stay isolated", () => {
  const report = buildPromotionMonthly([...orders, { id: "late", created: "2026-11-08", shipped: "2026-11-08", items: [item(1)] }], periods, promotions, "brands", "received", "Сантехніка");
  assert.deepEqual(report[0].items, []);
  assert.equal(report[1].items[0].revenue, 150);
  const previous = [{ from: "2025-11-01", to: "2025-11-07" }];
  assert.deepEqual(buildPromotionMonthly(orders, previous, promotions, "brands", "received")[0].items, []);
});
test("document counts are unique within each dimension even when an order repeats", () => {
  const report = buildPromotionMonthly([orders[0], { ...orders[0], items: [item(2)] }], periods, promotions, "brands", "shipped");
  assert.equal(report[0].items[0].docs, 1);
  assert.equal(report[0].items[0].goods, 6);
});
