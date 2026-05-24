// Storage layer for products snapshot in Redis.
// Lite shards drive the UI table; full records drive the drill-down modal.

import { getRedis } from "@/lib/redis";
import { readDiskSnapshot, writeDiskSnapshot } from "@/lib/products-disk-cache";
import type { ApiFilters } from "@/lib/products-api";

// ── Models ───────────────────────────────────────────────────────────────────
export interface StatusChange {
  at: string;        // ISO timestamp of the sync that detected it
  from: number;      // previous status_id
  to: number;        // new status_id
}

export interface ProductLite {
  id: number;
  goodsRef: number;
  code: number;
  sku: string | null;
  name: string;
  brand: string;
  brandId: number | null;
  categoryId: number;
  categoryName: string;
  categoryPath: string;
  url: string;
  price: number | null;
  priceBase: number | null;
  discountPct: number | null;
  currency: string;
  statusId: number;
  statusName: string;
  stockQty: number | null;
  imagesCount: number;
  reviewsCount: number;
  attributesCount: number;
  ratingAvg: number | null;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  // Our metadata (tracked across syncs)
  firstSeenAt: string;
  statusChangedAt: string | null;
  statusHistory: StatusChange[];
}

export interface ProductImage { url: string; main: boolean; sort: number }
export interface ProductAttribute { id: number; name: string; values: string[] }
export interface ProductReview {
  rating: number;
  text: string;
  author: string;
  advantage: string | null;
  disadvantage: string | null;
  date: string;
  likes: number;
  dislikes: number;
}
export interface ProductFull extends ProductLite {
  images: ProductImage[];
  attributes: ProductAttribute[];
  reviews: ProductReview[];
}

// ── Change-log events ────────────────────────────────────────────────────────
// Per-product change history captured at each sync by diffing the new full
// record against the previously stored one. Powers the "Історія змін" modal.
export type ChangeEvent =
  | { at: string; field: "price";       from: number | null; to: number | null }
  | { at: string; field: "priceBase";   from: number | null; to: number | null }
  | { at: string; field: "discountPct"; from: number | null; to: number | null }
  | { at: string; field: "status";      from: { id: number; name: string }; to: { id: number; name: string } }
  | { at: string; field: "stock";       from: number | null; to: number | null }
  | { at: string; field: "sku";         from: string | null; to: string | null }
  | {
      at: string;
      field: "attributes";
      added:   { id: number; name: string; values: string[] }[];
      removed: { id: number; name: string; values: string[] }[];
      changed: { id: number; name: string; from: string[]; to: string[] }[];
    }
  | {
      at: string;
      field: "images";
      fromCount: number;
      toCount: number;
      addedUrls: string[];
      removedUrls: string[];
    };

// Compact projection of ProductFull, used as the "previous state" we diff
// against. Keeping it small lets us load all 31K products at sync start
// without OOM (~10-30MB total vs. ~150MB for full records).
export interface ProductComparable {
  id: number;
  price: number | null;
  priceBase: number | null;
  discountPct: number | null;
  statusId: number;
  statusName: string;
  stockQty: number | null;
  sku: string | null;
  attributes: { id: number; name: string; values: string[] }[];
  imageUrls: string[];
}

export interface SyncState {
  state: "idle" | "running" | "ok" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  error?: string;
  // Set while state === "running" so the UI can render a progress bar
  progress?: {
    pages: number;
    totalPages: number;
    products: number;
  };
  stats?: {
    total: number;
    newCount: number;
    statusChanges: number;
    pages: number;
    durationMs: number;
  };
}

// ── Redis keys ───────────────────────────────────────────────────────────────
const SHARD_SIZE = 1000;        // lite: ~31 shards × ~250KB JSON for 31K products
const FULL_SHARD_COUNT = 200;   // full: 200 shards × ~150 items × ~3KB = ~450KB each (deterministic via id hash)
const FULL_TTL_SEC = 60 * 60 * 24 * 30; // 30 days for drill-down cache
const CHANGES_MAX_PER_PRODUCT = 200;          // cap to bound Redis size
const CHANGES_TTL_SEC = 60 * 60 * 24 * 180;   // 180 days

