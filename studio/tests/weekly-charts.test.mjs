import test from "node:test";
import assert from "node:assert/strict";
import {
  isoWeek,
  weekMonday,
  historySeries,
  weeklyChart,
  smoothPath,
} from "../public/weekly-charts.mjs";
import {
  historyRange,
  salesDailySafe,
  webWeeklyRequest,
} from "../overview-history.mjs";
import { usersQuery } from "../bigquery-users.mjs";
const days = (from, count, revenue, docs, canceled) =>
  Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10),
    revenue,
    docs,
    canceled,
  }));
function fixture() {
  return {
    range: { from: "2026-01-05", to: "2026-01-11" },
    sales: [
      {
        available: true,
        coverageFrom: "2026-01-05",
        days: days("2026-01-05", 7, 100, 2, 3),
      },
      {
        available: true,
        coverageFrom: "2025-01-06",
        days: days("2025-01-06", 7, 50, 1, 1),
      },
    ],
    users: {
      available: true,
      weeks: [
        { week: "2026-01-05", users: 25 },
        { week: "2025-01-06", users: 20 },
      ],
    },
    web: {
      available: true,
      weeks: [
        { isoWeek: "202602", sessions: 200, purchases: 10 },
        { isoWeek: "202502", sessions: 100, purchases: 3 },
      ],
    },
  };
}
test("ISO labels and 52 closed weeks stay aligned through the new year", () => {
  assert.deepEqual(isoWeek("2026-01-01"), { year: 2026, week: 1 });
  assert.equal(weekMonday(2026, 1), "2025-12-29");
  const range = historyRange("2026-11-19");
  assert.equal(range.to, "2026-11-18");
  assert.equal(range.from, "2025-11-19");
  assert.equal(
    (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1,
    365,
  );
});
test("every metric is aggregated by week, AOV uses weighted ratio and users are never summed by day", () => {
  const h = fixture();
  for (const [key, current, prior] of [
    ["revenue", 700, 350],
    ["docs", 14, 7],
    ["aov", 50, 50],
    ["canceled", 21, 7],
    ["users", 25, 20],
    ["conversion", 5, 3],
  ]) {
    const rows = historySeries(h, key);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, current, key);
    assert.equal(rows[0].previous, prior, key);
  }
});
test("missing weeks create gaps, never invented zeros or comparisons", () => {
  const h = fixture();
  h.sales[1].days = [];
  assert.equal(historySeries(h, "revenue")[0].previous, null);
  h.users.weeks = [];
  assert.equal(historySeries(h, "users")[0].value, null);
  h.sales[0].days.pop();
  assert.equal(historySeries(h, "aov")[0].value, null);
});
test("all mini charts have a previous-year series; hover targets expose full dates and exact values", () => {
  const h = fixture();
  for (const metric of [
    "revenue",
    "docs",
    "aov",
    "users",
    "conversion",
    "canceled",
  ]) {
    const html = weeklyChart(h, metric, { mini: true, id: metric });
    assert.match(html, /bo-prior-line/);
    assert.match(html, /bo-current-line/);
    assert.match(html, /role="tooltip"/);
    assert.match(html, /Т1–Т2/);
  }
  assert.match(
    smoothPath([
      [0, 5],
      [10, 7],
      [20, 2],
    ]),
    / C/,
  );
});
test("server projection drops customer/document fields and uses the existing cancellation analysis date", () => {
  const data = salesDailySafe(
    {
      rows: [
        {
          state: "Скасовано",
          createdDate: "2026-01-05",
          docsRef: "private",
          customer: "private",
        },
      ],
      summary: {
        canceledByDate: [{ date: "2026-01-05", docs: 1 }],
        firstShippedDate: "2026-01-05",
        lastShippedDate: "2026-01-05",
        byDate: [{ date: "2026-01-05", revenue: 100, docs: 1 }],
      },
      source: { lastModified: "2026-01-06", secret: "private" },
    },
    { from: "2026-01-05", to: "2026-01-11" },
  );
  assert.equal(data.days[0].canceled, 1);
  assert.doesNotMatch(JSON.stringify(data), /private|docsRef|customer/);
});
test("weekly UA users use distinct counts per week and for the whole period, not daily sum", () => {
  const q = usersQuery(
    "project",
    "dataset",
    { from: "2025-01-01", to: "2026-11-15" },
    true,
  );
  assert.match(q.query, /GROUPING SETS/);
  assert.match(q.query, /COUNT\(DISTINCT user_pseudo_id\)/);
  assert.equal(q.params.country, "Ukraine");
  const report = webWeeklyRequest({ from: "2025-01-01", to: "2026-11-15" });
  assert.equal(report.dimensions[0].name, "isoYearIsoWeek");
  assert.equal(report.metrics[0].name, "sessions");
});

test("a legacy 50-row document preview cannot masquerade as full cancellation history", () => {
  const result = salesDailySafe(
    {
      rows: [{ state: "Скасована", createdDate: "2026-01-05" }],
      summary: {
        firstShippedDate: "2026-01-05",
        byDate: [{ date: "2026-01-05", docs: 1, revenue: 10 }],
      },
    },
    { from: "2026-01-05", to: "2026-01-11" },
  );
  assert.equal(result.days[0].canceled, null);
  const h = fixture();
  h.sales[0].days[0].canceled = null;
  assert.equal(historySeries(h, "canceled")[0].value, null);
});

test('graph preset controls both chart sizes independently of KPI calendar dates',()=>{
 const h=fixture();
 const options={preset:'week',today:'2026-01-12'};
 const large=historySeries(h,'revenue',options);
 assert.equal(large.length,7);assert.equal(large[0].interval,'day');
 assert.equal(large[0].from,'2026-01-05');assert.equal(large[6].to,'2026-01-11');
 assert.equal(large[0].previousFrom,'2025-01-05');
 assert.equal(historySeries(h,'revenue',{preset:'quarter',today:'2026-01-12'}).length,2);
 for(const mini of [true,false]){
  const html=weeklyChart(h,'revenue',{...options,mini});assert.match(html,/Вибраний період графіків/);assert.doesNotMatch(html,/Останні 52 тижні/);
 }
});

test('selected weekly users use exact unique-period aggregates rather than daily sums',()=>{
 const h=fixture();
 h.users.periods=[{key:'2026-01-01:2026-01-04',users:17,hasData:true},{key:'2025-01-01:2025-01-04',users:12,hasData:true}];
 const first=historySeries(h,'users',{preset:'quarter',today:'2026-01-12'})[0];
 assert.equal(first.value,17);assert.equal(first.previous,12);assert.equal(first.from,'2026-01-01');assert.equal(first.to,'2026-01-04');
});
