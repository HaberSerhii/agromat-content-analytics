import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import os from "node:os";
import { sourceLoader } from "./helpers/load-source.mjs";

test("snapshot reads share inflation, reuse the value, and detect atomic replacement", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agromat-snapshots-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "2026-09-01.json.gz");
  const make = (price) =>
    gzipSync(
      JSON.stringify({ products: [{ id: 1, price }], syncedAt: String(price) }),
    );
  await writeFile(file, make(10));
  const load = sourceLoader({
    globals: {
      process: {
        env: { PRODUCT_SNAPSHOTS_DIR: directory },
        cwd: () => process.cwd(),
      },
    },
  });
  const { readDailySnapshotFromDisk } = load("@/lib/products-daily-snapshots");
  const [first, second] = await Promise.all([
    readDailySnapshotFromDisk("2026-09-01"),
    readDailySnapshotFromDisk("2026-09-01"),
  ]);
  assert.equal(first, second);
  assert.equal(first, await readDailySnapshotFromDisk("2026-09-01"));
  await writeFile(file + ".tmp", make(20));
  await rename(file + ".tmp", file);
  assert.equal(
    (await readDailySnapshotFromDisk("2026-09-01")).products[0].price,
    20,
  );
  await rm(file);
  assert.equal(await readDailySnapshotFromDisk("2026-09-01"), null);
});

test("BigQuery cold callers share disk/loader work and a new module reads the saved result", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agromat-bq-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = {
    globals: {
      process: {
        env: { BIGQUERY_RESULT_CACHE_DIR: directory },
        pid: process.pid,
        cwd: () => process.cwd(),
      },
    },
  };
  const first = sourceLoader(options)("@/lib/bigquery-result-cache");
  let calls = 0;
  const query = {
    namespace: "test",
    key: "day",
    load: async () => {
      calls++;
      return [{ clicks: 42 }];
    },
  };
  const results = await Promise.all(
    Array.from({ length: 5 }, () => first.readThroughBigQueryCache(query)),
  );
  assert.equal(calls, 1);
  assert.equal(results[0], results[4]);
  const restarted = sourceLoader(options)("@/lib/bigquery-result-cache");
  assert.equal(
    (
      await restarted.readThroughBigQueryCache({
        ...query,
        load: () => {
          throw Error("must use disk");
        },
      })
    )[0].clicks,
    42,
  );
});

test("explicit promotion dates reuse the same default disk/memory base", async () => {
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Europe/Kyiv",
  });
  const from = "2026-01-01";
  let reads = 0;
  const payload = {
    fromDate: from,
    toDate: today,
    items: [],
    historicalLinkedPromotions: [],
    generatedAt: today,
  };
  const load = sourceLoader({
    mocks: {
      "@/lib/promotions-daily-snapshots": {
        listPromotionsSnapshotDates: () => [from],
      },
      "@/lib/products-store": {},
      "@/lib/products-api": {},
      "@/lib/products-disk-cache": {},
      "@/lib/promotions-store": {},
      "@/lib/promotions-catalog-disk-cache": {
        readPromotionsCatalogDiskCache: async () => {
          reads++;
          return JSON.stringify(payload);
        },
      },
    },
  });
  const { GET } = load("@/app/api/promotions/catalog/route");
  const first = await GET(
    new Request("http://localhost/api/promotions/catalog?view=history"),
  );
  assert.equal(first.status, 200);
  const second = await GET(
    new Request(
      `http://localhost/api/promotions/catalog?view=history&from=${from}&to=${today}`,
    ),
  );
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("X-Agromat-Cache"), "hit");
  assert.equal(reads, 1);
});

