import test from 'node:test';
import assert from 'node:assert/strict';
import { chartMonthChange } from '../src/lib/chart-month-change.ts';
test('point change uses month start rather than the preceding day',()=>{
 assert.equal(chartMonthChange(90,100),-10);
 assert.equal(chartMonthChange(110,100),10);
 assert.equal(chartMonthChange(100,100),0);
 assert.equal(chartMonthChange(5888,6000),-112/6000*100);
});
test('missing history and growth from zero have no fabricated percentage',()=>{
 assert.equal(chartMonthChange(10,0),null);
 assert.equal(chartMonthChange(0,0),0);
 assert.equal(chartMonthChange(10,null),null);
 assert.equal(chartMonthChange(null,10),null);
});