const K = {
  liteShard: (n: number) => `products:lite:p${n}`,
  liteCount: "products:lite:count",
  liteTotal: "products:lite:total",
  liteSyncAt: "products:lite:syncedAt",
  // Full records are stored in deterministic shards keyed by `id % 200` (via djb2 hash).
  // No per-id index is needed — readers compute the shard from the id.
  fullShard: (n: number) => `products:full:s${n}`,
  filters: "products:filters",
  filtersAt: "products:filters:syncedAt",
  syncState: "products:sync:state",
  requiredAttrs: "products:required_attrs",
  // Per-day snapshots — copy of the lite snapshot keyed by ISO date (YYYY-MM-DD).
  // Used by the dashboard's "view state on day X" picker.
  snapShard: (date: string, n: number) => `products:snap:${date}:p${n}`,
  snapCount: (date: string) => `products:snap:${date}:count`,
  snapSyncAt: (date: string) => `products:snap:${date}:syncedAt`,
  snapDates: "products:snap:dates",          // sorted set, score=timestamp
  // Per-product change-event log. Written incrementally by sync.
  changes: (id: number) => `products:changes:${id}`,
};

const SNAPSHOT_KEEP_DAYS = 14;

// Deterministic id → shard mapping (djb2 hash, evenly distributes integer ids of any size).
function shardForId(id: number): number {
  let h = 5381;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h % FULL_SHARD_COUNT;
}

// ── In-memory cache for lite snapshot ───────────────────────────────────────
// Reading all 31 shards from Upstash REST costs ~1-3s per request (mostly
// network). Cache the result in the warm Node.js process so repeated dashboard
// requests (filtering, paging, summary) skip that cost entirely.
//
// Two TTL windows:
//   • FAST_TTL — return cached data with no Redis touch at all
//   • PROBE_TTL — cheap 2-key probe to verify syncedAt; if unchanged, keep cache
// Cache is invalidated explicitly by writeAllLite(), so a fresh sync is
// reflected immediately even if the probe window hasn't elapsed.
const LITE_CACHE_FAST_TTL_MS = 30_000;        // skip Redis entirely
const LITE_CACHE_PROBE_TTL_MS = 60 * 60_000;  // 1h — beyond this, force reload
declare global {
  // eslint-disable-next-line no-var
  var _productsLiteCache: { ts: number; key: string; data: ProductLite[] } | undefined;
}

// ── Lite shards I/O ─────────────────────────────────────────────────────────
//
// Read priority: in-memory → disk → Redis pipeline.
//   1. Memory hit (<30s): no I/O at all.
//   2. Probe Redis (2 GETs) for current syncedAt+count; if memory matches, reuse.
//   3. Try disk snapshot; if its embedded syncedAt+count match Redis's probe,
//      use it (saves the ~6s 31-shard pipeline).
//   4. Last resort: pipeline all shards from Redis, repopulate disk for next time.
export async function readAllLite(): Promise<ProductLite[]> {
  const redis = getRedis();
  const cache = global._productsLiteCache;
  const now = Date.now();

  // Fast path — recent cache, return without touching Redis.
  if (cache && now - cache.ts < LITE_CACHE_FAST_TTL_MS) {
    return cache.data;
  }

  const [countRaw, syncedAt] = await Promise.all([
    redis.get(K.liteCount) as Promise<string | null>,
    redis.get(K.liteSyncAt) as Promise<string | null>,
  ]);
  const count = parseInt(countRaw || "0", 10);
  if (!count) return [];

  // Cache key includes syncedAt — if probe shows the snapshot is unchanged,
  // reuse the cache for up to PROBE_TTL.
  const key = `${syncedAt ?? ""}:${count}`;
  if (cache && cache.key === key && now - cache.ts < LITE_CACHE_PROBE_TTL_MS) {
    cache.ts = now;
    return cache.data;
  }

  // Disk cache — populated by writeAllLite() after each sync. If its embedded
  // syncedAt matches what Redis just reported, the data is canonical and we
  // skip the expensive 31-shard pipeline. (Note: Redis's K.liteCount is the
  // shard count, not the product count — so we key freshness on syncedAt alone.)
  const disk = readDiskSnapshot();
  if (disk && syncedAt && disk.syncedAt === syncedAt) {
    const out: ProductLite[] = [];
    for (const p of disk.products) {
      if (p.name && p.name.trim() && p.code) out.push(p);
    }
    global._productsLiteCache = { ts: now, key, data: out };
    return out;
  }

  // Pipeline → one HTTP round-trip to Upstash instead of `count` separate calls.
  // For 31 shards this cuts cold-load time from ~2s to ~300-500ms.
  const pipe = redis.pipeline();
  for (let i = 0; i < count; i++) pipe.get(K.liteShard(i));
  const raws = (await pipe.exec()) as (string | null)[];

  const out: ProductLite[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    try {
      const shard = JSON.parse(raw) as ProductLite[];
      // Drop "ghost" records — products fully removed from the catalog that the
      // API still returns as stubs (valid id/created_at but empty name/code).
      // Pre-sync snapshots may contain them; sync now skips at write time.
      for (const p of shard) {
        if (p.name && p.name.trim() && p.code) out.push(p);
      }
    } catch { /* skip corrupted shard */ }
  }
  global._productsLiteCache = { ts: now, key, data: out };
  // Self-heal: backfill disk cache so future cold loads skip this Redis pipeline.
  if (syncedAt) writeDiskSnapshot(out, syncedAt);
  return out;
}