test("batched sales parsing preserves every row and gives the event loop a turn", async () => {
  const load = sourceLoader({
    mocks: {
      "@/lib/products-store": {},
      "@/lib/persistent-result-cache": {},
      "@aws-sdk/client-s3": {},
    },
    append: {
      "@/lib/sales-s3":
        "\nexport {parseSalesRows,parseSalesRowsBatched,buildDataset};",
    },
  });
  const sales = load("@/lib/sales-s3");
  const csv =
    "docs_ref,goods_codes,docs_sum,rows_sums,datecreation,state\n" +
    Array.from(
      { length: 1500 },
      (_, i) => `${i},101,25,25,2026-05-01,Повністю відвантажений`,
    ).join("\n");
  const expected = sales.parseSalesRows(csv, new Map(), new Map());
  let yielded = false;
  setImmediate(() => {
    yielded = true;
  });
  const actual = await sales.parseSalesRowsBatched(csv, new Map(), new Map());
  assert.equal(yielded, true);
  assert.deepEqual(actual, expected);
  assert.deepEqual(
    sales.buildDataset(
      actual,
      {},
      { from: "2026-05-01", to: "2026-05-31" },
      { categoryProducts: false },
    ),
    sales.buildDataset(
      expected,
      {},
      { from: "2026-05-01", to: "2026-05-31" },
      { categoryProducts: false },
    ),
  );
});

test("cards GET/POST share cached JSON, mutations invalidate it, and basic overview skips GA4", async () => {
  let catalogReads = 0,
    analyticsReads = 0;
  const index = new Map();
  const store = {
    readAllLite: async () => {
      catalogReads++;
      return [];
    },
    readLiteSyncedAt: async () => "v1",
    readSyncState: async () => ({ status: "ok" }),
    listSnapshotDates: async () => [],
    readProductAttributeIndex: async () => index,
    readRequiredAttrs: async () => ({}),
  };
  const load = sourceLoader({
    mocks: {
      "@/lib/products-store": store,
      "@/lib/content-reviews-store": {
        listContentProductReviews: async () => [],
      },
      "@/lib/new-product-assignments-store": {
        listAssignedNewProductCodes: async () => new Set(),
      },
      "@/lib/bigquery-result-cache": {
        readThroughBigQueryCache: async () => {
          analyticsReads++;
          return [];
        },
      },
    },
  });
  const route = load("@/app/api/products/dashboard-v2/route");
  const post = (includeAnalytics) =>
    route.POST(
      new Request("http://localhost/api/products/dashboard-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          view: "overview",
          page: 1,
          limit: 15,
          statusId: 5,
          includeAnalytics,
        }),
      }),
    );
  const basic = await post(false);
  assert.equal(basic.status, 200);
  assert.equal(analyticsReads, 0);
  const get = await route.GET(
    new Request(
      "http://localhost/api/products/dashboard-v2?view=overview&page=1&limit=15&statusId=5&analytics=0",
    ),
  );
  assert.equal(get.headers.get("X-Agromat-Cache"), "hit");
  assert.equal(catalogReads, 1);
  assert.deepEqual(await get.json(), await basic.json());
  await post(true);
  assert.equal(analyticsReads, 1);
  load("@/lib/server-result-cache").invalidateServerResults(
    "product-dashboard-json",
  );
  await post(false);
  assert.equal(catalogReads, 3);
});

test("compact attributes replace 200 shard reads and fall back for older installations", async () => {
  const values = new Map([["products:lite:syncedAt", "v1"]]);
  let shardReads = 0;
  const redis = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => values.set(key, value),
    del: async (key) => values.delete(key),
    pipeline: () => {
      const keys = [];
      return {
        get(key) {
          keys.push(key);
          return this;
        },
        async exec() {
          shardReads += keys.length;
          return keys.map((key) => values.get(key) ?? null);
        },
      };
    },
  };
  const load = sourceLoader({
    mocks: {
      "@/lib/redis": { getRedis: () => redis },
      "@/lib/products-disk-cache": {},
    },
  });
  const store = load("@/lib/products-store");
  const product = {
    id: 1,
    attributes: [{ id: 12, name: "Color", values: ["White"] }],
  };
  await store.writeAllFull([product], "v1");
  const index = await store.readProductAttributeIndex();
  assert.equal(index.get(1)[0].name, "Color");
  assert.equal(shardReads, 0);
  await store.writeFull({
    ...product,
    attributes: [{ id: 13, name: "Material", values: ["Stone"] }],
  });
  const [first, second] = await Promise.all([
    store.readProductAttributeIndex(),
    store.readProductAttributeIndex(),
  ]);
  assert.equal(first, second);
  assert.equal(first.get(1)[0].id, 13);
  assert.equal(shardReads, 200);
});
