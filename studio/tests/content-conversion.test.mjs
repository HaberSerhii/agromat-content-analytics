import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContentReport, compactContentTraffic, contentBucket, contentCatalogue, contentOpportunities, contentShipments, contentTable} from '../content-conversion.mjs';
import {contentFunnelQuery} from '../content-conversion-query.mjs';
import {contentBaseline,contentSelection} from '../public/content-conversion-filters.mjs';

const today = '2026-11-19';
const select = params => contentSelection({from:'2026-11-16',to:'2026-11-18',...params},today);
const product = (code,extra={}) => ({id:code,code,goodsRef:code+100,name:'Товар '+code,brand:'Бренд',
  categoryId:1,categoryName:'Тест',categoryPath:'Корінь / Тест',stockQty:2,price:200,currency:'UAH',
  imagesCount:3,reviewsCount:1,...extra});
const event = (period,day,ref,sessions,atc,purchases = 0,extra = {}) => ({
  period,day,ref,sessions,views:sessions,atc,purchase_sessions:purchases,purchases,incomplete_revenue:0,revenue:purchases*250,...extra,
});
const sampleCatalogue = products => contentCatalogue(products, {
  required:{1:[10,20]},present:new Map([[1,new Set([10])],[2,new Set([10,20])]]),
  names:new Map([[20,'Довжина']]),
},new Set(['1']));

test('validated ranges compare equal lengths at leap dates and reject unexpected inputs', () => {
  const range=contentSelection({from:'2024-02-29',to:'2024-03-02',comparison:'year'},today);
  assert.deepEqual(contentBaseline(range),{from:'2023-02-28',to:'2023-03-02'});
  assert.deepEqual(contentBaseline(select({})),{from:'2026-11-13',to:'2026-11-15'});
  for (const values of [{to:today},{from:'2026-08-01'},{device:'smartwatch'},{minScore:'81',maxScore:'80'},{bucket:'5'},
    {from:'2026-02-30'},{query:'anything'}]) assert.throws(()=>select(values));
  assert.throws(()=>contentSelection('device=desktop&device=mobile',today));
});

test('catalogue uses categorical attributes, review counts and rejects ambiguous SKU joins', () => {
  const {catalogue,refs,ambiguous} = sampleCatalogue([
    product(1), product(2), product(3,{goodsRef:102}), product(4), product(4,{id:40}), product(5,{deleted:true,goodsRef:101}),
  ]);
  assert.deepEqual([...refs],[[101,'1']]);
  assert.equal(ambiguous,2);
  assert.equal(catalogue.length,3);
  assert.deepEqual(catalogue[0].missing,['Довжина']);
  assert.equal(catalogue[0].attributes,50);
  assert.equal(catalogue[1].attributes,100);
  assert.equal(catalogue[2].attributes,null);
  assert.deepEqual([20,20.1,80,80.1,100].map(score=>contentBucket('score',score)),[0,1,3,4,4]);
  assert.deepEqual([0,1,2,3,4].map(count=>contentBucket('reviews',count)),[0,1,2,2,3]);
});

test('historical groups use exact daily scores, SKU-session rates are weighted, and missing days stay visible', async () => {
  const scores = {'2026-11-16':{'1':50,'2':90},'2026-11-18':{'1':90,'2':80}};
  const traffic = compactContentTraffic();
  traffic.add([
    event('coverage','20261116',null,0,0),event('coverage','20261117',null,0,0),event('coverage','20261118',null,0,0),
    event('coverage','20261113',null,0,0),
    event('current','20261116',101,100,20,2),event('current','20261116',102,10,9,1),
    event('current','20261117',101,30,0,0),event('current','20261118',101,10,5,0),
    event('current','20261118',999,10,0,0),event('previous','',101,80,10,1),
  ]);
  const report = await buildContentReport({catalog:sampleCatalogue([product(1),product(2)]),traffic,
    readScore:async date=>scores[date],scoreDates:Object.keys(scores)},select({}));
  assert.equal(report.current.sessions,150);
  assert.equal(report.current.atcRate,34/150*100);
  assert.equal(report.current.high,2);
  assert.equal(report.baseline.mean,null);
  assert.equal(report.complete,false);
  assert.equal(report.unscored,30);
  assert.equal(report.unmatched,10);
  assert.equal(report.groups.score[2].sessions,100);
  assert.equal(report.groups.score[4].sessions,20);
  assert.equal(report.groups.score[4].skus,2);
  assert.equal(report.groups.attributes[1].sessions,140);
  assert.deepEqual(report.daily.map(row=>row.score),[70,null,85]);
  assert.equal(report.tables.history.length,0,'a score gap cannot establish a change date');
  assert.equal(contentTable(report,select({table:'score',bucket:'4'})).total,2);
  assert.equal(contentTable(report,select({table:'score',bucket:'4',sort:'name',direction:'desc'})).rows[0].code,'2');

  const partial = await buildContentReport({catalog:sampleCatalogue([product(1)]),traffic:null,
    readScore:async date=>scores[date],scoreDates:Object.keys(scores)},select({}));
  assert.equal(partial.current.atcRate,null);
  assert.equal(partial.current.mean,90);
  assert.equal(partial.groups.photos[3].sessions,null);
});

