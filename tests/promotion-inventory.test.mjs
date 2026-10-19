import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './helpers/load-source.mjs';

const product = code => ({ code });
const program = (idinc, codes, extra = {}) => ({ idinc, name: `Акція ${idinc}`, start_date: '2026-10-01', end_date: '2026-10-31',
  is_unlimited: false, active: false, has_related: false, products: codes.map(product), type: null, url: null, ...extra });
const sourceMocks = { '@/lib/products-api': { isBundlePromotion: p => p.type?.name === 'Набори товарів' } };
const { inventoryOnDate, inventoryChanges } = sourceLoader({ mocks: sourceMocks })('@/lib/promotion-inventory');
const plain = value => JSON.parse(JSON.stringify(value));

test('inventory is a date-specific list of pricing programs with unique products, not a month-overlap total', () => {
  const result = inventoryOnDate([
    program(1, [10, 10, 20]), program(2, [20, 30]), program(3, []),
    program(4, [40], { end_date: '2026-10-18' }), program(5, [50], { start_date: '2026-10-20' }),
    program(6, [60], { has_related: true, active: true }), program(7, [70], { type: { name: 'Набори товарів' } }),
    program(8, [80], { is_unlimited: true, end_date: '2026-01-01' }),
  ], '2026-10-19');
  assert.deepEqual(plain(result.productCodes), [10, 20, 30, 80]);
  assert.deepEqual(plain(result.promotions.map(p => p.idinc)), [1, 2, 8]);
  assert.equal(result.promotions[0].productCount, 2);
});

test('daily additions/removals compare sets; moving an SKU between programs does not add/remove it', () => {
  const yesterday = inventoryOnDate([program(1, [10, 20]), program(2, [30])], '2026-10-18');
  const today = inventoryOnDate([program(1, [10, 30]), program(3, [40])], '2026-10-19');
  assert.deepEqual(plain(inventoryChanges(today, yesterday)), { promotions: { added: 1, removed: 1 }, products: { added: 1, removed: 1 } });
  const empty = inventoryOnDate([program(1, [10])], '2026-10-19', new Set());
  assert.equal(empty.promotions.length, 0);
  assert.equal(empty.productCodes.length, 0);
});

function route({ snapshots = {}, live = [program(1, [10,20])], positionCodes = null, segments = new Map(), today = "2026-10-19T12:00:00Z" } = {}) {
  const written = [];
  const reads = [];
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [today])); } }
  const api = sourceLoader({ globals: { Date: FixedDate }, mocks: {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body: plain(body), status: init.status ?? 200 }) } },
    '@/lib/products-api': { ...sourceMocks['@/lib/products-api'], fetchAllPromotions: async () => live },
    '@/lib/server-result-cache': { getServerResult: async ({load}) => ({value: await load(), status: 'miss'}) },
    '@/lib/promotion-price-position': { normalizePromotionPricePosition: v => v || 'all', readPricePositionCodes: async () => positionCodes },
    '@/lib/sales-s3': { readPromotionProductSegments: async () => segments },
    '@/lib/promotions-daily-snapshots': {
      readPromotionsDailySnapshot: date => { reads.push(date); return snapshots[date] ? { date, capturedAt: `${date}T20:00:00Z`, promotions: snapshots[date] } : null; },
      selectPromotionsForDailySnapshot: data => data,
      writePromotionsDailySnapshot: (...args) => written.push(args),
    },
  } })('@/app/api/promotions/inventory/route');
  return { get: async query => api.GET({url: `http://localhost/api/promotions/inventory?${query}`}), reads, written };
}

test('19th and 20th use their own day and the immediately preceding day, never the last two available snapshots', async () => {
  const api = route({ snapshots: { '2026-10-17': [program(9, [99])] } });
  const result = await api.get('date=2026-10-19');
  assert.equal(result.body.date, '2026-10-19');
  assert.equal(result.body.previousDate, '2026-10-18');
  assert.equal(result.body.available, true);
  assert.equal(result.body.changes, null);
  assert.deepEqual(api.reads, ['2026-10-18']);
  assert.equal(api.written[0][0], '2026-10-19');
  const capped = await api.get('date=2026-10-31');
  assert.equal(capped.body.date, '2026-10-19');
  const tomorrow = route({today: '2026-10-20T12:00:00Z', snapshots: {'2026-10-19': [program(1,[10])]}});
  const nextDay = await tomorrow.get('date=2026-10-20');
  assert.equal(nextDay.body.date, '2026-10-20');
  assert.equal(nextDay.body.previousDate, '2026-10-19');
  assert.deepEqual(nextDay.body.changes.products, {added:1,removed:0});
});

test('historical month end and daily difference use exact snapshots; missing history is never reconstructed', async () => {
  const api = route({ snapshots: { '2026-09-29': [program(1,[10], {start_date:null})],
    '2026-09-30': [program(2,[20], {start_date:null})] } });
  const result = await api.get('date=2026-09-30');
  assert.equal(result.body.date, '2026-09-30');
  assert.deepEqual(result.body.productCodes, [20]);
  assert.deepEqual(result.body.changes, {promotions:{added:1,removed:1},products:{added:1,removed:1}});
  assert.equal(api.written.length, 0);
  const missing = await api.get('date=2026-09-28');
  assert.equal(missing.body.available, false);
  assert.equal(missing.body.changes, null);
});

test('category and price filters select the same program/product sets for counts, clicks and changes', async () => {
  const api = route({ snapshots: {'2026-10-18': [program(1,[10,20]),program(2,[30])]},
    live: [program(1,[10,20]),program(3,[40])], positionCodes:new Set([10,20,40]),
    segments:new Map([[10,'tile'],[20,'power'],[40,'power']]) });
  const result = await api.get('date=2026-10-19&segment=power&price_position=lower');
  assert.deepEqual(result.body.productCodes, [20,40]);
  assert.equal(result.body.promotions.length, 2);
  assert.deepEqual(result.body.changes.products, {added:1,removed:0});
  assert.equal((await api.get('date=2026-02-30')).status, 400);
});

test('handoff retains more than 5000 exact codes and treats an empty selection as empty', () => {
  const { normalizePromotionCodes, parsePromotionProductSelection } = sourceLoader()('@/lib/promotion-product-selection');
  const codes = Array.from({length: 6000}, (_, i) => i + 1);
  const selection = parsePromotionProductSelection(JSON.stringify({date:'2026-10-19', label:'Акційні товари', productCodes: codes}));
  assert.equal(selection.productCodes.length, 6000);
  assert.deepEqual(plain(normalizePromotionCodes([])), []);
  assert.equal(normalizePromotionCodes(null), null);
  assert.equal(parsePromotionProductSelection('invalid'), null);
  assert.deepEqual(plain(normalizePromotionCodes([10,10,-1,'20',1.2])), [10]);
});
