import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { cpoCubeSql } from '../scripts/lib/cpo-query.mjs';
import { kyivDate, latestCompletedSunday, planRefresh, missingDailyTables, refreshOnce, readJson, shiftDate } from '../scripts/lib/cpo-refresh.mjs';

const seed = () => ({ version: 1, countryFilter: 'Ukraine', projectId: 'p', datasetId: 'd', datasetLocation: 'EU', dataFrom: '2024-12-30', dataTo: '2026-09-13', savedAt: '2026-09-14T22:59:53.211Z', partitions: { 'week-2025-38': ['historical.gz'], 'week-2026-37': ['old-week.gz'], 'month-2026-9': ['old-partial.gz'] } });
const keys = plan => plan.periods.map(p => p.key);

test('Kyiv week rollover uses local Monday and ISO week years, including week 53', () => {
  assert.equal(kyivDate(new Date('2026-09-20T21:00:00Z')), '2026-09-21');
  assert.equal(latestCompletedSunday('2026-09-20'), '2026-09-13');
  assert.equal(latestCompletedSunday('2026-09-21'), '2026-09-20');
  const plan = planRefresh({ ...seed(), dataTo: '2026-12-27' }, '2027-01-04');
  assert.deepEqual(keys(plan), ['week-2026-52', 'week-2026-53', 'month-2026-12']);
  assert.equal(plan.scanFrom, '2026-11-30');
  assert.equal(plan.scanTo, '2027-01-03');
  assert.equal(plan.finalized, false);
});

test('weekly catch-up is bounded, preserves comparisons, and never sums monthly unique users', () => {
  const plan = planRefresh(seed(), '2026-09-22');
  assert.deepEqual(keys(plan), ['week-2026-37', 'week-2026-38']);
  assert.equal(plan.scanFrom, '2026-09-06');
  assert.equal(plan.scanTo, '2026-09-20');
  const backlog = planRefresh(seed(), '2026-11-02');
  assert.equal(backlog.targetDataTo, '2026-09-20');
  const month = planRefresh({ ...seed(), dataTo: '2026-09-27' }, '2026-10-05');
  assert.deepEqual(keys(month), ['week-2026-39', 'week-2026-40', 'month-2026-9']);
  assert.equal(month.scanFrom, '2026-08-31');
  assert.equal(month.scanTo, '2026-10-04');
  const query = cpoCubeSql('p', 'd', true);
  assert.match(query, /APPROX_COUNT_DISTINCT/);
  assert.match(query, /IN UNNEST\(@periodKeys\)/);
  assert.doesNotMatch(cpoCubeSql('p', 'd'), /@periodKeys/);
  assert.throws(() => cpoCubeSql('p`;DROP', 'd'));
});

test('same day is a no-op; late arrivals are refreshed daily and finalized on Thursday', () => {
  const manifest = { ...seed(), dataTo: '2026-09-20', autoRefresh: { targetDataTo: '2026-09-20', refreshedOn: '2026-09-21', finalized: false } };
  assert.equal(planRefresh(manifest, '2026-09-21'), null);
  assert.equal(planRefresh(manifest, '2026-09-22').finalized, false);
  assert.equal(planRefresh(manifest, '2026-09-24').finalized, true);
  manifest.autoRefresh.finalized = true;
  assert.equal(planRefresh(manifest, '2026-09-27'), null);
  assert.ok(planRefresh(manifest, '2026-09-28'));
  manifest.autoRefresh.finalized = false;
  assert.equal(planRefresh(manifest, '2026-09-27').finalized, true, 'recover a missed final correction');
});

function tableNames(plan) {
  const names = [];
  for (let day = plan.scanFrom; day <= plan.scanTo; day = shiftDate(day, 1)) names.push(`events_${day.replaceAll('-', '')}`);
  return names;
}
function overall(key) {
  const [period_kind, period_year, period_number] = key.split('-');
  return { period_kind, period_year: Number(period_year), period_number: Number(period_number), dimension_name: 'overall', dimension_value: 'all', users: 90, sessions: 100, view_item_sessions: 60, add_to_cart_sessions: 20, begin_checkout_sessions: 10, purchase_sessions: 5, orders: 5, revenue: 6000, view_item_events: 80, add_to_cart_events: 25, begin_checkout_events: 10, purchase_events: 5 };
}
async function fixture(t, manifest = seed()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cpo-refresh-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'partition-manifest.json'), JSON.stringify(manifest));
  const plan = planRefresh(manifest, '2026-09-22');
  const state = { queries: [], tables: tableNames(plan), pages: keys(plan).map(key => [overall(key)]), failPage: null, submitted: false, incomplete: false, totalRows: keys(plan).length, terminalError: null };
  const metadata = () => ({ status: { state: 'DONE', ...(state.terminalError ? { errorResult: { message: state.terminalError } } : {}) }, statistics: { query: { totalBytesProcessed: '1234' } } });
  const job = {
    getMetadata: async () => { if (!state.submitted) throw Object.assign(new Error('not found'), { code: 404 }); return [metadata()]; },
    getQueryResults: async ({ pageToken }) => {
      if (state.incomplete) return [[], {}, { jobComplete: false }];
      const index = Number(pageToken || 0);
      if (state.failPage === index) throw new Error('simulated network failure');
      return [state.pages[index], index + 1 < state.pages.length ? { pageToken: String(index + 1) } : {}, { jobComplete: true, totalRows: String(state.totalRows) }];
    },
  };
  const client = {
    dataset: () => ({ getTables: async () => [state.tables.map(id => ({ id }))] }),
    job: () => job,
    createQueryJob: async options => {
      state.queries.push(options);
      if (options.dryRun) return [{ metadata: metadata() }];
      state.submitted = true;
      return [job];
    },
  };
  const run = overrides => refreshOnce({ root, client, today: '2026-09-22', now: () => new Date('2026-09-22T08:00:00Z'), log: () => {}, ...overrides });
  return { root, state, run, manifest: () => readJson(path.join(root, 'partition-manifest.json')) };
}