test('history uses equal seven-day windows, excludes change day and compares a stable peer cohort', async () => {
  const from='2026-11-04', to='2026-11-18', change='2026-11-11';
  const selection=select({from,to,table:'history'});
  const traffic=compactContentTraffic(), scores={};
  const products = Array.from({length:6},(_,i)=>product(i+1));
  for (let offset=4;offset<=18;offset++) {
    const day='2026-11-'+String(offset).padStart(2,'0');
    const suffix=day.replaceAll('-','');
    scores[day]=Object.fromEntries(products.map(({code})=>[code,code===1 && day>=change?85:60]));
    traffic.add([event('coverage',suffix,null,0,0),...products.map(({code})=>
      event('current',suffix,100+code,20,0,day===change?20:day>change?(code===1?4:2):1))]);
  }
  const report=await buildContentReport({catalog:sampleCatalogue(products),traffic,
    readScore:async date=>scores[date],scoreDates:Object.keys(scores)},selection);
  const changed=report.tables.history[0];
  assert.equal(changed.date,change);
  assert.equal(changed.before.sessions,140);
  assert.equal(changed.after.sessions,140);
  assert.equal(changed.after.purchases,28);
  assert.equal(report.tables.improved[0].windowDays,7);
  // Product 1 is on promotion, so no five otherwise comparable controls exist.
  assert.equal(changed.control,null);
  const controls=await buildContentReport({catalog:contentCatalogue(products,null,new Set()),traffic,
    readScore:async date=>scores[date],scoreDates:Object.keys(scores)},selection);
  assert.equal(controls.tables.history[0].control.count,5);
  assert.equal(controls.tables.history[0].adjusted,10);
});

test('improved SKU table requires score growth and a measured conversion change in both covered windows', async () => {
  const from='2026-11-10', to='2026-11-18', change='2026-11-14';
  const selection=select({from,to,table:'improved'});
  const traffic=compactContentTraffic(), scores={};
  const products=Array.from({length:9},(_,i)=>product(i+1));
  for (let offset=10;offset<=18;offset++) {
    const date='2026-11-'+offset;
    const suffix=date.replaceAll('-','');
    const after=date>change;
    scores[date]=Object.fromEntries(products.map(({code})=>[code,date<change ? 60 : code===5 ? 40 : 80]));
    if (offset>=18) scores[date][7]=85; // A second change has no completed after day.
    if (offset===15) delete scores[date][8];
    traffic.add([event('coverage',suffix,null,0,0),...products.map(({code})=>{
      const sessions=code===6 && after ? 0 : 30;
      const atc=after && code===2 ? 6 : after && code===3 ? 1 : 3;
      const purchases=[1,5].includes(code) && after ? 3 : code===9 && !after ? 2 : 0;
      return event('current',suffix,100+code,sessions,sessions?atc:0,purchases);
    })]);
  }
  const report=await buildContentReport({catalog:sampleCatalogue(products),traffic,
    readScore:async date=>scores[date],scoreDates:Object.keys(scores)},selection);
  assert.deepEqual(report.improvements,{increases:8,comparable:5,results:4});
  assert.equal(report.historyExposures,0,'the history view still requires seven-day windows');
  const {rows}=contentTable(report,selection);
  assert.deepEqual(rows.map(row=>row.code),['1','2','3','9']);
  assert.ok(rows.every(row=>row.windowDays===4 && row.before.sessions===120 && row.after.sessions===120));
  assert.deepEqual(rows[0].beforeRange,{from:'2026-11-10',to:'2026-11-13'});
  assert.deepEqual(rows[0].afterRange,{from:'2026-11-15',to:'2026-11-18'});
  assert.equal(rows[1].change,0);
  assert.equal(rows[1].atcChange,10);
  assert.ok(rows[3].change<0);
  assert.throws(()=>select({table:'improved',bucket:'1'}));
});

test('a scenario needs five matched, high-score SKUs with adequate traffic', () => {
  const base = {categoryId:2,brand:'One',priceBand:'high',stock:'in',promo:'no',sessions:150,
    purchases:10,revenue:5000,photos:6,reviews:1};
  const peers = Array.from({length:5},(_,i)=>({...base,code:String(i),score:90,purchaseRate:10}));
  const candidate = {...base,code:'x',score:45,photos:2,purchaseRate:2};
  assert.equal(contentOpportunities([candidate,...peers.slice(1)]).length,0);
  const [row]=contentOpportunities([candidate,...peers]);
  assert.equal(row.potentialOrders,12);
  assert.equal(row.potentialRevenue,6000);
});

test('ERP repeats of the same document and SKU line do not duplicate SKU orders', () => {
  const item = {code:'1',revenue:200,qty:1};
  const row = {docsRef:'private-id',shippedDate:'2026-11-16',state:'Повністю відвантажено',docsSum:400,
    goodsCount:2,returnSum:30,returnGoodsCodes:['1'],returnRowSums:[30],items:[item,item]};
  const data=contentShipments({rows:[row,row]},select({}),new Map([['1',true]]));
  assert.deepEqual(data.get('1'),{revenue:370,orders:1});
});

test('query checks event order and exports only aggregates for bounded date partitions', () => {
  const query=contentFunnelQuery('agromat-test','analytics_test',[{key:'current',from:'2026-11-16',to:'2026-11-18'}],
    {device:'tablet',source:'organic'});
  assert.match(query.query,/p\.ts > v\.pdp\.ts/);
  assert.match(query.query,/c\.last_cart > v\.pdp\.ts/);
  assert.match(query.query,/PARTITION BY p\.period, p\.ref, p\.transaction_id/);
  assert.match(query.query,/_TABLE_SUFFIX BETWEEN @from0 AND @to0/);
  assert.equal(query.params.device,'tablet');
  assert.equal(query.maximumBytesBilled,'20000000000');
});
