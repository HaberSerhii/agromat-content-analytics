import { getServerResult } from "@/lib/server-result-cache";
import { createHash } from "crypto";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import path from "path";
import zlib from "zlib";

type CacheEnvelope<T> = {
  version: 1;
  key: string;
  createdAt: string;
  value: T;
};

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const DEFAULT_RETENTION_DAYS = 35;
const MAX_FILES_PER_NAMESPACE = 500;

export function bigQueryCacheDay(date = new Date()): string {
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
}

function cacheRoot(): string {
  if (process.env.BIGQUERY_RESULT_CACHE_DIR)
    return process.env.BIGQUERY_RESULT_CACHE_DIR;
  if (process.env.PRODUCT_SNAPSHOTS_DIR)
    return path.join(
      path.dirname(process.env.PRODUCT_SNAPSHOTS_DIR),
      "bigquery-cache",
    );
  return path.join(process.cwd(), "data", "bigquery-cache");
}

function safeNamespace(namespace: string): string {
  return namespace.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
}

function cacheFile(namespace: string, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return path.join(cacheRoot(), safeNamespace(namespace), `${digest}.json.gz`);
}

function retentionMs(): number {
  const configured = Number(
    process.env.BIGQUERY_RESULT_CACHE_RETENTION_DAYS || DEFAULT_RETENTION_DAYS,
  );
  const days =
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_RETENTION_DAYS;
  return days * 24 * 60 * 60_000;
}

async function pruneNamespace(directory: string): Promise<void> {
  try {
    const now = Date.now();
    const names = (await fs.readdir(directory)).filter((name) =>
      name.endsWith(".json.gz"),
    );
    const files = [];
    for (const name of names) {
      const file = path.join(directory, name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat) files.push({ file, modifiedAt: stat.mtimeMs });
    }
    files.sort((a, b) => b.modifiedAt - a.modifiedAt);
    for (const [index, entry] of files.entries()) {
      if (
        now - entry.modifiedAt > retentionMs() ||
        index >= MAX_FILES_PER_NAMESPACE
      ) {
        await fs.unlink(entry.file).catch(() => undefined);
      }
    }
  } catch (error) {
    console.error("[bigquery-cache] prune failed:", error);
  }
}

async function readDisk<T>(namespace: string, key: string): Promise<T | null> {
  try {
    const file = cacheFile(namespace, key);
    const raw = (await gunzip(await fs.readFile(file))).toString("utf8");
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    if (
      envelope?.version !== 1 ||
      envelope.key !== key ||
      !Number.isFinite(Date.parse(envelope.createdAt)) ||
      Date.now() - Date.parse(envelope.createdAt) > retentionMs()
    )
      return null;
    return envelope.value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.error(`[bigquery-cache] ${namespace} read failed:`, error);
    return null;
  }
}

async function writeDisk<T>(
  namespace: string,
  key: string,
  value: T,
): Promise<void> {
  try {
    const file = cacheFile(namespace, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const envelope: CacheEnvelope<T> = {
      version: 1,
      key,
      createdAt: new Date().toISOString(),
      value,
    };
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(
      temporary,
      await gzip(JSON.stringify(envelope), { level: 6 }),
    );
    await fs.rename(temporary, file);
    void pruneNamespace(path.dirname(file));
  } catch (error) {
    console.error(`[bigquery-cache] ${namespace} write failed:`, error);
  }
}

export async function readThroughBigQueryCache<T>(options: {
  namespace: string;
  key: string;
  load: () => Promise<T>;
}): Promise<T> {
  const result = await getServerResult<T>({ namespace: `bigquery-${options.namespace}`, key: options.key, ttlMs: 60 * 60_000, maxEntries: 8, load: async () => {
    const diskValue = await readDisk<T>(options.namespace, options.key);
    if (diskValue != null) return diskValue;
    const value = await options.load();
    await writeDisk(options.namespace, options.key, value);
    return value;
  } });
  return result.value;
}