export async function writeAllLite(products: ProductLite[], syncedAt: string): Promise<number> {
  const redis = getRedis();
  // Clear old shards first (if previous run had more shards than this one)
  const oldCountRaw = (await redis.get(K.liteCount)) as string | null;
  const oldCount = parseInt(oldCountRaw || "0", 10);

  const shardCount = Math.max(1, Math.ceil(products.length / SHARD_SIZE));
  const writes: Promise<unknown>[] = [];
  for (let i = 0; i < shardCount; i++) {
    const chunk = products.slice(i * SHARD_SIZE, (i + 1) * SHARD_SIZE);
    writes.push(redis.set(K.liteShard(i), JSON.stringify(chunk)));
  }
  for (let i = shardCount; i < oldCount; i++) {
    writes.push(redis.del(K.liteShard(i)));
  }
  writes.push(redis.set(K.liteCount, String(shardCount)));
  writes.push(redis.set(K.liteTotal, String(products.length)));
  writes.push(redis.set(K.liteSyncAt, syncedAt));
  await Promise.all(writes);
  // Invalidate in-process cache so the next read picks up the fresh snapshot
  global._productsLiteCache = undefined;
  // Mirror to disk so the next cold load skips the 31-shard Redis pipeline.
  // Sync I/O is OK here — sync already takes minutes; an extra ~100ms is noise.
  writeDiskSnapshot(products, syncedAt);
  return shardCount;
}

export async function readLiteSyncedAt(): Promise<string | null> {
  const redis = getRedis();
  return (await redis.get(K.liteSyncAt)) as string | null;
}

// ── Full record (for drill-down) ────────────────────────────────────────────
// Reads the full record from its deterministic shard. Returns null if either
// the shard hasn't been populated yet or the id isn't in it.
export async function readFull(id: number): Promise<ProductFull | null> {
  const redis = getRedis();
  const raw = (await redis.get(K.fullShard(shardForId(id)))) as string | null;
  if (!raw) return null;
  try {
    const shard = JSON.parse(raw) as ProductFull[];
    return shard.find((p) => p.id === id) ?? null;
  } catch { return null; }
}

// Single-record write — used as a lazy fallback by /api/products/[id] on cache
// miss. Reads the shard, merges in the record (replacing any existing entry by
// id), writes back. Best-effort — failures only affect cache hit rate.
export async function writeFull(p: ProductFull): Promise<void> {
  const redis = getRedis();
  const shardKey = K.fullShard(shardForId(p.id));
  const raw = (await redis.get(shardKey)) as string | null;
  let shard: ProductFull[] = [];
  if (raw) { try { shard = JSON.parse(raw) as ProductFull[]; } catch { /* corrupt — overwrite */ } }
  const idx = shard.findIndex((x) => x.id === p.id);
  if (idx >= 0) shard[idx] = p; else shard.push(p);
  await redis.set(shardKey, JSON.stringify(shard), { ex: FULL_TTL_SEC });
}

// Bulk shard write — call at the end of a full sync. Spreads writes across
// FULL_SHARD_COUNT shards via deterministic hashing; runs with capped parallelism
// to stay within Upstash REST rate limits.
export async function writeAllFull(fulls: ProductFull[]): Promise<{ shards: number; bytes: number }> {
  const redis = getRedis();
  const buckets: ProductFull[][] = Array.from({ length: FULL_SHARD_COUNT }, () => []);
  for (const f of fulls) buckets[shardForId(f.id)].push(f);

  const PARALLEL = 20;
  let totalBytes = 0;
  for (let i = 0; i < FULL_SHARD_COUNT; i += PARALLEL) {
    const slice = buckets.slice(i, i + PARALLEL);
    await Promise.all(
      slice.map((b, j) => {
        const body = JSON.stringify(b);
        totalBytes += body.length;
        return redis.set(K.fullShard(i + j), body, { ex: FULL_TTL_SEC });
      }),
    );
  }
  return { shards: FULL_SHARD_COUNT, bytes: totalBytes };
}

