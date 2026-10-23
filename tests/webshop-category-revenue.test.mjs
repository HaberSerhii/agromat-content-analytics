import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";
const { webshopCategoryRevenue } = sourceLoader()("@/lib/webshop-category-revenue");
const products = [
  { id: 1, goodsRef: 11, code: 101, categoryPath: "Плитка / Керамограніт", categoryName: "Керамограніт" },
  { id: 2, goodsRef: 12, code: 102, categoryPath: "Сантехніка / Ванни", categoryName: "Ванни" },
];
test("mixed orders allocate net revenue after returns once across categories", () => {
  const rows = webshopCategoryRevenue([{ totals: { cost: 800 }, items: [
    { product_id: 1, line_total: 750 }, { goods_ref: 12, line_total: 250 },
  ] }], products);
  assert.equal(rows.find(r => r.label === "Плитка").revenue, 600);
  assert.equal(rows.find(r => r.label === "Сантехніка").revenue, 200);
  assert.equal(rows.reduce((sum, r) => sum + r.revenue, 0), 800);
});
test("unknown products and orders without items retain their value in Other", () => {
  const rows = webshopCategoryRevenue([
    { totals: { cost: 100 }, items: [{ product_id: 999, line_total: 100 }] },
    { totals: { cost: -20 }, items: [] },
  ], products);
  assert.equal(rows.find(r => r.label === "Інше").revenue, 80);
  assert.equal(rows.length, 6);
  assert.ok(webshopCategoryRevenue([], products).every(r => r.revenue === 0 && r.share === 0));
});
test("ERP keys override catalogue hierarchy and classify chemicals, flooring and power", () => {
  const keys = new Map([["101", "003.001"], ["102", "009.001"], ["103", "020.001"]]);
  const rows = webshopCategoryRevenue([{ totals: { cost: 300 }, items: [101,102,103].map(code => ({code, line_total:100})) }], products, keys);
  for (const label of ["Будівельна хімія", "Підлогові покриття", "Джерела живлення"]) assert.equal(rows.find(r => r.label === label).revenue, 100);
});
test("catalogue plumbing roots and singular flooring labels are recognized", () => {
  const catalogue = products.map((p,i) => ({...p, categoryPath: i ? "Підлогове покриття / Ламінат" : "Змішувачі / Змішувачі"}));
  const rows = webshopCategoryRevenue([{totals:{cost:200},items:[101,102].map(code => ({code,line_total:100}))}],catalogue);
  assert.equal(rows.find(r => r.label === "Сантехніка").revenue,100);
  assert.equal(rows.find(r => r.label === "Підлогові покриття").revenue,100);
});
