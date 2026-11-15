import test from "node:test";
import assert from "node:assert/strict";
import {
  contentSafe,
  dates,
  previousYear,
  buildPath,
  productSafe,
  salesSafe,
  productsSafe,
  pricesSafe,
  promotionsSafe,
  channelsSafe,
} from "../data.mjs";
test("validates dates, ordering, impossible dates and maximum range", () => {
  assert.deepEqual(
    dates(new URLSearchParams("from=2026-11-01&to=2026-11-15")),
    { from: "2026-11-01", to: "2026-11-15" },
  );
  for (const q of [
    "from=2026-02-30&to=2026-03-01",
    "from=2026-12-01&to=2026-11-01",
    "from=2024-01-01&to=2026-01-01",
    "from=../etc/passwd",
  ])
    assert.throws(() => dates(new URLSearchParams(q)));
  assert.deepEqual(previousYear({ from: "2024-02-29", to: "2024-03-01" }), {
    from: "2023-02-28",
    to: "2023-03-01",
  });
});
test("upstream routes and parameters are bounded and fixed", () => {
  assert.throws(() => buildPath("admin", new URLSearchParams(), {}));
  assert.throws(() =>
    buildPath("products", new URLSearchParams("category=arbitrary"), {}),
  );
  const p = buildPath(
    "prices",
    new URLSearchParams("page=9000&search=https://evil.test/?x=y&refresh=1"),
    {},
  );
  const u = new URL(p, "http://localhost");
  assert.equal(u.pathname, "/api/parser/dashboard-v2");
  assert.equal(u.searchParams.get("page"), "1000");
  assert.equal(u.searchParams.get("limit"), "25");
  assert.equal(u.searchParams.has("refresh"), false);
  assert.equal(u.searchParams.has("x"), false);
});
test("public product projection excludes internal fields and unsafe URLs", () => {
  let p = productSafe({
    id: 1,
    name: "Tile",
    price: 99,
    customer: { phone: "private" },
    secret: "hidden",
    url: "javascript:alert(1)",
  });
  assert.equal(p.price, 99);
  assert.equal(p.url, null);
  assert.equal("customer" in p, false);
  assert.equal("secret" in p, false);
});
test("sales public projection excludes all document/customer/manager/source identifiers", () => {
  const d = salesSafe({
    source: { key: "private-object", lastModified: "2026-11-15" },
    rows: [{ customer: "private", phone: "123" }],
    summary: {
      shippedRevenue: 300,
      totalDocs: 3,
      managers: [{ name: "private" }],
      categoryProducts: { private: "private" },
      byDate: [{ date: "2026-11-01", revenue: 300, customer: "private" }],
      categories: [{ label: "Tiles", revenue: 300, manager: "private" }],
    },
  });
  assert.equal(d.metrics.shippedRevenue, 300);
  assert.equal(d.hasData, true);
  assert.equal(JSON.stringify(d).includes("private"), false);
  assert.equal("rows" in d, false);
  assert.equal("managers" in d, false);
});
test("real product, competitor and promotion adapters keep pagination and numeric nulls", () => {
  assert.equal(
    productsSafe({ items: [], total: 300, totalPages: 12 }).pages,
    12,
  );
  let d = pricesSafe({
    total: 80,
    limit: 25,
    rows: [
      {
        productId: 1,
        ourPrice: 0,
        byCompetitor: { 8: { price: 123, credentials: "private" } },
      },
    ],
  });
  assert.equal(d.pages, 4);
  assert.equal(d.items[0].price, 0);
  assert.equal(JSON.stringify(d).includes("private"), false);
  assert.equal(
    promotionsSafe({
      items: [{ productId: 2, promoPrice: 12, promotionName: "P2" }],
    }).items[0].price,
    12,
  );
});
test("GA4 channel totals aggregate real rows without fabricating spend or users", () => {
  let d = channelsSafe({
    rows: [
      { channel: "Paid", sessions: 10, purchases: 1, revenue: 100 },
      { channel: "Paid", sessions: 20, purchases: 2, revenue: 150 },
      { channel: "Direct", sessions: 5, purchases: 0, revenue: 0 },
    ],
  });
  assert.equal(d.rows[0].sessions, 30);
  assert.equal(d.rows[0].purchases, 3);
  assert.equal(d.rows[0].revenue, 250);
  assert.equal("spend" in d.rows[0], false);
  assert.equal("users" in d.rows[0], false);
});

test("selected cancellations and received orders preserve period definitions", () => {
  const d = salesSafe({
    summary: {
      canceledDocs: 0,
      selected: { canceledDocs: 17 },
      orderInsights: {
        onlineOrders: { totalDocs: 85, customerEmail: "private" },
      },
    },
  });
  assert.equal(d.metrics.canceledDocs, 17);
  assert.equal(d.metrics.receivedDocs, 85);
  assert.ok(!JSON.stringify(d).includes("private"));
});

test("content compares only real snapshots in the preceding calendar month", () => {
  const d = contentSafe({
    currentDate: "2026-11-15",
    overviewPeriod: {
      contentScore: 60,
      current: [
        { date: "2026-10-30", contentScore: 49 },
        { date: "2026-10-31", contentScore: 50 },
        { date: "2026-11-14", contentScore: 59 },
      ],
      month: [{ date: "2026-09-30", contentScore: 20 }],
      customer: "private",
    },
  });
  assert.equal(d.previousScore, 50);
  assert.equal(d.previousDate, "2026-10-31");
  assert.ok(!JSON.stringify(d).includes("private"));
  assert.equal(contentSafe({ currentDate: "2026-11-15" }).previousScore, null);
});
test("inventory history requests are restricted to aggregate product snapshots", () => {
  const u = new URL(
    buildPath(
      "inventory",
      new URLSearchParams("historical=1&url=https://evil.test"),
      { to: "2025-11-14" },
    ),
    "http://local",
  );
  assert.equal(u.pathname, "/api/products");
  assert.equal(u.searchParams.get("as_of"), "2025-11-14");
  assert.equal(u.searchParams.get("min_stock"), "1");
  assert.equal(u.searchParams.has("url"), false);
  assert.equal(
    productsSafe({ syncedAt: null, total: 0 }).historyAvailable,
    false,
  );
  assert.equal(
    promotionsSafe({ targetReconstructed: true }).historyAvailable,
    false,
  );
});

test("sales channel filters are explicit and never fall back for unsupported channels", () => {
  for (const channel of ["all", "site", "monomarket", "rozetka"]) {
    const u = new URL(
      buildPath("sales", new URLSearchParams({ channel }), {
        from: "2026-11-01",
        to: "2026-11-14",
      }),
      "http://local",
    );
    assert.equal(u.searchParams.get("channel"), channel);
  }
  assert.throws(() =>
    buildPath("sales", new URLSearchParams("channel=prom"), {
      from: "2026-11-01",
      to: "2026-11-14",
    }),
  );
});
