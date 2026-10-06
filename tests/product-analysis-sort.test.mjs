import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './helpers/load-source.mjs';
const { compareProductAnalysisRows: compare, normalizeProductSortKey, PRODUCT_SORT_COLUMNS } = sourceLoader()('@/lib/product-analysis-sort');
test('all twelve columns accept sort keys; invalid keys are ignored', () => {
  assert.equal(PRODUCT_SORT_COLUMNS.length, 12);
  for (const [key] of PRODUCT_SORT_COLUMNS) assert.equal(normalizeProductSortKey(key), key);
  assert.equal(normalizeProductSortKey('invalid'), null);
});
test('numeric metrics sort before pagination, in both directions, with missing values last', () => {
  const rows = [{id:1, ctr:null}, {id:2, ctr:10}, {id:3, ctr:2}, {id:4, ctr:0}];
  assert.deepEqual([...rows].sort((a,b)=>compare(a,b,'ctr','asc')).map(r=>r.id), [4,3,2,1]);
  assert.deepEqual([...rows].sort((a,b)=>compare(a,b,'ctr','desc')).slice(0,2).map(r=>r.id), [2,3]);
});
test('article numbers use natural order and tied metrics have stable IDs', () => {
  assert.ok(compare({id:1,sku:'A2'},{id:2,sku:'A10'},'sku','asc') < 0);
  assert.ok(compare({id:2,impressions:5},{id:10,impressions:5},'impressions','desc') < 0);
});
