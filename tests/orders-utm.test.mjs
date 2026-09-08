import test from "node:test";
import assert from "node:assert/strict";
import { matchesUtm, utmOptions, utmValue } from "../src/lib/orders-utm.ts";

const orders = [
  { source: { utm_source: "google", utm_campaign: "summer" } },
  { source: { utm_source: "google", utm_campaign: "brand" } },
  { source: { utm_source: "facebook", utm_campaign: "summer" } },
  { source: null },
];

test("UTM filters match source and campaign independently", () => {
  assert.equal(matchesUtm(orders[0], "value:google", "value:summer"), true);
  assert.equal(matchesUtm(orders[1], "value:google", "value:summer"), false);
  assert.equal(matchesUtm(orders[2], "", "value:summer"), true);
  assert.equal(matchesUtm(orders[3], "missing", "missing"), true);
  assert.equal(utmValue(orders[3], "utm_source"), "missing");
});

test("UTM options include counts and missing values", () => {
  assert.deepEqual(utmOptions(orders, "utm_source"), [
    { value: "value:google", label: "google", count: 2 },
    { value: "value:facebook", label: "facebook", count: 1 },
    { value: "missing", label: "Без UTM", count: 1 },
  ]);
});
