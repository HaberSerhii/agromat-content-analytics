import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";

const product = (id, changes = {}) => ({
  id, code: 1000 + id, goodsRef: 2000 + id, name: `Product ${id}`,
  categoryId: 1, categoryName: "Плитка", categoryPath: "Плитка",
  brand: "Brand", brandId: 1, statusId: 5, statusName: "В наявності",
  deleted: false, isOnSale: false, firstSeenAt: "2026-08-01", statusHistory: [],
  imagesCount: 1, reviewsCount: 0, attributesCount: 0, price: 100, stockQty: 1,
  ...changes,
});
const inactiveAt = (at) => ({ at, from: 5, to: 1 });
const sanitary = { categoryId: 2, categoryName: "Сантехніка", categoryPath: "Сантехніка" };
const routeName = "@/app/api/products/dashboard-v2/route";
const plain = (value) => JSON.parse(JSON.stringify(value));

function setup({ products = [], snapshots = {}, ctr = [], failCtr = false } = {}) {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ["2026-09-29T12:00:00Z"])); }
  }
  const load = sourceLoader({
    globals: { Date: FixedDate },
    append: { [routeName]: "\nexport { buildDashboard };" },
    mocks: {
      "next/server": { NextResponse: class { constructor(value) { this.value = JSON.parse(value); } } },
      "@google-cloud/bigquery": { BigQuery: class {} },
      "@/lib/server-result-cache": { getServerResult: async ({ load }) => ({ value: await load(), status: "miss" }) },
      "@/lib/bigquery-result-cache": { readThroughBigQueryCache: async () => {
        if (failCtr) throw new Error("GA4 unavailable");
        return ctr;
      } },
      "@/lib/content-reviews-store": { listContentProductReviews: async () => [] },
      "@/lib/new-product-assignments-store": { listAssignedNewProductCodes: async () => new Set() },
      "@/lib/products-store": {
        readAllLite: async () => products,
        readLiteSyncedAt: async () => "2026-09-29T08:00:00Z",
        readSyncState: async () => ({ state: "ok" }),
        listSnapshotDates: async () => Object.keys(snapshots).sort().reverse().map((date) => ({ date })),
        readDailySnapshot: async (date) => ({ products: snapshots[date] }),
        readProductAttributeIndex: async () => new Map(),
        readRequiredAttrs: async () => ({}),
      },
    },
  });
  const route = load(routeName);
  const dashboard = async (metric, segment = "tile", scope = "current", extra = {}) => plain(await route.buildDashboard({
    view: "overview", includeAnalytics: false, statusId: null, limit: 100,
    overviewSelection: metric ? { metric, segment, scope } : null, ...extra,
  }));
  return { dashboard, route, load };
}

test("inactive KPI counts current state against the previous month end, subtracting recoveries", async () => {
  const products = [
    product(1, { statusId: 1, statusHistory: [inactiveAt("2026-09-10")] }),
    product(2, { statusHistory: [{ at: "2026-09-12", from: 1, to: 5 }, inactiveAt("2026-09-10")] }),
    product(3, { statusHistory: [{ at: "2026-09-20", from: 1, to: 5 }] }),
    product(4, { deleted: true }),
    product(5, { ...sanitary, statusId: 1 }),
    product(6, { statusId: 1 }),
  ];
  const baseline = [product(1), product(2), product(3, { statusId: 1 }), product(4),
    product(5, { ...sanitary, statusId: 1 }), product(6, { statusId: 1 })];
  const { dashboard } = setup({ products, snapshots: {
    "2026-08-31": baseline,
    "2026-09-28": products,
  } });
  const current = await dashboard("inactiveProducts");
  assert.deepEqual(current.rows.map((row) => row.id).sort(), [1, 4, 6]);
  assert.equal(current.total, current.metrics.inactiveProducts.tile);
  const changes = await dashboard("inactiveProducts", "tile", "changes");
  assert.deepEqual(changes.rows.map((row) => [row.id, row.overviewContribution]), [[1, 1], [4, 1], [3, -1]]);
  assert.equal(changes.overviewDrilldown.delta, 1);
  assert.equal(changes.metrics.inactiveProducts.deltaTile, 1);
  assert.equal(changes.overviewDrilldown.previousTo, "2026-08-31");
  assert.equal((await dashboard("inactiveProducts", "sanitary")).total, 1);
  assert.deepEqual((await dashboard("inactiveProducts", "tile", "removed")).rows.map((row) => row.id), [3]);
});

test("inactive baseline falls back to status history and excludes newly observed products", async () => {
  const { dashboard } = setup({ products: [
    product(1, { statusId: 1 }), // unchanged inactive, carried from August
    product(2, { statusHistory: [{ at: "2026-09-02", from: 1, to: 5 }] }),
    product(3, { statusId: 1, firstSeenAt: "2026-09-03" }),
    product(4, { statusId: 1, statusHistory: [
      inactiveAt("2026-09-04"), { at: "2026-09-02", from: 1, to: 5 },
    ] }), // round trip has no net contribution
    product(5), // always available
  ] });
  const result = await dashboard("inactiveProducts", "tile", "changes");
  assert.equal(result.metrics.inactiveProducts.tile, 3);
  assert.equal(result.metrics.inactiveProducts.deltaTile, 0);
  assert.deepEqual(result.rows.map((row) => [row.id, row.overviewContribution]), [[3, 1], [2, -1]]);
});

