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
test("interval is selected explicitly regardless of calendar range", () => {
  for (const to of ["2026-01-01", "2026-02-15", "2026-12-31"])
    for (const interval of ["day", "week", "month"])
      assert.equal(intervalFor("2026-01-01", to, interval), interval);
  assert.equal(intervalFor("2026-01-01", "2026-12-31"), "day");
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
    { from: "2026-01-01", to: "2026-03-01", chartInterval: "week" },
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
  const range = { from: "2026-08-01", to: "2026-11-14", chartInterval: "month" };
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

test('orders and revenue use independent values for daily and monthly comparisons', () => {
  const data = { byDate: [{ date: '2026-11-01', revenue: 500, docs: 3 }], months: [{ month: '2026-11', revenue: 500, docs: 3 }], previous: { available: true, hasData: true, byDate: [{ date: '2025-11-01', revenue: 250, docs: 2 }], months: [{ month: '2025-11', revenue: 250, docs: 2 }] } };
  for (const chartInterval of ['day', 'week', 'month']) {
    const range = { from: '2026-11-01', to: '2026-11-01', chartInterval, chartMetric: 'docs' };
    assert.equal(chartSeries(data, range, true).rows[0].value, 3);
    assert.equal(chartSeries(data, range, true).rows[0].previous, 2);
    assert.equal(chartSeries(data, { ...range, chartMetric: 'revenue' }, true).rows[0].value, 500);
  }
});
