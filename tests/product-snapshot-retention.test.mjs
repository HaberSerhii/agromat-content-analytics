import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sourceLoader } from "./helpers/load-source.mjs";

test("snapshot pruning retains closed month final states and the recent daily window", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "product-month-end-"));
  try {
    const load = sourceLoader({ globals: {
      process: { env: { PRODUCT_SNAPSHOTS_DIR: dir }, cwd: () => process.cwd() },
    } });
    const { writeDailySnapshotToDisk } = load("@/lib/products-daily-snapshots");
    for (const date of ["2026-08-30", "2026-08-31", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"])
      writeDailySnapshotToDisk(date, [], `${date}T20:00:00Z`, 2);
    const dates = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"))
      .snapshots.map((entry) => entry.date);
    assert.deepEqual(dates, ["2026-08-31", "2026-09-30", "2026-10-02", "2026-10-03"]);
    for (const date of dates) assert.ok(fs.existsSync(path.join(dir, `${date}.json.gz`)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