test("new products use the KPI's date, availability and hidden-batch rules and deduplicate IDs", async () => {
  const fresh = product(1, { firstSeenAt: "2026-09-29" });
  const { dashboard } = setup({ products: [
    fresh, fresh,
    product(2, { firstSeenAt: "2026-09-03" }),
    product(3, { firstSeenAt: "2026-09-10", statusId: 3 }),
    product(4, { firstSeenAt: "2026-09-11", deleted: true }),
    product(5, { ...sanitary, firstSeenAt: "2026-09-12" }),
  ], snapshots: { "2026-09-28": [product(6, { firstSeenAt: "2026-09-15" })] } });
  const result = await dashboard("newProducts");
  assert.deepEqual(result.rows.map((row) => row.id), [1]);
  assert.equal(result.total, result.metrics.newProducts.tile);
  assert.equal(result.metrics.newProducts.sanitary, 1);
  const changes = await dashboard("newProducts", "tile", "changes");
  assert.equal(changes.total, 2);
  assert.equal(changes.overviewDrilldown.delta, 0);
  assert.equal(changes.rows.find((row) => row.id === 6).overviewHistorical, true);
});

test("promotion losses retain removed snapshot products and current status; pagination and facets use the cohort", async () => {
  const { dashboard } = setup({ products: [product(1), product(3, { isOnSale: true }), product(4)], snapshots: {
    "2026-09-28": [product(1, { isOnSale: true }), product(2, { isOnSale: true })],
  } });
  const result = await dashboard("promoProducts", "tile", "changes");
  assert.equal(result.metrics.promoProducts.deltaTile, -1);
  assert.equal(result.total, 3);
  assert.equal(result.rows.find((row) => row.id === 1).isOnSale, false);
  assert.equal(result.rows.find((row) => row.id === 2).overviewHistorical, true);
  assert.equal(result.facets.categories[0].count, 3);
  const paged = await dashboard("promoProducts", "tile", "changes", { page: 2, limit: 1 });
  assert.equal(paged.rows.length, 1);
  assert.equal(paged.totalPages, 3);
  const searched = await dashboard("promoProducts", "tile", "changes", { search: "Product 2" });
  assert.equal(searched.total, 1);
  assert.equal(searched.rows[0].id, 2);
  assert.equal(searched.overviewDrilldown.delta, -1);
  assert.equal((await dashboard(null)).total, 3);
});

test("CTR drilldown uses the scored GA4 goods_refs, impression threshold and both directions", async () => {
  const ctr = [];
  for (const [id, before, after, impressions] of [[1, 2, 4, 20], [2, 4, 2, 20], [3, 2, 2, 20], [4, 1, 2, 19], [5, 1, 2, 30]]) {
    ctr.push({ goods_ref: 2000 + id, period: "previous", impressions, clicks: before });
    ctr.push({ goods_ref: 2000 + id, period: "current", impressions, clicks: after });
  }
  ctr.push({ goods_ref: 99999, period: "current", impressions: 100, clicks: 30 });
  const { dashboard } = setup({ products: [1, 2, 3, 4].map((id) => product(id)).concat(product(5, sanitary)), ctr });
  const current = await dashboard("ctr");
  assert.equal(current.total, 4);
  assert.equal(current.metrics.ctr.improvedTile, 1);
  assert.equal(current.metrics.ctr.declinedTile, 1);
  const changed = await dashboard("ctr", "tile", "changes");
  assert.deepEqual(changed.rows.map((row) => [row.id, row.overviewContribution]), [[1, 1], [2, -1]]);
  assert.equal(changed.overviewDrilldown.delta, changed.metrics.ctr.deltaTile);
  assert.equal((await dashboard("ctr", "sanitary", "added")).rows[0].id, 5);
});

test("unavailable CTR, missing snapshots and invalid selectors do not return unrelated products", async () => {
  const { dashboard, load } = setup({ products: [product(1)], failCtr: true });
  const result = await dashboard("ctr");
  assert.equal(result.total, 0);
  assert.equal(result.overviewDrilldown.available, false);
  assert.equal((await dashboard("promoProducts", "tile", "changes")).total, 0);
  const { normalizeOverviewSelection } = load("@/lib/product-overview-drilldown");
  for (const value of [null, "ctr", {}, { metric: "promoProducts", segment: "all", scope: "changes" }]) {
    assert.equal(normalizeOverviewSelection(value), null);
  }
});

test("GET and POST carry drilldown filters through the response cache", async () => {
  const { route } = setup({ products: [product(1, { isOnSale: true }), product(2)] });
  const result = await route.POST({ json: async () => ({ view: "overview", includeAnalytics: false,
    overviewSelection: { metric: "promoProducts", segment: "tile", scope: "current" } }) });
  assert.equal(result.value.total, 1);
  const get = await route.GET({ url: "http://localhost/api/products/dashboard-v2?analytics=0&overviewMetric=promoProducts&overviewSegment=tile&overviewScope=current" });
  assert.equal(get.value.total, 1);
  assert.equal(get.value.rows[0].id, 1);
});

test("segment moves contribute to both segment balances", () => {
  const { load } = setup();
  const { buildOverviewCohorts, overviewMetric } = load("@/lib/product-overview-drilldown");
  const cohorts = buildOverviewCohorts([product(1, sanitary)], [product(1)]);
  assert.deepEqual(plain(overviewMetric(cohorts)), { tile: 0, sanitary: 1, deltaTile: -1, deltaSanitary: 1 });
});
