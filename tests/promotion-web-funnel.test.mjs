import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './helpers/load-source.mjs';

test('Meta CPC is returned for every device and period, with a fresh attribution cache', async () => {
  let query;
  let cache;
  const rows = [
    { period_key: 'current', channel: 'meta_cpc', device: 'all', stage_key: 'landing', users: 100 },
    { period_key: 'current', channel: 'meta_cpc', device: 'all', stage_key: 'purchase', users: 2 },
    { period_key: 'current', channel: 'cpc', device: 'all', stage_key: 'landing', users: 200 },
  ];
  const load = sourceLoader({ mocks: {
    '@google-cloud/bigquery': { BigQuery: class { async query(options) { query = options; return [rows]; } } },
    '@/lib/bigquery-result-cache': {
      bigQueryCacheDay: () => '2026-10-06',
      readThroughBigQueryCache: async options => { cache = options; return options.load(); },
    },
  } });
  const result = await load('@/lib/promotion-web-funnel').readPromotionWebFunnel({
    url: 'https://www.agromat.ua/', periodKind: 'month', anchor: '2026-09-01', utmSource: 'Meta',
  });
  assert.equal(result.comparisons.meta_cpc.current.startUsers, 100);
  assert.equal(result.comparisons.meta_cpc.current.conversionRatePct, 2);
  assert.equal(result.comparisons.cpc.current.startUsers, 200);
  for (const device of ['all', 'mobile', 'desktop']) {
    assert.ok(result.comparisonsByDevice[device].meta_cpc.previous);
    assert.ok(result.comparisonsByDevice[device].meta_cpc.yearAgo);
  }
  assert.match(cache.key, /^v5-ua-funnel-unique-created-orders:/);
  assert.equal(result.countryFilter, "Ukraine");
  assert.equal(result.purchaseCountryFilter, "all");
  assert.match(query.query, /WHEN 'payment_unpaid' THEN 'purchase'/);
  assert.match(query.query, /FROM UNNEST\(event_params\) WHERE key = 'transaction_id'/);
  assert.match(query.query, /geo\.country AS country/);
  assert.match(query.query, /e\.event_name IN \('purchase', 'payment_unpaid'\) OR e\.country = 'Ukraine'/);
  assert.doesNotMatch(query.query, /AND geo\.country =/);
  assert.equal(query.params.utmSource, 'meta');
  assert.match(query.query, /session_traffic_source_last_click/);
  assert.doesNotMatch(query.query, /collected_traffic_source|\btraffic_source\.source|\bgclid\b/);
  assert.match(query.query, /COUNT\(DISTINCT IF\(stage_key = 'purchase', transaction_id, user_pseudo_id\)\)/);
  assert.match(query.query, /FROM base\s+WHERE \(@utmSource = '' OR traffic_source_name = @utmSource\)/);
});
