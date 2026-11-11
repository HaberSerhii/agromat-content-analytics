import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";
const load = sourceLoader({
  mocks: {
    "@google-cloud/bigquery": { BigQuery: class {} },
    "@/lib/bigquery-result-cache": { readThroughBigQueryCache: async () => [] },
  },
});
const { shiftOverviewDate, buildOverviewPeriod } = load(
  "@/lib/product-overview-period",
);
test("comparison periods clamp end of month and leap day", () => {
  assert.equal(shiftOverviewDate("2026-03-31", -1), "2026-02-28");
  assert.equal(shiftOverviewDate("2024-02-29", -12), "2023-02-28");
});
test("daily overview counts new products inclusively and leaves unavailable scores empty", async () => {
  const data = await buildOverviewPeriod(
    [{ goodsRef: 1, firstSeenAt: "2026-11-02T00:00:00Z" }],
    "2026-11-01",
    "2026-11-03",
    "table",
    72,
  );
  assert.deepEqual(
    Array.from(data.current, (p) => p.newProducts),
    [0, 1, 0],
  );
  assert.equal(data.current[0].ctr, null);
  assert.equal(data.current[0].contentScore, null);
  assert.equal(data.contentScore, 72);
});
test("invalid and excessive ranges are rejected", async () => {
  await assert.rejects(
    buildOverviewPeriod([], "2026-11-03", "2026-11-01", "table", null),
  );
  await assert.rejects(
    buildOverviewPeriod([], "2024-01-01", "2026-01-01", "table", null),
  );
});

test('catalog-only response never waits for BigQuery and returns new products and content', async () => {
  let calls = 0;
  const fast = sourceLoader({ mocks: {
    '@google-cloud/bigquery': { BigQuery: class { query() { calls++; throw new Error('Must not query'); } } },
    '@/lib/bigquery-result-cache': { readThroughBigQueryCache: async ({load}) => load() },
  }})('@/lib/product-overview-period');
  const result = await fast.buildOverviewPeriod([{goodsRef:1,firstSeenAt:'2026-11-02'}], '2026-11-01','2026-11-03','table',75,false);
  assert.equal(calls,0);
  assert.equal(result.contentScore,75);
  assert.equal(result.current[1].newProducts,1);
  assert.equal(result.current[0].atc,null);
  assert.equal(result.analyticsLoaded,false);
});

test('one query serves three periods and computes ATC from distinct user cohorts', async () => {
  const queries = [];
  const analytics = sourceLoader({ mocks: {
    '@google-cloud/bigquery': { BigQuery: class { async query(options) { queries.push(options); return [[
      {date:'2026-11-01',impressions:100,views:20,carts:3,pdp_users:10,cart_users:2},
      {date:null,scope:'current',pdp_users:15,cart_users:3},
      {date:null,scope:'year',pdp_users:20,cart_users:2},
      {date:null,scope:'month',pdp_users:10,cart_users:3},
      {date:'2025-11-01',impressions:200,views:10,carts:1},
      {date:'2026-10-01',impressions:50,views:5,carts:2,pdp_users:4,cart_users:1},
    ]]; } } },
    '@/lib/bigquery-result-cache': { readThroughBigQueryCache: async ({load}) => load() },
  }})('@/lib/product-overview-period');
  const result = await analytics.buildOverviewPeriod([{goodsRef:7,firstSeenAt:''},{goodsRef:7,firstSeenAt:''}], '2026-11-01','2026-11-02','table',null);
  assert.equal(queries.length,1);
  assert.deepEqual(Array.from(queries[0].params.refs),[7]);
  assert.equal(result.current[0].ctr,20);
  assert.equal(result.year[0].ctr,5);
  assert.equal(result.month[0].atc,25);
  assert.equal(result.current[0].atc,20);
  assert.equal(result.current[1].atc,null);
  assert.equal(result.atcTotals.current,20);
  assert.equal(result.atcTotals.year,10);
  assert.equal(result.atcTotals.month,30);
  assert.match(queries[0].query,/last_cart >= first_view/);
  assert.match(queries[0].query,/GROUP BY scope, user_pseudo_id, goods_ref/);
  assert.match(queries[0].query,/GROUP BY scope, user_pseudo_id\n/);
});
