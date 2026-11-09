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
    '@/lib/webshop-funnel-orders': { readWebshopFunnelOrders: async () => { throw new Error('Unexpected WEB SHOP call'); } },
    '@google-cloud/bigquery': { BigQuery: class { async query(options) { query = options; return [rows]; } } },
    '@/lib/bigquery-result-cache': {
      bigQueryCacheDay: () => '2026-10-06',
      readThroughBigQueryCache: async options => { cache = options; return options.load(); },
    },
  } });
  const result = await load('@/lib/promotion-web-funnel').readPromotionWebFunnel({
    url: 'https://www.agromat.ua/', periodKind: 'month', anchor: '2026-08-01', utmSource: 'Meta',
  });
  assert.equal(result.comparisons.meta_cpc.current.startUsers, 100);
  assert.equal(result.comparisons.meta_cpc.current.conversionRatePct, 2);
  assert.equal(result.comparisons.cpc.current.startUsers, 200);
  for (const device of ['all', 'mobile', 'desktop']) {
    assert.ok(result.comparisonsByDevice[device].meta_cpc.previous);
    assert.ok(result.comparisonsByDevice[device].meta_cpc.yearAgo);
  }
  assert.match(cache.key, /^v6-calendar-ranges:/);
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

function funnelFixture({ orders = async ({ from }) => from === '2026-10-01' ? 200 : 100, rows } = {}) {
  const orderCalls = [];
  const queryRows = rows ?? ['current', 'previous', 'yearAgo'].flatMap(period_key =>
    ['all', 'mobile', 'desktop'].flatMap(device => ['all', 'organic', 'cpc', 'meta_cpc', 'direct'].flatMap(channel =>
      [['landing', 10000], ['view_item', 4000], ['cart', 1000], ['begin_checkout', 500], ['purchase', 5]]
        .map(([stage_key, users]) => ({ period_key, device, channel, stage_key, users })))));
  const load = sourceLoader({ mocks: {
    '@/lib/webshop-funnel-orders': { readWebshopFunnelOrders: async range => { orderCalls.push(range); return orders(range); } },
    '@google-cloud/bigquery': { BigQuery: class { async query() { return [queryRows]; } } },
    '@/lib/bigquery-result-cache': {
      bigQueryCacheDay: () => '2026-11-01',
      readThroughBigQueryCache: async options => options.load(),
    },
  } });
  return { read: load('@/lib/promotion-web-funnel').readPromotionWebFunnel, orderCalls };
}

const october = { url: 'https://www.agromat.ua/', periodKind: 'month', anchor: '2026-10-01' };


for (const [kind, anchor, from, to] of [
  ['week', '2026-11-02', '2026-11-02', '2026-11-08'],
  ['week', '2026-10-26', '2026-10-26', '2026-11-01'],
  ['month', '2026-10-01', '2026-10-01', '2026-10-31'],
]) {
  test(`${kind} ${anchor} matches calendar stages, orders and conversions`, async () => {
    const { read, orderCalls } = funnelFixture();
    const regular = await read({ ...october, periodKind: kind, anchor });
    const calendar = await read({ ...october, periodKind: 'custom', dateFrom: from, dateTo: to });
    for (const device of ['all', 'mobile', 'desktop']) {
      for (const channel of ['all', 'organic', 'cpc', 'meta_cpc', 'direct']) {
        const a = regular.comparisonsByDevice[device][channel].current;
        const b = calendar.comparisonsByDevice[device][channel].current;
        assert.deepEqual(a.stages, b.stages);
        assert.equal(a.orderSource, 'ga4');
        assert.equal(a.orderUsers, b.orderUsers);
        assert.equal(a.conversionRatePct, b.conversionRatePct);
      }
    }
    assert.equal(orderCalls.length, 0);
  });
}

test('identical dates share a cached snapshot across mode and comparison position', async () => {
  const cache = new Map();
  let queries = 0;
  const load = sourceLoader({ mocks: {
    '@google-cloud/bigquery': { BigQuery: class { async query() {
      queries++;
      return [[{ period_key: 'current', channel: 'all', device: 'all', stage_key: 'landing', users: queries }]];
    } } },
    '@/lib/bigquery-result-cache': {
      bigQueryCacheDay: () => '2026-11-09',
      readThroughBigQueryCache: async options => {
        if (!cache.has(options.key)) cache.set(options.key, await options.load());
        return cache.get(options.key);
      },
    },
  } });
  const read = load('@/lib/promotion-web-funnel').readPromotionWebFunnel;
  const week = await read({ ...october, periodKind: 'week', anchor: '2026-11-02' });
  const calendar = await read({ ...october, periodKind: 'custom', dateFrom: '2026-11-02', dateTo: '2026-11-08' });
  assert.equal(week.comparisons.all.current.startUsers, calendar.comparisons.all.current.startUsers);
  assert.equal(week.comparisons.all.previous.startUsers, calendar.comparisons.all.previous.startUsers);
  const previous = await read({ ...october, periodKind: 'week', anchor: '2026-10-26' });
  assert.equal(previous.comparisons.all.current.startUsers, week.comparisons.all.previous.startUsers);
});
