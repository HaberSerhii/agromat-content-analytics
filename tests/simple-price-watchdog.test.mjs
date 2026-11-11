import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { STALL_MS, STALL_MESSAGE, statusAt } from "../scripts/lib/simple-price-watchdog.mjs";

test("only unfinished jobs expire five minutes after their last progress", () => {
  for (const status of ["starting", "running"]) {
    const job = { status, started_at: 0, current: 18 };
    assert.equal(statusAt(job, 900000, 900000 + STALL_MS - 1), job);
    const expired = statusAt(job, 900000, 900000 + STALL_MS);
    assert.equal(expired.status, "error");
    assert.equal(expired.current, 18);
  }
  for (const status of ["done", "error"]) {
    const job = { status };
    assert.equal(statusAt(job, 0, STALL_MS), job);
  }
});

test("a worker stuck reading the database exits and records a retryable error", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "price-watchdog-"));
  const mock = `
    globalThis.fetch = () => new Promise(() => {});
    const original = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => original(fn, ms === ${STALL_MS} ? 20 : ms, ...args);
  `;
  try {
    const child = spawnSync(process.execPath, [
      "--import", "data:text/javascript," + encodeURIComponent(mock),
      "scripts/simple-price-worker.mjs", "--adapter", "plitka",
    ], {
      timeout: 5000,
      env: { ...process.env, SIMPLE_PRICE_JOB_DIR: dir, SUPABASE_URL: "https://test.invalid", SUPABASE_KEY: "test" },
    });
    assert.ifError(child.error);
    assert.equal(child.status, 1);
    const { job_id } = JSON.parse(readFileSync(path.join(dir, "plitka-active.json")));
    const job = JSON.parse(readFileSync(path.join(dir, job_id + ".json")));
    assert.equal(job.status, "error");
    assert.equal(job.error, STALL_MESSAGE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
