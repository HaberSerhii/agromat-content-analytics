type CacheStatus = "hit" | "miss" | "shared";

type CacheEntry = {
  expiresAt: number;
  lastAccess: number;
  hasValue: boolean;
  value?: unknown;
  pending?: Promise<unknown>;
};

declare global {
  var _agromatServerResultCaches: Map<string, Map<string, CacheEntry>> | undefined;
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

function prune(cache: Map<string, CacheEntry>, now: number, maxEntries: number) {
  for (const [key, entry] of cache) {
    if (!entry.pending && entry.expiresAt <= now) cache.delete(key);
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
  load: () => Promise<T>;
}): Promise<{ value: T; status: CacheStatus }> {
  const cache = namespaceCache(options.namespace);
  const now = Date.now();
  const current = cache.get(options.key);

  if (current?.hasValue && current.expiresAt > now) {
    current.lastAccess = now;
    return { value: current.value as T, status: "hit" };
  }
  if (current?.pending) {
    return { value: await current.pending as T, status: "shared" };
  }

  prune(cache, now, Math.max(1, options.maxEntries ?? 32));
  const entry: CacheEntry = {
    expiresAt: 0,
    lastAccess: now,
    hasValue: false,
  };
  const pending = options.load();
  entry.pending = pending;
  cache.set(options.key, entry);

  try {
    const value = await pending;
    entry.value = value;
    entry.hasValue = true;
    entry.pending = undefined;
    entry.expiresAt = Date.now() + options.ttlMs;
    entry.lastAccess = Date.now();
    return { value, status: "miss" };
  } catch (error) {
    if (cache.get(options.key) === entry) cache.delete(options.key);
    throw error;
  }
}

export function putServerResult<T>(options: {
  namespace: string;
  key: string;
  value: T;
  ttlMs: number;
  maxEntries?: number;
}) {
  const cache = namespaceCache(options.namespace);
  const now = Date.now();
  prune(cache, now, Math.max(1, options.maxEntries ?? 32));
  cache.set(options.key, {
    expiresAt: now + options.ttlMs,
    lastAccess: now,
    hasValue: true,
    value: options.value,
  });
}

export function canonicalSearchParams(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}
