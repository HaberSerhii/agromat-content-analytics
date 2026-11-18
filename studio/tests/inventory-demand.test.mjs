import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildStockWatch,inventoryItemSignals,inventorySection,inventorySegment} from '../inventory-demand.mjs';

const day = (stock, views, siteRevenue=0) => ({stock, views, siteRevenue});

test('stock gaps stay out of lost-demand counts and estimates require a sales baseline', () => {
  const days = [...Array(7)].map((_,i)=>day(5,10,i<3?100:0));
  days.push(day(null,50),day(0,20),day(0,20,10));
  const result = inventoryItemSignals(days,true);
  assert.equal(result.outDays,2);
  assert.equal(result.missedViews,40);
  assert.equal(result.opportunity,40*300/70-10);
  assert.equal(result.risk,'out');
  assert.equal(inventoryItemSignals(days,false).opportunity,null);
});

test('risk requires demand and enough consecutive recorded stock changes', () => {
  const declining = [9,8,7,6,5,4,3].map(stock=>day(stock,2));
  const result = inventoryItemSignals(declining,true);
  assert.equal(result.risk,'low');
  assert.equal(result.cover,3);
  assert.equal(inventoryItemSignals(declining.map(d=>({...d,views:null})),true).risk,'none');
  assert.equal(inventoryItemSignals([...declining.slice(0,-1),day(null,2)],true).risk,'unknown');
});

test('stock watch applies inclusive segment thresholds after YTD sales and weekly GA4 filters', () => {
  const item = (code, recentViews, stock, segment='Плитка') => ({code,views:500,recentViews,stock,segment});
  const items = [item('tile',100,20),item('tile-ok',101,21),item('floor',100,20,'Підлогові покриття'),
    item('plumbing',100,3,'Сантехніка'),item('chemicals',100,3,'Будівельна хімія'),
    item('station',100,3,'Зарядні станції'),item('station-ok',101,4,'Зарядні станції'),
    item('missing',102,null),item('low-views',99,0),item('low-revenue',101,0),item('other',100,0,'Інше')];
  const revenue = new Map(items.map(({code})=>[code,5_000]));
  revenue.set('missing',10_000);
  revenue.set('low-revenue',4_999.99);
  const watch = buildStockWatch(items,revenue);
  assert.equal(watch.alerts,5);
  assert.equal(watch.rows[0].code,'missing');
  assert.deepEqual(Object.fromEntries(watch.rows.map(row=>[row.code,[row.status,row.threshold,row.views]])),{
    tile:['low',20,100],'tile-ok':['ok',20,101],floor:['low',20,100],plumbing:['low',3,100],
    chemicals:['low',3,100],station:['low',3,100],'station-ok':['ok',3,101],missing:['unknown',20,102],
  });
});

test('charging stations are distinct from plumbing and other power products', () => {
  assert.equal(inventorySegment({categoryPath:'Джерела живлення / Зарядні станції'},'020.001'),'Зарядні станції');
  assert.equal(inventorySegment({categoryName:'Зарядні станції'}),'Зарядні станції');
  assert.equal(inventorySegment({categoryPath:'Джерела живлення / Аксесуари'},'020.001'),null);
  assert.equal(inventorySegment({categoryName:'Насосні станції'},'002.001'),'Сантехніка');
});

test('category filtering has its own product ranking and totals beyond the aggregate shortlist', () => {
  const item = (code,category,views) => ({code,category,views,missedViews:views,outDays:1,risk:'none',opportunity:null});
  const candidates = [...Array(25)].map((_,i)=>item(`tile-${i}`,'Плитка',10+i));
  candidates.push(item('sink','Раковини',2));
  const scope = inventorySection('Усі сегменти',candidates,true);
  assert.ok(!scope.rows.includes('sink'));
  const sink = scope.categories.find(category=>category.name==='Раковини');
  assert.deepEqual(sink.rows,['sink']);
  assert.equal(sink.views,2);
  assert.equal(sink.total.missedViews,2);
  assert.equal(sink.total.outDays,1);
});
