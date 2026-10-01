import test from "node:test";
import assert from "node:assert/strict";
import { getSalesPlanAmounts, isSalesPlanService } from "../src/lib/sales-plan-items.ts";

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
