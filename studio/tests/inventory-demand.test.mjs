import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inventoryItemSignals} from '../inventory-demand.mjs';

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
