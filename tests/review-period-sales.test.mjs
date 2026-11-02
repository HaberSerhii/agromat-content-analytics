import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesOrderSearch } from '../src/lib/orders-search.ts';

const orders = Array.from({ length: 257 }, (_, i) => ({
  id: 39000 + i, customer: { first_name: 'Олена', last_name: 'Коваль', phone: '+380501234567' },
  origin: { source: 'site' }, items: [{ code: 'ABC', name: 'Плитка Київ' }],
}));

test('review sales filters exact product references before pagination and sums only matching goods', async () => {
  const { sourceLoader } = await import('./helpers/load-source.mjs');
  const data = orders.map((order, i) => ({ ...order, date: '2026-10-22T12:00:00+03:00', items: [{ goods_ref: i === 60 ? 21731813 : 217318130, quantity: 2, line_total: 80, name: 'Плитка' }, { goods_ref: 999, quantity: 5, line_total: 200, name: 'Інший товар' }], totals: { cost: 280 }, payment: { type: 'cash' } }));
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
  const found = (await route.GET({ url: base + '&goods_refs=21731813&page=5' })).body;
  assert.deepEqual(Array.from(found.data, order => order.id), [39060]);
  assert.equal(found.meta.total, 1);
  assert.equal(found.meta.page, 1);
  assert.equal(found.productSales.orders, 1);
  assert.equal(found.productSales.quantity, 2);
  assert.equal(found.productSales.revenue, 80);
  const empty = (await route.GET({ url: base + '&goods_refs=123' })).body;
  assert.equal(empty.productSales.orders, 0);
  assert.equal(empty.productSales.quantity, 0);
  const group = (await route.GET({ url: base + '&goods_refs=21731813,999' })).body;
  assert.equal(group.productSales.orders, 257);
  assert.equal(group.productSales.quantity, 257 * 5 + 2);
});
