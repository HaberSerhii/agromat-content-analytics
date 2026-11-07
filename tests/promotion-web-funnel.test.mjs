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

test('October vs September and year-ago October use Webshop orders and recalculate CR', async () => {
  const { read, orderCalls } = funnelFixture();
  const result = await read(october);
  const { current, previous, yearAgo } = result.comparisons.all;
  assert.deepEqual(orderCalls.map(r => [r.from, r.to]), [['2026-10-01', '2026-10-31'], ['2026-09-01', '2026-09-30'], ['2025-10-01', '2025-10-31']]);
  assert.equal(current.orderSource, 'webshop');
  assert.equal(previous.orderSource, 'webshop');
  assert.equal(current.orderUsers, 200);
  assert.equal(previous.orderUsers, 100);
  assert.equal(current.conversionRatePct, 2);
  assert.equal(previous.conversionRatePct, 1);
  assert.deepEqual(Array.from(current.stages.slice(0, 4), s => s.users), [10000, 4000, 1000, 500]);
  assert.equal(current.stages[4].users, 200);
  assert.equal(current.stages[4].conversionFromPreviousPct, 40);
  assert.equal(current.stages[4].conversionFromStartPct, 2);
  assert.equal(yearAgo.orderSource, 'webshop');
  assert.equal(yearAgo.orderUsers, 100);
});

test('historical WEB SHOP totals never leak into channel or device segments', async () => {
  const { read } = funnelFixture();
  const result = await read(october);
  for (const device of ['all', 'mobile', 'desktop']) {
    for (const channel of ['all', 'organic', 'cpc', 'meta_cpc', 'direct']) {
      if (device === 'all' && channel === 'all') continue;
      const { current, previous, yearAgo } = result.comparisonsByDevice[device][channel];
      for (const period of [current, previous]) {
        assert.equal(period.orderSource, 'unavailable');
        assert.equal(period.orderUsers, null);
        assert.equal(period.stages[4].users, null);
        assert.equal(period.stages[4].conversionFromPreviousPct, null);
        assert.equal(period.conversionRatePct, null);
        assert.equal(period.startUsers, 10000);
        assert.match(period.ordersNote, /каналами та пристроями/);
      }
      assert.equal(yearAgo.orderSource, 'unavailable');
      assert.equal(yearAgo.orderUsers, null);
    }
  }
});

test('page or source/campaign filters do not show unfiltered historical orders', async () => {
  for (const filters of [{ url: 'https://www.agromat.ua/sale/' }, { utmSource: 'google' }, { utmCampaign: 'sale' }]) {
    const { read, orderCalls } = funnelFixture();
    const result = await read({ ...october, ...filters });
    assert.equal(orderCalls.length, 0);
    assert.equal(result.comparisons.all.current.orderUsers, null);
    assert.equal(result.comparisons.all.previous.orderSource, 'unavailable');
    assert.equal(result.comparisons.all.current.stages[0].users, 10000);
    assert.match(result.comparisons.all.current.ordersNote, /без фільтрів/);
  }
});

test('WEB SHOP failure leaves GA4 traffic visible without reverting to unreliable GA4 orders', async () => {
  const { read } = funnelFixture({ orders: async ({ from }) => {
    if (from === '2026-10-01') throw new Error('upstream unavailable');
    return 100;
  } });
  const result = await read(october);
  assert.equal(result.comparisons.all.current.orderSource, 'unavailable');
  assert.equal(result.comparisons.all.current.orderUsers, null);
  assert.equal(result.comparisons.all.current.startUsers, 10000);
  assert.equal(result.comparisons.all.previous.orderUsers, 100);
  assert.match(result.comparisons.all.current.ordersNote, /Не вдалося/);
});

test('a real zero WEB SHOP count stays zero and orders survive absent GA4 traffic', async () => {
  const zero = await funnelFixture({ orders: async () => 0 }).read(october);
  assert.equal(zero.comparisons.all.current.orderUsers, 0);
  assert.equal(zero.comparisons.all.current.conversionRatePct, 0);
  assert.equal(zero.comparisons.all.current.orderSource, 'webshop');
  const emptyTraffic = await funnelFixture({ rows: [] }).read(october);
  assert.equal(emptyTraffic.comparisons.all.current.available, false);
  assert.equal(emptyTraffic.comparisons.all.current.orderUsers, 200);
  assert.equal(emptyTraffic.comparisons.all.current.conversionRatePct, null);
});

