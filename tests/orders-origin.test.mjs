import test from "node:test";
import assert from "node:assert/strict";
import { orderOriginSource, matchesOrderOrigin, summarizeOrderOrigins } from "../src/lib/orders-origin.ts";
import { sourceLoader } from "./helpers/load-source.mjs";

test("origin distinguishes Rozetka from UTM and preserves legacy webshop orders", () => {
  assert.equal(orderOriginSource({ origin: { source: " Rozetka " } }), "rozetka");
  assert.equal(orderOriginSource({ source: { utm_source: "rozetka" } }), "webshop");
  assert.equal(matchesOrderOrigin({ origin: null }, "webshop"), true);
  assert.equal(matchesOrderOrigin({ origin: { source: "rozetka" } }, "webshop"), false);
  assert.deepEqual(summarizeOrderOrigins([
    { origin: { source: "rozetka" }, totals: { cost: 200 } },
    { origin: { source: "rozetka" }, totals: { cost: 400 } },
    { totals: { cost: 100 } },
  ]), [
    { key: "rozetka", label: "Rozetka", docs: 2, revenue: 600, averageOrder: 300 },
    { key: "webshop", label: "Вебшоп AGROMAT", docs: 1, revenue: 100, averageOrder: 100 },
  ]);
});

test("Rozetka filter covers all upstream pages and updates totals, daily series and statuses", async () => {
  let calls = 0;
  const order = (id, cost, origin) => ({ id, date: "2026-10-02T12:00:00", origin, totals: { cost }, items: [], is_synced: true, status: "В обробці", payment: { type: "cash" } });
  const route = sourceLoader({ globals: {
    process: { env: { AGROMAT_API_KEY: "test" } },
    fetch: async (url) => {
      calls++;
      const page = new URL(url).searchParams.get("page");
      return { ok: true, json: async () => ({ data: page === "1" ? [order(1, 100), order(2, 200, { source: "rozetka", external_order_id: "907440691" })] : [order(3, 400, { source: "rozetka" })], meta: { total_pages: 2 } }) };
    },
  }, mocks: {
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    "@/lib/sales-s3": { readSalesWebshopReturnLookup: async () => new Map(), readSalesWebshopManagerLookup: async () => new Map() },
    "@/lib/promotion-price-position": { normalizePromotionPricePosition: () => "all" },
    "@/lib/liqpay": { readOnlinePayments: async () => ({ availability: "ready", payments: [] }) },
  } })("@/app/api/sales/webshop-orders/route");
  const base = "http://localhost/api/sales/webshop-orders?from=2026-10-01&to=2026-10-06";
  const { body, status } = await route.GET({ url: base + "&origin_source=rozetka" });
  assert.equal(status, 200);
  assert.equal(body.meta.total, 2);
  assert.equal(body.summary.revenue, 600);
  assert.equal(body.summary.averageOrder, 300);
  assert.equal(body.summary.statusesTotal, 2);
  assert.equal(body.daily.reduce((sum, day) => sum + day.transactions, 0), 2);
  assert.equal(body.daily.reduce((sum, day) => sum + day.revenue, 0), 600);
  assert.equal(body.data[0].origin.external_order_id, "907440691");
  assert.equal(body.origins.length, 2);
  assert.equal((await route.GET({ url: base + "&origin_source=webshop" })).body.summary.revenue, 100);
  assert.equal((await route.GET({ url: base })).body.meta.total, 3);
  assert.equal(calls, 4, "channel switches reuse base and background P2 datasets");
});
