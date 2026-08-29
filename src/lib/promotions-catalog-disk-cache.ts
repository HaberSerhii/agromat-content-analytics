import { promises as fs } from "node:fs";
import path from "node:path";

const CACHE_FILE = "promotions-catalog-default.json";

function cacheDirectory(): string {
  if (process.env.DASHBOARD_CACHE_DIR) return process.env.DASHBOARD_CACHE_DIR;
  return process.env.NODE_ENV === "production"
    ? "/var/cache/agromat-analytics"
    : path.join(process.cwd(), "data", "dashboard-cache");
}

function cachePath(): string {
  return path.join(cacheDirectory(), CACHE_FILE);
}

export async function readPromotionsCatalogDiskCache(maxAgeMs: number): Promise<string | null> {
  try {
    const file = cachePath();
    const stat = await fs.stat(file);
    if (!stat.isFile() || Date.now() - stat.mtimeMs > maxAgeMs) return null;
    const json = await fs.readFile(file, "utf8");
    // Writes are atomic, but keep a cheap guard against manual truncation.
    return json.startsWith("{") && json.endsWith("}") ? json : null;
  } catch {
    return null;
  }
}

export async function writePromotionsCatalogDiskCache(json: string): Promise<void> {
  const directory = cacheDirectory();
  const destination = cachePath();
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(directory, { recursive: true, mode: 0o750 });
  try {
    await fs.writeFile(temporary, json, { encoding: "utf8", mode: 0o640 });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}
