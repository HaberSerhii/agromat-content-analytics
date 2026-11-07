import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";

const period = { from: "2026-10-01", to: "2026-10-31" };
const order = (id, extra = {}) => ({ id, date: "2026-10-10T12:00:00Z", ...extra });
const payload = (data, page = 1, total = data.length) => ({
  data, meta: { total, page, per_page: 50, total_pages: Math.ceil(total / 50) },
});
const response = body => ({ ok: true, json: async () => body });
function reader(fetch, mocks = {}, env = {}) {
  return sourceLoader({ globals: {
    fetch, AbortSignal,
    process: { env: { AGROMAT_API_KEY: "test-secret", ...env } },
  }, mocks })("@/lib/webshop-funnel-orders").readWebshopFunnelOrders;
}

test("counts unique site orders of every status using inclusive Kyiv dates", async () => {
  const read = reader(async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/api/v1/orders/");
    assert.equal(parsed.searchParams.get("date_from"), period.from);
    assert.equal(parsed.searchParams.get("date_to"), "2026-11-01");
    assert.equal(parsed.searchParams.get("with_movements"), "false");
    assert.equal(parsed.searchParams.has("status"), false);
    assert.equal(parsed.searchParams.has("synced"), false);
    assert.equal(init.headers["X-API-Key"], "test-secret");
    assert.ok(init.signal);
    return response(payload([
      order(1, { status: "cancelled" }), order("1"),
      order(2, { date: "2026-09-30T21:00:00Z", payment: { status: "unpaid" } }),
      order(3, { date: "2026-10-31T21:59:59Z", origin: { source: "WEBSHOP" } }),
      order(4, { date: "2026-09-30T20:59:59Z" }),
      order(5, { date: "2026-10-31T22:00:00Z" }),
      order(6, { origin: { source: "rozetka" } }),
      order(7, { origin: { source: "other-marketplace" } }),
      order(8, { origin: { source: "site" }, is_synced: false }),
      order(9, { origin: { source: " SITE " }, status: "new" }),
      order(10, { origin: { source: "prom" } }),
    ]));
  });
  assert.equal(await read(period), 5);
});

test("loads every page, deduplicates across pages, and caches only the complete result", async () => {
  const calls = [];
  const read = reader(async url => {
    const page = Number(new URL(url).searchParams.get("page"));
    calls.push(page);
    return response(payload(page === 1 ? Array.from({ length: 50 }, (_, i) => order(i + 1)) : [order("50"), order(51)], page, 52));
  });
  assert.equal(await read(period), 51);
  assert.equal(await read(period), 51);
  assert.deepEqual(calls, [1, 2]);
});

test("cache includes period/base URL and uses the shared 15-minute refresh interval", async () => {
  let cacheOptions;
  const read = reader(async () => response(payload([])), {
    "@/lib/server-result-cache": { getServerResult: async options => {
      cacheOptions = options;
      return { value: await options.load() };
    } },
  }, { AGROMAT_API_BASE_URL: "https://example.test/api///" });
  assert.equal(await read(period), 0);
  assert.deepEqual(JSON.parse(cacheOptions.key), ["https://example.test/api", period.from, period.to]);
  assert.equal(cacheOptions.ttlMs, 15 * 60_000);
  assert.equal(cacheOptions.key.includes("test-secret"), false);
});

test("rejects errors and incomplete pages without returning a partial count", async () => {
  for (const body of [
    null,
    { data: [], meta: { total_pages: 1 } },
    payload([order(0)]),
    payload([order(1, { date: "invalid" })]),
    { ...payload([order(1)]), meta: { total: 2, page: 1, per_page: 50, total_pages: 1 } },
  ]) {
    await assert.rejects(reader(async () => response(body))(period), /WEB SHOP/);
  }
  await assert.rejects(reader(async () => ({ ok: false, status: 503 }))(period), /503/);
  await assert.rejects(reader(async () => { throw new Error("timed out"); })(period), /timed out/);
  const read = reader(async url => {
    const page = Number(new URL(url).searchParams.get("page"));
    return response(payload(page === 1 ? Array.from({ length: 50 }, (_, i) => order(i + 1)) : [], page, 51));
  });
  await assert.rejects(read(period), /неповну сторінку/);
});

test("rejects changing pagination, invalid periods, and missing credentials", async () => {
  const read = reader(async url => {
    const page = Number(new URL(url).searchParams.get("page"));
    return response(payload(page === 1 ? Array.from({ length: 50 }, (_, i) => order(i + 1)) : [order(51), order(52)], page, page === 1 ? 51 : 52));
  });
  await assert.rejects(read(period), /змінився/);
  const unused = reader(async () => { assert.fail("invalid requests must not fetch"); });
  await assert.rejects(unused({ from: "2026-02-30", to: "2026-10-31" }), /некоректний період/);
  await assert.rejects(unused({ from: period.to, to: period.from }), /некоректний період/);
  await assert.rejects(reader(async () => {}, {}, { AGROMAT_API_KEY: "" })(period), /AGROMAT_API_KEY/);
});
