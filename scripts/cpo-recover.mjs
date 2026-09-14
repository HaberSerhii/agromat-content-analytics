// Reads an EXISTING job only. Never creates a query job or scans GA4 tables.
import { BigQuery } from '@google-cloud/bigquery';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = process.env.CPO_ANALYTICS_DIR;
const jobId = process.env.CPO_RECOVERY_JOB_ID;
if (!root || !jobId) throw new Error('CPO_ANALYTICS_DIR and CPO_RECOVERY_JOB_ID required');
await fs.mkdir(root, { recursive: true });
const lock = await fs.open(path.join(root, 'recovery.lock'), 'wx', 0o600);
const atomic = async (file, data) => {
  await fs.writeFile(`${file}.tmp`, data, { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
};
try {
  const bq = new BigQuery({ projectId: 'maximal-furnace-385413' });
  const job = bq.job(jobId, { location: 'EU' });
  const [metadata] = await job.getMetadata();
  if (metadata.status?.state !== 'DONE' || metadata.status?.errorResult) throw new Error('Job not successfully complete');
  const params = Object.fromEntries(metadata.configuration.query.queryParameters.map(p => [p.name, p.parameterValue.value]));
  if (params.country !== 'Ukraine') throw new Error('Expected Ukraine-only job');
  const stateFile = path.join(root, 'recovery-progress.json');
  let state;
  try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  state ??= { jobId, page: 0, rows: 0, pageToken: null, partitions: {}, complete: false };
  if (state.jobId !== jobId) throw new Error('Checkpoint belongs to another job');
  while (!state.complete) {
    const [rows, next, response] = await job.getQueryResults({ autoPaginate: false, maxResults: 5000, ...(state.pageToken ? { pageToken: state.pageToken } : {}) });
    if (!response.jobComplete) throw new Error('Expected completed result');
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.period_kind}-${row.period_year}-${row.period_number}`;
      if (!/^(week|month)-\d{4}-\d{1,2}$/.test(key)) throw new Error('Invalid period');
      const mapped = { periodKind: row.period_kind, periodYear: Number(row.period_year), periodNumber: Number(row.period_number), dimension: row.dimension_name, dimensionValue: row.dimension_value ?? '(not set)' };
      for (const [field, value] of Object.entries(row)) {
        if (['period_kind','period_year','period_number','dimension_name','dimension_value'].includes(field)) continue;
        const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        mapped[camel] = Number(value ?? 0);
        if (!Number.isFinite(mapped[camel])) throw new Error(`Invalid metric ${field}`);
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(mapped);
    }
    for (const [key, data] of groups) {
      const file = `${key}-page-${state.page}.json.gz`;
      await atomic(path.join(root, file), gzipSync(JSON.stringify(data)));
      (state.partitions[key] ??= []).push(file);
    }
    state.rows += rows.length;
    state.page++;
    state.pageToken = next?.pageToken || null;
    state.complete = !state.pageToken;
    if (state.complete && state.rows !== Number(response.totalRows)) throw new Error('Row count mismatch');
    await atomic(stateFile, JSON.stringify(state));
    console.log(JSON.stringify({ page: state.page, rows: state.rows, total: response.totalRows }));
  }
  const date = s => `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  const manifest = { version: 1, countryFilter: 'Ukraine', savedAt: new Date().toISOString(), projectId: 'maximal-furnace-385413', datasetId: 'analytics_321347682', datasetLocation: 'EU', dataFrom: date(params.fromSuffix), dataTo: date(params.toSuffix), bytesProcessed: Number(metadata.statistics.query.totalBytesProcessed), jobId, totalRows: state.rows, partitions: state.partitions };
  await atomic(path.join(root, 'partition-manifest.json'), JSON.stringify(manifest));
  console.log('COMPLETE');
} finally {
  await lock.close();
  await fs.unlink(path.join(root, 'recovery.lock'));
}
