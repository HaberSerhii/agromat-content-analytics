import test from "node:test";
import assert from "node:assert/strict";
import { apiParams, createApiCache } from "../public/api-cache.mjs";
function storage() {
  const entries = new Map();
  const cache = {
    async match(key) { return entries.get(key)?.clone(); },
    async put(key, value) { entries.set(key, value.clone()); },
    async delete(key) { return entries.delete(key); },
    async keys() { return [...entries.keys()]; },
  };
  return { open: async () => cache, entries };
}
const ok = (n = 1) => Response.json({ available: true, count: n, revision: "test" });
test("concurrent requests share fetch; fresh data survives a new page instance and expires", async () => {
  const disk = storage();
  let time = 1000, calls = 0;
  const options = { storage: () => disk, now: () => time, ttl: 100, fetcher: async () => ok(++calls) };
  const first = createApiCache(options);
  const values = await Promise.all([first.get('/api/sales'), first.get('/api/sales')]);
  assert.equal(calls, 1);
  assert.equal(values[0], values[1]);
  await first.flush();
  const next = createApiCache(options);
  assert.equal((await next.get('/api/sales')).count, 1);
  assert.equal(calls, 1);
  time += 101;
  assert.equal((await next.get('/api/sales')).count, 2);
  assert.equal(calls, 2);
  await next.flush();
});
test("filters and dates have distinct keys; display settings do not refetch sources", () => {
  const state = { from: "2026-11-01", to: "2026-11-14", yoy: true, page: 1, category: "all", chartChannel: "all", chartMetric: "revenue", chartInterval: "day", ranking: "category" };
  const key = (kind, extra = {}, changed = {}) => apiParams(kind, { ...state, ...changed }, extra).toString();
  assert.equal(key('sales'), key('sales', { channel: 'all', segment: 'Усі' }));
  assert.equal(key('sales'), key('sales', {}, { chartMetric: 'docs', chartInterval: 'week', ranking: 'brand', page: 3 }));
  for (const changed of [{ category: '42' }, { from: '2026-10-01' }, { yoy: false }, { chartInterval: 'month' }]) assert.notEqual(key('sales'), key('sales', {}, changed));
  assert.notEqual(key('sales'), key('sales', { channel: 'site' }));
  assert.notEqual(key('products'), key('products', {}, { page: 2 }));
  assert.equal(apiParams('users', state, { yoy: '0' }).get('yoy'), '0');
  assert.equal(key('channels'), key('channels', {}, { category: '42', search: 'test' }));
});
test("storage failure does not block data, errors are retried rather than cached", async () => {
  let calls = 0;
  const cache = createApiCache({ storage: () => { throw Error('denied'); }, fetcher: async () => ++calls === 1 ? Response.json({ available: false }, { status: 503 }) : ok(calls) });
  assert.equal((await cache.get('/api/products')).available, false);
  assert.equal((await cache.get('/api/products')).count, 2);
  assert.equal((await cache.get('/api/products')).count, 2);
  await cache.flush();
  assert.equal(calls, 2);
});
test("entry and byte limits bound persistent and memory cache; oversized replies are not saved", async () => {
  const disk = storage();
  let calls = 0;
  const cache = createApiCache({ storage: () => disk, maxEntries: 2, maxBytes: 300, fetcher: async () => ok(++calls) });
  for (const url of ['/a', '/b', '/c']) { await cache.get(url); await cache.flush(); }
  assert.equal(disk.entries.size, 2);
  await cache.get('/a');
  assert.equal(calls, 4);
  await cache.flush();
  const small = createApiCache({ storage: () => disk, maxBytes: 5, fetcher: async () => ok(++calls) });
  await small.get('/large'); await small.flush(); await small.get('/large');
  assert.equal(calls, 6);
  assert.equal(disk.entries.has('/large'), false);
});

test('overview history cache keys include calendar dates and channel',()=>{
 const state={from:'2026-10-01',to:'2026-11-15',chartChannel:'all'};
 const key=apiParams('overview-history',state).toString();
 assert.notEqual(key,apiParams('overview-history',{...state,from:'2026-11-01'}).toString());
 assert.notEqual(key,apiParams('overview-history',state,{channel:'site'}).toString());
 assert.equal(key,apiParams('overview-history',{...state,chartInterval:'week'}).toString());
});
