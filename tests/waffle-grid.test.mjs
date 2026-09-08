import test from "node:test";
import assert from "node:assert/strict";

import {
  isWaffleDotActive,
  waffleActiveDotCount,
} from "../src/lib/waffle-grid.ts";

function activeDots(share) {
  const count = waffleActiveDotCount(share);
  return Array.from({ length: 100 }, (_, index) => index)
    .filter((index) => isWaffleDotActive(index, count));
}

test("waffle chart fills complete rows from the bottom", () => {
  assert.deepEqual(activeDots(0.4), Array.from({ length: 40 }, (_, index) => index + 60));
});

test("waffle chart fills a partial row from the left", () => {
  const active = activeDots(0.43);

  assert.equal(active.length, 43);
  assert.deepEqual(active.slice(0, 3), [50, 51, 52]);
  assert.deepEqual(active.slice(3), Array.from({ length: 40 }, (_, index) => index + 60));
});

test("waffle chart rounds and clamps invalid shares", () => {
  assert.equal(waffleActiveDotCount(0.424), 42);
  assert.equal(waffleActiveDotCount(2), 100);
  assert.equal(waffleActiveDotCount(-1), 0);
  assert.equal(waffleActiveDotCount(Number.NaN), 0);
});
