import test from "node:test";
import assert from "node:assert/strict";
import { lastQuarterWeeks, calendarBins } from "../public/chart-periods.mjs";
import { quarterChannelRows } from "../public/business-overview.mjs";
test("last quarter is 13 completed ISO weeks, T34 through T46 on Nov 16", () => {
  const range = lastQuarterWeeks("2026-11-16"),
    weeks = calendarBins(range, "week");
  assert.deepEqual(range, { from: "2026-08-17", to: "2026-11-15" });
  assert.deepEqual(
    weeks.map((row) => row.label),
    Array.from({ length: 13 }, (_, i) => "Т" + (34 + i)),
  );
  assert.deepEqual(
    lastQuarterWeeks("2026-11-19"),
    range,
    "current incomplete week is excluded",
  );
});
test("weekly channel totals sum every day once across month boundaries", () => {
  const range = lastQuarterWeeks("2026-11-16");
  const days = Array.from({ length: 91 }, (_, i) => ({
    date: new Date(Date.parse(range.from) + i * 86400000)
      .toISOString()
      .slice(0, 10),
    revenue: i + 1,
  }));
  const source = { available: true, byDate: days };
  const data = {
    quarterChannels: { site: source, rozetka: source, monomarket: source },
  };
  const result = quarterChannelRows(data, "2026-11-16");
  assert.equal(result.rows.length, 13);
  assert.equal(result.rows[0].total, 28 * 3);
  assert.equal(
    result.rows.reduce((sum, row) => sum + row.total, 0),
    ((91 * 92) / 2) * 3,
  );
  delete data.quarterChannels.rozetka;
  assert.ok(
    quarterChannelRows(data, "2026-11-16").rows.every(
      (row) => row.total === null,
    ),
  );
});
