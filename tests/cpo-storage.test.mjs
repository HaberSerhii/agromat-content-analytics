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
