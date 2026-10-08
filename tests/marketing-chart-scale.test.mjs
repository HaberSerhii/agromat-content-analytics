import test from "node:test";
import assert from "node:assert/strict";
import { marketingChartScale } from "../src/lib/marketing-chart-scale.ts";

test("marketing scale leaves a full step above both exact and intermediate peaks", () => {
  for (const peak of [0, 1, 5, 23, 50, 33200, 200000]) {
    const scale = marketingChartScale(peak);
    assert.ok(scale.maximum - peak >= scale.step);
    assert.equal(scale.ticks.at(-1), scale.maximum);
    assert.equal(scale.ticks[0], 0);
    assert.ok(scale.ticks.every(Number.isInteger));
  }
  assert.equal(marketingChartScale(50).maximum, 80);
});
