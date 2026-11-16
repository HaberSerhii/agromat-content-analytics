import test from "node:test";
import assert from "node:assert/strict";
import {
  categoryPeriod,
  treemapLayout,
  categoryTone,
  categoryMosaic,
} from "../public/category-treemap.mjs";
test("mosaic tile areas preserve revenue proportions without overlapping", () => {
  const values = [1000, 620, 410, 380, 330, 270, 240, 180, 160, 90],
    total = values.reduce((a, b) => a + b, 0);
  const layout = treemapLayout(
    values.map((revenue, id) => ({ label: String(id), revenue })),
    1000,
    520,
  );
  for (const tile of layout) {
    assert.ok(
      Math.abs((tile.w * tile.h) / (1000 * 520) - tile.revenue / total) < 1e-10,
    );
    assert.ok(
      tile.x >= -1e-8 &&
        tile.y >= -1e-8 &&
        tile.x + tile.w <= 1000 + 1e-8 &&
        tile.y + tile.h <= 520 + 1e-8,
    );
  }
  for (let i = 0; i < layout.length; i++)
    for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i],
        b = layout[j],
        overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
        overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(overlapX < 1e-7 || overlapY < 1e-7);
    }
});
test("colors encode growth, decline, flat values, and absent history rather than category rank", () => {
  assert.equal(categoryTone(20), "growth-strong");
  assert.equal(categoryTone(9), "growth");
  assert.equal(categoryTone(-7), "decline");
  assert.equal(categoryTone(-20), "decline-strong");
  assert.equal(categoryTone(0.5), "flat");
  assert.equal(categoryTone(null), "missing");
  const current = [
      { label: "A", revenue: 110 },
      { label: "B", revenue: 60 },
      { label: "New", revenue: 90 },
    ],
    previous = [
      { label: "A", revenue: 100 },
      { label: "B", revenue: 100 },
    ];
  const tiles = categoryMosaic(current, previous);
  assert.equal(tiles.find((t) => t.label === "A").tone, "growth");
  assert.equal(tiles.find((t) => t.label === "B").tone, "decline-strong");
  assert.equal(tiles.find((t) => t.label === "New").delta, null);
});

test("category month and year use current calendar period through yesterday",()=>{
 assert.deepEqual(categoryPeriod("2026-11-16","month"),{from:"2026-11-01",to:"2026-11-15",empty:false});
 assert.deepEqual(categoryPeriod("2026-11-16","year"),{from:"2026-01-01",to:"2026-11-15",empty:false});
 assert.equal(categoryPeriod("2026-01-01","year").empty,true);
 assert.equal(categoryPeriod("2026-03-01","month").empty,true);
});
