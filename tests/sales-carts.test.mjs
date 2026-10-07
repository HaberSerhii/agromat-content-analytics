import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";

function route({ authorized = true, pages = [], catalog = [] } = {}) {
  const calls = [];
  const module = sourceLoader({ globals: {
    process: { env: { AGROMAT_API_KEY: "test" } }, AbortSignal,
    fetch: async url => {
      calls.push(url);
      const page = Number(new URL(url).searchParams.get("page"));
      return { ok: true, json: async () => pages[page - 1] };
    },
  }, mocks: {
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    "@/lib/dashboard-auth": { isDashboardRequest: () => authorized },
    "@/lib/products-store": { readAllLite: async () => catalog },
  } })("@/app/api/sales/carts/route");
  return { get: query => module.GET({ url: `http://localhost/api/sales/carts?${query}`, signal: new AbortController().signal }), calls };
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
  assert.equal(result.body.data[0].items[0].url, "https://www.agromat.ua/test-product");
});
test("invalid periods do not call upstream and oversized datasets are not shown as complete", async () => {
  const api = route({ pages: [{ data: [], meta: { total_pages: 101 } }] });
  assert.equal((await api.get("from=2026-10-08&to=2026-10-07")).status, 400);
  assert.equal(api.calls.length, 0);
  assert.equal((await api.get("")).status, 502);
});
test("untrusted product URLs cannot become dashboard links", async () => {
  const api = route({ pages: [{ data: [cart(1, "2026-10-07T10:00:00Z")], meta: { total_pages: 1 } }], catalog: [{ id: 99, code: 123, url: "https://unrelated.example/product" }] });
  const result = await api.get("");
  assert.equal(result.body.data[0].items[0].url, null);
});
