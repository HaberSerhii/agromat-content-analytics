import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { classifySalesCategory, splitBusinessSales } from "../src/lib/sales-business-segments.ts";

const item = (categoryKey, revenue, qty = 1) => ({ categoryKey, revenue, qty });

test("sanitary is strictly branch 002; all unplanned branches remain Other", () => {
  assert.equal(classifySalesCategory("002.009.013.003").segment, "Сантехніка");
  assert.equal(classifySalesCategory("001.003.003").segment, "Плитка");
  for (const key of ["", "012.008", "013.003", "008.005", "011.005"]) {
    assert.deepEqual(classifySalesCategory(key), { segment: "Інше", otherGroup: null });
  }
});

test("four Other groups include legacy power stations and chemical subcategories", () => {
  for (const [key, label] of [["009.002.002", "Підлогові покриття"], ["003.023.004", "Будівельна хімія"], ["007", "Будівельна хімія"], ["020.002", "Джерела живлення"], ["011.010", "Джерела живлення"], ["004.007", "Меблі"]]) {
    assert.deepEqual(classifySalesCategory(key), { segment: "Інше", otherGroup: label });
  }
  for (const key of ["003.003", "003.005", "003.019"]) assert.equal(classifySalesCategory(key).otherGroup, null);
});

test("mixed orders split amounts and quantities without changing the total", () => {
  const parts = splitBusinessSales([item("001", 600, 2), item("002", 300), item("020", 100), item("004", 200)], 1200);
  assert.deepEqual(parts.map(({ segment, revenue, goods }) => ({ segment, revenue, goods })), [
    { segment: "Плитка", revenue: 600, goods: 2 }, { segment: "Сантехніка", revenue: 300, goods: 1 }, { segment: "Інше", revenue: 300, goods: 2 },
  ]);
  assert.equal(parts.reduce((sum, part) => sum + part.revenue, 0), 1200);
  assert.equal(parts[2].otherGroups.get("Джерела живлення"), 100);
  for (const total of [0, 100, -100]) {
    const fallback = splitBusinessSales([item("001", 0), item("002", 0), item("004", 0)], total);
    assert.equal(fallback.reduce((sum, part) => sum + part.revenue, 0), total);
  }
});

