import test from "node:test";
import assert from "node:assert/strict";
import {
  revenueWaterfall,
  waterfallComparison,
} from "../revenue-waterfall.mjs";
const sales = (revenue, docs = 10) => ({
  available: true,
  metrics: { shippedRevenue: revenue, shippedDocs: docs },
});
const current = {
  all: sales(4040000),
  site: sales(3000000, 150),
  rozetka: sales(6000000 / 10),
  monomarket: sales(440000),
  traffic: { available: true, rows: [{ sessions: 1100, purchases: 150 }] },
};
const previous = {
  all: sales(3590000),
  site: sales(2800000, 140),
  rozetka: sales(450000),
  monomarket: sales(340000),
  traffic: { available: true, rows: [{ sessions: 1000, purchases: 140 }] },
};
test("waterfall uses a single ERP identity without a cross-system adjustment", () => {
  const report = revenueWaterfall(
    current,
    previous,
    { from: "2026-11-01", to: "2026-11-15" },
    { from: "2025-11-01", to: "2025-11-15" },
  );
  assert.equal(report.available, true);
  assert.ok(
    Math.abs(
      report.start +
        report.steps.reduce((sum, step) => sum + step.value, 0) -
        report.end,
    ) < 0.01,
  );
  assert.ok(report.steps.some((step) => step.key === "marketplaces"));
  assert.ok(Math.abs(report.residual) < 0.01);
  const changed = {
    ...current,
    traffic: { available: true, rows: [{ sessions: 2000, purchases: 200 }] },
  };
  assert.deepEqual(revenueWaterfall(changed, previous, {}, {}).steps, report.steps);
  assert.ok(!report.steps.some(step=>step.key==='reconcile'));
});
test("invalid or missing baselines are explicit rather than fabricated", () => {
  assert.equal(
    revenueWaterfall(
      { ...current, site: { available: false } },
      previous,
      {},
      {},
    ).available,
    false,
  );
  assert.deepEqual(
    waterfallComparison({ from: "2026-03-01", to: "2026-03-31" }, "month"),
    { from: "2026-02-01", to: "2026-02-28" },
  );
  assert.deepEqual(
    waterfallComparison({ from: "2026-11-01", to: "2026-11-15" }, "month"),
    { from: "2026-10-01", to: "2026-10-15" },
  );
});


import { overviewRevenueWaterfall } from '../public/revenue-drivers.mjs';
function overviewFixture(){
 return {sales:{...current.all,previous:previous.all},salesChannels:Object.fromEntries(['site','rozetka','monomarket'].map(id=>[id,{...current[id],previous:previous[id]}])),history:{web:{available:true,days:[{date:'2026-11-15',sessions:1100,purchases:150},{date:'2025-11-15',sessions:1000,purchases:140},{date:'2026-10-15',sessions:1000,purchases:140}]}}};
}
test('overview driver chart reuses ERP aggregates and does not depend on GA4 attribution rates',()=>{
 const range={from:'2026-11-15',to:'2026-11-15'},data=overviewFixture();
 const report=overviewRevenueWaterfall(data,range);
 assert.equal(report.available,true);assert.equal(report.start,3590000);assert.equal(report.end,4040000);
 assert.ok(Math.abs(report.start+report.steps.reduce((sum,step)=>sum+step.value,0)-report.end)<.01);
 assert.equal(overviewRevenueWaterfall({...data,history:{web:{...data.history.web,thresholded:true}}},range).available,true);
 assert.equal(overviewRevenueWaterfall({...data,history:{web:{available:true,days:data.history.web.days.slice(0,1)}}},range).available,true);
 assert.equal(overviewRevenueWaterfall({...data,salesChannels:{}},range),null);
});
test('previous-month drivers accept only the exact requested ERP baseline and preserve missing source data',()=>{
 const range={from:'2026-11-15',to:'2026-11-15'},data=overviewFixture();
 assert.equal(overviewRevenueWaterfall(data,range,'month'),null);
 data.waterfallBaseline={range:{from:'2026-10-15',to:'2026-10-15'},...previous};
 assert.equal(overviewRevenueWaterfall(data,range,'month').available,true);
 data.waterfallBaseline.range.to='2026-10-14';
 assert.equal(overviewRevenueWaterfall(data,range,'month'),null);
 data.waterfallBaseline.range.to='2026-10-15';data.waterfallBaseline.site={available:false};
 assert.equal(overviewRevenueWaterfall(data,range,'month').available,false);
});
