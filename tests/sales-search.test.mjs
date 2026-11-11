import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";
import { matchesSalesSearch } from "../src/lib/sales-search.ts";

test("search matches code, name, brand and category without regard to case or whitespace", () => {
  const item = { code: "400817", name: "Плитка підлогова", brand: "Atem", category: "Керамограніт" };
  for (const query of ["400817", "  ПЛИТКА  Atem ", "керамограніт", "817"]) assert.ok(matchesSalesSearch(item, query));
  assert.ok(matchesSalesSearch(item, "  "));
  assert.equal(matchesSalesSearch(item, "400817 ванна"), false);
});

test("shipped search endpoint forwards the scope and supplies product details for both dimensions", async () => {
  let filter;
  const product = { code: "400817", name: "Плитка", brand: "Atem", category: "Плитка підлогова", orders: 1, qty: 2, revenue: 200 };
  const route = sourceLoader({ mocks: {
    "next/server": { NextResponse: { json: (body, options) => ({ body, options }) } },
    "@/lib/ga4-marketing-report": { validateGa4Dates: (from, to) => { if (!from || !to) throw new Error("date"); } },
    "@/lib/sales-s3": { readSalesDataset: async value => {
      filter = value;
      return { summary: { brands: [{ label: "Atem", revenue: 200 }], categories: [{ label: product.category, revenue: 200 }], categoryProducts: { [product.category]: [product] } } };
    } },
  } })("@/app/api/sales/ranking/route");
  const response = await route.GET({ url: "http://localhost/api/sales/ranking?from=2026-11-01&to=2026-11-05&channel=site&search=400817&status=done" });
  assert.equal(filter.search, "400817");
  assert.equal(filter.channel, "site");
  assert.equal(filter.statuses[0], "done");
  assert.equal(response.body.brands.products.Atem[0].code, "400817");
  assert.equal(response.body.categories.products[product.category][0].revenue, 200);
  assert.equal((await route.GET({ url: "http://localhost/api/sales/ranking?from=2026-11-01&to=2026-11-05" })).options.status, 400);
  assert.equal((await route.GET({ url: "http://localhost/api/sales/ranking?search=x" })).options.status, 400);
});
