import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";
const { summarizeReviewPeriodSales } = sourceLoader()("@/lib/review-period-sales");
const base = { docsRef: "d1", number: "101", webshopId: "900", state: "Повністю відвантажено", createdDate: "2026-09-15", shippedDate: "2026-10-02", docsSum: 700, returnSum: 0, goodsCount: 7, returnGoodsCodes: [], returnRowSums: [], items: [{ code: "400817", name: "Плитка", category: "Плитка", qty: 5, revenue: 500 }, { code: "222", name: "Інший товар", category: "Плитка", qty: 2, revenue: 200 }] };
const input = { from: "2026-09-14", to: "2026-11-01", productCodes: [400817] };
test("ERP quantities and receipts agree; unrelated goods, pending/out-of-period sales and duplicates do not count", () => {
 const report = summarizeReviewPeriodSales([base, base, { ...base, docsRef: "pending", state: "Сформовано" }, { ...base, docsRef: "outside", shippedDate: "2026-11-02" }], input);
 assert.equal(report.quantity, 5); assert.equal(report.revenue, 500); assert.equal(report.orders, 1);
 assert.deepEqual(Array.from(report.webshopIds), ["900"]);
});
test("ERP sales without Webshop still count and are explicitly distinguished", () => {
 const report = summarizeReviewPeriodSales([{ ...base, webshopId: "" }], input);
 assert.equal(report.quantity, 5); assert.equal(report.withoutWebshop, 1); assert.equal(report.webshopIds.length, 0);
});
test("returned revenue is attributed only to requested goods", () => {
 const report = summarizeReviewPeriodSales([{ ...base, returnSum: 100, returnGoodsCodes: ["400817"], returnRowSums: [100] }], input);
 assert.equal(report.revenue, 400);
});
test("Webshop drilldown follows ERP IDs outside the sales dates, excludes unlinked orders and paginates exact matches", async () => {
 const calls = [];
 const route = sourceLoader({ globals: {
  process: { env: { AGROMAT_API_KEY: 'test' } },
  fetch: async value => {
   const url = new URL(value); calls.push(url);
   return { ok: true, json: async () => ({ data: [
    { id: 900, date: '2026-08-01', items: [{ code: '400817', name: 'Плитка', quantity: 5, line_total: 500 }], totals: { cost: 500 }, payment: { type: 'cash' } },
    { id: 901, date: '2026-10-01', items: [], totals: { cost: 100 }, payment: { type: 'cash' } },
   ], meta: { total_pages: 1 } }) };
  },
 }, mocks: {
  'next/server': { NextResponse: { json: body => ({ body }) } },
  '@/lib/dashboard-auth': { isDashboardRequest: () => true },
  '@/lib/products-store': { readAllLite: async () => [] },
  '@/lib/sales-s3': {
   readReviewPeriodSales: async () => summarizeReviewPeriodSales([base], input),
   readSalesProductCategoryLookup: async () => new Map(), readSalesWebshopReturnLookup: async () => new Map(), readSalesWebshopManagerLookup: async () => new Map(),
  },
  '@/lib/promotion-price-position': { normalizePromotionPricePosition: () => 'all' },
  '@/lib/liqpay': { readOnlinePayments: async () => ({ availability: 'ready', payments: [] }) },
 } })('@/app/api/sales/webshop-orders/route');
 const result = (await route.GET({ url: 'http://localhost/api/sales/webshop-orders?from=2026-09-14&to=2026-11-01&sales_codes=400817' })).body;
 assert.equal(result.reviewSales.quantity, 5);
 assert.deepEqual(Array.from(result.data, order => order.id), [900]);
 assert.equal(result.reviewSales.found, 1);
 assert.ok(calls.every(url => url.searchParams.get('search') === '900' && !url.searchParams.has('date_from') && !url.searchParams.has('date_to')));
});
