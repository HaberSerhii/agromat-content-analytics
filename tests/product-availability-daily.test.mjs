import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceLoader } from './helpers/load-source.mjs';
const p = (id, statusId = 5, extra = {}) => ({ id, statusId, brandId: 1, brand: 'Golden Tile', categoryId: 10, categoryName: 'Плитка', deleted: false, isOnSale: true, ...extra });
const all = { categories: [], brands: [], promotion: 'all' };

test('daily observations preserve per-SKU changes, missing days, new arrivals and snapshot-time filters', () => {
 const { buildDailyAvailabilitySnapshot, DailyAvailabilityAccumulator } = sourceLoader()('@/lib/product-availability-daily');
 const first = buildDailyAvailabilitySnapshot([p(1), p(2, 3), p(1)], '2026-11-01T12:00:00Z');
 const second = buildDailyAvailabilitySnapshot([p(1, 1), p(2, 3), p(3)], '2026-11-03T12:00:00Z');
 assert.equal(first.products.length, 2);
 assert.equal('name' in first.products[0], false);
 const report = new DailyAvailabilityAccumulator(); report.add(first, all); report.add(second, all); report.add(second, all);
 const value = report.finish(7);
 assert.equal(value.observedDays, 2); assert.equal(value.expectedDays, 7);
 assert.equal(value.totalSku, 3); assert.equal(value.mixed, 1);
 assert.equal(value.alwaysActive, 1); assert.equal(value.alwaysInactive, 1);
 assert.equal(value.activeSkuDays, 2); assert.equal(value.inactiveSkuDays, 3);
 assert.equal(value.averageActive, 1); assert.equal(value.averageInactive, 1.5); assert.equal(value.activeShare, 40);
 const filtered = new DailyAvailabilityAccumulator(); filtered.add(first, { ...all, promotion: 'regular' });
 assert.equal(filtered.finish(7).totalSku, 0); assert.equal(filtered.finish(7).observedDays, 1);
 const empty = new DailyAvailabilityAccumulator().finish(7); assert.equal(empty.averageActive, null);
 const archived = new DailyAvailabilityAccumulator(); archived.add(buildDailyAvailabilitySnapshot([p(1, 5, { deleted: true })], '2026-11-03T12:00:00Z'), all); assert.equal(archived.finish(7).alwaysInactive, 1);
});

test('compact daily snapshots survive pruning and restart, serialize out-of-order writes and preserve Kyiv calendar days', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'availability-daily-'));
 const load = () => sourceLoader({ globals: { process: { env: { PRODUCT_SNAPSHOTS_DIR: dir }, cwd: () => process.cwd(), pid: process.pid } } });
 try {
  const store = load()('@/lib/product-availability-daily-store');
  await store.writeDailyAvailabilitySnapshot([p(1)], '2026-10-31T22:30:00Z');
  await Promise.all([store.writeDailyAvailabilitySnapshot([p(1,1)], '2026-11-01T12:00:00Z'),store.writeDailyAvailabilitySnapshot([p(1)], '2026-11-01T10:00:00Z')]);
  await store.writeDailyAvailabilitySnapshot([p(1)], '2026-11-02T12:00:00Z');
  load()('@/lib/products-daily-snapshots').pruneDailySnapshotsOnDisk(1);
  const reloaded = load()('@/lib/product-availability-daily-store');
  const days = await reloaded.listDailyAvailabilitySnapshots(['2026-11']);
  assert.deepEqual(Array.from(days, d=>d.date), ['2026-11-01','2026-11-02']);
  assert.equal(days[0].syncedAt, '2026-11-01T12:00:00Z');
  const first = await reloaded.readDailyAvailabilitySnapshot('2026-11-01'); assert.equal(first.products[0][3],1);
  assert.equal(await reloaded.readDailyAvailabilitySnapshot('2026-10-31'),null);
  assert.equal(fs.readdirSync(path.join(dir,'availability-daily')).some(f=>f.endsWith('.tmp')),false);
 } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('daily report backfills each real day once and derives mixed activity without inventing missing days', async () => {
 const daily = sourceLoader()('@/lib/product-availability-daily');
 const monthly = sourceLoader()('@/lib/product-availability');
 const days = new Map(), months = new Map();let reads=0;
 const source = [{date:'2026-11-01',syncedAt:'2026-11-01T12:00:00Z'},{date:'2026-11-03',syncedAt:'2026-11-03T12:00:00Z'}];
 const load=sourceLoader({mocks:{
  '@/lib/products-store': {listSnapshotDates:async()=>source,readDailySnapshot:async date=>{reads++;return{products:[p(1,date.endsWith('01')?5:1)],syncedAt:date+'T12:00:00Z'}},readSyncState:async()=>({state:'idle'}),readLiteSyncedAt:async()=>null},
  '@/lib/product-availability-store':{readAvailabilitySnapshot:async month=>months.get(month)||null,writeAvailabilitySnapshot:async(products,at)=>{const value=monthly.buildAvailabilitySnapshot(products,at);months.set(value.month,value);return value}},
  '@/lib/product-availability-daily-store':{listDailyAvailabilitySnapshots:async()=>[...days.values()].map(d=>({date:d.date,syncedAt:d.syncedAt,signature:d.syncedAt})),readDailyAvailabilitySnapshot:async date=>days.get(date)||null,writeDailyAvailabilitySnapshot:async(products,at)=>{const value=daily.buildDailyAvailabilitySnapshot(products,at);days.set(value.date,value);return value}},
  '@/lib/dashboard-report-cache':{readDashboardReport:async(_ns,_key,_ttl,fn)=>({value:await fn()})},
 }});
 const {readAvailabilityReport}=load('@/lib/product-availability-report');
 const value=await readAvailabilityReport(['2026-10','2026-11'],all,true);
 assert.equal(value.months[0].daily.observedDays,0);assert.equal(value.months[0].daily.averageActive,null);
 assert.equal(value.months[1].counts.inactive,1);assert.equal(value.months[1].daily.observedDays,2);assert.equal(value.months[1].daily.mixed,1);assert.equal(value.months[1].daily.activeSkuDays,1);assert.equal(reads,2);
 await readAvailabilityReport(['2026-11'],all,true);assert.equal(reads,2);
});
