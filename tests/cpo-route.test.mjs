import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './helpers/load-source.mjs';

function setup({ authenticated = true, availability = { dataTo: '2026-09-13', periods: { week: [{ year: 2026, number: 37 }, { year: 2025, number: 52 }], month: [] } } } = {}) {
  const reads = [];
  const saves = [];
  const route = sourceLoader({ mocks: {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200, headers: init?.headers }) } },
    '@/lib/dashboard-auth': { isDashboardRequest: () => authenticated },
    '@/lib/cpo-analytics/store': {
      readCpoAvailability: async () => availability,
      cpoImportProgress: async () => 5000,
      readCpoCube: async selection => { reads.push(selection); return { cube: {}, compressedBytes: 100 }; },
      saveDiagnosticSnapshot: async (...args) => { saves.push(args); return `${process.cwd()}/data/test.json.gz`; },
    },
    '@/lib/cpo-analytics/engine': { buildCpoDiagnostic: input => ({ selectedYear: input.selectedYear, selectedPeriod: input.selectedPeriod, storage: {} }) },
  } })('@/app/api/cpo-diagnostics/route');
  return { ...route, reads, saves };
}
const request = body => ({ json: async () => body });

test('GET lists snapshot periods without reading diagnostic chunks; both methods require authentication', async () => {
  const route = setup();
  const response = await route.GET({});
  assert.equal(response.status, 200);
  assert.equal(response.body.periods.week[0].number, 37);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.equal(route.reads.length, 0);
  const denied = setup({ authenticated: false });
  assert.equal((await denied.GET({})).status, 401);
  assert.equal((await denied.POST(request({}))).status, 401);
});

test('POST defaults to the latest stored period and accepts explicit prior years', async () => {
  const route = setup();
  const response = await route.POST(request({}));
  assert.equal(response.body.selectedPeriod, 37);
  assert.equal(response.body.selectedYear, 2026);
  const priorYear = await route.POST(request({ periodKind: 'week', period: 52, year: 2025 }));
  assert.equal(priorYear.body.selectedYear, 2025);
  assert.equal(route.reads[1].year, 2025);
  assert.equal(route.saves[1][3], 2025);
});

test('POST rejects unavailable periods and import actions without loading chunks', async () => {
  const route = setup();
  for (const body of [{ period: 38, year: 2026 }, { period: 37.4, year: 2026 }, { periodKind: 'month' }]) {
    const response = await route.POST(request(body));
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'cpo_period_unavailable');
  }
  for (const action of ['build', 'estimate']) {
    assert.equal((await route.POST(request({ action }))).body.code, 'offline_import_required');
  }
  assert.equal(route.reads.length, 0);
});

test('missing snapshots retain import progress in GET and POST', async () => {
  const route = setup({ availability: null });
  for (const response of [await route.GET({}), await route.POST(request({}))]) {
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'cpo_snapshot_missing');
    assert.match(response.body.error, /5\D?000/);
  }
});
