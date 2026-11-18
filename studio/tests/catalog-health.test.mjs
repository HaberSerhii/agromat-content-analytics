import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogSelection, stockMovement} from '../catalog-health.mjs';

test('catalog impressions and CTR use the header calendar and comparison mode', () => {
  const params = new URLSearchParams({from:'2026-11-01',to:'2026-11-17',compareMode:'mom'});
  assert.deepEqual(catalogSelection(params,'2026-11-18').baseline,{from:'2026-10-01',to:'2026-10-17'});
  params.set('compareMode','yoy');
  assert.deepEqual(catalogSelection(params,'2026-11-18').baseline,{from:'2025-11-01',to:'2025-11-17'});
  params.set('compareMode','wow');
  assert.throws(()=>catalogSelection(params,'2026-11-18'),/comparison_unavailable/);
});

test('stock movement compares unique SKUs and preserves a missing baseline', () => {
  const current = new Set([1,2,3,4]);
  assert.deepEqual(stockMovement(current,new Set([1,2,5])),{gained:2,lost:1,net:1});
  assert.equal(stockMovement(current,null),null);
});