test('missing daily table or intraday-only data defers without starting a billable query', async t => {
  const f = await fixture(t);
  f.state.tables = f.state.tables.filter(n => n !== 'events_20260920');
  f.state.tables.push('events_intraday_20260920');
  const result = await f.run();
  assert.equal(result.state, 'waiting_for_source');
  assert.deepEqual(result.missingDates, ['2026-09-20']);
  assert.equal(f.state.queries.length, 0);
  assert.deepEqual(await f.manifest(), seed());
  assert.equal(missingDailyTables(planRefresh(seed(), '2026-09-22'), f.state.tables).length, 1);
});

test('atomic refresh replaces whole periods, retains historical partitions, then becomes a no-op', async t => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.state, 'updated');
  const manifest = await f.manifest();
  assert.equal(manifest.dataTo, '2026-09-20');
  assert.deepEqual(manifest.partitions['week-2025-38'], ['historical.gz']);
  assert.deepEqual(manifest.partitions['month-2026-9'], ['old-partial.gz']);
  assert.equal(manifest.partitions['week-2026-37'].length, 1);
  assert.notEqual(manifest.partitions['week-2026-37'][0], 'old-week.gz');
  const rows = JSON.parse(gunzipSync(await fs.readFile(path.join(f.root, manifest.partitions['week-2026-38'][0]))));
  assert.equal(rows[0].sessions, 100);
  assert.equal(rows[0].revenue, 6000);
  assert.equal(f.state.queries[0].maximumBytesBilled, '100000000000');
  assert.deepEqual(f.state.queries[0].params.periodKeys, ['week-2026-37', 'week-2026-38']);
  assert.equal((await f.run()).state, 'up_to_date');
  assert.equal(f.state.queries.length, 1);
  assert.equal(await readJson(path.join(f.root, 'refresh-pending.json')), null);
  assert.ok((await fs.readdir(f.root)).some(name => name.startsWith('manifest-before-')));
});

test('interrupted pagination retains old manifest and resumes the same job without another scan', async t => {
  const f = await fixture(t);
  f.state.failPage = 1;
  await assert.rejects(f.run(), /network/);
  assert.deepEqual(await f.manifest(), seed());
  const pending = await readJson(path.join(f.root, 'refresh-pending.json'));
  assert.equal(pending.pageToken, '1');
  f.state.failPage = null;
  await f.run();
  assert.equal(f.state.queries.length, 1);
  const manifest = await f.manifest();
  assert.equal(manifest.partitions['week-2026-37'].length, 1);
  assert.equal(manifest.partitions['week-2026-38'].length, 1);
});

test('incomplete BigQuery job is retained and polled without publication or a second query', async t => {
  const f = await fixture(t);
  f.state.incomplete = true;
  assert.equal((await f.run()).state, 'running');
  assert.deepEqual(await f.manifest(), seed());
  f.state.incomplete = false;
  assert.equal((await f.run()).state, 'updated');
  assert.equal(f.state.queries.length, 1);
});

test('invalid results, absent totals and row-count mismatch never replace the active snapshot', async t => {
  for (const scenario of ['missing', 'count', 'nan', 'zero', 'duplicate']) {
    const f = await fixture(t);
    if (scenario === 'missing') { f.state.pages = [[overall('week-2026-37')]]; f.state.totalRows = 1; }
    if (scenario === 'count') f.state.totalRows = 999;
    if (scenario === 'nan') f.state.pages[1][0].revenue = 'NaN';
    if (scenario === 'zero') f.state.pages[1][0].sessions = 0;
    if (scenario === 'duplicate') f.state.pages[1] = [overall('week-2026-37')];
    await assert.rejects(f.run());
    assert.deepEqual(await f.manifest(), seed(), scenario);
  }
});

test('dry run only estimates the bounded query; no manifest, checkpoint or status mutation', async t => {
  const f = await fixture(t);
  const before = await fs.readdir(f.root);
  assert.equal((await f.run({ dryRun: true })).estimatedBytes, 1234);
  assert.deepEqual(await fs.readdir(f.root), before);
  assert.deepEqual(await f.manifest(), seed());
  assert.equal(f.state.queries[0].dryRun, true);
});

test('terminal query failure and concurrent manifest changes preserve the current generation', async t => {
  const f = await fixture(t);
  f.state.incomplete = true;
  await f.run();
  f.state.terminalError = 'quota exceeded';
  await assert.rejects(f.run(), /quota exceeded/);
  assert.deepEqual(await f.manifest(), seed());
  assert.equal(await readJson(path.join(f.root, 'refresh-pending.json')), null);
  const g = await fixture(t);
  g.state.incomplete = true;
  await g.run();
  const newer = { ...seed(), savedAt: '2026-09-22T09:00:00Z' };
  await fs.writeFile(path.join(g.root, 'partition-manifest.json'), JSON.stringify(newer));
  await assert.rejects(g.run(), /manifest changed/);
  assert.deepEqual(await g.manifest(), newer);
});
