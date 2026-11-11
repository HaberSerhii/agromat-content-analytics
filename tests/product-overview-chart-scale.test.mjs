import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './helpers/load-source.mjs';
const { productOverviewChartScale: scale, productOverviewChartY: y } = sourceLoader()('@/lib/product-overview-chart-scale');

test('small content score growth occupies a readable part of the chart', () => {
  const s = scale([64.8, 64.82]);
  assert.ok(s.minimum < 64.8 && s.maximum > 64.82);
  assert.ok(y(64.8, s.minimum, s.maximum) - y(64.82, s.minimum, s.maximum) > 30);
  const labels = s.ticks.map(v => v.toFixed(s.decimals));
  assert.equal(new Set(labels).size, labels.length);
});

test('comparison extremes and declines use the same axis', () => {
  const s = scale([64.82, 64.8, 59, 70]);
  assert.ok(s.minimum <= 59 && s.maximum >= 70);
  assert.ok(y(64.8, s.minimum, s.maximum) > y(64.82, s.minimum, s.maximum));
  for (const v of [59, 64.8, 64.82, 70]) assert.ok(y(v, s.minimum, s.maximum) >= 8 && y(v, s.minimum, s.maximum) <= 92);
});

test('empty, constant, zero, missing and integer data have usable scales', () => {
  for (const values of [[], [0], [64.81,64.81], [NaN, Infinity, 64.8]]) {
    const s = scale(values);
    assert.ok(Number.isFinite(s.minimum) && s.maximum > s.minimum);
    assert.ok(s.minimum >= 0);
  }
  for (const values of [[3, 4], [0, 8], [10, 100]]) {
    const s = scale(values, true);
    assert.ok(s.ticks.every(Number.isInteger));
  }
});
