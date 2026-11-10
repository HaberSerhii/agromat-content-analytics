import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './helpers/load-source.mjs';

function setup({ failQuery = false, failWrite = false, historicalEvents = false, customRows = null } = {}) {
  const files = new Map([['/snapshots/product-content-snapshots/2026-11-01.json', JSON.stringify({10:20,20:80,30:100})]]);
  let query;
  const { dailyProductPoints, buildProductDailyDynamics } = sourceLoader({ mocks: {
    '@google-cloud/bigquery': { BigQuery: class { async query(options) { query=options; if (failQuery) throw Error('offline'); return [customRows ?? [{date:{value:'2026-11-01'},impressions:100,views:20,carts:5}, ...(historicalEvents ? [{date:'2025-11-01',impressions:200,views:10,carts:2}] : [])]]; } } },
    '@/lib/bigquery-result-cache': { readThroughBigQueryCache: ({load}) => load() },
    'node:fs': {promises:{ mkdir: async()=>{}, writeFile:async(p,value)=>{if(failWrite)throw Error('disk');files.set(p,value);},rename:async(from,to)=>files.set(to,files.get(from)),readFile:async p=>{if(!files.has(p))throw Error('missing');return files.get(p);} }},
    'node:path': path,
  }, globals:{crypto:{randomUUID:()=> 'test'},process:{env:{PRODUCT_SNAPSHOTS_DIR:'/snapshots/product-snapshots'},cwd:()=>'/repo',pid:1}} })('@/lib/product-daily-dynamics');
  return {dailyProductPoints,buildProductDailyDynamics,files,getQuery:()=>query};
}
import path from 'node:path';
const plain = value => JSON.parse(JSON.stringify(value));

test('daily series uses weighted rates, missing denominators and unavailable data remain null', () => {
  const {dailyProductPoints}=setup();
  const points=plain(dailyProductPoints('2026-11-03',[{date:'2026-11-01',impressions:1000,views:25,carts:5}],new Map([['2026-11-03',70]]),true));
  assert.equal(points.length,3);
  assert.deepEqual(points[0],{date:'2026-11-01',impressions:1000,ctr:2.5,atc:20,contentScore:null,views:25,carts:5});
  assert.deepEqual(points[1],{date:'2026-11-02',impressions:0,ctr:null,atc:null,contentScore:null,views:0,carts:0});
  assert.equal(points[2].contentScore,70);
  assert.equal(dailyProductPoints('2026-11-03',[],new Map(),false)[0].impressions,null);
});

test('query covers current month and exact selection; CS uses saved day values without backfilling', async()=>{
  const {buildProductDailyDynamics,getQuery,files}=setup();
  const all=[{code:10,goodsRef:100,contentScore:60},{code:20,goodsRef:200,contentScore:90},{code:30,goodsRef:300,contentScore:null}];
  const result=await buildProductDailyDynamics('2026-11-03',[all[0]],all,'`project.dataset.events`');
  assert.deepEqual(plain(getQuery().params),{from:'2026-11-01',to:'2026-11-03',completedThrough:'2026-11-02',yearFrom:'2025-11-01',yearTo:'2025-11-03',refs:[100]});
  assert.deepEqual(plain(result.points.map(p=>p.contentScore)),[20,null,60]);
  assert.equal(result.points[0].ctr,20);
  assert.equal(result.points[0].atc,25);
  assert.deepEqual(JSON.parse(files.get('/snapshots/product-content-snapshots/2026-11-03.json')),{'10':60,'20':90,'30':null});
});

test('empty selection does not query all products and failures keep CS usable',async()=>{
  const empty=setup();
  const result=await empty.buildProductDailyDynamics('2026-11-03',[],[], '`events`');
  assert.equal(empty.getQuery(),undefined);
  assert.equal(result.points[0].contentScore,null);
  const failed=setup({failQuery:true,failWrite:true});
  const p={code:10,goodsRef:100,contentScore:60};
  const failure=await failed.buildProductDailyDynamics('2026-11-03',[p],[p],'`events`');
  assert.equal(failure.points[0].impressions,null);
  assert.equal(failure.points[2].contentScore,60);
  assert.ok(failure.error);
});

test('year comparison uses identical month/day window and clamps leap day without duplicating it', async()=>{
 const {previousYearPeriod}=sourceLoader()('@/lib/product-daily-dynamics');
 assert.deepEqual(plain(previousYearPeriod('2026-11-10')),{from:'2025-11-01',to:'2025-11-10'});
 assert.deepEqual(plain(previousYearPeriod('2024-02-29')),{from:'2023-02-01',to:'2023-02-28'});
 const {buildProductDailyDynamics}=setup();
 const p={code:10,goodsRef:100,contentScore:60};
 const result=await buildProductDailyDynamics('2026-11-03',[p],[p],'`events`');
 assert.equal(result.year.length,3);
 assert.equal(result.year[0].date,'2025-11-01');
 assert.equal(result.year[0].impressions,null);
 assert.equal(result.year[0].contentScore,null);
});

test('past year rates are calculated from its own events for the same selection', async()=>{
 const {buildProductDailyDynamics}=setup({historicalEvents:true});
 const p={code:10,goodsRef:100,contentScore:60};
 const result=await buildProductDailyDynamics('2026-11-03',[p],[p],'`events`');
 assert.equal(result.points[0].ctr,20);
 assert.equal(result.year[0].impressions,200);
 assert.equal(result.year[0].ctr,5);
 assert.equal(result.year[0].atc,20);
});

test('source watermark clips both periods even when the selected set has no events on the last loaded day',async()=>{
 const {buildProductDailyDynamics}=setup({customRows:[
  {date:'2026-11-01',impressions:100,views:20,carts:2,available_through:{value:'2026-11-02'}},
  {date:'2026-11-03',impressions:9999,views:999,carts:99,available_through:{value:'2026-11-02'}},
  {date:'2025-11-01',impressions:200,views:10,carts:2,available_through:{value:'2026-11-02'}},
  {date:'2025-11-03',impressions:9999,views:999,carts:99,available_through:{value:'2026-11-02'}},
 ]});
 const p={code:10,goodsRef:100,contentScore:60};
 const result=await buildProductDailyDynamics('2026-11-03',[p],[p],'`events`');
 assert.equal(result.points[1].impressions,0);
 assert.equal(result.points[2].impressions,null);
 assert.equal(result.year[2].impressions,null);
 assert.equal(result.summary.impressions.through,'2026-11-02');
 assert.equal(result.summary.impressions.current,100);
 assert.equal(result.summary.impressions.year,200);
 assert.equal(result.summary.atc.current,10);
 assert.equal(result.summary.atc.year,20);
});

test('past month covers the whole month while current month excludes today from completed totals',async()=>{
 const {dailyMonthPeriod}=sourceLoader()('@/lib/product-daily-dynamics');
 assert.deepEqual(plain(dailyMonthPeriod('2026-11-10','2026-10')),{from:'2026-10-01',end:'2026-10-31',completedThrough:'2026-10-31'});
 assert.equal(dailyMonthPeriod('2026-11-10','2024-02').end,'2024-02-29');
 assert.equal(dailyMonthPeriod('2026-11-10','2026-11').completedThrough,'2026-11-09');
 assert.throws(()=>dailyMonthPeriod('2026-11-10','2026-12'));
 assert.throws(()=>dailyMonthPeriod('2026-11-10','2026-13'));
 const api=setup();
 await api.buildProductDailyDynamics('2026-11-10',[],[],'`events`','2026-10');
});
