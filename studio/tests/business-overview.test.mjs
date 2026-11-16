import test from "node:test";
import assert from "node:assert/strict";
import {
  overviewModel,
  presetRange,
  renderBusinessOverview,
} from "../public/business-overview.mjs";
const state = {
  from: "2026-11-01",
  to: "2026-11-15",
  yoy: true,
  chartChannel: "all",
  chartMetric: "revenue",
  chartInterval: "day",
  chartSegment: "Усі",
};
const source = (metrics) => ({
  available: true,
  hasData: true,
  metrics,
  categories: [],
  byDate: [],
});
test("period shortcuts stop yesterday and handle year and quarter boundaries", () => {
  assert.deepEqual(presetRange("2026-01-01", "month"), {
    from: "2025-12-01",
    to: "2025-12-31",
  });
  assert.deepEqual(presetRange("2026-11-16", "week"), {
    from: "2026-11-09",
    to: "2026-11-15",
  });
  assert.deepEqual(presetRange("2026-11-16", "quarter"), {
    from: "2026-10-01",
    to: "2026-11-15",
  });
  assert.deepEqual(presetRange("2026-01-01", "year"), {
    from: "2025-01-01",
    to: "2025-12-31",
  });
});
test("overview derives shipped AOV and session-weighted conversion using real baselines", () => {
  const sales = source({
    shippedRevenue: 1200,
    shippedDocs: 3,
    canceledDocs: 2,
  });
  sales.previous = source({
    shippedRevenue: 1000,
    shippedDocs: 4,
    canceledDocs: 1,
  });
  const model = overviewModel(
    {
      sales,
      chartSales: sales,
      channels: {
        available: true,
        rows: [
          { sessions: 100, purchases: 10 },
          { sessions: 900, purchases: 0 },
        ],
      },
    },
    state,
  );
  assert.equal(model.metrics[0].delta, 20);
  assert.equal(model.metrics[2].value, 400);
  assert.equal(model.metrics[2].prior, 250);
  assert.equal(model.metrics[4].value, 1);
});
test("missing selected channel never falls back to all-channel sales or zero values", () => {
  const data = {
    sales: source({ shippedRevenue: 1200, shippedDocs: 3 }),
    chartSales: { available: false },
  };
  const model = overviewModel(data, { ...state, chartChannel: "site" });
  assert.equal(model.sales, null);
  for (const metric of model.metrics) assert.equal(metric.value, null);
  assert.match(
    renderBusinessOverview(
      data,
      { ...state, chartChannel: "site" },
      "<div>No data</div>",
    ),
    /Немає бази/,
  );
});
test("public overview escapes category labels and marks missing integrations without demo values", () => {
  const data = {
    sales: source({ shippedRevenue: 1200, shippedDocs: 3 }),
    chartSales: source({ shippedRevenue: 1200, shippedDocs: 3 }),
  };
  data.chartSales.categories = [
    { label: "<script>alert(1)</script>", revenue: 100, docs: 1 },
  ];
  const html = renderBusinessOverview(data, state, "<div>chart</div>");
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Не підключено/);
  assert.match(html, /неповна розбивка/);
});
test('category comparison stays independent of the dashboard calendar and YoY toggle',()=>{
 const sales=source({shippedRevenue:20,shippedDocs:2});
 sales.categories=[{label:'Плитка',revenue:20}];
 sales.previous={...source({}),categories:[{label:'Плитка',revenue:10}]};
 const html=renderBusinessOverview({categorySales:sales},{...state,from:'2026-02-01',to:'2026-02-02',yoy:false,graphToday:'2026-11-16',categoryPeriod:'year'});
 assert.match(html,/2026-01-01 — 2026-11-15/);
 assert.match(html,/data-category-period="year" aria-pressed="true"/);
 assert.match(html,/\+100%/);
});
