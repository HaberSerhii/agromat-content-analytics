import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";

const { goodsOnlyWebshopOrder } = sourceLoader({
  mocks: { "next/server": {}, "@/lib/sales-s3": {}, "@/lib/liqpay": {}, "@/lib/promotion-price-position": {} },
  append: { "@/app/api/sales/webshop-orders/route": "\nexport { goodsOnlyWebshopOrder };" },
})("@/app/api/sales/webshop-orders/route");

const goods = { code: "123", name: "Змішувач", line_total: 1000 };
const delivery = { code: "18385", name: "Транспортні послуги", line_total: 80 };
const service = { code: "456", name: "Підйом та занос товару", line_total: 50 };

test("webshop list and details use goods after returns, excluding delivery fees and service lines", () => {
  const order = { items: [goods, delivery, service], totals: { cost: 1200, delivery: 70, items_sum: 1130 }, return_info: { returnSum: 200 } };
  const actual = goodsOnlyWebshopOrder(order);
  assert.equal(actual.items.length, 1);
  assert.equal(actual.items[0].code, "123");
  assert.equal(actual.totals.cost, 800);
  assert.equal(actual.totals.delivery, 0);
  assert.equal(actual.totals.items_sum, 1000);
  assert.equal(order.items.length, 3);
});

test("service-only orders disappear; unknown goods retain their amount less a separate delivery fee", () => {
  assert.equal(goodsOnlyWebshopOrder({ items: [delivery, service], totals: { cost: 130, delivery: 0 } }), null);
  assert.equal(goodsOnlyWebshopOrder({ items: [], totals: { cost: 120, delivery: 20 } }).totals.cost, 100);
});
