import test from "node:test";
import assert from "node:assert/strict";
import { monthlyPeriods, priorYearDate, revenueChange, salesCsv } from "../src/lib/sales-monthly.ts";

test("monthly window crosses the year and caps only the last month", () => {
  assert.deepEqual(monthlyPeriods("2026-02-07", 3), [
    { from: "2025-12-01", to: "2025-12-31" },
    { from: "2026-01-01", to: "2026-01-31" },
    { from: "2026-02-01", to: "2026-02-07" },
  ]);
});
test("year comparison clamps leap day without moving into March", () => {
  assert.equal(priorYearDate("2024-02-29"), "2023-02-28");
  assert.equal(priorYearDate("2026-11-07"), "2025-11-07");
  assert.equal(revenueChange(100, 0), null);
  assert.equal(revenueChange(150, 100), 50);
  assert.equal(revenueChange(0, 100), -100);
});
test("CSV preserves delimiters, quotes and prevents label formulas", () => {
  assert.equal(salesCsv([['A;"B', '=SUM(1)', 42]]), '\uFEFF"A;""B";"\'=SUM(1)";"42"');
});

test("monthly ranks use selected current-month values, including full losses and new activity", async () => {
  const { sortMonthlyRows } = await import("../src/lib/sales-monthly.ts");
  const rows = [
    { label: "Historical leader", total: 9999, monthValue: 10, previousMonthValue: 10 },
    { label: "Lost sales", total: 0, monthValue: 0, previousMonthValue: 500 },
    { label: "New sales", total: 200, monthValue: 200, previousMonthValue: 0 },
    { label: "Monthly leader", total: 800, monthValue: 800, previousMonthValue: 700 },
  ];
  assert.equal(sortMonthlyRows(rows, "total")[0].label, "Historical leader");
  assert.equal(sortMonthlyRows(rows, "growth")[0].label, "New sales");
  assert.equal(sortMonthlyRows(rows, "decline")[0].label, "Lost sales");
  assert.equal(rows[0].label, "Historical leader");
  assert.equal(sortMonthlyRows(rows.filter(row => row.label !== "Lost sales"), "decline")[0].label, "Historical leader");
});
