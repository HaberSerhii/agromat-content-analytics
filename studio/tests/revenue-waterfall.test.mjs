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
  site: sales(3090000, 299),
  rozetka: sales(550000),
  monomarket: sales(400000),
  traffic: { available: true, sessions: 21000, purchases: 150 },
};
const previous = {
  all: sales(3590000),
  site: sales(2800000, 280),
  rozetka: sales(450000),
  monomarket: sales(340000),
  traffic: { available: true, sessions: 20000, purchases: 140 },
};
test("waterfall explains the example's growth by traffic, shipped conversion, average check and marketplaces", () => {
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
  assert.deepEqual(report.steps.map(step=>[step.key,Math.round(step.value)]),[
    ['traffic',140000],['conversion',50000],['aov',100000],['marketplaces',160000],
  ]);
  assert.ok(Math.abs(report.residual) < 0.01);
  const changed = {
    ...current,
    traffic: { ...current.traffic, purchases: 200 },
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
 return {sales:{...current.all,previous:previous.all},salesChannels:Object.fromEntries(['site','rozetka','monomarket'].map(id=>[id,{...current[id],previous:previous[id]}])),channels:{...current.traffic,previous:previous.traffic}};
}
test('overview driver chart uses selected-period traffic and shows an ERP order fallback for incomplete GA4',()=>{
 const range={from:'2026-11-15',to:'2026-11-15'},data=overviewFixture();
 const report=overviewRevenueWaterfall(data,range);
 assert.equal(report.available,true);assert.equal(report.start,3590000);assert.equal(report.end,4040000);
 assert.ok(Math.abs(report.start+report.steps.reduce((sum,step)=>sum+step.value,0)-report.end)<.01);
 assert.equal(report.steps[0].key,'traffic');
 for (const traffic of [{complete:false},{thresholded:true},{sessions:0},{range:{from:'2026-11-14',to:range.to}}]) {
   const fallback=overviewRevenueWaterfall({...data,channels:{...data.channels,...traffic}},range);
   assert.deepEqual(fallback.steps.map(step=>step.key),['orders','aov','new-products','marketplaces']);
   assert.equal(fallback.steps.find(step=>step.key==='new-products').value,null);
   assert.equal(fallback.residual,0);
 }
 assert.equal(overviewRevenueWaterfall({...data,salesChannels:{}},range),null);
});
test('channel scopes reconcile independently, including negative and zero-order contributions',()=>{
 const range={from:'2026-11-15',to:'2026-11-15'},data=overviewFixture();
 const site=overviewRevenueWaterfall(data,{...range,salesScope:'site'});
 const market=overviewRevenueWaterfall(data,{...range,salesScope:'marketplaces'});
 assert.deepEqual(site.steps.map(step=>step.key),['traffic','conversion','aov','new-products']);
 assert.deepEqual(market.steps.map(step=>[step.key,step.value]),[['new-products',null],['marketplaces',160000]]);
 assert.equal(site.end+market.end,current.all.metrics.shippedRevenue);
 const decrease=revenueWaterfall(previous,current,{},{});
 assert.ok(decrease.steps.every(step=>step.value<0));
 assert.ok(Math.abs(decrease.residual)<.01);
 const firstSales=revenueWaterfall(current,{...previous,all:sales(790000),site:sales(0,0)},{},{});
 assert.deepEqual(firstSales.steps.map(step=>step.key),['site','marketplaces']);
 assert.equal(firstSales.residual,0);
});

test('cancellation effect and new SKU shipments each contribute once to the realized revenue change',()=>{
 const receive = (received,receivedAmount,canceledAmount) => ({available:true,received,receivedAmount,canceledAmount,
   canceledAmountShare:canceledAmount/receivedAmount});
 const prior={...previous,orderLoss:receive(1000,4000000,1000000)};
 const now={...current,orderLoss:receive(1200,4800000,960000),
   assortment:{available:true,newRevenue:110000,newSiteRevenue:70000,effect:-190000}};
 const report=revenueWaterfall(now,prior,{},{});
 assert.deepEqual(report.steps.map(step=>[step.label,Math.round(step.value)]),[
   ['Трафік',140000],['CR',-190000],['AOV',30000],['Ефект скасувань',240000],['Нові товари',110000],['Маркетплейси',120000],
 ]);
 assert.ok(Math.abs(report.residual)<.01);
 assert.equal(revenueWaterfall(prior,now,{},{}).steps.find(step=>step.key==='order-loss').value < 0,true);
 const missingBase = revenueWaterfall(now,{...prior,orderLoss:{available:false}},{},{});
 assert.equal(missingBase.steps.find(step=>step.key==='order-loss').value,0);
 assert.equal(missingBase.residual,0);
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
