import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './helpers/load-source.mjs';

const { availableCpoPeriods } = sourceLoader()('@/lib/cpo-analytics/periods');
const metadata = { savedAt: '2026-09-14T00:00:00Z', dataFrom: '2025-01-01', dataTo: '2026-09-13' };
const identities = ranges => Array.from(ranges, r => `${r.year}:${r.number}`);

test('stale snapshot offers week 37 and August, excluding absent and incomplete periods', () => {
  const result = availableCpoPeriods(metadata, ['week-2026-36', 'week-2026-38', 'week-2026-37', 'week-2026-37', 'month-2026-9', 'month-2026-8', 'week-2025-1', 'month-2026-13'], '2026-09-22');
  assert.deepEqual(identities(result.periods.week), ['2026:37', '2026:36']);
  assert.deepEqual(identities(result.periods.month), ['2026:8']);
  assert.equal(result.dataTo, '2026-09-13');
});

test('periods crossing a new year keep their ISO year and exclude the current period', () => {
  const result = availableCpoPeriods({ ...metadata, dataTo: '2027-01-10' }, ['week-2026-53', 'week-2027-1', 'month-2026-12', 'month-2027-1'], '2027-01-04');
  assert.deepEqual(identities(result.periods.week), ['2026:53']);
  assert.deepEqual(identities(result.periods.month), ['2026:12']);
});

test('midweek and midmonth coverage does not expose partial aggregates', () => {
  const result = availableCpoPeriods({ ...metadata, dataTo: '2026-09-09' }, ['week-2026-36', 'week-2026-37', 'month-2026-9'], '2026-09-22');
  assert.deepEqual(identities(result.periods.week), ['2026:36']);
  assert.deepEqual(identities(result.periods.month), []);
});
