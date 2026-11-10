import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceLoader} from './helpers/load-source.mjs';
const {dailyComparisons,relativeChange}=sourceLoader()('@/lib/product-daily-comparison');
test('period rates use summed events, impressions sum, and CS uses last saved point',()=>{
 const points=[{date:'2026-11-01',impressions:100,views:10,carts:2,contentScore:60},
 {date:'2026-11-02',impressions:900,views:90,carts:9,contentScore:61},
 {date:'2026-11-03',impressions:9999,views:999,carts:999,contentScore:62}];
 const year=[{date:'2025-11-01',impressions:200,views:20,carts:1,contentScore:50},
 {date:'2025-11-02',impressions:300,views:30,carts:1,contentScore:51},
 {date:'2025-11-03',impressions:9999,views:999,carts:999,contentScore:null}];
 const totals=dailyComparisons(points,year,'2026-11-02');
 assert.equal(totals.impressions.current,1000);
 assert.equal(totals.impressions.year,500);
 assert.equal(totals.ctr.current,10);
 assert.equal(totals.atc.current,11);
 assert.equal(totals.atc.year,4);
 assert.equal(totals.contentScore.current,62);
 assert.equal(totals.contentScore.year,null);
 assert.equal(totals.impressions.yearThrough,'2025-11-02');
});
test('relative growth handles decline, zero current, missing data and zero baseline',()=>{
 assert.ok(Math.abs(relativeChange(3.67,2.34)-56.837606837606835)<1e-9);
 assert.equal(relativeChange(0,2),-100);
 assert.equal(relativeChange(2,4),-50);
 assert.equal(relativeChange(2,2),0);
 assert.equal(relativeChange(2,0),null);
 assert.equal(relativeChange(null,2),null);
 assert.equal(dailyComparisons([],[],null).ctr.current,null);
});
