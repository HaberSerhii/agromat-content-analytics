import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { sourceLoader } from "../tests/helpers/load-source.mjs";

// Offline comparison: no external services, writes only to a temporary cache and outputs/.
// Usage: node scripts/benchmark-dashboard-performance.mjs <baseline git ref>
const baseline = process.argv[2] || "2be328a";
const beforeSource = (name) =>
  execFileSync("git", ["show", `${baseline}:src/${name.slice(2)}.ts`], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
const output = path.resolve("outputs/performance-optimization-2026-09-09");
fs.mkdirSync(output, { recursive: true });
const report = {
  baseline,
  node: process.version,
  scope:
    "Offline, real historical fixtures; external I/O mocked; not production latency",
  measurements: {},
};
const directory = await mkdtemp(path.join(os.tmpdir(), "agromat-benchmark-"));
const env = {
  env: { DASHBOARD_CACHE_DIR: directory },
  pid: process.pid,
  cwd: () => process.cwd(),
};
const catalog = JSON.parse(
  zlib.gunzipSync(fs.readFileSync("data/products-lite.json.gz")),
);
const snapshot = JSON.parse(
  zlib.gunzipSync(fs.readFileSync("data/product-snapshots/2026-06-15.json.gz")),
);
const csv = fs.readFileSync(
  "outputs/sales-readable/analysebillsofparsel.csv",
  "utf8",
);
report.fixtures = {
  products: catalog.products.length,
  syncedAt: catalog.syncedAt,
  snapshot: "2026-06-15",
  csvBytes: Buffer.byteLength(csv),
};
async function measure(work, count = 9) {
  const samples = [];
  let result;
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    result = await work();
    samples.push(performance.now() - start);
  }
  const warm = samples.slice(1).sort((a, b) => a - b);
  return {
    firstMs: samples[0],
    warmMedianMs: warm[Math.floor(warm.length / 2)],
    maxMs: Math.max(...samples),
    samples,
    result,
  };
}
function saveComparison(name, before, after) {
  const left = Object.fromEntries(
    Object.entries(before).filter(([key]) => key !== "result"),
  );
  const right = Object.fromEntries(
    Object.entries(after).filter(([key]) => key !== "result"),
  );
  report.measurements[name] = {
    before: left,
    after: right,
    reductionPct: 100 * (1 - right.warmMedianMs / left.warmMedianMs),
  };
}
try {
  const snapshotModule = "@/lib/products-daily-snapshots";
  const oldSnapshots = sourceLoader({
    sources: { [snapshotModule]: beforeSource(snapshotModule) },
    globals: { process: env },
  })(snapshotModule);
  const newSnapshots = sourceLoader({ globals: { process: env } })(
    snapshotModule,
  );
  const oldSnapshot = await measure(() =>
    oldSnapshots.readDailySnapshotFromDisk("2026-06-15"),
  );
  const newSnapshot = await measure(() =>
    newSnapshots.readDailySnapshotFromDisk("2026-06-15"),
  );
  assert.equal(
    JSON.stringify(oldSnapshot.result),
    JSON.stringify(newSnapshot.result),
  );
  saveComparison("snapshotRead", oldSnapshot, newSnapshot);

  const routeName = "@/app/api/products/dashboard-v2/route";
  const moduleOptions = {
    mocks: {
      "@/lib/products-store": {
        readAllLite: async () => catalog.products,
        readLiteSyncedAt: async () => catalog.syncedAt,
        readSyncState: async () => ({ status: "ok" }),
        listSnapshotDates: async () => [{ date: "2026-06-15" }],
        readDailySnapshot: async () => snapshot,
        readProductAttributeIndex: async () => new Map(),
        readRequiredAttrs: async () => ({}),
      },
      "@/lib/content-reviews-store": {
        listContentProductReviews: async () => [],
      },
      "@/lib/new-product-assignments-store": {
        listAssignedNewProductCodes: async () => new Set(),
      },
      "@/lib/bigquery-result-cache": {
        readThroughBigQueryCache: async () => [],
      },
    },
  };
  for (const view of ["overview", "categories", "products", "new"]) {
    const oldRoute = sourceLoader({
      ...moduleOptions,
      sources: { [routeName]: beforeSource(routeName) },
    })(routeName);
    const newRoute = sourceLoader(moduleOptions)(routeName);
    const request = () =>
      new Request("http://localhost/api/products/dashboard-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          view,
          page: 1,
          limit: 15,
          statusId: view === "new" ? null : 5,
        }),
      });
    const old = await measure(async () => {
      const response = await oldRoute.POST(request());
      assert.equal(response.status, 200);
      return response.text();
    });
    const current = await measure(async () => {
      const response = await newRoute.POST(request());
      assert.equal(response.status, 200);
      return response.text();
    });
    assert.deepEqual(JSON.parse(old.result), JSON.parse(current.result));
    saveComparison(`cards_${view}_repeatedPost`, old, current);
  }

  const salesName = "@/lib/sales-s3";
  const salesOptions = {
    mocks: {
      "@/lib/products-store": {},
      "@aws-sdk/client-s3": {},
      "@/lib/persistent-result-cache": {},
    },
    append: { [salesName]: "\nexport {parseSalesRows,buildDataset};" },
  };
  const oldSales = sourceLoader({
    ...salesOptions,
    sources: { [salesName]: beforeSource(salesName) },
  })(salesName);
  const newSales = sourceLoader({
    ...salesOptions,
    append: { [salesName]: "\nexport {parseSalesRowsBatched,buildDataset};" },
  })(salesName);
  async function withResponsiveness(work) {
    let last = performance.now(),
      maxGap = 0;
    const tick = () => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    };
    const timer = setInterval(tick, 1);
    await new Promise((resolve) => setImmediate(resolve));
    const start = performance.now();
    const rows = await work();
    const elapsed = performance.now() - start;
    await new Promise((resolve) => setImmediate(resolve));
    tick();
    clearInterval(timer);
    return { rows, elapsed, maxGap };
  }
  const oldParse = [],
    newParse = [];
  let parsedRows;
  for (let i = 0; i < 5; i++) {
    const old = await withResponsiveness(() =>
      oldSales.parseSalesRows(csv, new Map(), new Map()),
    );
    const current = await withResponsiveness(() =>
      newSales.parseSalesRowsBatched(csv, new Map(), new Map()),
    );
    assert.equal(JSON.stringify(old.rows), JSON.stringify(current.rows));
    for (const from of ["2026-05-01", "2026-06-01"]) {
      const filter = {
        from,
        to: from.slice(0, 7) + (from.includes("05") ? "-31" : "-28"),
      };
      assert.equal(
        JSON.stringify(
          oldSales.buildDataset(old.rows, {}, filter, {
            categoryProducts: false,
          }),
        ),
        JSON.stringify(
          newSales.buildDataset(current.rows, {}, filter, {
            categoryProducts: false,
          }),
        ),
      );
    }
    oldParse.push({ totalMs: old.elapsed, maxEventLoopGapMs: old.maxGap });
    newParse.push({
      totalMs: current.elapsed,
      maxEventLoopGapMs: current.maxGap,
    });
    parsedRows = current.rows;
  }
  const median = (rows, key) =>
    rows.map((row) => row[key]).sort((a, b) => a - b)[
      Math.floor(rows.length / 2)
    ];
  report.measurements.salesCsv = {
    before: oldParse,
    after: newParse,
    beforeMedianMs: median(oldParse, "totalMs"),
    afterMedianMs: median(newParse, "totalMs"),
    beforeMedianMaxEventLoopGapMs: median(oldParse, "maxEventLoopGapMs"),
    afterMedianMaxEventLoopGapMs: median(newParse, "maxEventLoopGapMs"),
  };
  const persistent = sourceLoader({ globals: { process: env } })(
    "@/lib/persistent-result-cache",
  );
  await persistent.writePersistentResult("sales-test", parsedRows);
  const restored = await measure(
    () => persistent.readPersistentResult("sales-test", 60_000),
    5,
  );
  assert.equal(
    JSON.stringify(restored.result.value),
    JSON.stringify(parsedRows),
  );
  const metrics = Object.fromEntries(
    Object.entries(restored).filter(([key]) => key !== "result"),
  );
  report.measurements.salesRestore = metrics;
  report.correctness =
    "Snapshots, complete card API responses, all parsed sales rows and May/June sales summaries match baseline exactly.";
  fs.writeFileSync(
    path.join(output, "comparison.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
