import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sourceLoader } from "./helpers/load-source.mjs";
const product = (id, statusId = 5, extra = {}) => ({ id, statusId, deleted: false, categoryName: "Плитка", categoryPath: "Плитка", ...extra });
const load = () => sourceLoader()("@/lib/product-inactive-tracking");

test("zero start, 10 tile and 15 sanitary outages, five recoveries, and monthly carryover", () => {
  const { advanceInactiveTracking } = load();
  const initial = [product(1000, 1), ...Array.from({length: 25}, (_, i) => product(i + 1, 5,
    i >= 10 ? {categoryName: "Сантехніка", categoryPath: "Сантехніка"} : {}))];
  let state = advanceInactiveTracking(null, initial, "2026-10-08T12:00:00Z");
  assert.equal(state.current.length, 0);
  const off = initial.map(p => ({...p, statusId: 1}));
  state = advanceInactiveTracking(state, off, "2026-10-09T12:00:00Z");
  assert.equal(state.current.filter(p => p.id <= 10).length, 10);
  assert.equal(state.current.filter(p => p.id > 10).length, 15);
  const recovered = off.map(p => ({...p, statusId: p.id <= 5 ? 5 : 1}));
  state = advanceInactiveTracking(state, recovered, "2026-10-14T12:00:00Z");
  assert.equal(state.current.filter(p => p.id <= 10).length, 5);
  assert.equal(state.current.filter(p => p.id > 10).length, 15);
  assert.equal(state.baseline.length, 0);
  state = advanceInactiveTracking(state, recovered, "2026-11-01T12:00:00Z");
  assert.equal(state.baseline.length, 20);
  assert.equal(state.current.length - state.baseline.length, 0);
  state = advanceInactiveTracking(state, recovered.map(p => p.id === 6 ? {...p, statusId: 5} : p), "2026-11-02T12:00:00Z");
  assert.equal(state.current.length - state.baseline.length, -1);
  assert.ok(!state.current.some(p => p.id === 1000));
});

test("legacy recovery is ignored, later outage joins tracking; archives and new inactive products count once", () => {
  const { advanceInactiveTracking } = load();
  let state = advanceInactiveTracking(null, [product(1, 1), product(2)], "2026-10-08T12:00:00Z");
  state = advanceInactiveTracking(state, [product(1), product(2)], "2026-10-09T12:00:00Z");
  assert.equal(state.current.length, 0);
  const now = [product(1, 1), product(2, 5, {deleted: true}), product(3, 1)];
  state = advanceInactiveTracking(state, now, "2026-10-10T12:00:00Z");
  assert.deepEqual([...state.trackedIds], [1, 2, 3]);
  state = advanceInactiveTracking(state, now, "2026-10-11T12:00:00Z");
  assert.equal(state.current.length, 3);
  assert.equal(state.trackedIds.length, 3);
  assert.equal(advanceInactiveTracking(state, [], "2026-10-08T12:00:00Z"), state);
});

test("tracking state survives process reloads and monthly snapshot pruning", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inactive-dynamics-"));
  try {
    const loader = () => sourceLoader({ globals: {process: {env: {PRODUCT_SNAPSHOTS_DIR: dir}, pid: process.pid, cwd: () => process.cwd()}} });
    loader()("@/lib/product-inactive-tracking").updateInactiveTracking([product(1), product(2, 1)], "2026-10-08T12:00:00Z");
    loader()("@/lib/product-inactive-tracking").updateInactiveTracking([product(1, 1), product(2, 1)], "2026-10-09T12:00:00Z");
    loader()("@/lib/products-daily-snapshots").pruneDailySnapshotsOnDisk(1);
    const state = loader()("@/lib/product-inactive-tracking").readInactiveTracking();
    assert.deepEqual([...state.trackedIds], [1]);
    assert.equal(state.startedAt, "2026-10-08T12:00:00Z");
    assert.equal(state.current.length, 1);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
