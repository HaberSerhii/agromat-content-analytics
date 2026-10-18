import test from "node:test";
import assert from "node:assert/strict";
import { getSalesPlanAmounts, isSalesPlanService, goodsOnlySalesRow, netSalesItems } from "../src/lib/sales-plan-items.ts";

const goods = { code: "123", name: "Зарядна станція", category: "Інші товари", qty: 2, revenue: 1000 };
const delivery = { code: "18385", name: "Транспортні послуги", category: "Послуги доставки", qty: 1, revenue: 100 };
const lifting = { code: "456", name: "Підйом та занос товару в приміщення", category: "Інші послуги", qty: 1, revenue: 50 };
const row = { items: [goods, delivery, lifting], docsSum: 1150, returnSum: 240, goodsCount: 4, returnGoodsCodes: ["123", "18385", "456"], returnRowSums: [200, 30, 10] };

test("mixed orders count goods and goods returns, excluding all services", () => {
  assert.deepEqual(getSalesPlanAmounts(row), { docsSum: 1000, returnSum: 200, goodsCount: 2 });
  assert.equal(row.items.length, 3); // Original positions remain available for category/brand slices.
});

test("service-only orders do not count toward plan documents or revenue", () => {
  assert.equal(getSalesPlanAmounts({ ...row, items: [delivery, lifting] }), null);
});

test("other goods and unbranded goods retain their original totals", () => {
  assert.equal(isSalesPlanService(goods), false);
  assert.equal(isSalesPlanService({ ...goods, name: "Змішувач з доставкою" }), false);
  assert.deepEqual(getSalesPlanAmounts({ ...row, items: [goods], docsSum: 1000, returnSum: 200, goodsCount: 2 }), { docsSum: 1000, returnSum: 200, goodsCount: 2 });
});

test("services are detected by category or name even without delivery code", () => {
  assert.equal(isSalesPlanService(lifting), true);
  assert.equal(isSalesPlanService({ ...lifting, category: "Послуги" }), true);
  assert.equal(isSalesPlanService({ ...delivery, code: "999", category: "" }), true);
});


test("service exclusion removes service returns and costs and is idempotent", () => {
  const input = { ...row, ownCost: 750, items: [{ ...goods, ownCost: 700 }, { ...delivery, ownCost: 30 }, { ...lifting, ownCost: 20 }] };
  const cleaned = goodsOnlySalesRow(input);
  assert.equal(cleaned.docsSum, 1000);
  assert.equal(cleaned.returnSum, 200);
  assert.equal(cleaned.ownCost, 700);
  assert.deepEqual(cleaned.returnGoodsCodes, ["123"]);
  assert.equal(cleaned.items.length, 1);
  assert.equal(goodsOnlySalesRow(cleaned), cleaned);
  assert.equal(netSalesItems(cleaned)[0].revenue, 800);
  assert.equal(input.items.length, 3);
});

test("branch 012 is a service even when its name does not say service", () => {
  assert.equal(isSalesPlanService({ ...goods, categoryKey: "012.011", name: "Компенсація" }), true);
  assert.equal(goodsOnlySalesRow({ ...row, items: [delivery, lifting] }), null);
  assert.equal(getSalesPlanAmounts({ ...row, items: [goods, { ...delivery, revenue: 0 }], docsSum: 1000, returnSum: 0, returnGoodsCodes: [], returnRowSums: [] }).docsSum, 1000);
});

test("net goods sums handle partial, full, unallocated and repeated-SKU returns", () => {
  const input = { ...row, items: [{ ...goods, revenue: 300 }, { ...goods, revenue: 700 }], docsSum: 1000, returnSum: 200, returnGoodsCodes: ["123"], returnRowSums: [200] };
  assert.deepEqual(netSalesItems(input).map(item => item.revenue), [240, 560]);
  assert.equal(netSalesItems({ ...input, returnSum: 1000, returnRowSums: [1000] }).reduce((sum, item) => sum + item.revenue, 0), 0);
  assert.deepEqual(netSalesItems({ ...input, returnGoodsCodes: [], returnRowSums: [] }).map(item => item.revenue), [240, 560]);
});
