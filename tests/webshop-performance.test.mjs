import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";

test("LiqPay reuses the archive after a minute and serves stale data during refresh", async () => {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  let calls = 0;
  let release;
  const reader = sourceLoader({ globals: {
    Date: Clock, AbortSignal,
    process: { env: { LIQPAY_PUBLIC_KEY: "test", LIQPAY_PRIVATE_KEY: "secret" } },
    fetch: async () => {
      calls++;
      if (calls === 2) await new Promise(resolve => { release = resolve; });
      return { ok: true, json: async () => ({ result: "ok", data: [] }) };
    },
  } })("@/lib/liqpay");
  await reader.readOnlinePayments("2026-10-01", "2026-10-06");
  now += 61_000;
  await reader.readOnlinePayments("2026-10-01", "2026-10-06");
  assert.equal(calls, 1);
  now += 15 * 60_000;
  const stale = await reader.readOnlinePayments("2026-10-01", "2026-10-06");
  assert.equal(stale.availability, "ready");
  assert.equal(calls, 2);
  await reader.readOnlinePayments("2026-10-01", "2026-10-06");
  assert.equal(calls, 2, "concurrent refreshes share one request");
  release();
});

test("orders and payments start concurrently; sync and payment filters reuse upstream orders", async () => {
  let calls = 0;
  let releasePayments;
  let startedPayments = false;
  const orders = [true, false].map((is_synced, index) => ({
    id: index + 1, date: "2026-10-02T12:00:00", is_synced,
    totals: { cost: 100 }, payment: { type: index ? "cash" : "online" },
    items: [], status: "В обробці",
  }));
  const route = sourceLoader({ globals: {
    process: { env: { AGROMAT_API_KEY: "test" } },
    fetch: async (url) => {
      calls++;
      assert.equal(new URL(url).searchParams.has("synced"), false);
      await Promise.resolve();
      assert.equal(startedPayments, true);
      return { ok: true, json: async () => ({ data: orders, meta: { total_pages: 1 } }) };
    },
  }, mocks: {
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    "@/lib/products-store": { readAllLite: async () => [] },
    "@/lib/sales-s3": { readSalesProductCategoryLookup: async () => new Map(), readSalesWebshopReturnLookup: async () => new Map(), readSalesWebshopManagerLookup: async () => new Map() },
    "@/lib/promotion-price-position": { normalizePromotionPricePosition: () => "all" },
    "@/lib/liqpay": { readOnlinePayments: async () => {
      startedPayments = true;
      if (!releasePayments) await new Promise(resolve => { releasePayments = resolve; });
      return { availability: "ready", payments: [] };
    } },
  } })("@/app/api/sales/webshop-orders/route");
  const base = "http://localhost/api/sales/webshop-orders?from=2026-10-01&to=2026-10-06";
  const pending = route.GET({ url: base });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  releasePayments();
  assert.equal((await pending).body.meta.total, 2);
  assert.equal((await route.GET({ url: base + "&synced=true" })).body.meta.total, 1);
  assert.equal((await route.GET({ url: base + "&synced=false&payment=cash" })).body.data[0].id, 2);
  assert.equal(calls, 2, "one base request and one shared background P2 request");
});


test("slow P2 never blocks the registry; completed P2 updates status filters", async () => {
  let releaseP2;
  let baseCalls = 0, p2Calls = 0;
  const order = { id: 1, date: "2026-10-02T12:00:00", totals: { cost: 100 }, items: [], status: "В обробці", payment: { type: "cash" } };
  const route = sourceLoader({ globals: {
    process: { env: { AGROMAT_API_KEY: "test" } },
    fetch: async url => {
      const p2 = new URL(url).searchParams.get("with_movements") === "true";
      if (p2) { p2Calls++; await new Promise(resolve => { releaseP2 = resolve; }); } else baseCalls++;
      return { ok: true, json: async () => ({ data: [{ ...order, ...(p2 ? { fulfillment: { current: { name: "Отримано" }, history: [] } } : {}) }], meta: { total_pages: 1 } }) };
    },
  }, mocks: {
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    "@/lib/products-store": { readAllLite: async () => [] },
    "@/lib/sales-s3": { readSalesProductCategoryLookup: async () => new Map(), readSalesWebshopReturnLookup: async () => new Map(), readSalesWebshopManagerLookup: async () => new Map() },
    "@/lib/promotion-price-position": { normalizePromotionPricePosition: () => "all" },
    "@/lib/liqpay": { readOnlinePayments: async () => ({ availability: "ready", payments: [] }) },
  } })("@/app/api/sales/webshop-orders/route");
  const url = "http://localhost/api/sales/webshop-orders?from=2026-10-01&to=2026-10-06";
  const first = await route.GET({ url });
  assert.equal(first.body.meta.movements_included, false);
  assert.equal(first.body.meta.total, 1);
  await route.GET({ url });
  assert.equal(baseCalls, 1); assert.equal(p2Calls, 1);
  releaseP2(); await new Promise(resolve => setImmediate(resolve));
  const enriched = await route.GET({ url: url + "&order_status=" + encodeURIComponent("Отримано") });
  assert.equal(enriched.body.meta.movements_included, true);
  assert.equal(enriched.body.meta.total, 1);
  assert.equal(baseCalls, 1); assert.equal(p2Calls, 1);
});

test("base order pagination uses 200 rows while P2 keeps its 50-row contract", async () => {
  const calls = [];
  const reader = sourceLoader({ globals: {
    process: { env: { AGROMAT_API_KEY: "test" } },
    fetch: async url => {
      const params = new URL(url).searchParams;
      const page = Number(params.get("page")), size = Number(params.get("per_page"));
      calls.push({ size, movements: params.get("with_movements") });
      return { ok: true, json: async () => ({ data: Array.from({ length: Math.min(size, 300 - (page - 1) * size) }, (_, index) => ({ id: (page - 1) * size + index + 1, date: "2026-10-02T12:00:00Z" })), meta: { total_pages: Math.ceil(300 / size) } }) };
    },
  } })("@/lib/webshop-orders-api");
  assert.equal((await reader.fetchCompleteOrders("2026-10-01", "2026-10-03", null)).length, 300);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.size === 200 && call.movements === "false"));
  calls.length = 0;
  assert.equal((await reader.fetchCompleteOrders("2026-10-01", "2026-10-03", null, true)).length, 300);
  assert.equal(calls.length, 6);
  assert.ok(calls.every(call => call.size === 50 && call.movements === "true"));
});