// ── Filters cache ───────────────────────────────────────────────────────────
export async function readFiltersCache(): Promise<{ filters: ApiFilters; syncedAt: string } | null> {
  const redis = getRedis();
  const [raw, at] = await Promise.all([
    redis.get(K.filters) as Promise<string | null>,
    redis.get(K.filtersAt) as Promise<string | null>,
  ]);
  if (!raw) return null;
  try { return { filters: JSON.parse(raw) as ApiFilters, syncedAt: at || "" }; } catch { return null; }
}

export async function writeFiltersCache(filters: ApiFilters): Promise<string> {
  const redis = getRedis();
  const syncedAt = new Date().toISOString();
  await Promise.all([
    redis.set(K.filters, JSON.stringify(filters)),
    redis.set(K.filtersAt, syncedAt),
  ]);
  return syncedAt;
}

// ── Sync state ──────────────────────────────────────────────────────────────
export async function readSyncState(): Promise<SyncState> {
  const redis = getRedis();
  const raw = (await redis.get(K.syncState)) as string | null;
  if (!raw) return { state: "idle", startedAt: null, finishedAt: null };
  try { return JSON.parse(raw) as SyncState; } catch {
    return { state: "idle", startedAt: null, finishedAt: null };
  }
}

export async function writeSyncState(s: SyncState): Promise<void> {
  const redis = getRedis();
  await redis.set(K.syncState, JSON.stringify(s));
}

// ── Required attributes config ──────────────────────────────────────────────
export type RequiredAttrsConfig = Record<string, number[]>; // categoryId → [attribute_id, ...]

export async function readRequiredAttrs(): Promise<RequiredAttrsConfig> {
  const redis = getRedis();
  const raw = (await redis.get(K.requiredAttrs)) as string | null;
  if (!raw) return {};
  try { return JSON.parse(raw) as RequiredAttrsConfig; } catch { return {}; }
}

export async function writeRequiredAttrs(cfg: RequiredAttrsConfig): Promise<void> {
  const redis = getRedis();
  await redis.set(K.requiredAttrs, JSON.stringify(cfg));
}

// ── Per-day snapshots ────────────────────────────────────────────────────────
// Snapshot = a frozen copy of the lite snapshot for a given calendar day.
// Used by the dashboard's "state as of day X" picker. Trimmed to the last
// SNAPSHOT_KEEP_DAYS dates to bound Redis storage.

export async function writeDailySnapshot(date: string, products: ProductLite[], syncedAt: string): Promise<void> {
  const redis = getRedis();

  // Wipe any older shards for this date (a re-sync on the same day may have fewer shards)
  const oldCountRaw = (await redis.get(K.snapCount(date))) as string | null;
  const oldCount = parseInt(oldCountRaw || "0", 10);

  const shardCount = Math.max(1, Math.ceil(products.length / SHARD_SIZE));
  const writes: Promise<unknown>[] = [];
  for (let i = 0; i < shardCount; i++) {
    const chunk = products.slice(i * SHARD_SIZE, (i + 1) * SHARD_SIZE);
    writes.push(redis.set(K.snapShard(date, i), JSON.stringify(chunk)));
  }
  for (let i = shardCount; i < oldCount; i++) {
    writes.push(redis.del(K.snapShard(date, i)));
  }
  writes.push(redis.set(K.snapCount(date), String(shardCount)));
  writes.push(redis.set(K.snapSyncAt(date), syncedAt));
  writes.push(redis.zadd(K.snapDates, { score: Date.now(), member: date }));
  await Promise.all(writes);

  // Trim: keep only SNAPSHOT_KEEP_DAYS most recent dates
  const allDates = (await redis.zrange(K.snapDates, 0, -1)) as string[];
  if (allDates.length > SNAPSHOT_KEEP_DAYS) {
    // zrange returns oldest-first; we want to drop the oldest excess
    const toDrop = allDates.slice(0, allDates.length - SNAPSHOT_KEEP_DAYS);
    const ops: Promise<unknown>[] = [];
    for (const d of toDrop) {
      const cnt = parseInt(((await redis.get(K.snapCount(d))) as string | null) || "0", 10);
      for (let i = 0; i < cnt; i++) ops.push(redis.del(K.snapShard(d, i)));
      ops.push(redis.del(K.snapCount(d)));
      ops.push(redis.del(K.snapSyncAt(d)));
      ops.push(redis.zrem(K.snapDates, d));
    }
    await Promise.all(ops);
  }
}

