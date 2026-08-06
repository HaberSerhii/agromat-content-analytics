import test from "node:test";
import assert from "node:assert/strict";

import {
  brandsMatch,
  matchConfidence,
  priceForSnapshot,
  snapshotQualityIssue,
} from "../scripts/lib/competitor-price-quality.mjs";

test("out-of-stock offers produce a blank current price", () => {
  assert.equal(priceForSnapshot(2094.75, "Немає в наявності"), null);
  assert.equal(priceForSnapshot(2094.75, "OutOfStock"), null);
});

test("snapshot quality guard blocks mass out-of-stock spikes", () => {
  const previous = Array.from({ length: 100 }, (_, i) => ({ status: i < 10 ? "OutOfStock" : "InStock" }));
  const anomalous = Array.from({ length: 100 }, (_, i) => ({ status: i < 45 ? "OutOfStock" : "InStock" }));
  const normal = Array.from({ length: 100 }, (_, i) => ({ status: i < 20 ? "OutOfStock" : "InStock" }));

  assert.match(snapshotQualityIssue(previous, anomalous), /out_of_stock spike/);
  assert.equal(snapshotQualityIssue(previous, normal), null);
});

test("only an explicit in-stock status keeps the current price", () => {
  assert.equal(priceForSnapshot(2205, "В наявності"), 2205);
  assert.equal(priceForSnapshot(2205, "unknown"), null);
});

test("missing or conflicting brands quarantine a match", () => {
  assert.equal(matchConfidence("Valeso", null), "partial");
  assert.equal(matchConfidence("Valeso", "Wezer"), "rejected");
  assert.equal(matchConfidence("Grohe AG", "Grohe"), "exact");
  assert.equal(matchConfidence("Grohe AG", null, "exact", "https://shop.test/grohe-tempesta-26162003"), "exact");
  assert.equal(matchConfidence("Valeso", null, "exact", "https://shop.test/wezer-7850-08"), "partial");
  assert.equal(brandsMatch("Valeso", "Wezer"), false);
});
