import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";

test("received monthly endpoint reads two contiguous periods, skips product detail and pairs partial months", async () => {
  const calls = [], summaries = [];
  const api = sourceLoader({ mocks: {
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    "@/lib/sales-s3": { readSalesProductDimensionLookup: async () => new Map() },
    "@/lib/webshop-orders-api": { readBaseOrders: async (from, to) => {
      calls.push([from, to]);
      return { value: [{ id: calls.length, date: to + "T10:00:00Z" }] };
    } },
    "@/lib/products-store": { readAllLite: async () => [], readLiteSyncedAt: async () => "v1" },
    "@/lib/received-sales": { receivedSales: (orders, products, dimensions, channel, filter) => {
      summaries.push(filter);
      return { brands: { items: orders.map(order => ({ label: "Brand", docs: 1, goods: 2, revenue: order.id })) } };
    } },
    "@/lib/dashboard-report-cache": { readDashboardReport: async (namespace, key, ttl, load) => ({ value: await load(), status: "miss" }) },
    "@/lib/ga4-marketing-report": { validateGa4Dates: (from, to) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("date"); } },
  } })("@/app/api/sales/monthly/route");
  const response = await api.GET({ url: "http://localhost/api/sales/monthly?to=2026-11-07&count=6&compare=1&measure=received&segment=Плитка" });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["2026-06-01", "2026-11-07"], ["2025-06-01", "2025-11-07"]]);
  assert.equal(response.body.length, 6);
  assert.equal(response.body[5].current[0].revenue, 1);
  assert.equal(response.body[5].previous[0].revenue, 2);
  assert.ok(summaries.every(value => value.details === false && value.segment === "Плитка"));
  assert.equal((await api.GET({ url: "http://localhost/api/sales/monthly?to=invalid&count=12" })).status, 400);
});