export async function readDailySnapshot(date: string): Promise<{ products: ProductLite[]; syncedAt: string | null } | null> {
  const redis = getRedis();
  const [countRaw, syncedAt] = await Promise.all([
    redis.get(K.snapCount(date)) as Promise<string | null>,
    redis.get(K.snapSyncAt(date)) as Promise<string | null>,
  ]);
  const count = parseInt(countRaw || "0", 10);
  if (!count) return null;
  const pipe = redis.pipeline();
  for (let i = 0; i < count; i++) pipe.get(K.snapShard(date, i));
  const raws = (await pipe.exec()) as (string | null)[];
  const out: ProductLite[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    try {
      const shard = JSON.parse(raw) as ProductLite[];
      for (const p of shard) {
        if (p.name && p.name.trim() && p.code) out.push(p);
      }
    } catch { /* skip */ }
  }
  return { products: out, syncedAt };
}

export async function listSnapshotDates(): Promise<{ date: string; syncedAt: string | null }[]> {
  const redis = getRedis();
  const dates = ((await redis.zrange(K.snapDates, 0, -1, { rev: true })) as string[]) || [];
  if (!dates.length) return [];
  const pipe = redis.pipeline();
  for (const d of dates) pipe.get(K.snapSyncAt(d));
  const ats = (await pipe.exec()) as (string | null)[];
  return dates.map((d, i) => ({ date: d, syncedAt: ats[i] }));
}

// ── Change-log I/O ──────────────────────────────────────────────────────────
// Per-product event log. Newest events stored first; capped at
// CHANGES_MAX_PER_PRODUCT entries; TTL refreshed on each write.
export async function readChanges(id: number): Promise<ChangeEvent[]> {
  const redis = getRedis();
  const raw = (await redis.get(K.changes(id))) as string | null;
  if (!raw) return [];
  try { return JSON.parse(raw) as ChangeEvent[]; } catch { return []; }
}

// Bulk write the per-product changes accumulated during a sync. Reads each
// existing log, prepends the new events, caps to CHANGES_MAX_PER_PRODUCT,
// writes back with TTL. Runs in capped parallel batches to respect Upstash limits.
export async function appendChangesBulk(updates: Map<number, ChangeEvent[]>): Promise<void> {
  if (updates.size === 0) return;
  const redis = getRedis();
  const entries = [...updates.entries()];
  const PARALLEL = 20;
  for (let i = 0; i < entries.length; i += PARALLEL) {
    const slice = entries.slice(i, i + PARALLEL);
    await Promise.all(
      slice.map(async ([id, events]) => {
        if (events.length === 0) return;
        const existing = await readChanges(id);
        const merged = [...events, ...existing].slice(0, CHANGES_MAX_PER_PRODUCT);
        await redis.set(K.changes(id), JSON.stringify(merged), { ex: CHANGES_TTL_SEC });
      }),
    );
  }
}

// Builds a compact { id → ProductComparable } map from all full shards.
// Used at the start of a sync to capture the "previous state" we diff against
// without holding the full ~150MB ProductFull set in memory.
export async function readAllComparable(): Promise<Map<number, ProductComparable>> {
  const redis = getRedis();
  const pipe = redis.pipeline();
  for (let i = 0; i < FULL_SHARD_COUNT; i++) pipe.get(K.fullShard(i));
  const raws = (await pipe.exec()) as (string | null)[];
  const out = new Map<number, ProductComparable>();
  for (const raw of raws) {
    if (!raw) continue;
    try {
      const shard = JSON.parse(raw) as ProductFull[];
      for (const p of shard) {
        out.set(p.id, {
          id: p.id,
          price: p.price,
          priceBase: p.priceBase,
          discountPct: p.discountPct,
          statusId: p.statusId,
          statusName: p.statusName,
          stockQty: p.stockQty,
          sku: p.sku,
          attributes: p.attributes.map((a) => ({ id: a.id, name: a.name, values: [...a.values] })),
          imageUrls: p.images.map((i) => i.url),
        });
      }
    } catch { /* skip corrupt shard */ }
  }
  return out;
}

// ── Cleanup of legacy "cards:*" keys (old Google Sheets pipeline) ───────────
export async function purgeLegacyCardsKeys(): Promise<number> {
  const redis = getRedis();
  const dates = ((await redis.zrange("cards:snap:dates", 0, -1)) as string[]) || [];
  if (!dates.length) return 0;
  const ops: Promise<unknown>[] = [];
  for (const d of dates) {
    ops.push(redis.del(`cards:snap:${d}`));
    ops.push(redis.del(`cards:sig:${d}`));
  }
  ops.push(redis.del("cards:snap:dates"));
  await Promise.all(ops);
  return dates.length;
}
