import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sourceLoader } from './helpers/load-source.mjs';

const loadSegments = () => sourceLoader()('@/lib/promotion-sales-segments');

test('promotions use the same six category branches as sales analysis', () => {
  const { promotionSalesSegment } = loadSegments();
  for (const [key, segment] of [
    ['001.001', 'tile'], ['002.006', 'plumbing'], ['003.023.004', 'chemicals'],
    ['007', 'chemicals'], ['004.007', 'furniture'], ['020.002', 'power'],
    ['011.010', 'power'], ['009.002', 'flooring'], ['', null], ['012.011', null],
    ['003.003', null],
  ]) assert.equal(promotionSalesSegment(key), segment, key);
});

function loadDataset(rows) {
  return sourceLoader({
    sources: {
      '@/lib/sales-s3': fs.readFileSync('src/lib/sales-s3.ts', 'utf8')
        .replace('const { rows } = await readCachedSalesRows();\n  const from = normalizeDateFilter(input.from)',
          'const rows = fixtureRows;\n  const from = normalizeDateFilter(input.from)'),
    },
    globals: { fixtureRows: rows },
    mocks: {
      '@/lib/sales-order-origin': {},
      '@/lib/persistent-result-cache': {},
      '@/lib/products-store': {},
    },
  })('@/lib/sales-s3').readPromotionSalesDataset;
}

const item = (code, categoryKey, revenue, qty = 1) => ({
  code: String(code), categoryKey, revenue, qty, name: 'Плитка для ванни',
  category: 'Категорія', brand: 'Бренд', url: '',
});
const items = [item(1, '001', 100, 2), item(2, '002', 200), item(3, '003.023', 300),
  item(4, '004', 400), item(5, '020', 500), item(6, '009', 600),
  item(7, '003.023', 50), item(8, '012', 70), item(9, '001', 1000)];
const base = {
  createdDate: '2025-10-01', shippedDate: '2025-10-02', state: 'Повністю відвантажений',
  docsRef: '1', number: '1', items, docsSum: 3220, returnSum: 50,
  returnGoodsCodes: ['3'], returnRowSums: [50], planGroup: 'Плитка',
};
const promotions = [1, 2].map(idinc => ({ id: idinc, idinc, name: 'Акція',
  startDate: '2025-10-01', endDate: '2025-10-31',
  productCodes: [1, 2, 3, 4, 5, 6, 7, 8], publicUrl: null,
}));

test('daily chart splits mixed promotional orders, ignores returns and counts each order once per segment', async () => {
  const read = loadDataset([base, { ...base, docsRef: '2', number: '2',
    state: 'відвантаження дозволено', shippedDate: null },
    { ...base, createdDate: '2025-10-03', shippedDate: null, state: 'Скасована' }]);
  const result = await read({ from: '2025-10-01', to: '2025-10-03', promotions, publicPromotionGroups: [] });
  for (const date of ['2025-10-01', '2025-10-02']) {
    const day = result.summary.daily.find(day => day.date === date);
    for (const [segment, revenue, qty] of [
      ['tile', 100, 2], ['plumbing', 200, 1], ['chemicals', 350, 2],
      ['furniture', 400, 1], ['power', 500, 1], ['flooring', 600, 1],
    ]) {
      assert.equal(day[segment].revenue, revenue, `${date} ${segment}`);
      assert.equal(day[segment].qty, qty);
      assert.equal(day[segment].docs, 1);
    }
    assert.equal(day.total.revenue, 2220); // Includes the uncategorized promo item; excludes regular goods.
    assert.equal(day.total.docs, 1); // Two overlapping promotions must not double count a sale.
  }
  assert.equal(result.summary.daily[2].power.revenue, 0);
  assert.equal(result.summary.daily[2].power.docs, 0);
  assert.deepEqual(Array.from(result.summary.promotions[0].segments).sort(),
    ['tile', 'plumbing', 'chemicals', 'furniture', 'power', 'flooring'].sort());
});


test('returns never change marketing totals, segment charts or promotion/product/brand breakdowns', async () => {
  const input = { from: '2025-10-01', to: '2025-10-03', promotions, publicPromotionGroups: [] };
  const serialize = result => JSON.parse(JSON.stringify(result));
  for (const state of ['Повністю відвантажений', 'відвантаження дозволено']) {
    const row = { ...base, state, returnSum: 0, returnGoodsCodes: [], returnRowSums: [] };
    const expected = serialize(await loadDataset([row])(input));
    for (const returns of [
      { returnSum: 300, returnGoodsCodes: ['3'], returnRowSums: [300] },
      { returnSum: 3220, returnGoodsCodes: items.map(item => item.code), returnRowSums: items.map(item => item.revenue) },
      { returnSum: 1000, returnGoodsCodes: ['9'], returnRowSums: [1000] },
      { returnSum: 777, returnGoodsCodes: [], returnRowSums: [] },
    ]) {
      const actual = await loadDataset([{ ...row, ...returns }])(input);
      assert.deepEqual(serialize(actual), expected, `${state}: return ${returns.returnSum}`);
    }
    assert.equal(expected.summary.revenue, 2220);
    assert.equal(expected.summary.promotions[0].revenue, 2220);
    assert.equal(expected.summary.products.find(product => product.code === '3').revenue, 300);
  }
});
