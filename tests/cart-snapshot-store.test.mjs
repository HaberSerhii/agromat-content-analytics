import test, { after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sourceLoader } from "./helpers/load-source.mjs";

const temporary = [];
after(async () => Promise.all(temporary.map(dir => fs.rm(dir, { recursive: true, force: true }))));

async function store(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cart-recovery-"));
  temporary.push(root);
  const directory = path.join(root, "carts", "test");
  const { readCartSnapshot } = sourceLoader({
    globals: { process: { env: { DASHBOARD_CACHE_DIR: root } } },
    mocks: { "node:fs": { promises: { ...fs, ...overrides } } },
  })("@/lib/cart-snapshot-store");
  let calls = 0;
  let ids = [1, 2];
  const pageData = async page => {
    calls++;
    return { data: [{ id: ids[page - 1], created_at: "2026-11-09T10:00:00Z", updated_at: "2026-11-09T10:00:00Z" }], totalPages: ids.length };
  };
  return {
    directory,
    read: (refresh = false) => readCartSnapshot("test", pageData, refresh),
    manifest: async () => JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")),
    calls: () => calls,
    setIds: value => { ids = value; },
  };
}

for (const corruption of ["missing generation", "missing second page", "invalid JSON"]) {
  test(`snapshot recovers from ${corruption} without returning partial data`, async () => {
    const cache = await store();
    await cache.read();
    const { generation } = await cache.manifest();
    if (corruption === "missing generation") await fs.rm(path.join(cache.directory, generation), { recursive: true });
    else if (corruption === "missing second page") await fs.unlink(path.join(cache.directory, generation, "2.json"));
    else await fs.writeFile(path.join(cache.directory, generation, "2.json"), "{");
    cache.setIds([3, 4]);
    const results = await Promise.all([cache.read(), cache.read()]);
    for (const result of results) assert.deepEqual(Array.from(result.data, row => row.id), [3, 4]);
    assert.equal(cache.calls(), 4);
    await cache.read();
    assert.equal(cache.calls(), 4);
  });
}

test("reader switches to another worker's published generation without fetching", async () => {
  const cache = await store();
  await cache.read();
  const old = await cache.manifest();
  const generation = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  await fs.cp(path.join(cache.directory, old.generation), path.join(cache.directory, generation), { recursive: true });
  await fs.writeFile(path.join(cache.directory, "manifest.json"), JSON.stringify({ ...old, generation }));
  await fs.rm(path.join(cache.directory, old.generation), { recursive: true });
  assert.equal((await cache.read()).data.length, 2);
  assert.equal(cache.calls(), 2);
});

for (const operation of ["readdir", "stat", "rm"]) {
  test(`cleanup ${operation} failure preserves the published snapshot`, async () => {
    const cache = await store({ [operation]: async () => { throw new Error("cleanup failed"); } });
    await fs.mkdir(path.join(cache.directory, "old-generation"), { recursive: true });
    const old = new Date(Date.now() - 300_000);
    await fs.utimes(path.join(cache.directory, "old-generation"), old, old);
    assert.equal((await cache.read()).data.length, 2);
    const { generation } = await cache.manifest();
    assert.ok(await fs.stat(path.join(cache.directory, generation, "1.json")));
    assert.equal((await cache.read(true)).data.length, 2);
    assert.equal(cache.calls(), 4);
  });
}

test("recovery stops after two retries if files keep disappearing", async () => {
  const cache = await store({ readFile: async (file, ...args) => {
    if (path.basename(file) === "2.json") {
      const error = new Error("page removed");
      error.code = "ENOENT";
      throw error;
    }
    return fs.readFile(file, ...args);
  } });
  await assert.rejects(cache.read(), { code: "ENOENT" });
  assert.equal(cache.calls(), 6);
});
