import test from "node:test";
import assert from "node:assert/strict";
import {
  overviewModel,
  presetRange,
  renderBusinessOverview,
  renderCatalogScoreHistory,
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
  const byKey = Object.fromEntries(model.metrics.map(metric=>[metric.key,metric]));
  assert.equal(byKey.revenue.delta, 20);
  assert.equal(byKey.aov.value, 400);
  assert.equal(byKey.aov.prior, 250);
  assert.equal(byKey.conversion.value, 1);
});

test('overview KPI order and sales channels follow the chosen ERP metric', () => {
  const channel = (revenue,docs,canceled) => source({shippedRevenue:revenue,shippedDocs:docs,canceledDocs:canceled});
  const sales = channel(600,13,5);
  const site = {...channel(100,4,1),previous:channel(50,2,2)};
  const margin = {amount:60,byChannel:{site:{amount:10,percent:10},rozetka:{amount:20,percent:10},monomarket:{amount:30,percent:10}},
    previous:{byChannel:{site:{amount:5,percent:8},rozetka:{amount:0,percent:null}}}};
  const data = {sales,chartSales:sales,margin,salesChannels:{site,rozetka:channel(200,3,4),monomarket:channel(300,6,0)}};
  const html = renderBusinessOverview(data,state);
  assert.deepEqual([...html.matchAll(/data-bo-metric="(\w+)"/g)].map(([,key])=>key),
    ['revenue','margin','docs','canceled','users','aov','conversion']);
  for (const [key,total,siteValue] of [['revenue','600 ₴','100 ₴'],['margin','60 ₴','10 ₴'],['docs','13','4'],['canceled','5','1']]) {
    const selected = {...state,chartMetric:key};
    const panel = renderBusinessOverview(data,selected,{panel:'channels'});
    assert.ok(panel.includes('data-channel-metric="'+key+'"'));
    assert.ok(panel.includes('class="bo-donut-total">'+total+'<'));
    assert.doesNotMatch(panel,/Валова маржа за каналами/);
    if (key==='margin') {
      assert.match(panel,/Прибуток, грн/);
      assert.match(panel,/Маржа, %/);
      assert.doesNotMatch(panel,/class="bo-channel-list"/);
      const row = id => panel.match(new RegExp('data-channel="'+id+'"[\\s\\S]*?</tr>'))[0];
      assert.match(row('site'),/<b>10,00<\/b>[\s\S]*?\+5,00 грн[\s\S]*?\(\+100%\)[\s\S]*?<b>10%<\/b>[\s\S]*?\+2 п\. п\./);
      assert.match(row('rozetka'),/\+20,00 грн/);
      assert.doesNotMatch(row('rozetka'),/<small>/);
      assert.match(row('monomarket'),/Немає бази для порівняння/);
      assert.doesNotMatch(renderBusinessOverview(data,{...selected,yoy:false},{panel:'channels'}),/bo-channel-profit-change/);
      continue;
    }
    assert.doesNotMatch(panel,/class="bo-channel-profit"/);
    const siteRow = panel.match(/data-channel="site"[^]*?<\/div>/)[0];
    assert.ok(siteRow.includes('<b>'+siteValue+'</b>'));
    if (key==='canceled') assert.match(siteRow,/bo-delta positive[^]*?50%/);
  }
  const cancellations = renderBusinessOverview(data,{...state,chartMetric:'canceled'},{panel:'channels'});
  for (const chartMetric of ['users','aov','conversion']) {
    const selected = {...state,chartMetric,channelMetric:'canceled'};
    assert.equal(renderBusinessOverview(data,selected,{panel:'channels'}),cancellations);
    assert.doesNotMatch(renderBusinessOverview(data,selected,{panel:'chart'}),/bo-channels/);
  }

  const loss = {...data,margin:{...margin,amount:40,byChannel:{...margin.byChannel,site:{amount:-10}}}};
  const panel = renderBusinessOverview(loss,{...state,chartMetric:'margin'},{panel:'channels'});
  assert.match(panel,/<b>-10,00<\/b>/);
  assert.match(panel,/bo-donut-label">підсумок/);
  assert.doesNotMatch(panel,/stroke-dasharray/);
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
test('category and brand tooltips carry dated amounts in the selected measure and comparison', () => {
  const sales = source({shippedRevenue:20,shippedDocs:2});
  sales.categories = [{label:'Плитка',revenue:20,quantities:{'м²':33.12}}];
  sales.brands = [{label:'A',revenue:20,quantities:{шт:4}}, {label:'B',revenue:5,quantities:{шт:2}}];
  sales.previous = {...source({}),categories:[{label:'Плитка',revenue:10,quantities:{'м²':24}}],
    brands:[{label:'A',revenue:10,quantities:{шт:0}}, {label:'B',revenue:1,missingQuantityLines:1}]};
  const renderTips = selection => [...renderBusinessOverview({chartSales:sales,sales},
    {...state,from:'2026-02-01',to:'2026-02-02',...selection}).matchAll(/data-category-meta="([^"]+)"/g)]
    .map(([,meta]) => JSON.parse(meta.replaceAll('&quot;', '"')));

  const revenue = renderTips({compareMode:'yoy'});
  for (const dimension of ['categories','brands']) {
    const tip = revenue.find(row => row.dimension === dimension);
    assert.equal(tip.period,'01.02.2026 — 02.02.2026');
    assert.equal(tip.baselineLabel,'01.02.2025 — 02.02.2025');
    assert.deepEqual([tip.formattedValue,tip.formattedPrior,tip.formattedDelta],['20 ₴','10 ₴','+100%']);
  }

  const quantity = renderTips({compareMode:'mom',categoryMeasure:'goods',brandMeasure:'goods'});
  assert.ok(quantity.every(tip => tip.baselineLabel === '01.01.2026 — 02.01.2026'));
  assert.deepEqual(quantity.map(tip => [tip.formattedValue,tip.formattedPrior,tip.formattedDelta]), [
    ['33,12 м²','24 м²','+38%'], ['4 шт.','0 шт.','Немає бази'], ['2 шт.','—','Немає бази'],
  ]);
});

test('conversion falls back only to complete unthresholded daily GA4 data',()=>{
 const days=[{date:'2026-11-01',sessions:100,purchases:2},{date:'2025-11-01',sessions:100,purchases:1}];
 const query={...state,from:'2026-11-01',to:'2026-11-01'};
 const data={channels:{available:false},history:{web:{available:true,days}}};
 const conversion=(data,query)=>overviewModel(data,query).metrics.find(metric=>metric.key==='conversion');
 const metric=conversion(data,query);
 assert.equal(metric.value,2);assert.equal(metric.prior,1);assert.equal(metric.delta,100);
 assert.equal(conversion({...data,history:{web:{available:true,days,thresholded:true}}},query).value,null);
 assert.equal(conversion(data,{...query,to:'2026-11-02'}).value,null);
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

test('catalog opens daily Content Score history from the monthly change', () => {
  const tile = {
    label:'Плитка', scoreBase:60.34, scoreBaseDate:'2026-11-30', score:60.64, scoreDate:'2026-12-02', scoreChange:0.3,
    scoreHistory:[
      {date:'2026-12-01', score:60.64, daily:0.3, monthChange:0.3},
      {date:'2026-12-02', score:60.64, daily:0, monthChange:0.3},
      {date:'2026-12-03', score:null, daily:null, monthChange:null},
    ],
  };
  const catalogHealth = {available:true, scoreStart:'2026-12-01', scoreDate:'2026-12-02', segments:[tile]};
  const card = renderBusinessOverview({catalogHealth}, state);
  assert.match(card, /60,34<button[^>]+data-catalog-score-history="Плитка"[^>]+aria-haspopup="dialog"[^>]*>\+0,3<\/button>/);
  const history = renderCatalogScoreHistory(tile, catalogHealth.scoreStart);
  assert.match(history, /<strong>60,34<\/strong> від 30\.11\.2026/);
  assert.match(history, /03\.12\.2026<\/th><td>Немає даних<\/td>/);
  assert.match(history, /02\.12\.2026<\/th><td>60,64<\/td>\s*<td class="">0<\/td><td class="up">\+0,3<\/td>/);
});
