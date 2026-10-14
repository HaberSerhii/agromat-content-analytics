import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";

function route({ authorized = true, pages = [], catalog = [], fetchPage, readCatalog } = {}) {
  const calls = [];
  const routeModule = sourceLoader({ globals: {
    process: { env: { AGROMAT_API_KEY: "test" } }, AbortSignal,
    fetch: async url => {
      calls.push(url);
      if (fetchPage) return fetchPage(url);
      const page = Number(new URL(url).searchParams.get("page"));
      return { ok: true, json: async () => pages[page - 1] };
    },
  }, mocks: {
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    "@/lib/dashboard-auth": { isDashboardRequest: () => authorized },
    "@/lib/products-store": { readAllLite: readCatalog || (async () => catalog) },
  } })("@/app/api/sales/carts/route");
  return { get: query => routeModule.GET({ url: `http://localhost/api/sales/carts?${query}`, signal: new AbortController().signal }), calls };
}
const cart = (id, created_at, sku = "123") => ({ id, created_at, currency: "UAH", items: [{ type: "product", id: 99, sku }] });

test("cart contacts cannot be retrieved without dashboard authentication", async () => {
  const api = route({ authorized: false });
  assert.equal((await api.get("")).status, 401);
  assert.equal(api.calls.length, 0);
});
test("cart cohorts include the Kyiv final day and load all upstream pages", async () => {
  const api = route({ pages: [
    { data: [cart(1, "2026-10-06T22:00:00Z")], meta: { total_pages: 2 } },
    { data: [cart(2, "2026-10-07T20:59:59Z"), cart(3, "2026-10-07T21:00:00Z")], meta: { total_pages: 2 } },
  ], catalog: [{ id: 99, code: 123, url: "/test-product" }] });
  const result = await api.get("from=2026-10-07&to=2026-10-07");
  assert.equal(result.status, 200);
  assert.deepEqual(Array.from(result.body.data, row => row.id), [1, 2]);
  assert.equal(api.calls.length, 2);
  const detail = await api.get("cart_id=1");
  assert.equal(detail.body.data.items[0].url, "https://www.agromat.ua/test-product");
  assert.equal(api.calls.length, 2);
});
test("invalid periods do not call upstream and oversized datasets are not shown as complete", async () => {
  const api = route({ pages: [{ data: [], meta: { total_pages: 101 } }] });
  assert.equal((await api.get("from=2026-10-08&to=2026-10-07")).status, 400);
  assert.equal(api.calls.length, 0);
  assert.equal((await api.get("")).status, 502);
});
test("untrusted product URLs cannot become dashboard links", async () => {
  const api = route({ pages: [{ data: [cart(1, "2026-10-07T10:00:00Z")], meta: { total_pages: 1 } }], catalog: [{ id: 99, code: 123, url: "https://unrelated.example/product" }] });
  const result = await api.get("cart_id=1");
  assert.equal(result.body.data.items[0].url, null);
});


test("list does not wait for the catalog or product URL searches", async () => {
  let catalogReads = 0;
  const api = route({ pages: [{ data: [cart(1, "2026-10-07T10:00:00Z")], meta: { total_pages: 1 } }],
    readCatalog: async () => { catalogReads++; return []; },
  });
  assert.equal((await api.get("")).status, 200);
  assert.equal(api.calls.length, 1);
  assert.equal(catalogReads, 0);
});

test("cold load fetches remaining pages concurrently with a limit of four", async () => {
  let active = 0, peak = 0;
  const api = route({ fetchPage: async url => {
    const page = Number(new URL(url).searchParams.get("page"));
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return { ok: true, json: async () => ({ data: [cart(page, "2026-10-07T10:00:00Z")], meta: { total_pages: 10 } }) };
  } });
  const result = await api.get("");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.length, 10);
  assert.equal(api.calls.length, 10);
  assert.equal(peak, 4);
});

test("period changes reuse the snapshot and explicit refresh fetches fresh carts", async () => {
  const api = route({ pages: [{ data: [cart(1, "2026-10-07T10:00:00Z")], meta: { total_pages: 1 } }] });
  const first = await api.get("from=2026-10-07&to=2026-10-07");
  assert.equal((await api.get("from=2026-10-08&to=2026-10-08")).body.data.length, 0);
  assert.equal(api.calls.length, 1);
  assert.equal((await api.get("")).body.fetched_at, first.body.fetched_at);
  assert.equal((await api.get("refresh=1")).status, 200);
  assert.equal(api.calls.length, 2);
});

test("simultaneous requests share a load and failed snapshots are retried", async () => {
  let fail = true;
  const api = route({ fetchPage: async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    return { ok: !fail, status: 503, json: async () => ({ data: [], meta: { total_pages: 1 } }) };
  } });
  const responses = await Promise.all([api.get(""), api.get("")]);
  assert.deepEqual(responses.map(response => response.status), [502, 502]);
  assert.equal(api.calls.length, 1);
  fail = false;
  assert.equal((await api.get("")).status, 200);
  assert.equal(api.calls.length, 2);
});

test("lazy links are cached, sanitized, and do not mutate the cart snapshot", async () => {
  const api = route({ fetchPage: async url => ({ ok: true, json: async () => new URL(url).pathname.endsWith("/products/")
    ? { data: [{ sku: "123", code: 123, url: "/product" }] }
    : { data: [cart(1, "2026-10-07T10:00:00Z")], meta: { total_pages: 1 } } }),
  });
  assert.equal((await api.get("cart_id=1")).body.data.items[0].url, "https://www.agromat.ua/product");
  assert.equal((await api.get("cart_id=1")).status, 200);
  assert.equal(api.calls.length, 2);
  assert.equal((await api.get("")).body.data[0].items[0].url, null);
  assert.equal((await api.get("cart_id=missing")).status, 400);
  assert.equal((await api.get("cart_id=999")).status, 404);
});

test("growing pagination does not skip pages in a partial batch", async () => {
  const api = route({ fetchPage: async url => {
    const page = Number(new URL(url).searchParams.get("page"));
    return { ok: true, json: async () => ({ data: [cart(page, "2026-10-07T10:00:00Z")], meta: { total_pages: page === 1 ? 2 : 5 } }) };
  } });
  const result = await api.get("");
  assert.deepEqual(Array.from(result.body.data, row => row.id), [1, 2, 3, 4, 5]);
});


test("product search failure does not prevent opening cart details", async () => {
  const api = route({ fetchPage: async url => new URL(url).pathname.endsWith("/products/")
    ? { ok: false, status: 503 }
    : { ok: true, json: async () => ({ data: [cart(1, "2026-10-07T10:00:00Z")], meta: { total_pages: 1 } }) },
  });
  const response = await api.get("cart_id=1");
  assert.equal(response.status, 200);
  assert.equal(response.body.data.items[0].url, null);
});

test("unauthenticated cart details cannot read the snapshot", async () => {
  const api = route({ authorized: false });
  assert.equal((await api.get("cart_id=1")).status, 401);
  assert.equal(api.calls.length, 0);
});
