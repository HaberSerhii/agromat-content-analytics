import test from "node:test";
import assert from "node:assert/strict";
import { isDeliverySalesItem, isDimensionOrderInPeriod } from "../src/lib/sales-dimension-filter.ts";

const period = { from: "2026-09-01", to: "2026-09-30" };
const order = { state: "Повністю відвантажений", createdDate: "2026-09-01", shippedDate: "2026-09-30" };
const goods = { code: "123", name: "Змішувач", brand: "Без бренда", category: "Змішувачі" };

test("both creation and shipment must be in the selected period", () => {
  assert.equal(isDimensionOrderInPeriod(order, period), true);
  assert.equal(isDimensionOrderInPeriod({ ...order, createdDate: "2026-08-31" }, period), false);
  assert.equal(isDimensionOrderInPeriod({ ...order, shippedDate: "2026-10-01" }, period), false);
  assert.equal(isDimensionOrderInPeriod({ ...order, state: "Скасована" }, period), false);
  assert.equal(isDimensionOrderInPeriod({ ...order, state: "Частково відвантажений" }, period), false);
});

test("inclusive date bounds accept timestamps on the final day", () => {
  assert.equal(isDimensionOrderInPeriod({ ...order, createdDate: "2026-09-30T08:00:00", shippedDate: "2026-09-30T21:00:00" }, period), true);
  assert.equal(isDimensionOrderInPeriod({ ...order, createdDate: "2026-09-02", shippedDate: "2026-09-01" }, period), false);
  assert.equal(isDimensionOrderInPeriod({ ...order, createdDate: "" }, period), false);
  assert.equal(isDimensionOrderInPeriod({ ...order, shippedDate: null }, period), false);
});

test("arbitrary ranges and previous-year comparisons use the same date rule", () => {
  const range = { from: "2025-08-15", to: "2025-09-14" };
  assert.equal(isDimensionOrderInPeriod({ ...order, createdDate: "2025-08-15", shippedDate: "2025-09-14" }, range), true);
  assert.equal(isDimensionOrderInPeriod(order, { from: null, to: null }), true);
  assert.equal(isDimensionOrderInPeriod(order, { from: "2026-09-02", to: null }), false);
});

test("delivery is removed by service code, category or service name", () => {
  assert.equal(isDeliverySalesItem({ ...goods, code: "18385" }), true);
  assert.equal(isDeliverySalesItem({ ...goods, category: "Послуги доставки" }), true);
  assert.equal(isDeliverySalesItem({ ...goods, name: "Транспортні послуги" }), true);
  assert.equal(isDeliverySalesItem({ ...goods, name: "Послуга доставки" }), true);
});

test("mixed orders retain goods, including unbranded products", () => {
  const items = [goods, { ...goods, code: "18385", name: "Транспортні послуги" }];
  assert.deepEqual(items.filter((item) => !isDeliverySalesItem(item)), [goods]);
  assert.equal(isDeliverySalesItem({ ...goods, name: "Змішувач — безкоштовна доставка" }), false);
});
