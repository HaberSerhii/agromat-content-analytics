import { BigQuery } from '@google-cloud/bigquery';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { atomicWrite, kyivDate, latestCompletedSunday, readJson, refreshOnce } from './lib/cpo-refresh.mjs';

const root = process.env.CPO_ANALYTICS_DIR
  || (process.env.BIGQUERY_AUDIT_DIR ? path.join(path.dirname(process.env.BIGQUERY_AUDIT_DIR), 'cpo-analytics') : null)
  || (process.env.PRODUCT_SNAPSHOTS_DIR ? path.join(path.dirname(process.env.PRODUCT_SNAPSHOTS_DIR), 'cpo-analytics') : path.join(process.cwd(), 'data', 'cpo-analytics'));
const dryRun = process.argv.includes('--dry-run');
try {
  try { await access(path.join(root, 'recovery.lock')); throw new Error('CPO recovery is running; refresh deferred'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const manifest = await readJson(path.join(root, 'partition-manifest.json'));
  if (!manifest) throw new Error('Import the initial CPO snapshot before enabling refresh');
  const client = new BigQuery({ projectId: manifest.projectId });
  // A short outage is recovered in one invocation; longer backlogs continue
  // on the next hourly run instead of producing an unbounded scan.
  const deadline = Date.now() + 15 * 60 * 1000;
  let batches = 0;
  while (batches < 8) {
    const result = await refreshOnce({ root, client, dryRun, maximumBytesBilled: process.env.CPO_MAXIMUM_BYTES_BILLED || '100000000000' });
    if (result.state === 'running' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      continue;
    }
    if (dryRun || result.state !== 'updated' || result.dataTo >= result.targetDataTo) break;
    batches++;
  }
} catch (error) {
  // Never log the BigQuery error object: it can contain request credentials.
  const message = error instanceof Error ? error.message : 'CPO refresh failed';
  console.error(message);
  if (!dryRun) {
    await atomicWrite(path.join(root, 'refresh-status.json'), JSON.stringify({ state: 'error', checkedAt: new Date().toISOString(), targetDataTo: latestCompletedSunday(kyivDate()), error: message })).catch(() => {});
  }
  process.exitCode = 1;
}
