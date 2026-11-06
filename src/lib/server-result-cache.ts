/** Conservative heap estimate; no serialization buffer or copy of the cached value. */
export function estimatedCacheBytes(value: unknown, ceiling = 128 * 1024 * 1024): number {
  const seen = new WeakSet<object>();
  let bytes = 0;
  function visit(value: unknown, depth = 0) {
    if (bytes > ceiling) return;
    if (typeof value === "string") { bytes += value.length * 2 + 24; return; }
    if (value === null || typeof value !== "object") { bytes += 8; return; }
    if (seen.has(value)) return;
    seen.add(value); bytes += 48;
    if (depth > 64) { bytes = ceiling + 1; return; }
    if (ArrayBuffer.isView(value)) { bytes += value.byteLength; return; }
    if (value instanceof Map) { for (const [key, item] of value) { visit(key, depth + 1); visit(item, depth + 1); } }
    else if (value instanceof Set || Array.isArray(value)) { for (const item of value) visit(item, depth + 1); }
    else { for (const key of Object.keys(value)) { bytes += key.length * 2 + 16; visit((value as Record<string, unknown>)[key], depth + 1); } }
  }
  visit(value);
  return bytes;
}

type CacheStatus = "hit" | "miss" | "shared" | "stale";

type CacheEntry = {
  bytes?: number;
  expiresAt: number;
  staleUntil?: number;
  retryAt?: number;
  lastAccess: number;
  hasValue: boolean;
  value?: unknown;
  pending?: Promise<unknown>;
};

declare global {
  var _agromatServerResultCaches:
    | Map<string, Map<string, CacheEntry>>
    | undefined;
}

const counters = { hit: 0, miss: 0, shared: 0, stale: 0, evicted: 0, oversized: 0, loads: 0, errors: 0, loadMs: 0 };
const managed = (namespace: string) => !/^(parser|competitor)/.test(namespace);
const budgetBytes = () => Math.max(1, Number(process.env.DASHBOARD_RESULT_CACHE_MB) || 96) * 1024 * 1024;

export function trimServerResultCaches(now = Date.now()) {
  const entries: { cache: Map<string, CacheEntry>; key: string; entry: CacheEntry }[] = [];
  let total = 0;
  for (const [namespace, cache] of global._agromatServerResultCaches || []) {
    if (!managed(namespace)) continue;
    for (const [key, entry] of cache) {
      if (!entry.pending && (entry.staleUntil ?? entry.expiresAt) <= now) { cache.delete(key); continue; }
      total += entry.bytes || 0;
      if (!entry.pending) entries.push({ cache, key, entry });
    }
  }
  for (const { cache, key, entry } of entries.sort((a, b) => a.entry.lastAccess - b.entry.lastAccess)) {
    if (total <= budgetBytes()) break;
    cache.delete(key); total -= entry.bytes || 0; counters.evicted++;
  }
}

export function serverResultCacheStats() {
  trimServerResultCaches();
  const namespaces = [...(global._agromatServerResultCaches || [])].filter(([name]) => managed(name)).map(([name, cache]) => ({
    name, entries: cache.size,
    estimatedBytes: [...cache.values()].reduce((sum, entry) => sum + (entry.bytes || 0), 0),
    pending: [...cache.values()].filter(entry => entry.pending).length,
  }));
  return { budgetBytes: budgetBytes(), estimatedBytes: namespaces.reduce((sum, item) => sum + item.estimatedBytes, 0), counters: { ...counters }, namespaces };
}

function namespaceCache(namespace: string): Map<string, CacheEntry> {
  global._agromatServerResultCaches ??= new Map();
  let cache = global._agromatServerResultCaches.get(namespace);
  if (!cache) {
    cache = new Map();
    global._agromatServerResultCaches.set(namespace, cache);
  }
  return cache;
}

function prune(
  cache: Map<string, CacheEntry>,
  now: number,
  maxEntries: number,
) {
  for (const [key, entry] of cache) {
    if (!entry.pending && (entry.staleUntil ?? entry.expiresAt) <= now)
      cache.delete(key);
  }
  while (cache.size >= maxEntries) {
    const oldest = [...cache.entries()]
      .filter(([, entry]) => !entry.pending)
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess)[0];
    if (!oldest) break;
    cache.delete(oldest[0]);
  }
}

/**
 * Small process-local TTL/LRU cache for expensive, user-independent results.
 * Concurrent callers for the same key share one loader promise.
 */
