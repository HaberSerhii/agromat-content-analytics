import test from "node:test";
import assert from "node:assert/strict";
import { filterCartSearch } from "../src/lib/cart-search.ts";
const carts = [
  { id: 1, product: "Golden Tile, Grohe", sku: "GT-01", promo_code: null, name: "Олена", raw: { ip: "192.0.2.1" }, status: "abandoned", total: 1500, contact: true, stage: 2 },
  { id: 2, product: "GOLDEN TILE", sku: "GT-02", promo_code: "AUTUMN", name: "Іван", status: "converted", total: 400, contact: true, stage: 4 },
  { id: 3, product: "Grohe", sku: "GH-03", promo_code: null, name: "Марія", status: "abandoned", total: 900, contact: false, stage: 0 },
  { id: 4, product: "Golden Tile", sku: "GT-04", promo_code: null, name: "Петро", status: "active", total: 100, contact: false, stage: 0 },
];
test("search narrows the all-status statistics cohort and abandoned amount together", () => {
  const found = filterCartSearch(carts, " golden tile ");
  assert.deepEqual(found.map(cart => cart.id), [1, 2, 4]);
  const abandoned = found.filter(cart => cart.status === "abandoned");
  assert.equal(abandoned.length, 1);
  assert.equal(abandoned.reduce((sum, cart) => sum + cart.total, 0), 1500);
  assert.equal(found.filter(cart => cart.status === "active").length, 1);
  assert.equal(found.filter(cart => cart.status === "converted").length, 1);
  assert.equal(abandoned.filter(cart => cart.contact).length, 1);
  assert.equal(abandoned.filter(cart => cart.stage > 0).length, 1);
});
test("ID, product, SKU, promo, customer and IP use the same search", () => {
  for (const query of ["1", "GT-01", "олена", "192.0.2.1"]) assert.equal(filterCartSearch(carts, query)[0].id, 1);
  assert.equal(filterCartSearch(carts, "autumn")[0].id, 2);
  assert.equal(filterCartSearch(carts, "grohe").length, 2);
});
test("clearing search restores the cohort; no matches produce zero statistics", () => {
  assert.equal(filterCartSearch(carts, "   "), carts);
  assert.equal(filterCartSearch(carts, "no match").length, 0);
  assert.equal(carts.length, 4);
});
