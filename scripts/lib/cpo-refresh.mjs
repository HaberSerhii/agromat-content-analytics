import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { cpoCubeSql } from './cpo-query.mjs';

export function kyivDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function monday(value) {
  return shiftDate(value, 1 - (new Date(`${value}T12:00:00Z`).getUTCDay() || 7));
}
export function latestCompletedSunday(today) { return shiftDate(monday(today), -1); }
function weekKey(value) {
  const thursday = shiftDate(monday(value), 3);
  const year = Number(thursday.slice(0, 4));
  const firstMonday = monday(`${year}-01-04`);
  return `week-${year}-${1 + Math.round((Date.parse(monday(value)) - Date.parse(firstMonday)) / (7 * 86400000))}`;
}
export function planRefresh(manifest, today) {
  const target = latestCompletedSunday(today);
  if (manifest.dataTo > target) return null;
  const previous = manifest.autoRefresh;
  if (manifest.dataTo === target && previous?.targetDataTo === target
    && (previous.refreshedOn === today || previous.finalized)) return null;
  // Catch up one week at a time, keeping scans bounded even after a long outage.
  const lastCoveredSunday = shiftDate(monday(shiftDate(manifest.dataTo, 1)), -1);
  const end = manifest.dataTo < target ? [shiftDate(lastCoveredSunday, 7), target].sort()[0] : target;
  const firstWeek = shiftDate(monday(end), -7);
  const periods = [];
  for (let from = firstWeek; from <= end; from = shiftDate(from, 7)) {
    if (from >= manifest.dataFrom) periods.push({ key: weekKey(from), from, to: shiftDate(from, 6) });
  }
  // Users are distinct over a whole month: never obtain monthly counts by
  // summing weekly aggregates. Replace any month that closed in these weeks.
  for (let day = firstWeek; day <= end; day = shiftDate(day, 1)) {
    if (shiftDate(day, 1).endsWith('-01')) {
      const from = `${day.slice(0, 7)}-01`;
      if (from >= manifest.dataFrom) periods.push({ key: `month-${Number(day.slice(0, 4))}-${Number(day.slice(5, 7))}`, from, to: day });
    }
  }
  if (!periods.length) throw new Error('No complete CPO periods in the configured coverage');
  const from = periods.map(p => p.from).sort()[0];
  return {
    targetDataTo: end, latestDataTo: target, today, periods,
    // One preceding day supplies context for sessions crossing midnight.
    scanFrom: [manifest.dataFrom, shiftDate(from, -1)].sort().at(-1), scanTo: end,
    finalized: today >= shiftDate(end, 4),
  };
}
export function missingDailyTables(plan, tableNames) {
  const tables = new Set(tableNames);
  const missing = [];
  for (let date = plan.scanFrom; date <= plan.scanTo; date = shiftDate(date, 1)) {
    if (!tables.has(`events_${date.replaceAll('-', '')}`)) missing.push(date);
  }
  return missing;
}
export async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function atomicWrite(file, content) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, { mode: 0o600 });
  await fs.rename(temporary, file);
}
const metrics = ['users', 'sessions', 'viewItemSessions', 'addToCartSessions', 'beginCheckoutSessions', 'purchaseSessions', 'orders', 'revenue', 'viewItemEvents', 'addToCartEvents', 'beginCheckoutEvents', 'purchaseEvents'];
function invalidResult(message) {
  return Object.assign(new Error(message), { code: 'CPO_INVALID_RESULT' });
}
function mapRow(row, allowedKeys) {
  const key = `${row.period_kind}-${row.period_year}-${row.period_number}`;
  if (!allowedKeys.has(key)) throw invalidResult(`Unexpected CPO period: ${key}`);
  if (!['overall', 'device', 'source_medium', 'city', 'landing_page'].includes(row.dimension_name)) throw invalidResult('Invalid CPO dimension');
  const mapped = { periodKind: row.period_kind, periodYear: Number(row.period_year), periodNumber: Number(row.period_number), dimension: row.dimension_name, dimensionValue: String(row.dimension_value ?? '(not set)') };
  for (const field of metrics) {
    const snake = field.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    const value = Number(row[snake]);
    if (row[snake] == null || !Number.isFinite(value) || (field !== 'revenue' && value < 0)) throw invalidResult(`Invalid CPO metric: ${field}`);
    mapped[field] = value;
  }
  return { key, mapped };
}
function queryOptions(manifest, plan, maximumBytesBilled) {
  return {
    query: cpoCubeSql(manifest.projectId, manifest.datasetId, true),
    params: { fromSuffix: plan.scanFrom.replaceAll('-', ''), toSuffix: plan.scanTo.replaceAll('-', ''), country: 'Ukraine', periodKeys: plan.periods.map(p => p.key) },
    location: manifest.datasetLocation, maximumBytesBilled: String(maximumBytesBilled), useQueryCache: true,
  };
}

