import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {catalogSelection, catalogTrafficReferences, readCatalogScoreHistory, stockMovement} from '../catalog-health.mjs';

test('catalog impressions and CTR use the header calendar and comparison mode', () => {
  const params = new URLSearchParams({from:'2026-11-01',to:'2026-11-17',compareMode:'mom'});
  assert.deepEqual(catalogSelection(params,'2026-11-18').baseline,{from:'2026-10-01',to:'2026-10-17'});
  params.set('compareMode','yoy');
  assert.deepEqual(catalogSelection(params,'2026-11-18').baseline,{from:'2025-11-01',to:'2025-11-17'});
  params.set('compareMode','wow');
  assert.throws(()=>catalogSelection(params,'2026-11-18'),/comparison_unavailable/);
});

test('stock movement compares unique SKUs and preserves a missing baseline', () => {
  const current = new Set([1,2,3,4]);
  assert.deepEqual(stockMovement(current,new Set([1,2,5])),{gained:2,lost:1,net:1});
  assert.equal(stockMovement(current,null),null);
});

test('catalog traffic fills missing GA4 categories only for unambiguous IDs', () => {
  const groups = [
    {label:'Плитка',refs:new Set([1,2])},
    {label:'Сантехніка',refs:new Set([2,3])},
    {label:'Будівельна хімія',refs:new Set([4])},
  ];
  assert.deepEqual(catalogTrafficReferences(groups), [
    {segment:'Плитка',ref:1,nullOnly:true},
    {segment:'Сантехніка',ref:3,nullOnly:true},
    {segment:'Будівельна хімія',ref:4,nullOnly:false},
  ]);
});

test('daily CS carries the prior month closing score and keeps gaps distinct from zero', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-score-history-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const snapshots = {
    '2026-10-31':{1:58.544},
    '2026-11-02':{1:58.544},
    '2026-11-30':{1:60.343, 2:null},
    '2026-12-01':{1:60.444},
    '2026-12-02':{1:60.644, 2:50},
    '2026-12-03':{1:60.644, 2:50},
    '2026-12-05':{1:60.644, 2:null},
    '2026-12-06':{1:0},
  };
  await Promise.all(Object.entries(snapshots).map(([date, data]) =>
    writeFile(join(directory, `${date}.json`), JSON.stringify(data))));
  const groups = [{codes:[1]}, {codes:[2]}];
  const november = await readCatalogScoreHistory(groups, directory, '2026-11-30');
  assert.equal(november.segments[0].scoreBase, 58.54);
  assert.equal(november.segments[0].scoreChange, 1.8);
  const december = await readCatalogScoreHistory(groups, directory, '2026-12-01');
  assert.equal(december.segments[0].scoreDaily, 0.1);
  const {date, start, segments:[tile, plumbing]} = await readCatalogScoreHistory(groups, directory, '2026-12-05');
  assert.equal(start, '2026-12-01');
  assert.equal(date, '2026-12-05');
  assert.equal(tile.scoreBase, 60.34);
  assert.equal(tile.scoreBaseDate, '2026-11-30');
  assert.equal(tile.score, 60.64);
  assert.equal(tile.scoreChange, 0.3);
  assert.deepEqual(tile.scoreHistory.map(({score, daily, monthChange}) => [score, daily, monthChange]), [
    [60.44, 0.1, 0.1], [60.64, 0.2, 0.3], [60.64, 0, 0.3], [null, null, null], [60.64, null, 0.3],
  ]);
  assert.equal(plumbing.scoreBaseDate, '2026-12-02');
  assert.equal(plumbing.scoreBase, 50);
  assert.equal(plumbing.scoreDate, '2026-12-03');
  assert.equal(plumbing.scoreDaily, 0);
  assert.equal(plumbing.scoreHistory[1].monthChange, 0);

  const {available, date: januaryDate, segments:[january]} = await readCatalogScoreHistory(groups, directory, '2027-01-01');
  assert.equal(available, true);
  assert.equal(januaryDate, null);
  assert.equal(january.scoreBaseDate, '2026-12-06');
  assert.equal(january.scoreBase, 0);
  assert.equal(january.scoreChange, null);
});
