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
  assert.doesNotMatch(html, /Пропущені дзвінки/);
  assert.match(html, /Звідки приріст виручки/);
  assert.match(html, /неповна розбивка/);
});
test('category and brand maps share the selected dates and comparison',()=>{
 const sales=source({shippedRevenue:20,shippedDocs:2});
 sales.categories=[{label:'Плитка',revenue:20}];sales.brands=[{label:'A',revenue:20}];
 sales.previous={...source({}),categories:[{label:'Плитка',revenue:10}],brands:[{label:'A',revenue:10}]};
 const html=renderBusinessOverview({chartSales:sales,sales},{...state,from:'2026-02-01',to:'2026-02-02',compareMode:'yoy'});
 assert.match(html,/2026-02-01 — 2026-02-02/);
 assert.doesNotMatch(html,/data-category-period=/);
 assert.match(html,/Бренди/);assert.match(html,/\+100%/);
});

test('conversion falls back only to complete unthresholded daily GA4 data',()=>{
 const days=[{date:'2026-11-01',sessions:100,purchases:2},{date:'2025-11-01',sessions:100,purchases:1}];
 const query={...state,from:'2026-11-01',to:'2026-11-01'};
 const data={channels:{available:false},history:{web:{available:true,days}}};
 const metric=overviewModel(data,query).metrics[4];
 assert.equal(metric.value,2);assert.equal(metric.prior,1);assert.equal(metric.delta,100);
 assert.equal(overviewModel({...data,history:{web:{available:true,days,thresholded:true}}},query).metrics[4].value,null);
 assert.equal(overviewModel(data,{...query,to:'2026-11-02'}).metrics[4].value,null);
});

test('catalog changes expose both dated values in comparison tooltips', () => {
  const catalogHealth = {
    available: true,
    compareMode: 'mom',
    trafficRange: {from:'2026-11-01',to:'2026-11-15'},
    comparisonRange: {from:'2026-10-01',to:'2026-10-15'},
    stockStart:'2026-11-01', stockDate:'2026-11-16',
    scoreStart:'2026-11-01', scoreDate:'2026-11-16',
    segments:[{
      label:'Плитка', stockBase:100,inStock:90,stockMovement:{net:-10,gained:2,lost:12},
      priorImpressions:100,impressions:500,impressionsChange:400,priorCtr:12,ctr:14,ctrChange:2,
      scoreBase:null,score:50,
    }],
  };
  const html = renderBusinessOverview({catalogHealth}, state);
  assert.match(html, /id="catalog-hover-tooltip" role="tooltip" hidden/);
  const [stock, impressions, ctr, score] = [...html.matchAll(/data-catalog-tip="([^"]+)"/g)]
    .map(([, meta]) => JSON.parse(meta.replaceAll('&quot;', '"')));
  assert.deepEqual(impressions.rows.map(({dates,value}) => [dates,value]), [
    ['01.10.2026 — 15.10.2026','100'], ['01.11.2026 — 15.11.2026','500'],
  ]);
  assert.deepEqual(ctr.rows.map(row => row.value), ['12%','14%']);
  assert.equal(ctr.comparisons[0].relative, '+2 в.п.');
  assert.deepEqual(stock.rows.map(({dates,value}) => [dates,value]), [['01.11.2026','100'], ['16.11.2026','90']]);
  assert.deepEqual(score.rows.map(row => row.value), ['—','50']);
  assert.match(score.comparisons[0].relative, /Немає бази/);
});
