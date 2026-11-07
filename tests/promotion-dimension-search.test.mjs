import test from "node:test";
import assert from "node:assert/strict";
import { selectPromotionDimensions } from "../src/lib/promotion-dimension-search.ts";

for (const [dimension, labels, query] of [
  ["brands", ["Golden Tile", "GOLDEN TILE Premium", "Grohe"], " golden tile "],
  ["categories", ["Плитка", "Плитка для підлоги", "Сантехніка"], " ПЛИТКА "],
]) {
  const items = labels.map((label, index) => ({ label, productCount: index + 1, revenue: (index + 1) * 125.5 }));
  test(`${dimension}: search and statistics use the same matching dimensions`, () => {
    const selected = selectPromotionDimensions(items, query);
    assert.deepEqual(selected.items, items.slice(0, 2));
    assert.equal(selected.count, 2);
    assert.equal(selected.productCount, 3);
    assert.equal(selected.revenue, 376.5);
  });
  test(`${dimension}: no match clears statistics and clearing search restores totals`, () => {
    assert.deepEqual(selectPromotionDimensions(items, "no match"), { items: [], count: 0, productCount: 0, revenue: 0 });
    const restored = selectPromotionDimensions(items, "  ");
    assert.equal(restored.items, items);
    assert.equal(restored.count, 3);
    assert.equal(restored.productCount, 6);
    assert.equal(restored.revenue, 753);
  });
}