export async function getServerResult<T>(options: {
  namespace: string;
  key: string;
  ttlMs: number;
  maxEntries?: number;
  staleMs?: number;
  refresh?: boolean;
  load: () => Promise<T>;
}): Promise<{ value: T; status: CacheStatus }> {
  const cache = namespaceCache(options.namespace);
  const now = Date.now();
  const current = cache.get(options.key);

  if (!options.refresh && current?.hasValue && current.expiresAt > now) {
    current.lastAccess = now;
    counters.hit++;
    return { value: current.value as T, status: "hit" };
  }
  const canServeStale =
    !options.refresh && current?.hasValue && (current.staleUntil ?? 0) > now;
  if (canServeStale && (current.pending || (current.retryAt ?? 0) > now)) {
    current.lastAccess = now;
    counters.stale++;
    return { value: current.value as T, status: "stale" };
  }
  if (current?.pending) {
    counters.shared++;
    return { value: (await current.pending) as T, status: "shared" };
  }

  prune(cache, now, Math.max(1, options.maxEntries ?? 32));
  const entry: CacheEntry = current?.hasValue
    ? current
    : {
        expiresAt: 0,
        lastAccess: now,
        hasValue: false,
      };
  // Defer the loader until the promise is registered (including synchronous failures).
  const started = performance.now();
  counters.loads++;
  const pending = Promise.resolve().then(options.load);
  entry.pending = pending;
  cache.set(options.key, entry);

  const complete = async (): Promise<T> => {
    try {
      const value = await pending;
      entry.value = value;
      entry.hasValue = true;
      entry.pending = undefined;
      entry.expiresAt = Date.now() + options.ttlMs;
      entry.staleUntil = entry.expiresAt + (options.staleMs ?? 0);
      entry.retryAt = 0;
      entry.lastAccess = Date.now();
      counters.loadMs += performance.now() - started;
      if (managed(options.namespace) && cache.get(options.key) === entry) {
        entry.bytes = estimatedCacheBytes(value, budgetBytes());
        const maxEntry = Math.min(budgetBytes(), 16 * 1024 * 1024);
        if (entry.bytes > maxEntry) { cache.delete(options.key); counters.oversized++; }
        trimServerResultCaches();
      }
      return value;
    } catch (error) {
      counters.errors++;
      entry.pending = undefined;
      entry.retryAt = Date.now() + 10_000;
      if (!entry.hasValue || (entry.staleUntil ?? 0) <= Date.now()) {
        if (cache.get(options.key) === entry) cache.delete(options.key);
      }
      throw error;
    }
  };
  const completion = complete();
  entry.pending = completion;
  if (canServeStale) {
    void completion.catch(() => undefined);
    return { value: entry.value as T, status: "stale" };
  }
  counters.miss++;
  return { value: await completion, status: "miss" };
}

export function putServerResult<T>(options: {
  namespace: string;
  key: string;
  value: T;
  ttlMs: number;
  maxEntries?: number;
  staleMs?: number;
}) {
  const cache = namespaceCache(options.namespace);
  const now = Date.now();
  prune(cache, now, Math.max(1, options.maxEntries ?? 32));
  cache.set(options.key, {
    expiresAt: now + options.ttlMs,
    staleUntil: now + options.ttlMs + (options.staleMs ?? 0),
    lastAccess: now,
    hasValue: true,
    value: options.value,
    bytes: managed(options.namespace) ? estimatedCacheBytes(options.value, budgetBytes()) : 0,
  });
  if (managed(options.namespace)) trimServerResultCaches();
}

/** In-flight readers may finish, but their result cannot repopulate this namespace. */
export function invalidateServerResults(namespace: string) {
  global._agromatServerResultCaches?.get(namespace)?.clear();
}

export function canonicalSearchParams(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(
      ([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
    )
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

/** Read a completed result without waiting for an in-flight background refresh. */
export function peekServerResult<T>(namespace: string, key: string): { value: T; status: "hit" | "stale" } | null {
  const entry = namespaceCache(namespace).get(key);
  if (!entry?.hasValue || (entry.staleUntil ?? entry.expiresAt) <= Date.now()) return null;
  entry.lastAccess = Date.now();
  return { value: entry.value as T, status: entry.expiresAt > Date.now() ? "hit" : "stale" };
}

// Expiration also releases idle namespaces. The timer never keeps the process alive.
declare global { var _agromatResultCacheSweep: ReturnType<typeof setInterval> | undefined; }
if (typeof setInterval === "function" && !global._agromatResultCacheSweep) {
  global._agromatResultCacheSweep = setInterval(() => trimServerResultCaches(), 30_000);
  global._agromatResultCacheSweep.unref?.();
}
