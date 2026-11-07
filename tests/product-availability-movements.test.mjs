import test from 'node:test';
import assert from 'node:assert/strict';
import { AvailabilityMovements } from '../src/lib/product-availability-movements.ts';
const filter = { categories: [], brands: [], promotion: 'all' };
const snap = (states, date = '2026-11-01') => ({ date, syncedAt:date+'T12:00:00Z', categories:[['10','Tiles'],['20','Bath']], brands:[['1','A'],['2','B']], products:states.map(([id,active,promo=false,category=0,brand=0])=>[id,category,brand,active?5:3,promo?2:0]) });
test('monthly disabled starts at zero, excludes old inactive, removes reactivations and resets next month', () => {
 const baseline = snap([[1,true,true],[2,true],[3,true],[4,false,true]],'2026-10-31');
 const tracker = new AvailabilityMovements(baseline,filter);
 assert.deepEqual(tracker.add(snap([[1,false,true],[2,true],[3,true],[4,false,true]])), {active:2,inactive:1,promoActive:0,promoInactive:1});
 assert.deepEqual(tracker.add(snap([[1,true,true],[2,false],[3,true],[4,false,true]],'2026-11-02')), {active:2,inactive:1,promoActive:1,promoInactive:0});
 assert.equal(tracker.events.inactive.added.length,2);
 assert.equal(tracker.events.inactive.removed.length,1);
 const december = new AvailabilityMovements(snap([[1,true,true],[2,false],[3,true],[4,false,true]],'2026-11-30'),filter);
 assert.equal(december.add(snap([[1,true,true],[2,false],[3,true],[4,false,true]],'2026-12-01')).inactive,0);
});
test('missing observations and new inactive SKU are not treated as deactivation; missing baseline stays unknown', () => {
 const tracker = new AvailabilityMovements(snap([[1,true]],'2026-10-31'), filter);
 assert.equal(tracker.add(snap([[2,false]])).inactive,0);
 assert.equal(tracker.add(snap([[1,false],[2,false]],'2026-11-02')).inactive,1);
 assert.equal(new AvailabilityMovements(null,filter).add(snap([[1,false]])).inactive,null);
});
test('filters and searched IDs apply to active totals and disabled cohorts without mistaking category changes for status changes', () => {
 const baseline=snap([[1,true,true],[2,true,true],[3,true,false]]);
 const tracker=new AvailabilityMovements(baseline,{...filter,categories:['10'],brands:['A']},new Set([1,2]));
 const counts=tracker.add(snap([[1,false,true],[2,true,true,1],[3,false,false]]));
 assert.deepEqual(counts,{active:0,inactive:1,promoActive:0,promoInactive:1});
});
test('50 disabled then 40 disabled and 10 reactivated gives 80 disabled and +90/-10', () => {
 const states=Array.from({length:100},(_,i)=>[i,true]);
 const tracker=new AvailabilityMovements(snap(states,'2026-10-31'),filter);
 assert.equal(tracker.add(snap(states.map(([id])=>[id,id>=50]))).inactive,50);
 const result=tracker.add(snap(states.map(([id])=>[id,id<10||id>=90]),'2026-11-02'));
 assert.equal(result.active,20); assert.equal(result.inactive,80);
 assert.equal(tracker.events.inactive.added.length,90); assert.equal(tracker.events.inactive.removed.length,10);
});

test('report, search, monthly comparison and drilldown share the same historical membership', async () => {
 const { sourceLoader } = await import('./helpers/load-source.mjs');
 const baseline=snap([[1,true,true],[2,true],[3,false]],'2026-10-31');
 const first=snap([[1,false,true],[2,true],[3,false]],'2026-11-01');
 const second=snap([[1,true,true],[2,false],[3,false]],'2026-11-02');
 const snapshots=new Map([baseline,first,second].map(s=>[s.date,s]));
 const catalogue=[{id:1,code:100,sku:'AAA',name:'Blue Tile',brand:'A'}, {id:2,code:200,sku:'BBB',name:'White Tile',brand:'A'}, {id:3,code:300,sku:'CCC',name:'Old',brand:'A'}];
 const load=sourceLoader({mocks:{
  '@/lib/product-availability-report':{readAvailabilityReport:async()=>({facets:{categories:[],brands:[]}})},
  '@/lib/product-availability-store':{readAvailabilitySnapshot:async month=>month==='2026-10'?baseline:null},
  '@/lib/product-availability-daily-store':{readDailyAvailabilitySnapshot:async date=>snapshots.get(date)||null,listDailyAvailabilitySnapshots:async()=>[...snapshots.values()].map(s=>({date:s.date,syncedAt:s.syncedAt}))},
  '@/lib/products-store':{readAllLite:async()=>catalogue},
 }});
 const {readMovementReport}=load('@/lib/product-availability-movement-report');
 const report=await readMovementReport(['2026-11'],filter,'');
 assert.equal(report.months[0].counts.inactive,1);
 assert.equal(report.months[0].days[0].counts.inactive,1);
 assert.equal(report.months[0].days[2].counts,null);
 assert.equal(report.months[0].changes.inactive.added,2);
 assert.equal(report.months[0].changes.inactive.removed,1);
 const selected=await readMovementReport(['2026-11'],filter,'',{metric:'inactive',mode:'total'});
 assert.deepEqual(Array.from(selected.products,p=>p.id),[2]);
 const searched=await readMovementReport(['2026-11'],filter,'AAA');
 assert.equal(searched.months[0].counts.active,1);
 assert.equal(searched.months[0].counts.inactive,0);
 const removed=await readMovementReport(['2026-11'],filter,'',{metric:'inactive',mode:'removed'});
 assert.deepEqual(Array.from(removed.products,p=>p.id),[1]);
});
