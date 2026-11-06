import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getServerResult,
  putServerResult,
  invalidateServerResults,
} from "../src/lib/server-result-cache.ts";
import {
  readPersistentResult,
  writePersistentResult,
} from "../src/lib/persistent-result-cache.ts";

test("concurrent cold requests share one loader and failures are retried", async () => {
  let calls = 0;
  const options = {
    namespace: "test-cold",
    key: "key",
    ttlMs: 1000,
    load: async () => {
      calls++;
      return 42;
    },
  };
  const results = await Promise.all(
    Array.from({ length: 5 }, () => getServerResult(options)),
  );
  assert.equal(calls, 1);
  assert.deepEqual(
    results.map((r) => r.value),
    [42, 42, 42, 42, 42],
  );
  invalidateServerResults(options.namespace);
  await assert.rejects(
    getServerResult({
      ...options,
      load: () => {
        throw new Error("offline");
      },
    }),
  );
  assert.equal((await getServerResult(options)).value, 42);
  assert.equal(calls, 2);
});

test("expired data returns immediately while one refresh runs; forced refresh waits", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const options = {
    namespace: "test-stale",
    key: "key",
    ttlMs: 100,
    staleMs: 200,
  };
  putServerResult({ ...options, value: "old" });
  now += 101;
  let finish;
  let calls = 0;
  const load = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  assert.deepEqual(await getServerResult({ ...options, load }), {
    value: "old",
    status: "stale",
  });
  assert.equal((await getServerResult({ ...options, load })).status, "stale");
  const forced = getServerResult({ ...options, refresh: true, load });
  finish("new");
  assert.equal((await forced).value, "new");
  assert.equal(calls, 1);
  assert.equal((await getServerResult({ ...options, load })).value, "new");
});

test("stale refresh failures preserve data temporarily, with backoff and a hard expiry", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const options = {
    namespace: "test-failure",
    key: "key",
    ttlMs: 100,
    staleMs: 200,
  };
  putServerResult({ ...options, value: "last good" });
  now = 1101;
  let calls = 0;
  const load = async () => {
    calls++;
    throw new Error("offline");
  };
  assert.equal(
    (await getServerResult({ ...options, load })).value,
    "last good",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await getServerResult({ ...options, load })).status, "stale");
  assert.equal(calls, 1);
  now = 1400;
  await assert.rejects(getServerResult({ ...options, load }), /offline/);
});

test("invalidation during an in-flight read does not resurrect the old result", async () => {
  let finish;
  const options = { namespace: "test-invalidate", key: "key", ttlMs: 1000 };
  const first = getServerResult({
    ...options,
    load: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await Promise.resolve();
  invalidateServerResults(options.namespace);
  finish("old");
  await first;
  assert.equal(
    (await getServerResult({ ...options, load: async () => "new" })).value,
    "new",
  );
});

test("persistent datasets preserve Map/Set and enforce age on restart", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agromat-cache-"));
  const previous = process.env.DASHBOARD_CACHE_DIR;
  process.env.DASHBOARD_CACHE_DIR = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.DASHBOARD_CACHE_DIR;
    else process.env.DASHBOARD_CACHE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const value = { ids: new Set([1, 2]), rows: new Map([[1, { price: 23 }]]) };
  await writePersistentResult("test-base", value);
  assert.deepEqual((await readPersistentResult("test-base", 500)).value, value);
  now = 1600;
  assert.equal(await readPersistentResult("test-base", 500), null);
});

test("a global byte budget evicts across namespaces and idle expiration frees values", async () => {
  const { serverResultCacheStats, trimServerResultCaches, estimatedCacheBytes } = await import("../src/lib/server-result-cache.ts");
  const old = process.env.DASHBOARD_RESULT_CACHE_MB;
  process.env.DASHBOARD_RESULT_CACHE_MB = "1";
  try {
    putServerResult({ namespace: "test-budget-a", key: "a", value: "x".repeat(350_000), ttlMs: 60_000 });
    putServerResult({ namespace: "test-budget-b", key: "b", value: "x".repeat(350_000), ttlMs: 60_000 });
    assert.ok(serverResultCacheStats().estimatedBytes <= 1024 * 1024);
    assert.equal((await getServerResult({ namespace: "test-budget-a", key: "a", ttlMs: 1000, load: async () => "reloaded" })).status, "miss");
    trimServerResultCaches(Date.now() + 120_000);
    assert.equal(serverResultCacheStats().namespaces.find(item => item.name === "test-budget-b").entries, 0);
    const cycle = {}; cycle.self = cycle;
    assert.ok(Number.isFinite(estimatedCacheBytes(cycle)));
  } finally { if (old === undefined) delete process.env.DASHBOARD_RESULT_CACHE_MB; else process.env.DASHBOARD_RESULT_CACHE_MB = old; }
});

test("per-entry limits can be tuned while the global budget remains in force", async () => {
  let loads = 0;
  const options = { namespace: "test-entry-limit", key: "value", ttlMs: 10000, load: async () => { loads++; return "x".repeat(1024); } };
  await getServerResult({ ...options, maxEntryBytes: 128 });
  await getServerResult({ ...options, maxEntryBytes: 128 });
  assert.equal(loads, 2);
  await getServerResult({ ...options, maxEntryBytes: 4096 });
  await getServerResult({ ...options, maxEntryBytes: 4096 });
  assert.equal(loads, 3);
});