// Exercise the actual dataset builder, including its overall plan calculation.
const require = createRequire(import.meta.url);
function loadBuilder(source) {
  const exports = {};
  const localRequire = (name) => {
    if (name === "@/lib/sales-order-origin") return { normalizeSalesChannel: (value) => value === "rozetka" ? "rozetka" : "all" };
    if (name.startsWith("@/lib/")) {
      if (["sales-plan", "sales-plan-items", "sales-business-segments", "sales-date-series", "sales-dimension-filter"].some((file) => name === `@/lib/${file}`)) return require(path.resolve(`src/lib/${name.slice(6)}.ts`));
      return {};
    }
    return require(name);
  };
  const js = ts.transpileModule(source + '\nexports.testBuilder = buildDataset;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", js)(localRequire, exports);
  return exports.testBuilder;
}

test("overview, statuses and cancellation products split mixed orders while preserving the overall fact and configured plans", () => {
  const source = fs.readFileSync("src/lib/sales-s3.ts", "utf8");
  const build = loadBuilder(source);
  const products = [item("001.001", 600), item("002.006", 300), item("020.001", 100)].map((value, index) => ({ ...value, code: String(index + 1), name: "Товар", category: "Категорія", brand: "Бренд", url: "" }));
  const base = { docsRef: "1", number: "1", createdDate: "2026-10-01", shippedDate: "2026-10-02", seller: "4964", state: "Повністю відвантажений", docsSum: 1000, returnSum: 0, goodsCount: 3, goodsCodes: "1 | 2 | 3", trademarksNames: "", groupRefs: "", goodsNames: "", margin: null, stockm: "", planGroup: "Плитка", cartNumber: "", items: products, goodsCodeNumbers: [1, 2, 3], cancelReason: "Відмова", webshopId: "", marketingProgram: "", hasReturns: false, returnGoodsCodes: [], returnRowSums: [], ownCost: 0, hasOwnCostData: false };
  const rows = [base, { ...base, docsRef: "2", number: "2", shippedDate: null, state: "Скасована" }];
  const args = [rows, {}, { from: "2026-10-01", to: "2026-10-31" }];
  const result = build(...args);
  // Quantities use item-level units, preserve fractional area and exclude services/canceled orders.
  const volumeItems = [
    { ...products[0], qty: 12.75 },
    { ...products[1], qty: 3 },
    { ...products[2], code: "4", categoryKey: "009.002", qty: 5.25 },
    { ...products[2], code: "5", qty: 2 },
    { ...products[2], code: "6", categoryKey: "", qty: 4 },
    { ...products[2], code: "18385", categoryKey: "012.008", name: "Послуги доставки", qty: 1 },
  ];
  const volumeResult = build([
    { ...base, items: volumeItems, docsSum: 1200 },
    { ...base, docsRef: "canceled", items: volumeItems, shippedDate: null, state: "Скасована" },
  ], {}, args[2]);
  assert.deepEqual(volumeResult.summary.shippedQuantities, { squareMeters: 18, pieces: 9 });
  assert.deepEqual(volumeResult.summary.otherQuantities, { squareMeters: 5.25, pieces: 6 });
  assert.equal(volumeResult.summary.shippedSegments.find((part) => part.label === "Плитка").goods, 12.75);
  assert.equal(volumeResult.summary.otherSalesGroups.find((part) => part.label === "Підлогові покриття").goods, 5.25);
  assert.equal(volumeResult.summary.otherSalesGroups.find((part) => part.label === "Джерела живлення").goods, 2);
  assert.equal(result.summary.shippedRevenue, 1000);
  assert.deepEqual(result.summary.shippedSegments.map((part) => part.revenue), [600, 300, 100]);
  assert.equal(result.summary.otherSalesGroups.find((part) => part.label === "Джерела живлення").revenue, 100);
  const plumbing = result.summary.documentStatusesBySegment.find((part) => part.segment === "Сантехніка");
  assert.equal(plumbing.cancelReasons[0].revenue, 300);
  assert.deepEqual(plumbing.cancelReasons[0].products.map((part) => part.code), ["2"]);
  assert.equal(plumbing.states.reduce((sum, part) => sum + part.revenue, 0), 600);
  // Overall fact and configured targets stay fixed; completion excludes Other.
  assert.equal(result.summary.plan.segments.find((part) => part.segment === "Плитка").revenue, 600);
  assert.equal(result.summary.plan.segments.find((part) => part.segment === "Сантехніка").revenue, 300);
  assert.equal(result.summary.plan.revenue, 1000);
  assert.equal(result.summary.plan.segments.find((part) => part.segment === "Інше").revenue, 100);
  assert.equal(result.summary.plan.segments.find((part) => part.segment === "Плитка").plan, 2700000);
  const returned = build([{ ...base, returnSum: 50, returnGoodsCodes: ["2"], returnRowSums: [50] }], {}, args[2]);
  assert.equal(returned.summary.plan.revenue, 950);
  const economics = build([{ ...base, webshopId: "web", hasOwnCostData: true, ownCost: 500, returnSum: 50, returnGoodsCodes: ["2"], returnRowSums: [50] }], {}, args[2]);
  assert.equal(economics.summary.orderInsights.shippedEconomics.revenueWithCost, 950);
  assert.equal(economics.summary.orderInsights.shippedEconomics.estimatedGrossProfit, 450);
  assert.equal(returned.summary.plan.segments.find((part) => part.segment === "Сантехніка").revenue, 250);
  assert.equal(returned.summary.plan.segments.find((part) => part.segment === "Плитка").revenue, 600);
  assert.equal(returned.summary.plan.segments.reduce((sum, part) => sum + part.revenue, 0), 950);
  const delivery = { ...products[2], code: "18385", name: "Послуги доставки", category: "Послуги доставки", categoryKey: "012.008", revenue: 80 };
  const mixed = build([{ ...base, docsSum: 1080, returnSum: 70, items: [...products, delivery], goodsCount: 4, returnGoodsCodes: ["2", "18385"], returnRowSums: [50, 20] }], {}, args[2]);
  assert.equal(mixed.summary.plan.revenue, 950);
  assert.equal(mixed.summary.shippedRevenue, 950);
  assert.equal(mixed.summary.returnedRevenue, 50);
  assert.equal(mixed.summary.otherSalesRemainder.length, 0);
  assert.deepEqual(mixed.summary.shippedSegments.map((part) => part.revenue), [600, 250, 100]);
  assert.equal(mixed.summary.byDate.reduce((sum, day) => sum + day.revenue, 0), 950);
  assert.equal(mixed.summary.categories.reduce((sum, category) => sum + category.revenue, 0), 950);
  assert.equal(Object.values(mixed.summary.categoryProducts).flat().reduce((sum, product) => sum + product.revenue, 0), 950);
  const serviceOnly = { ...base, docsRef: "service", items: [delivery], docsSum: 80, returnSum: 0, goodsCount: 1, returnGoodsCodes: [], returnRowSums: [] };
  const withoutServices = build([base, serviceOnly], {}, args[2]);
  assert.equal(withoutServices.summary.shippedDocs, 1);
  assert.equal(withoutServices.summary.shippedRevenue, 1000);
  assert.equal(withoutServices.summary.states.reduce((sum, state) => sum + state.docs, 0), 1);
  assert.equal(mixed.summary.plan.segments.find((part) => part.segment === "Інше").revenue, 100);
  const duplicate = build([{ ...base, items: [{ ...products[0], revenue: 200 }, { ...products[0], revenue: 400 }, products[1], products[2]], returnSum: 100, returnGoodsCodes: ["1"], returnRowSums: [100] }], {}, args[2]);
  assert.ok(Math.abs(duplicate.summary.plan.segments.find((part) => part.segment === "Плитка").revenue - 500) < 0.01);
  assert.equal(duplicate.summary.plan.segments.find((part) => part.segment === "Сантехніка").revenue, 300);
});
