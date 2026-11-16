import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewCacheKey,createOverviewCache} from '../public/overview-cache.mjs';
test('saved public dashboard appears without fetching and never crosses dates or channels',()=>{
 let time=1000,raw;const storage=()=>({getItem:()=>raw,setItem:(key,v)=>raw=v});
 const cache=createOverviewCache({storage,now:()=>time});
 const state={from:'2026-11-01',to:'2026-11-15',chartChannel:'all',yoy:true};
 const key=overviewCacheKey(state,'2026-11-16');
 cache.write(key,{sales:{available:true,metrics:{shippedRevenue:42}},privateOverview:true,waterfall:{secret:'private'}});
 assert.equal(cache.read(key).data.sales.metrics.shippedRevenue,42);
 assert.doesNotMatch(raw,/privateOverview|waterfall|private/);
 assert.equal(cache.read(overviewCacheKey({...state,chartChannel:'site'},'2026-11-16')),null);
 assert.equal(cache.read(overviewCacheKey(state,'2026-11-17')),null);
 time+=24*3600000+1;assert.equal(cache.read(key),null);
});
test('denied, corrupt and oversized storage never prevents page loading',()=>{
 const denied=createOverviewCache({storage:()=>{throw Error('denied')}});assert.equal(denied.read('x'),null);assert.doesNotThrow(()=>denied.write('x',{sales:{available:true}}));
 const cache=createOverviewCache({storage:()=>({getItem:()=>'{broken'})});assert.equal(cache.read('x'),null);
});
