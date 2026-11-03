import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";
const { receivedSales } = sourceLoader()("@/lib/received-sales");
const products = [{ id: 1, code: 101, goodsRef: 11, brand: "A", categoryName: "Ванни", name: "Bath" }, { id: 2, code: 102, goodsRef: 12, brand: "A", categoryName: "Плитка" }];
const item = (id, quantity = 1) => ({ product_id: id, quantity, line_total: 100 });
const orders = [{ id: 1, status: "cancelled", items: [item(1, 2), item(1), item(2)] }, { id: 2, origin: { source: "rozetka" }, items: [item(1)] }];
test("received includes all statuses and counts distinct orders by brand/category/product", () => {
  const data = receivedSales([...orders, orders[0]], products, new Map(), "all");
  assert.equal(data.brands.items[0].docs, 2);
  assert.equal(data.brands.items[0].goods, 5);
  assert.equal(data.brands.items[0].revenue, 400);
  assert.equal(data.brands.products.A[0].orders, 2);
  assert.equal(data.categories.items.find(x => x.label === "Ванни").docs, 2);
});
test("channels and ERP dimensions apply; services excluded and unknown goods retained", () => {
  const metadata = new Map([["101", { category: "ERP category", categoryKey: "002", brand: "ERP brand" }]]);
  const data = receivedSales([...orders, { id: 3, items: [{ code: 18385, name: "Доставка", quantity: 1, line_total: 50 }, item(999)] }], products, metadata, "site");
  assert.equal(data.brands.items.find(x => x.label === "ERP brand").docs, 1);
  assert.equal(data.categories.items.find(x => x.label === "ERP category").goods, 3);
  assert.equal(data.brands.items.reduce((sum, x) => sum + x.revenue, 0), 400);
  assert.equal(receivedSales(orders, products, metadata, "monomarket").brands.items.length, 0);
  assert.equal(receivedSales(orders, products, metadata, "rozetka").brands.items[0].docs, 1);
});

test("orders without lines remain countable under unknown dimensions", () => {
  const data = receivedSales([{ id: 90, items: [], totals: { cost: 150, delivery: 50 } }], [], new Map(), "all");
  assert.equal(data.categories.items[0].docs, 1);
  assert.equal(data.categories.items[0].goods, 0);
  assert.equal(data.categories.items[0].revenue, 100);
});

test("site channel accepts the live API origin and legacy webshop origin", () => {
  const data = receivedSales([
    { id: 10, origin: { source: "site" }, items: [item(1)] },
    { id: 11, origin: { source: "webshop" }, items: [item(1)] },
    { id: 12, origin: { source: "rozetka" }, items: [item(1)] },
  ], products, new Map(), "site");
  assert.equal(data.brands.items[0].docs, 2);
});
