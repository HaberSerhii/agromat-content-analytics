import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";

test("Rozetka lookup reads every page, caches IDs, and leaves ERP dates independent", async () => {
  let calls = 0;
  const load = sourceLoader({ globals: {
    AbortSignal,
    process: { env: { AGROMAT_API_KEY: "test" } },
    fetch: async (url) => {
      calls++;
      const params = new URL(url).searchParams;
      assert.equal(params.get("source"), "rozetka");
      assert.equal(params.has("date_from"), false);
      assert.equal(params.has("date_to"), false);
      return { ok: true, json: async () => ({ data: params.get("page") === "1" ? [{ id: 11, origin: { source: "site" } }] : [{ id: 22, origin: { source: "rozetka" } }], meta: { total_pages: 2 } }) };
    },
  } });
  const origins = load("@/lib/sales-order-origin");
  assert.equal(origins.normalizeSalesChannel("rozetka"), "rozetka");
  assert.equal(origins.normalizeSalesChannel("monomarket"), "monomarket");
  assert.equal(origins.normalizeSalesChannel("unknown"), "all");
  const ids = await origins.readRozetkaOrderIds();
  assert.deepEqual([...ids], ["22"]);
  await origins.readRozetkaOrderIds();
  assert.equal(calls, 2);
  const rows = [{ webshopId: "11" }, { webshopId: "22" }, { webshopId: "" }];
  assert.deepEqual(origins.filterRozetkaSalesRows(rows, ids), [rows[1]]);
});

test("Rozetka ERP summaries retain shipment, status and period rules", async () => {
  const load = sourceLoader({ mocks: {
    "@/lib/products-store": {}, "@/lib/persistent-result-cache": {}, "@aws-sdk/client-s3": {},
    "@/lib/sales-order-origin": {
      normalizeSalesChannel: value => value === "rozetka" || value === "monomarket" ? value : "all",
      readRozetkaOrderIds: async () => new Set(["22", "33"]),
      filterRozetkaSalesRows: (rows, ids) => rows.filter(row => ids.has(row.webshopId)),
    },
  }, append: { "@/lib/sales-s3": "\nexport { parseSalesRows, buildDataset, scopeRowsToChannel, buildDimensionProducts };" } });
  const sales = load("@/lib/sales-s3");
  const rows = sales.parseSalesRows(
    "docs_ref,number,goods_codes,docs_sum,rows_sums,datecreation,fullyshipped_datetime,state,webshop_id\n" +
    "site,1,101,100,100,2026-10-01,2026-10-02,Повністю відвантажений,11\n" +
    "rozetka,2,102,474,474,2026-10-01,2026-10-02,Повністю відвантажений,22\n" +
    "pending,3,103,200,200,2026-10-01,,В обробці,33",
    new Map(), new Map(),
  );
  const filter = { from: "2026-10-01", to: "2026-10-08", channel: "rozetka" };
  const scoped = await sales.scopeRowsToChannel(rows, filter);
  const dataset = sales.buildDataset(scoped, {}, filter, { categoryProducts: false });
  assert.equal(dataset.filter.channel, "rozetka");
  assert.equal(dataset.summary.shippedRevenue, 474);
  assert.equal(dataset.summary.shippedDocs, 1);
  assert.equal(dataset.summary.states.reduce((sum, row) => sum + row.docs, 0), 2);
  const previous = sales.buildDataset(scoped, {}, { ...filter, from: "2025-10-01", to: "2025-10-08" }, { categoryProducts: false });
  assert.equal(previous.summary.shippedRevenue, 0);
  const products = sales.buildDimensionProducts(scoped, "brand", "Без бренда", filter);
  assert.equal(products.length, 1);
  assert.equal(products[0].code, "102");
});

test("upstream failure fails Rozetka analytics instead of showing all-channel totals", async () => {
  const origins = sourceLoader({ globals: {
    AbortSignal, process: { env: { AGROMAT_API_KEY: "test" } },
    fetch: async () => ({ ok: false, status: 503 }),
  } })("@/lib/sales-order-origin");
  await assert.rejects(origins.readRozetkaOrderIds(), /503/);
});
