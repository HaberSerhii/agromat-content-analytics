import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './helpers/load-source.mjs';
const {contentScoreChange} = sourceLoader()('@/lib/product-content-history');
const plain=value=>JSON.parse(JSON.stringify(value));

test('CS shows the daily delta separately from the change since first recorded day of month',()=>{
 const history=new Map([['2026-11-10',64.81],['2026-11-11',64.93]]);
 const result=plain(contentScoreChange('2026-11-12',65,history));
 assert.equal(result.previousDate,'2026-11-11');
 assert.ok(Math.abs(result.dayDelta-.07)<1e-10);
 assert.ok(Math.abs(result.monthDelta-.19)<1e-10);
 assert.equal(result.monthBaselineDate,'2026-11-10');
});
test('CS declines and unchanged values are valid, missing yesterday is never replaced by an older date',()=>{
 const history=new Map([['2026-11-01',65],['2026-11-09',66]]);
 const missing=contentScoreChange('2026-11-11',64.81,history);
 assert.equal(missing.dayDelta,null);
 assert.ok(missing.monthDelta<0);
 assert.equal(missing.monthBaselineDate,'2026-11-01');
 const unchanged=contentScoreChange('2026-11-10',66,history);
 assert.equal(unchanged.dayDelta,0);
});
test('first day compares yesterday across month boundary and does not claim a month baseline',()=>{
 const result=contentScoreChange('2026-12-01',65,new Map([['2026-11-30',64.81],['2026-12-01',65]]));
 assert.ok(Math.abs(result.dayDelta-.19)<1e-10);
 assert.equal(result.monthDelta,null);
 assert.equal(result.monthBaselineDate,null);
 assert.equal(contentScoreChange('2026-11-10',null,new Map([['2026-11-09',65]])).dayDelta,null);
});
