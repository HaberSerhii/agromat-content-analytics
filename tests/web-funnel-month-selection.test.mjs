import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './helpers/load-source.mjs';
function fixture() {
  const keys = [];
  const load = sourceLoader({ mocks: {
    '@google-cloud/bigquery': { BigQuery: class { async query() { return [[]]; } } },
    '@/lib/bigquery-result-cache': {
      bigQueryCacheDay: () => '2026-11-01',
      readThroughBigQueryCache: async options => { keys.push(options.key); return options.load(); },
    },
  } });
  return { read: load('@/lib/promotion-web-funnel').readPromotionWebFunnel, keys };
}
const october = { url: 'https://www.agromat.ua/', periodKind: 'month', anchor: '2026-10-01' };
test('independently compares October 2025 with October 2026 and preserves arrow navigation', async () => {
  const { read } = fixture();
  const result = await read({ ...october, comparisonMonth: '2025-10-01' });
  const { previous, current } = result.comparisons.all;
  assert.equal(previous.from, '2025-10-01');
  assert.equal(previous.to, '2025-10-31');
  assert.equal(current.from, '2026-10-01');
  assert.equal(current.to, '2026-10-31');
  assert.equal(result.navigation.previousAnchor, '2026-09-01');
});
test('comparison month has its own cache key and supports leap years', async () => {
  const { read, keys } = fixture();
  const first = await read({ ...october, comparisonMonth: '2024-02-01' });
  await read({ ...october, comparisonMonth: '2025-02-01' });
  assert.equal(first.comparisons.all.previous.to, '2024-02-29');
  assert.notEqual(keys[0], keys[1]);
  await assert.rejects(read({ ...october, comparisonMonth: '2099-01-01' }), /завершені місяці/);
});
