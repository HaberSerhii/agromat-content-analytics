import test from "node:test";
import assert from "node:assert/strict";
import {
  categoryPeriod,
  treemapLayout,
  categoryTone,
  categoryColor,
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
  assert.equal(categoryTone(20), "growth");
  assert.equal(categoryTone(9), "growth");
  assert.equal(categoryTone(-7), "decline");
  assert.equal(categoryTone(-20), "decline");
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
  assert.equal(tiles.find((t) => t.label === "B").tone, "decline");
  assert.equal(tiles.find((t) => t.label === "New").delta, null);
});

test("quantity mode ranks, sizes and colors the tiles by shipped units", () => {
  const current = [
    { label: "A", revenue: 10000, goods: 3 },
    { label: "B", revenue: 0, goods: 12 },
  ];
  const previous = [
    { label: "A", revenue: 5000, goods: 6 },
    { label: "B", revenue: 0, goods: 8 },
  ];
  const [first, second] = categoryMosaic(current, previous, true, { measure: "goods" });
  assert.equal(first.label, "B");
  assert.equal(first.delta, 50);
  assert.equal(second.delta, -50);
  assert.equal(first.w * first.h / (second.w * second.h), 4);
});

test("category month and year use current calendar period through yesterday",()=>{
 assert.deepEqual(categoryPeriod("2026-11-16","month"),{from:"2026-11-01",to:"2026-11-15",empty:false});
 assert.deepEqual(categoryPeriod("2026-11-16","year"),{from:"2026-01-01",to:"2026-11-15",empty:false});
 assert.equal(categoryPeriod("2026-01-01","year").empty,true);
 assert.equal(categoryPeriod("2026-03-01","month").empty,true);
});


test('heatmap color bands change every two percent in opposite thermal directions',()=>{
 assert.equal(categoryTone(1.99),'flat');assert.equal(categoryTone(-1.99),'flat');
 assert.equal(categoryColor(1.99).band,0);
 assert.deepEqual(categoryColor(2),categoryColor(3.99));
 assert.notEqual(categoryColor(2).background,categoryColor(4).background);
 assert.equal(categoryColor(-4).band,-2);assert.equal(categoryColor(4).band,2);
 assert.notEqual(categoryColor(-4).background,categoryColor(4).background);
 assert.equal(categoryColor(null),null);assert.equal(categoryColor(Infinity),null);
 const rgb=color=>color.match(/\d+/g).map(Number);
 assert.ok(rgb(categoryColor(-20).background)[0]>rgb(categoryColor(-20).background)[2]);
 assert.ok(rgb(categoryColor(20).background)[2]>rgb(categoryColor(20).background)[0]);
 const luminance=values=>values.map(value=>value/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 for(let step=-100;step<=100;step++){
  const color=categoryColor(step*2),bg=luminance(rgb(color.background));
  const fg=luminance(color.foreground.slice(1).match(/../g).map(v=>parseInt(v,16)));
  assert.ok((Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)>=4.5,`contrast at ${step*2}%`);
 }
});