// The runner holds an OS flock throughout this function. All chunks have a
// generation-specific name, and only the final manifest rename publishes them.
export async function refreshOnce({ root, client, today = kyivDate(), maximumBytesBilled = '100000000000', dryRun = false, now = () => new Date(), log = console.log }) {
  await fs.mkdir(root, { recursive: true });
  const manifestFile = path.join(root, 'partition-manifest.json');
  const pendingFile = path.join(root, 'refresh-pending.json');
  const statusFile = path.join(root, 'refresh-status.json');
  const manifest = await readJson(manifestFile);
  if (!manifest || manifest.version !== 1 || manifest.countryFilter !== 'Ukraine' || !manifest.partitions) throw new Error('CPO refresh requires an imported partition manifest');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.dataFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.dataTo)) throw new Error('Invalid CPO coverage');
  const status = async (state, extra = {}) => {
    const result = { state, checkedAt: now().toISOString(), targetDataTo: latestCompletedSunday(today), dataTo: manifest.dataTo, ...extra };
    if (!dryRun) await atomicWrite(statusFile, JSON.stringify(result));
    log(JSON.stringify(result));
    return result;
  };
  let pending = await readJson(pendingFile);
  // Recover a crash immediately after the atomic publication.
  if (pending && manifest.autoRefresh?.jobId === pending.jobId) {
    if (!dryRun) await fs.unlink(pendingFile);
    pending = null;
  }
  if (pending && pending.baseSavedAt !== manifest.savedAt) throw new Error('CPO manifest changed while refresh was pending; refusing to overwrite');
  const plan = pending?.plan ?? planRefresh(manifest, today);
  if (!plan) return status('up_to_date', { finalized: manifest.autoRefresh?.finalized ?? false });
  if (!pending) {
    const [tables] = await client.dataset(manifest.datasetId).getTables();
    const missingDates = missingDailyTables(plan, tables.map(table => table.id));
    if (missingDates.length) return status('waiting_for_source', { missingDates });
  }
  const options = queryOptions(manifest, plan, maximumBytesBilled);
  if (dryRun) {
    const [estimate] = await client.createQueryJob({ ...options, dryRun: true });
    return status('estimate', { plan, estimatedBytes: Number(estimate.metadata.statistics.query.totalBytesProcessed) });
  }
  if (!pending) {
    // Stable job identity prevents another billable scan after an uncertain
    // submission or process restart. A failed job is not resubmitted hourly.
    const id = createHash('sha256').update(JSON.stringify({ version: 1, base: manifest.savedAt, plan })).digest('hex').slice(0, 32);
    pending = { baseSavedAt: manifest.savedAt, jobId: `cpo_refresh_${id}`, plan, page: 0, rows: 0, pageToken: null, complete: false, partitions: {}, overall: {}, createdAt: now().toISOString() };
    await atomicWrite(pendingFile, JSON.stringify(pending));
  }
  await status('running', { jobId: pending.jobId });
  let job = client.job(pending.jobId, { location: manifest.datasetLocation });
  let metadata;
  try { [metadata] = await job.getMetadata(); }
  catch (error) {
    if (error.code !== 404) throw error;
    try { [job] = await client.createQueryJob({ ...options, jobId: pending.jobId }); }
    catch (submitError) { if (submitError.code !== 409) throw submitError; }
    [metadata] = await job.getMetadata();
  }
  if (metadata.status?.errorResult) {
    // Retain the job details for diagnosis, but let the following day create
    // a new deterministic job instead of retrying this failure indefinitely.
    await atomicWrite(path.join(root, 'refresh-failed.json'), JSON.stringify({ ...pending, failedAt: now().toISOString(), error: metadata.status.errorResult.message }));
    await fs.unlink(pendingFile);
    throw new Error(`CPO BigQuery job failed: ${metadata.status.errorResult.message}`);
  }
  const allowed = new Set(plan.periods.map(period => period.key));
  try {
    while (!pending.complete) {
      let result;
      try {
        result = await job.getQueryResults({ autoPaginate: false, maxResults: 5000, timeoutMs: 10000, ...(pending.pageToken ? { pageToken: pending.pageToken } : {}) });
      } catch (error) {
        // The Node SDK throws on a normal polling timeout, even though the
        // server-side job is still running successfully. Keep its checkpoint.
        if (/^The query did not complete before \d+ms$/.test(error.message)) return status('running', { jobId: pending.jobId });
        throw error;
      }
      const [rows, next, response] = result;
      if (!response?.jobComplete) return status('running', { jobId: pending.jobId });
      const groups = new Map();
      for (const row of rows) {
        const { key, mapped } = mapRow(row, allowed);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(mapped);
        if (mapped.dimension === 'overall') {
          if (pending.overall[key]) throw invalidResult(`Duplicate CPO overall row: ${key}`);
          if (mapped.sessions <= 0) throw invalidResult(`Empty CPO period: ${key}`);
          pending.overall[key] = true;
        }
      }
      for (const [key, group] of groups) {
        const filename = `${pending.jobId}-${key}-page-${pending.page}.json.gz`;
        await atomicWrite(path.join(root, filename), gzipSync(JSON.stringify(group)));
        (pending.partitions[key] ??= []).push(filename);
      }
      pending.rows += rows.length;
      pending.page++;
      pending.pageToken = next?.pageToken || null;
      pending.complete = !pending.pageToken;
      if (pending.complete && pending.rows !== Number(response.totalRows)) throw invalidResult('CPO result row count mismatch');
      await atomicWrite(pendingFile, JSON.stringify(pending));
    }
    for (const key of allowed) {
      if (!pending.overall[key] || !pending.partitions[key]?.length) throw invalidResult(`CPO result is missing a complete period: ${key}`);
    }
  } catch (error) {
    if (error.code === 'CPO_INVALID_RESULT') {
      await atomicWrite(path.join(root, 'refresh-failed.json'), JSON.stringify({ ...pending, failedAt: now().toISOString(), error: error.message }));
      await fs.unlink(pendingFile);
    }
    throw error;
  }
  [metadata] = await job.getMetadata();
  if (metadata.status?.state !== 'DONE' || metadata.status?.errorResult) throw new Error('CPO job did not complete successfully');
  if ((await readJson(manifestFile)).savedAt !== pending.baseSavedAt) throw new Error('CPO manifest changed before publication');
  const savedAt = now().toISOString();
  const updated = {
    ...manifest, savedAt, dataTo: plan.targetDataTo,
    partitions: { ...manifest.partitions, ...pending.partitions },
    autoRefresh: { targetDataTo: plan.targetDataTo, refreshedOn: plan.today, finalized: plan.finalized, jobId: pending.jobId, rows: pending.rows, bytesProcessed: Number(metadata.statistics?.query?.totalBytesProcessed || 0) },
  };
  // Legacy totalRows/bytesProcessed describe the original frozen query only.
  delete updated.totalRows;
  await atomicWrite(path.join(root, `manifest-before-${pending.jobId}.json`), JSON.stringify(manifest));
  await atomicWrite(manifestFile, JSON.stringify(updated));
  await fs.unlink(pendingFile);
  return status('updated', { dataTo: updated.dataTo, savedAt, finalized: plan.finalized, rows: pending.rows, bytesProcessed: updated.autoRefresh.bytesProcessed });
}
