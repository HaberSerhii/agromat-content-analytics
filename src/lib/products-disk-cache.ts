import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { ProductLite } from "./products-store";

const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
function cacheFile() {
  const root = process.env.DASHBOARD_CACHE_DIR || (process.env.NODE_ENV === "production" ? "/var/cache/agromat-analytics" : path.join(process.cwd(), "data"));
  return path.join(root, "products-lite.json.gz");
}
interface DiskSnapshot { syncedAt: string; count: number; products: ProductLite[]; }
export async function readDiskSnapshot(): Promise<DiskSnapshot | null> {
  try {
    const snap = JSON.parse((await gunzip(await fs.readFile(cacheFile()))).toString("utf8")) as DiskSnapshot;
    return snap?.products && Array.isArray(snap.products) ? snap : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[products-disk-cache] invalid snapshot");
    return null;
  }
}
export async function writeDiskSnapshot(products: ProductLite[], syncedAt: string): Promise<void> {
  const file = cacheFile(), tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const gz = await gzip(JSON.stringify({ syncedAt, count: products.length, products }), { level: 3 });
    await fs.writeFile(tmp, gz, { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch { await fs.unlink(tmp).catch(() => undefined); console.warn("[products-disk-cache] write failed"); }
}
