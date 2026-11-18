import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildTileStockWatch,inventoryItemSignals,tileSalesStart} from '../inventory-demand.mjs';

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

test('tile stock watch filters by revenue and views and signals low known stock only', () => {
  const item = (code, views, stock, segment='Плитка') => ({code,name:code,views,stock,segment,
    days:[{date:'2026-11-18', stock, views, docs:1, siteRevenue:10}]});
  const items = [item('low',500,29),item('ok',550,30),item('missing',600,null),
    item('out',700,0),item('low-views',499,0),item('low-revenue',501,0),
    item('plumbing',600,0,'Сантехніка')];
  const revenue = new Map([['low',10_000],['ok',20_000],['missing',30_000],['out',15_000],
    ['low-views',40_000],['low-revenue',9_999.99],['plumbing',40_000]]);
  const watch = buildTileStockWatch(items,revenue);
  assert.equal(watch.alerts,2);
  assert.deepEqual(watch.rows.map(row=>[row.code,row.status]),
    [['missing','unknown'],['ok','ok'],['out','low'],['low','low']]);
  assert.deepEqual(watch.rows[0].days,[{date:'2026-11-18',stock:null,views:600,docs:1}]);
});

test('the six-month sales window crosses years and clips short months', () => {
  assert.equal(tileSalesStart('2026-11-19'),'2026-05-19');
  assert.equal(tileSalesStart('2026-02-19'),'2025-08-19');
  assert.equal(tileSalesStart('2024-08-31'),'2024-02-29');
});
