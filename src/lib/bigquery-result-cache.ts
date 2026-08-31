import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";

type CacheEnvelope<T> = {
  version: 1;
  key: string;
  createdAt: string;
  value: T;
};

const memoryCache = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();
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
    process.env.BIGQUERY_RESULT_CACHE_RETENTION_DAYS ||
      DEFAULT_RETENTION_DAYS,
  );
  const days = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_RETENTION_DAYS;
  return days * 24 * 60 * 60_000;
}

function pruneNamespace(directory: string): void {
  try {
    const now = Date.now();
    const files = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".json.gz"))
      .map((name) => {
        const file = path.join(directory, name);
        return { file, modifiedAt: fs.statSync(file).mtimeMs };
      })
      .sort((left, right) => right.modifiedAt - left.modifiedAt);
    for (const entry of files) {
      if (now - entry.modifiedAt > retentionMs()) fs.unlinkSync(entry.file);
    }
    const remaining = files.filter(
      (entry) => now - entry.modifiedAt <= retentionMs(),
    );
    for (const entry of remaining.slice(MAX_FILES_PER_NAMESPACE))
      fs.unlinkSync(entry.file);
  } catch (error) {
    console.error("[bigquery-cache] prune failed:", error);
  }
}

function readDisk<T>(namespace: string, key: string): T | null {
  try {
    const file = cacheFile(namespace, key);
    const raw = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    if (envelope?.version !== 1 || envelope.key !== key) return null;
    return envelope.value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.error(`[bigquery-cache] ${namespace} read failed:`, error);
    return null;
  }
}

function writeDisk<T>(namespace: string, key: string, value: T): void {
  try {
    const file = cacheFile(namespace, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const envelope: CacheEnvelope<T> = {
      version: 1,
      key,
      createdAt: new Date().toISOString(),
      value,
    };
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      zlib.gzipSync(JSON.stringify(envelope), { level: 6 }),
    );
    fs.renameSync(temporary, file);
    pruneNamespace(path.dirname(file));
  } catch (error) {
    console.error(`[bigquery-cache] ${namespace} write failed:`, error);
  }
}

export async function readThroughBigQueryCache<T>(options: {
  namespace: string;
  key: string;
  load: () => Promise<T>;
}): Promise<T> {
  const compositeKey = `${options.namespace}:${options.key}`;
  if (memoryCache.has(compositeKey))
    return memoryCache.get(compositeKey) as T;

  const diskValue = readDisk<T>(options.namespace, options.key);
  if (diskValue != null) {
    memoryCache.set(compositeKey, diskValue);
    return diskValue;
  }

  const pending = inFlight.get(compositeKey);
  if (pending) return pending as Promise<T>;

  const loadPromise = options
    .load()
    .then((value) => {
      memoryCache.set(compositeKey, value);
      writeDisk(options.namespace, options.key, value);
      return value;
    })
    .finally(() => inFlight.delete(compositeKey));
  inFlight.set(compositeKey, loadPromise);
  return loadPromise;
}
