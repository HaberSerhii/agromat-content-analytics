import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesOrderSearch } from '../src/lib/orders-search.ts';

const orders = Array.from({ length: 257 }, (_, i) => ({
  id: 39000 + i, customer: { first_name: 'Олена', last_name: 'Коваль', phone: '+380501234567' },
  origin: { source: 'site' }, items: [{ code: 'ABC', name: 'Плитка Київ' }],
}));

test('search finds an order outside the current page before pagination', () => {
  assert.equal(orders.slice(200, 250).some(order => matchesOrderSearch(order, '39060')), false);
  const matches = orders.filter(order => matchesOrderSearch(order, '39060'));
  assert.deepEqual(matches.map(order => order.id), [39060]);
  assert.equal(matches.slice(0, 50).length, 1);
});

test('search preserves supported fields, trims input and ignores case', () => {
  const order = { ...orders[0], order_num: 'DOC123', order_doc_id: 7654, origin: { source: 'rozetka', external_order_id: 'EXT987' }, erp_manager: 'Менеджер', status: 'Виконано' };
  for (const query of ['  ПЛИТКА київ ', 'Коваль Олена', '050123', 'doc123', '7654', 'ext987', 'ROZETKA', 'менеджер', 'виконано', 'abc', ' ']) {
    assert.equal(matchesOrderSearch(order, query), true, query);
  }
  assert.equal(matchesOrderSearch(order, 'відсутній товар'), false);
});

test('registry searches the complete period and paginates the matching results', async () => {
  const { sourceLoader } = await import('./helpers/load-source.mjs');
  const data = orders.map(order => ({ ...order, date: '2026-10-22T12:00:00+03:00', totals: { cost: 100 }, payment: { type: 'cash' } }));
  const route = sourceLoader({ globals: {
    process: { env: { AGROMAT_API_KEY: 'test' } },
    fetch: async url => {
      const page = Number(new URL(url).searchParams.get('page'));
      return { ok: true, json: async () => ({ data: data.slice((page - 1) * 50, page * 50), meta: { total_pages: 6 } }) };
    },
  }, mocks: {
    'next/server': { NextResponse: { json: body => ({ body }) } },
    '@/lib/products-store': { readAllLite: async () => [] },
    '@/lib/sales-s3': { readSalesProductCategoryLookup: async () => new Map(), readSalesWebshopReturnLookup: async () => new Map(), readSalesWebshopManagerLookup: async () => new Map() },
    '@/lib/promotion-price-position': { normalizePromotionPricePosition: () => 'all' },
    '@/lib/liqpay': { readOnlinePayments: async () => ({ availability: 'ready', payments: [] }) },
  } })('@/app/api/sales/webshop-orders/route');
  const base = 'http://localhost/api/sales/webshop-orders?from=2026-10-21&to=2026-10-27';
  const fifth = (await route.GET({ url: base + '&page=5' })).body;
  assert.equal(fifth.data.some(order => order.id === 39060), false);
  const found = (await route.GET({ url: base + '&page=5&search=39060' })).body;
  assert.deepEqual(Array.from(found.data, order => order.id), [39060]);
  assert.equal(found.meta.total, 1);
  assert.equal(found.meta.page, 1);
  assert.equal(found.summary.basedOn, 1);
  const empty = (await route.GET({ url: base + '&search=absent' })).body;
  assert.equal(empty.meta.total, 0);
  const cleared = (await route.GET({ url: base + '&page=2' })).body;
  assert.equal(cleared.meta.total, 257);
  assert.equal(cleared.data.length, 50);
});
