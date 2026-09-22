import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { sourceLoader } from './helpers/load-source.mjs';

test('CPO reads only comparison periods, including year boundary, without unrelated chunks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cpo-store-test-'));
  const previous = process.env.CPO_ANALYTICS_DIR;
  process.env.CPO_ANALYTICS_DIR = root;
  try {
    const partitions = {};
    for (const key of ['month-2026-1', 'month-2025-12', 'month-2025-1']) {
      partitions[key] = [`${key}.json.gz`];
      await fs.writeFile(path.join(root, `${key}.json.gz`), gzipSync(JSON.stringify([{ key }])));
    }
    // Deliberately absent: reading all periods would fail.
    partitions['month-2026-9'] = ['missing.json.gz'];
    await fs.writeFile(path.join(root, 'partition-manifest.json'), JSON.stringify({ version: 1, countryFilter: 'Ukraine', partitions }));
    const { readCpoCube } = sourceLoader({ globals: { process } })('@/lib/cpo-analytics/store');
    const result = await readCpoCube({ kind: 'month', period: 1, year: 2026 });
    assert.deepEqual(Array.from(result.cube.rows, r => r.key), ['month-2026-1','month-2025-12','month-2025-1']);
    assert.ok(result.compressedBytes > 0);
  } finally {
    if (previous === undefined) delete process.env.CPO_ANALYTICS_DIR;
    else process.env.CPO_ANALYTICS_DIR = previous;
    await fs.rm(root, { recursive: true });
  }
});

test('CPO availability reads manifest without loading any partition chunks, with legacy fallback', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cpo-availability-test-'));
  const previous = process.env.CPO_ANALYTICS_DIR;
  process.env.CPO_ANALYTICS_DIR = root;
  try {
    const metadata = { version: 1, countryFilter: 'Ukraine', savedAt: '2020-09-14T00:00:00Z', dataFrom: '2020-01-01', dataTo: '2020-09-13' };
    const manifestPath = path.join(root, 'partition-manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({ ...metadata, partitions: {
      'week-2020-37': ['not-loaded.json.gz'], 'week-2020-38': ['future.json.gz'], 'month-2020-8': ['also-not-loaded.json.gz'], 'week-2020-36': [],
    } }));
    const { readCpoAvailability, saveCpoCube } = sourceLoader({ globals: { process } })('@/lib/cpo-analytics/store');
    const result = await readCpoAvailability();
    assert.deepEqual(Array.from(result.periods.week, r => r.number), [37]);
    assert.deepEqual(Array.from(result.periods.month, r => r.number), [8]);
    await fs.unlink(manifestPath);
    assert.equal(await readCpoAvailability(), null);
    await saveCpoCube({ ...metadata, rows: [
      { periodKind: 'week', periodYear: 2020, periodNumber: 37, dimension: 'overall', sessions: 100 },
      { periodKind: 'week', periodYear: 2020, periodNumber: 36, dimension: 'device', sessions: 100 },
      { periodKind: 'week', periodYear: 2020, periodNumber: 35, dimension: 'overall', sessions: 0 },
    ] });
    const legacy = await readCpoAvailability();
    assert.deepEqual(Array.from(legacy.periods.week, r => r.number), [37]);
  } finally {
    if (previous === undefined) delete process.env.CPO_ANALYTICS_DIR;
    else process.env.CPO_ANALYTICS_DIR = previous;
    await fs.rm(root, { recursive: true });
  }
});
