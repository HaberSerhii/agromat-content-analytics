import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildAvailabilitySnapshot, type AvailabilitySnapshot } from "@/lib/product-availability";
import type { ProductLite } from "@/lib/products-store";

function directory() {
  return path.join(process.env.PRODUCT_SNAPSHOTS_DIR || path.join(process.cwd(), "data", "product-snapshots"), "availability-monthly");
}
function file(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid snapshot month");
  return path.join(directory(), `${month}.json`);
}
export async function readAvailabilitySnapshot(month: string): Promise<AvailabilitySnapshot | null> {
  try {
    const value = JSON.parse(await fs.readFile(file(month), "utf8")) as AvailabilitySnapshot;
    if (value.version !== 1 || value.month !== month || !Array.isArray(value.groups) || !Number.isFinite(Date.parse(value.syncedAt))) throw new Error("Invalid availability snapshot");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
const writes = new Map<string, Promise<unknown>>();
/** Keep every month's latest observed state indefinitely. A later request or
 * delayed sync must never replace it with an earlier observation. */
export async function writeAvailabilitySnapshot(products: ProductLite[], syncedAt: string) {
  const snapshot = buildAvailabilitySnapshot(products, syncedAt);
  const previous = writes.get(snapshot.month) || Promise.resolve();
  const work = previous.catch(() => undefined).then(async () => {
    const current = await readAvailabilitySnapshot(snapshot.month);
    if (current && Date.parse(current.syncedAt) >= Date.parse(syncedAt)) return current;
    await fs.mkdir(directory(), { recursive: true });
    const temporary = `${file(snapshot.month)}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
      await fs.rename(temporary, file(snapshot.month));
    } finally { await fs.unlink(temporary).catch(() => undefined); }
    return snapshot;
  });
  writes.set(snapshot.month, work);
  try { return await work; }
  finally { if (writes.get(snapshot.month) === work) writes.delete(snapshot.month); }
}
