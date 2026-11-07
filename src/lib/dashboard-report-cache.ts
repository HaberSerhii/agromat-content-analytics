import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getServerResult } from "@/lib/server-result-cache";
import { readPersistentResult, writePersistentResult } from "@/lib/persistent-result-cache";
/** Only compact, derived reports belong here, never copies of raw order history. */
export function readDashboardReport<T>(namespace: string, key: string, ttlMs: number, load: () => Promise<T>) {
  const name = `${namespace}-${createHash("sha256").update(key).digest("hex")}`;
  const options = { namespace, key, ttlMs, maxEntries: namespace === "search-dataset-v2" ? 1 : 8, maxEntryBytes: namespace === "search-dataset-v2" ? 64 * 1024 * 1024 : 16 * 1024 * 1024, load: async (): Promise<T> => {
    const saved = await readPersistentResult<T>(name, ttlMs);
    if (saved) { options.ttlMs = Math.max(1, saved.createdAt + ttlMs - Date.now()); return saved.value; }
    const value = await load();
    await writePersistentResult(name, value);
    const directory = process.env.DASHBOARD_CACHE_DIR || path.join(process.cwd(), "data", "dashboard-cache");
    try {
      const files = (await fs.readdir(directory)).filter(file => file.startsWith(`${namespace}-`) && file.endsWith(".bin"));
      const dated = await Promise.all(files.map(async file => ({ file, modified: (await fs.stat(path.join(directory, file))).mtimeMs })));
      const sorted = dated.sort((a, b) => b.modified - a.modified);
      for (const [index, file] of sorted.entries()) if (index >= 64 || Date.now() - file.modified > Math.max(ttlMs * 2, 86_400_000)) await fs.unlink(path.join(directory, file.file)).catch(() => undefined);
    } catch { /* Retention failure must not prevent report delivery. */ }
    return value;
  } };
  return getServerResult(options);
}
