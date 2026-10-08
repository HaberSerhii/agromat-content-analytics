import test from "node:test";
import assert from "node:assert/strict";
import { marketingDailySeries } from "../src/lib/marketing-daily-series.ts";

test("daily marketing metrics include empty days, Kyiv midnight and correct AOV", () => {
 const days = marketingDailySeries([
  {date: "2026-09-30T22:00:00Z", totals: {cost: 100}},
  {date: "2026-10-01T12:00:00Z", totals: {cost: 300}},
  {date: "2026-10-03T12:00:00Z", totals: {cost: 900}},
  {date: "2026-10-04T12:00:00Z", totals: {cost: 999}},
 ], "2026-10-01", "2026-10-03");
 assert.deepEqual(days, [
  {date: "2026-10-01", transactions: 2, revenue: 400, aov: 200},
  {date: "2026-10-02", transactions: 0, revenue: 0, aov: 0},
  {date: "2026-10-03", transactions: 1, revenue: 900, aov: 900},
 ]);
});

test("daily series counts all orders beyond a 50 order registry page", () => {
 const orders = Array.from({length: 120}, () => ({date: "2026-10-01T12:00:00Z", totals: {cost: 20}}));
 assert.equal(marketingDailySeries(orders, "2026-10-01", "2026-10-01")[0].transactions, 120);
 assert.equal(marketingDailySeries(orders, "2026-10-01", "2026-10-01")[0].revenue, 2400);
 assert.deepEqual(marketingDailySeries([], "invalid", "2026-10-01"), []);
});

test("orders API daily series follows campaign filtering and is independent of registry pagination", async () => {
 const {sourceLoader} = await import("./helpers/load-source.mjs");
 const orders = Array.from({length: 65}, (_, i) => ({id: i+1, date: "2026-10-02T12:00:00Z", totals: {cost: 100},
  source: {utm_source: "google", utm_campaign: i < 60 ? "brand" : "other"}, items: [], payment: null, status: "В обробці"}));
 const route = sourceLoader({globals: {
  process: {env: {AGROMAT_API_KEY: "test"}},
  fetch: async url => {const page = Number(new URL(url).searchParams.get("page")); return {ok: true, json: async () => ({data: orders.slice((page-1)*50, page*50), meta: {total_pages: 2}})};},
 }, mocks: {
  "next/server": {NextResponse: {json: body => ({body})}},
  "@/lib/server-result-cache": {getServerResult: async ({load}) => ({value: await load()})},
  "@/lib/sales-s3": {readSalesWebshopReturnLookup: async () => new Map(), readSalesWebshopManagerLookup: async () => new Map()},
  "@/lib/promotion-price-position": {normalizePromotionPricePosition: () => "all"},
  "@/lib/liqpay": {readOnlinePayments: async () => ({availability: "ready", payments: []})},
 }})("@/app/api/sales/webshop-orders/route");
 const result = await route.GET({url: "http://localhost/api/sales/webshop-orders?from=2026-10-01&to=2026-10-03&utm_campaign=value:brand&page=2"});
 assert.equal(result.body.data.length, 10);
 assert.equal(result.body.daily[1].transactions, 60);
 assert.equal(result.body.daily[1].revenue, 6000);
 assert.equal(result.body.daily[1].aov, 100);
 assert.equal(result.body.daily.reduce((sum, day) => sum + day.transactions, 0), result.body.summary.total);
});
