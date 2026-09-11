import test from "node:test";
import assert from "node:assert/strict";
import { calendarDates, completedDateSeries, fillOrderDateSeries, fillSalesDateSeries } from "../src/lib/sales-date-series.ts";

test("calendarDates includes every day in the selected period", () => {
  assert.deepEqual(calendarDates("2026-09-01", "2026-09-04"), [
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
  ]);
});

test("missing sales days are represented by zero values", () => {
  assert.deepEqual(
    fillSalesDateSeries(
      [{ date: "2026-09-02", docs: 2, goods: 5, revenue: 1000 }],
      "2026-09-02",
      "2026-09-04",
    ),
    [
      { date: "2026-09-02", docs: 2, goods: 5, revenue: 1000 },
      { date: "2026-09-03", docs: 0, goods: 0, revenue: 0 },
      { date: "2026-09-04", docs: 0, goods: 0, revenue: 0 },
    ],
  );
});

test("missing order days have zero orders and no managers", () => {
  assert.deepEqual(
    fillOrderDateSeries(
      [{ date: "2026-09-02", docs: 1, managers: [{ seller: "Менеджер", docs: 1 }] }],
      "2026-09-02",
      "2026-09-04",
    ),
    [
      { date: "2026-09-02", docs: 1, managers: [{ seller: "Менеджер", docs: 1 }] },
      { date: "2026-09-03", docs: 0, managers: [] },
      { date: "2026-09-04", docs: 0, managers: [] },
    ],
  );
});

test("completedDateSeries excludes today and future dates from a delayed chart", () => {
  const points = [
    { date: "2026-09-09", revenue: 1000 },
    { date: "2026-09-10", revenue: 0 },
    { date: "2026-09-11", revenue: 0 },
  ];

  assert.deepEqual(completedDateSeries(points, "2026-09-10"), [
    { date: "2026-09-09", revenue: 1000 },
  ]);
});
