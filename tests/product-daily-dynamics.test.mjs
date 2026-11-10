import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './helpers/load-source.mjs';

function setup({ failQuery = false, failWrite = false } = {}) {
  const files = new Map([['/snapshots/product-content-snapshots/2026-11-01.json', JSON.stringify({10:20,20:80,30:100})]]);
  let query;
  const { dailyProductPoints, buildProductDailyDynamics } = sourceLoader({ mocks: {
    '@google-cloud/bigquery': { BigQuery: class { async query(options) { query=options; if (failQuery) throw Error('offline'); return [[{date:{value:'2026-11-01'},impressions:100,views:20,carts:5}]]; } } },
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
  assert.deepEqual(points[0],{date:'2026-11-01',impressions:1000,ctr:2.5,atc:20,contentScore:null});
  assert.deepEqual(points[1],{date:'2026-11-02',impressions:0,ctr:null,atc:null,contentScore:null});
  assert.equal(points[2].contentScore,70);
  assert.equal(dailyProductPoints('2026-11-03',[],new Map(),false)[0].impressions,null);
});

test('query covers current month and exact selection; CS uses saved day values without backfilling', async()=>{
  const {buildProductDailyDynamics,getQuery,files}=setup();
  const all=[{code:10,goodsRef:100,contentScore:60},{code:20,goodsRef:200,contentScore:90},{code:30,goodsRef:300,contentScore:null}];
  const result=await buildProductDailyDynamics('2026-11-03',[all[0]],all,'`project.dataset.events`');
  assert.deepEqual(plain(getQuery().params),{from:'2026-11-01',to:'2026-11-03',refs:[100]});
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
