import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ApiCart } from "@/lib/cart-types";
import { getServerResult, putServerResult } from "@/lib/server-result-cache";

type Manifest = { generation: string; pages: number; fetched_at: string };
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" });
const root = () => path.join(process.env.DASHBOARD_CACHE_DIR || (process.env.NODE_ENV === "production" ? "/var/cache/agromat-analytics" : path.join(process.cwd(), "data", "dashboard-cache")), "carts");
const pending = new Map<string, Promise<Manifest>>();
async function readManifest(directory: string): Promise<Manifest | null> {
  try {
    const value = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")) as Manifest;
    return /^[a-f0-9-]+$/.test(value.generation) && value.pages >= 0 && value.pages <= 10000 ? value : null;
  } catch { return null; }
}

/** Publish the manifest last: an interrupted sync never replaces the last complete snapshot. */
async function synchronize(directory: string, pageData: (page: number) => Promise<{ data: ApiCart[]; totalPages: number }>) {
  if (pending.has(directory)) return pending.get(directory)!;
  const work = (async () => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const generation = randomUUID(), destination = path.join(directory, generation);
    await fs.mkdir(destination, { mode: 0o700 });
    try {
      const first = await pageData(1);
      if (first.totalPages > 10000) throw new Error("Історія кошиків перевищує ліміт дискової синхронізації");
      await fs.writeFile(path.join(destination, "1.json"), JSON.stringify(first.data), { mode: 0o600 });
      let pages = first.totalPages;
      for (let page = 2; page <= pages;) {
        const count = Math.min(2, pages - page + 1);
        const batch = await Promise.all(Array.from({ length: count }, (_, i) => pageData(page + i)));
        for (let index = 0; index < batch.length; index++) {
          pages = Math.max(pages, batch[index].totalPages);
          if (pages > 10000) throw new Error("Історія кошиків перевищує ліміт дискової синхронізації");
          await fs.writeFile(path.join(destination, `${page + index}.json`), JSON.stringify(batch[index].data), { mode: 0o600 });
        }
        page += count;
      }
      const value = { generation, pages: Math.max(1, pages), fetched_at: new Date().toISOString() };
      const temp = path.join(directory, `manifest-${generation}.tmp`);
      await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
      await fs.rename(temp, path.join(directory, "manifest.json"));
      return value;
    } catch (error) { await fs.rm(destination, { recursive: true, force: true }); throw error; }
  })().then(async value => {
    // Cleanup must never roll back an already published snapshot.
    // Retain old generations for active readers and a short grace period so existing readers can finish safely.
    try {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === value.generation) continue;
        const file = path.join(directory, entry.name);
        try {
          if (Date.now() - (await fs.stat(file)).mtimeMs > 120_000) await fs.rm(file, { recursive: true, force: true });
        } catch { /* Another worker may already have removed this generation. */ }
      }
    } catch { /* Cleanup is best effort; the published snapshot remains valid. */ }
    return value;
  }).finally(() => pending.delete(directory));
  pending.set(directory, work);
  return work;
}

export async function readCartSnapshot(scope: string, pageData: (page: number) => Promise<{ data: ApiCart[]; totalPages: number }>, refresh: boolean, filter: { from?: string; to?: string; cartId?: number } = {}) {
  const directory = path.join(root(), scope);
  const namespace = "cart-snapshot-manifest-v1";
  let { value } = await getServerResult({ namespace, key: directory, ttlMs: 30_000, maxEntries: 2, refresh, load: async () => {
    const saved = await readManifest(directory);
    if (saved && Date.now() - Date.parse(saved.fetched_at) < 30_000 && !refresh) return saved;
    if (saved && !refresh) {
      void synchronize(directory, pageData).catch(() => undefined);
      return saved;
    }
    try { return await synchronize(directory, pageData); } catch (error) { if (saved) return saved; throw error; }
  } });
  // A cached manifest can outlive its files (cleanup, another worker, or disk eviction).
  // Prefer the current disk manifest and limit recovery to two retries; never return partial pages.
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await readPages(directory, value, filter);
      if (attempt > 0) putServerResult({ namespace, key: directory, value, ttlMs: 30_000, maxEntries: 2 });
      return result;
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      if ((!missing && !(error instanceof SyntaxError)) || attempt >= 2) throw error;
      const latest = attempt === 0 ? await readManifest(directory) : null;
      value = latest && latest.generation !== value.generation ? latest : await synchronize(directory, pageData);
    }
  }
}

async function readPages(directory: string, value: Manifest, filter: { from?: string; to?: string; cartId?: number }) {
  const selected = new Map<number, ApiCart>();
  for (let page = 1; page <= value.pages; page++) {
    const carts = JSON.parse(await fs.readFile(path.join(directory, value.generation, `${page}.json`), "utf8")) as ApiCart[];
    for (const cart of carts) {
      if (filter.cartId !== undefined && cart.id !== filter.cartId) continue;
      const date = day.format(new Date(cart.created_at));
      if ((filter.from && date < filter.from) || (filter.to && date > filter.to)) continue;
      const existing = selected.get(cart.id);
      if (!existing || cart.updated_at >= existing.updated_at) selected.set(cart.id, cart);
    }
  }
  return { data: [...selected.values()], fetched_at: value.fetched_at, stale: Date.now() - Date.parse(value.fetched_at) > 30_000 };
}
