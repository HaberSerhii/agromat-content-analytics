import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAvailabilitySnapshot, summarizeAvailability, availabilityDate } from "../src/lib/product-availability.ts";
import { sourceLoader } from "./helpers/load-source.mjs";
const product = (id, statusId = 5, extra = {}) => ({ id, statusId, categoryId: 10, categoryName: "Плитка", brand: "Golden Tile", isOnSale: false, deleted: false, ...extra });
const all = { categories: [], brands: [], promotion: "all" };
const fixture = [product(1, 5, { isOnSale: true }), product(2, 3, { isOnSale: true }), product(3, 1), product(4, 5, { brand: "Grohe", categoryId: 20, categoryName: "Сантехніка" }), product(5, 5, { deleted: true }), product(1)];

test("only nonarchived in-stock status is active; preorder, archived and absent goods are inactive, IDs count once", () => {
 const snapshot = buildAvailabilitySnapshot(fixture, "2026-11-07T12:00:00Z");
 assert.deepEqual(summarizeAvailability(snapshot, all), { active: 2, inactive: 3, promoActive: 1, promoInactive: 1, total: 5, promo: 2 });
 assert.equal(JSON.stringify(snapshot).includes('statusHistory'), false);
});
test("multiple categories and brands combine OR within a filter and AND across filters", () => {
 const snapshot = buildAvailabilitySnapshot(fixture, "2026-11-07T12:00:00Z");
 assert.equal(summarizeAvailability(snapshot, { ...all, categories: ['10', '20'], brands: ['Golden Tile', 'Grohe'] }).total, 5);
 assert.equal(summarizeAvailability(snapshot, { ...all, categories: ['10'], brands: ['Grohe'] }).total, 0);
 assert.equal(summarizeAvailability(snapshot, { ...all, promotion: 'promo' }).total, 2);
 assert.equal(summarizeAvailability(snapshot, { ...all, promotion: 'regular' }).total, 3);
});
test("month boundaries use Kyiv and historical classification is frozen", () => {
 assert.equal(availabilityDate('2026-10-31T22:30:00Z'), '2026-11-01');
 const snapshot = buildAvailabilitySnapshot(fixture, '2026-10-31T20:00:00Z');
 const changed = fixture.map(p => ({ ...p, brand: 'Renamed', isOnSale: false, statusId: 1 }));
 buildAvailabilitySnapshot(changed, '2026-11-07T12:00:00Z');
 assert.equal(summarizeAvailability(snapshot, { ...all, brands: ['Golden Tile'], promotion: 'promo' }).active, 1);
 assert.equal(snapshot.month, '2026-10');
});
test("monthly files survive restart and daily pruning; out-of-order concurrent writes retain the newest state", async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'availability-monthly-'));
 const load = () => sourceLoader({ globals: { process: { env: { PRODUCT_SNAPSHOTS_DIR: dir }, cwd: () => process.cwd(), pid: process.pid } } });
 try {
  const store = load()('@/lib/product-availability-store');
  await store.writeAvailabilitySnapshot(fixture, '2026-10-31T20:00:00Z');
  await Promise.all([
   store.writeAvailabilitySnapshot([product(1, 1)], '2026-11-07T12:00:00Z'),
   store.writeAvailabilitySnapshot([product(1)], '2026-11-06T12:00:00Z'),
  ]);
  load()('@/lib/products-daily-snapshots').pruneDailySnapshotsOnDisk(1);
  const reloaded = load()('@/lib/product-availability-store');
  assert.equal((await reloaded.readAvailabilitySnapshot('2026-10')).groups.length > 0, true);
  const november = await reloaded.readAvailabilitySnapshot('2026-11');
  assert.equal(november.syncedAt, '2026-11-07T12:00:00Z');
  assert.equal(november.groups[0].inactive, 1);
  assert.equal(await reloaded.readAvailabilitySnapshot('2026-09'), null);
  assert.equal(fs.readdirSync(path.join(dir, 'availability-monthly')).some(file => file.endsWith('.tmp')), false);
 } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("history backfill uses last observation per month, leaves missing months null, and reuses compact cubes", async () => {
 const snapshots = new Map(); let reads = 0;
 const store = { readAvailabilitySnapshot: async month => snapshots.get(month) || null, writeAvailabilitySnapshot: async (products, at) => { const snapshot = buildAvailabilitySnapshot(products, at); snapshots.set(snapshot.month, snapshot); return snapshot; } };
 const load = sourceLoader({ mocks: {
  '@/lib/product-availability-store': store,
  '@/lib/products-store': {
   listSnapshotDates: async () => [{ date: '2026-10-02', syncedAt: '2026-10-02T12:00:00Z' }, { date: '2026-10-31', syncedAt: '2026-10-31T12:00:00Z' }],
   readDailySnapshot: async date => { reads++; assert.equal(date, '2026-10-31'); return { syncedAt: date+'T12:00:00Z', products: fixture }; },
   readSyncState: async () => ({ state: 'ok', startedAt: '2026-11-07T12:00:00Z' }),
   readLiteSyncedAt: async () => '2026-11-07T12:00:00Z', readAllLite: async () => [product(1)],
  },
 } });
 const { readAvailabilityReport } = load('@/lib/product-availability-report');
 const report = await readAvailabilityReport(['2026-09','2026-10','2026-11'], all);
 assert.equal(report.months[0].counts, null);
 assert.equal(report.months[1].counts.total, 5);
 assert.equal(report.months[2].counts.total, 1);
 assert.equal(report.months[1].date, '2026-10-31');
 await readAvailabilityReport(['2026-09','2026-10','2026-11'], { ...all, promotion: 'promo' });
 assert.equal(reads, 1);
});

test("partial live sync cannot replace a complete historical observation", async () => {
 let writes = 0;
 const load = sourceLoader({ mocks: {
  '@/lib/product-availability-store': { readAvailabilitySnapshot: async () => null, writeAvailabilitySnapshot: async () => { writes++; } },
  '@/lib/products-store': { listSnapshotDates: async () => [], readSyncState: async () => ({ state: 'ok', startedAt: '2026-11-07T12:00:00Z', error: 'Skipped 1/157 pages' }), readLiteSyncedAt: async () => '2026-11-07T12:00:00Z', readAllLite: async () => [] },
 } });
 const report = await load('@/lib/product-availability-report').readAvailabilityReport(['2026-11'], all);
 assert.equal(writes, 0);
 assert.equal(report.months[0].counts, null);
});
