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

test("overview counts mixed orders once and filters amounts by segment and category", () => {
  const metadata = new Map([
    ["101", { category: "Ванни", categoryKey: "002", brand: "A" }],
    ["102", { category: "Плитка", categoryKey: "001", brand: "A" }],
  ]);
  const input = [{ ...orders[0], date: "2026-10-01T23:30:00Z" }];
  const range = { from: "2026-10-01", to: "2026-10-03" };
  const all = receivedSales(input, products, metadata, "site", range).overview;
  assert.equal(all.docs, 1);
  assert.equal(all.revenue, 300);
  assert.equal(all.goods, 4);
  assert.equal(all.averageCheck, 300);
  assert.deepEqual(Array.from(all.byDate, x => x.docs), [0, 1, 0]);
  assert.equal(all.segments.find(x => x.label === "Сантехніка").docs, 1);
  const tile = receivedSales(input, products, metadata, "site", { ...range, segment: "Плитка" }).overview;
  assert.equal(tile.docs, 1);
  assert.equal(tile.revenue, 100);
  assert.equal(tile.goods, 1);
  assert.equal(tile.categoryOptions.length, 2);
  const bath = receivedSales(input, products, metadata, "site", { ...range, categories: ["Ванни"] }).overview;
  assert.equal(bath.revenue, 200);
  assert.equal(bath.docs, 1);
  const empty = receivedSales(input, products, metadata, "rozetka", range).overview;
  assert.equal(empty.docs, 0);
  assert.equal(empty.averageCheck, null);
  assert.equal(empty.byDate.length, 3);
});

test("monthly segment filters isolate flooring and chemistry lines inside mixed Web-shop orders", () => {
  const metadata = new Map([
    ["101", { category: "Ламінат", categoryKey: "009.002", brand: "A" }],
    ["102", { category: "Клей", categoryKey: "003.023", brand: "A" }],
  ]);
  const flooring = receivedSales(orders, products, metadata, "site", { segment: "Підлогові покриття" });
  assert.equal(flooring.brands.items[0].revenue, 200);
  assert.equal(flooring.brands.items[0].goods, 3);
  assert.deepEqual(Array.from(flooring.categories.items, x => x.label), ["Ламінат"]);
  const chemistry = receivedSales(orders, products, metadata, "site", { segment: "Будівельна хімія" });
  assert.equal(chemistry.brands.items[0].revenue, 100);
  assert.equal(chemistry.brands.items[0].docs, 1);
  assert.deepEqual(Array.from(chemistry.brands.products.A, x => x.category), ["Клей"]);
  assert.equal(receivedSales(orders, products, metadata, "site", { segment: "Плитка" }).brands.items.length, 0);
});
