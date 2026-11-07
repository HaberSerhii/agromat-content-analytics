import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { buildDailyAvailabilitySnapshot, type DailyAvailabilitySnapshot } from "@/lib/product-availability-daily";
import type { ProductLite } from "@/lib/products-store";
const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
function directory() { return path.join(process.env.PRODUCT_SNAPSHOTS_DIR || path.join(process.cwd(), "data", "product-snapshots"), "availability-daily"); }
function file(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Invalid daily snapshot date");
  return path.join(directory(), `${date}.json.gz`);
}
export async function readDailyAvailabilitySnapshot(date: string): Promise<DailyAvailabilitySnapshot | null> {
  try {
    const value = JSON.parse((await gunzip(await fs.readFile(file(date)))).toString("utf8")) as DailyAvailabilitySnapshot;
    if (value.version !== 1 || value.date !== date || !Array.isArray(value.products) || !Array.isArray(value.categories) || !Array.isArray(value.brands) || !Number.isFinite(Date.parse(value.syncedAt))) throw new Error("Invalid daily availability snapshot");
    return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function listDailyAvailabilitySnapshots(months?: string[]) {
  let files: string[];
  try { files = await fs.readdir(directory()); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const result: Array<{ date: string; signature: string; syncedAt: string | null }> = [];
  for (const name of files.filter(name => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(name) && (!months || months.includes(name.slice(0, 7)))).sort()) {
    const stat = await fs.stat(path.join(directory(), name));
    let syncedAt: string | null = null;
    try { const meta = JSON.parse(await fs.readFile(path.join(directory(), name + ".meta"), "utf8")); if (meta.size === stat.size && meta.mtimeMs === stat.mtimeMs) syncedAt = meta.syncedAt; } catch { /* Missing metadata is recovered from the payload on the next write. */ }
    result.push({ date: name.slice(0, 10), signature: `${stat.ino}:${stat.mtimeMs}:${stat.size}`, syncedAt });
  }
  return result;
}
let writeQueue: Promise<unknown> = Promise.resolve();
/** Last successful observation per Kyiv day, retained independently of the raw
 * daily snapshot window. Older syncs never replace newer same-day observations. */
export async function writeDailyAvailabilitySnapshot(products: ProductLite[], syncedAt: string) {
  const snapshot = buildDailyAvailabilitySnapshot(products, syncedAt);
  const work = writeQueue.catch(() => undefined).then(async () => {
    const current = await readDailyAvailabilitySnapshot(snapshot.date);
    const value = current && Date.parse(current.syncedAt) >= Date.parse(syncedAt) ? current : snapshot;
    await fs.mkdir(directory(), { recursive: true });
    const target = file(snapshot.date), temporary = `${target}.${randomUUID()}.tmp`;
    try {
      if (value === snapshot) { await fs.writeFile(temporary, await gzip(JSON.stringify(value), { level: 3 }), { mode: 0o600 }); await fs.rename(temporary, target); }
      const stat = await fs.stat(target), meta = `${target}.meta`, tempMeta = `${meta}.${randomUUID()}.tmp`;
      try { await fs.writeFile(tempMeta, JSON.stringify({ syncedAt: value.syncedAt, size: stat.size, mtimeMs: stat.mtimeMs }), { mode: 0o600 }); await fs.rename(tempMeta, meta); }
      finally { await fs.unlink(tempMeta).catch(() => undefined); }
    } finally { await fs.unlink(temporary).catch(() => undefined); }
    return value;
  });
  writeQueue = work.then(() => undefined, () => undefined);
  return work;
}