test('only configured historical calendar months change, including when used as previous month', async () => {
  for (const input of [
    { anchor: '2026-08-01' },
    { anchor: '2026-10-05', periodKind: 'week' },
    { periodKind: 'custom', dateFrom: '2026-09-01', dateTo: '2026-10-31' },
  ]) {
    const { read, orderCalls } = funnelFixture();
    const result = await read({ ...october, ...input });
    assert.equal(orderCalls.length, 0);
    assert.equal(result.comparisons.all.current.orderSource, 'ga4');
    assert.equal(result.comparisons.all.current.orderUsers, 5);
  }
  const { read, orderCalls } = funnelFixture();
  const result = await read({ ...october, anchor: '2026-11-01' });
  assert.deepEqual(orderCalls.map(r => r.from), ['2026-10-01']);
  assert.equal(result.comparisons.all.current.orderSource, 'ga4');
  assert.equal(result.comparisons.all.previous.orderSource, 'webshop');
});


test('weeks 43–44 use site orders from WEB SHOP, including November 1', async () => {
  const { read, orderCalls } = funnelFixture({ orders: async ({ from }) => from === '2026-10-26' ? 270 : 250 });
  const result = await read({ ...october, periodKind: 'week', anchor: '2026-10-26' });
  assert.deepEqual(orderCalls.map(r => [r.from, r.to]), [['2026-10-26', '2026-11-01'], ['2026-10-19', '2026-10-25']]);
  const { current, previous, yearAgo } = result.comparisons.all;
  assert.equal(current.orderSource, 'webshop');
  assert.equal(current.orderUsers, 270);
  assert.equal(previous.orderUsers, 250);
  assert.equal(current.conversionRatePct, 2.7);
  assert.equal(current.stages[4].conversionFromPreviousPct, 54);
  assert.equal(yearAgo.orderSource, 'ga4');
  assert.equal(result.comparisons.organic.current.orderUsers, null);
  assert.equal(result.comparisonsByDevice.mobile.all.previous.orderUsers, null);
  const next = await read({ ...october, periodKind: 'week', anchor: '2026-11-02' });
  assert.equal(next.comparisons.all.current.orderSource, 'ga4');
  assert.equal(next.comparisons.all.previous.orderSource, 'webshop');
});

test('month comparison independently selects October 2025 and October 2026', async () => {
  const { read } = funnelFixture();
  const result = await read({ ...october, comparisonMonth: '2025-10-01' });
  const { previous, current } = result.comparisons.all;
  assert.equal(previous.from, '2025-10-01');
  assert.equal(previous.to, '2025-10-31');
  assert.equal(current.from, '2026-10-01');
  assert.equal(current.to, '2026-10-31');
  assert.equal(result.navigation.previousAnchor, '2026-09-01');
});

test('selected comparison months use separate cache keys and actual month boundaries', async () => {
  const keys = [];
  const load = sourceLoader({ mocks: {
    '@/lib/webshop-funnel-orders': { readWebshopFunnelOrders: async () => 1 },
    '@google-cloud/bigquery': { BigQuery: class { async query() { return [[]]; } } },
    '@/lib/bigquery-result-cache': {
      bigQueryCacheDay: () => '2026-11-01',
      readThroughBigQueryCache: async options => { keys.push(options.key); return options.load(); },
    },
  } });
  const read = load('@/lib/promotion-web-funnel').readPromotionWebFunnel;
  const first = await read({ ...october, comparisonMonth: '2024-02-01' });
  await read({ ...october, comparisonMonth: '2025-02-01' });
  assert.equal(first.comparisons.all.previous.to, '2024-02-29');
  assert.notEqual(keys[0], keys[1]);
  await assert.rejects(read({ ...october, comparisonMonth: '2099-01-01' }), /завершені місяці/);
});

test('October 2025 vs 2026 uses Webshop orders in both final stages and recalculates all order conversions', async () => {
  const { read } = funnelFixture({ orders: async ({ from }) => from === '2025-10-01' ? 800 : 1093 });
  const result = await read({ ...october, comparisonMonth: '2025-10-01' });
  const { previous, current, yearAgo } = result.comparisons.all;
  for (const [period, count] of [[previous, 800], [current, 1093], [yearAgo, 800]]) {
    assert.equal(period.orderSource, 'webshop');
    assert.equal(period.orderUsers, count);
    assert.equal(period.stages.at(-1).users, count);
    assert.equal(period.conversionRatePct, count / period.startUsers * 100);
    assert.equal(period.stages.at(-1).conversionFromStartPct, count / period.startUsers * 100);
    assert.equal(period.stages.at(-1).conversionFromPreviousPct, count / 500 * 100);
  }
});
