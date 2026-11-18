import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  calendarBins,
  calendarUserBins,
  miniInterval,
} from "../public/chart-periods.mjs";
import { usersBinsQuery } from "../bigquery-users.mjs";
import { historySeries, weeklyChart } from "../public/weekly-charts.mjs";
import { renderBusinessOverview } from "../public/business-overview.mjs";
test("mini charts use days through 40 inclusive and clipped weeks above 40", () => {
  assert.equal(miniInterval({ from: "2026-01-01", to: "2026-02-09" }), "day");
  assert.equal(miniInterval({ from: "2026-01-01", to: "2026-02-10" }), "week");
  const rows = calendarBins({ from: "2026-10-01", to: "2026-11-15" }, "week");
  assert.equal(rows[0].from, "2026-10-01");
  assert.equal(rows[0].to, "2026-10-04");
  assert.equal(rows.at(-1).to, "2026-11-15");
  assert.equal(rows[0].previousFrom, "2025-10-01");
  assert.equal(rows[0].previousTo, "2025-10-04");
});
test("calendar drives both graph sizes; daily-weekly switch keeps calendar and metric intact", () => {
  const history = {
    range: { from: "2026-10-01", to: "2026-11-15" },
    sales: [],
  };
  const day = historySeries(history, "aov", {
      range: history.range,
      interval: "day",
    }),
    week = historySeries(history, "aov", {
      range: history.range,
      interval: "week",
    });
  assert.equal(day.length, 46);
  assert.equal(week.length, 7);
  assert.equal(day[0].from, week[0].from);
  assert.equal(day.at(-1).to, week.at(-1).to);
  const html = renderBusinessOverview(
    { history },
    {
      from: "2026-10-01",
      to: "2026-11-15",
      yoy: true,
      chartMetric: "aov",
      chartChannel: "all",
      chartSegment: "Усі",
      chartInterval: "week",
    },
  );
  assert.match(html, /<h2>Середній чек<\/h2>/);
  assert.match(html, /data-bo-interval="day"/);
  assert.match(html, /data-bo-interval="week"/);
  assert.doesNotMatch(html, /52 тижні|data-bo-preset/);
  const source = fs.readFileSync(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /data-bo-preset/);
  assert.match(source, /state.chartMetric=key;saveLocation\(\);render\(\)/);
});
test("revenue charts use round ceilings and show start, middle and end dates", () => {
  const range = {from:"2026-11-01", to:"2026-11-17"};
  const labels = (peak, interval) => {
    const days = calendarBins(range).map(bin => ({
      date:bin.from, revenue:bin.from === "2026-11-10" ? peak : 0, docs:1,
    }));
    const history = {range, sales:[{available:true, coverageFrom:range.from, days}]};
    return [...weeklyChart(history, "revenue", {range, interval}).matchAll(/<text[^>]+>([^<]+)<\/text>/g)]
      .map(match => match[1].replace(/\s/g, " "));
  };
  assert.deepEqual(labels(800_000, "day").slice(0, 5), ["0", "250 тис.", "500 тис.", "750 тис.", "1 млн"]);
  assert.deepEqual(labels(800_000, "day").slice(5), ["01.11", "09.11", "17.11"]);
  for (const [peak, ceiling] of [[1_100_000, "1,5 млн"], [1_510_000, "2 млн"]]) {
    const axisLabels = labels(peak, "week");
    assert.equal(axisLabels[axisLabels.indexOf("01.11") - 1], ceiling);
    assert.deepEqual(axisLabels.slice(-3), ["01.11", "09.11", "17.11"]);
  }
});
test("calendar unique-user bins are counted distinctly, never summed from day-level users", () => {
  const range = { from: "2026-10-01", to: "2026-11-15" },
    bins = calendarUserBins(range),
    query = usersBinsQuery("project", "dataset", bins);
  assert.ok(bins.length > 92);
  assert.match(query.query, /COUNT\(DISTINCT e.user_pseudo_id\)/);
  assert.equal(query.params.country, "Ukraine");
  const history = {
    range,
    sales: [],
    users: {
      available: true,
      periods: [
        { key: "2026-10-01:2026-10-04", users: 17, hasData: true },
        { key: "2025-10-01:2025-10-04", users: 12, hasData: true },
      ],
    },
  };
  const first = historySeries(history, "users", { range, interval: "week" })[0];
  assert.equal(first.value, 17);
  assert.equal(first.previous, 12);
});
