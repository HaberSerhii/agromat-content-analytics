import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultRange,
  intervalFor,
  chartSeries,
} from "../public/chart-data.mjs";
test("completed month-to-date defaults handle first day and leap day", () => {
  assert.deepEqual(defaultRange("2026-11-15"), {
    from: "2026-11-01",
    to: "2026-11-14",
  });
  assert.deepEqual(defaultRange("2026-01-01"), {
    from: "2025-12-01",
    to: "2025-12-31",
  });
  assert.deepEqual(defaultRange("2024-03-01"), {
    from: "2024-02-01",
    to: "2024-02-29",
  });
});
test("inclusive interval boundaries are 30 and 90 days", () => {
  for (const [days, expected] of [
    [1, "day"],
    [30, "day"],
    [31, "week"],
    [90, "week"],
    [91, "month"],
    [365, "month"],
  ]) {
    const to = new Date(Date.parse("2026-01-01") + (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    assert.equal(intervalFor("2026-01-01", to), expected);
  }
});
test("weekly bins preserve totals, month boundaries and calendar-aligned YoY", () => {
  const byDate = [],
    prior = [];
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.parse("2026-01-01") + i * 86400000)
      .toISOString()
      .slice(0, 10);
    byDate.push({ date: d, revenue: 10 });
    prior.push({ date: "2025" + d.slice(4), revenue: 5 });
  }
  const series = chartSeries(
    { byDate, previous: { available: true, hasData: true, byDate: prior } },
    { from: "2026-01-01", to: "2026-03-01" },
    true,
  );
  assert.equal(
    series.rows.reduce((s, r) => s + r.value, 0),
    600,
  );
  assert.equal(
    series.rows.reduce((s, r) => s + r.previous, 0),
    300,
  );
  assert.ok(series.rows.every((r) => r.from.slice(0, 7) === r.to.slice(0, 7)));
  assert.match(series.rows[0].label, /тиждень 1/);
});
test("monthly comparisons use source totals and absent history stays null", () => {
  const range = { from: "2026-08-01", to: "2026-11-14" };
  let d = {
    months: [{ month: "2026-08", revenue: 200 }],
    previous: {
      available: true,
      hasData: true,
      months: [{ month: "2025-08", revenue: 100 }],
    },
  };
  assert.equal(chartSeries(d, range, true).rows[0].previous, 100);
  d.previous.hasData = false;
  assert.equal(chartSeries(d, range, true).rows[0].previous, null);
});
