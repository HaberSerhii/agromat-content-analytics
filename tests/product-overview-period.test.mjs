import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/load-source.mjs";
const load = sourceLoader({
  mocks: {
    "@google-cloud/bigquery": { BigQuery: class {} },
    "@/lib/bigquery-result-cache": { readThroughBigQueryCache: async () => [] },
  },
});
const { shiftOverviewDate, buildOverviewPeriod } = load(
  "@/lib/product-overview-period",
);
test("comparison periods clamp end of month and leap day", () => {
  assert.equal(shiftOverviewDate("2026-03-31", -1), "2026-02-28");
  assert.equal(shiftOverviewDate("2024-02-29", -12), "2023-02-28");
});
test("daily overview counts new products inclusively and leaves unavailable scores empty", async () => {
  const data = await buildOverviewPeriod(
    [{ goodsRef: 1, firstSeenAt: "2026-11-02T00:00:00Z" }],
    "2026-11-01",
    "2026-11-03",
    "table",
    72,
  );
  assert.deepEqual(
    Array.from(data.current, (p) => p.newProducts),
    [0, 1, 0],
  );
  assert.equal(data.current[0].ctr, null);
  assert.equal(data.current[0].contentScore, null);
  assert.equal(data.contentScore, 72);
});
test("invalid and excessive ranges are rejected", async () => {
  await assert.rejects(
    buildOverviewPeriod([], "2026-11-03", "2026-11-01", "table", null),
  );
  await assert.rejects(
    buildOverviewPeriod([], "2024-01-01", "2026-01-01", "table", null),
  );
});
