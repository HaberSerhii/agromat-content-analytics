// Full sync pipeline: pulls every page from Agromat API, diffs against the
// previous lite snapshot to detect new items + status changes, writes new shards.

import type { ApiProduct } from "@/lib/products-api";
import { fetchFilters, fetchProductsPage } from "@/lib/products-api";
import {
  type ProductLite,
  type ProductFull,
  type ProductComparable,
  type StatusChange,
  type SyncState,
  type ChangeEvent,
  readAllLite,
  writeAllLite,
  writeAllFull,
  writeDailySnapshot,
  writeFiltersCache,
  readSyncState,
  writeSyncState,
  readAllComparable,
  appendChangesBulk,
} from "@/lib/products-store";

const MAX_STATUS_HISTORY = 20;

function avgRating(reviews: ApiProduct["reviews"]): number | null {
  if (!reviews?.length) return null;
  const sum = reviews.reduce((s, r) => s + (r.rating || 0), 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

function toLite(
  api: ApiProduct,
  prev: ProductLite | undefined,
  syncedAt: string,
  brandIdByName: Map<string, number>,
): { lite: ProductLite; full: ProductFull; changed: boolean; isNew: boolean } {
  const newStatusId = api.stock?.status?.id ?? 0;
  const prevStatusId = prev?.statusId;
  const statusChanged = prev != null && prevStatusId !== newStatusId;
  const history: StatusChange[] = prev?.statusHistory ? [...prev.statusHistory] : [];
  if (statusChanged) {
    history.unshift({ at: syncedAt, from: prevStatusId!, to: newStatusId });
    if (history.length > MAX_STATUS_HISTORY) history.length = MAX_STATUS_HISTORY;
  }

  const lite: ProductLite = {
    id: api.id,
    goodsRef: api.goods_ref,
    code: api.code,
    sku: api.sku,
    name: api.name,
    brand: api.brand || "",
    brandId: brandIdByName.get((api.brand || "").toLowerCase()) ?? null,
    categoryId: api.category?.id ?? 0,
    categoryName: api.category?.name ?? "",
    categoryPath: api.category?.path ?? "",
    url: api.url,
    price: api.prices?.actual ?? null,
    priceBase: api.prices?.base ?? null,
    discountPct: api.discount_pct ?? null,
    currency: api.prices?.currency ?? "UAH",
    statusId: newStatusId,
    statusName: api.stock?.status?.name ?? "",
    stockQty: api.stock?.quantity ?? null,
    imagesCount: api.images?.length ?? 0,
    reviewsCount: api.reviews?.length ?? 0,
    attributesCount: api.attributes?.length ?? 0,
    ratingAvg: avgRating(api.reviews),
    deleted: !!api.deleted,
    createdAt: api.created_at,
    updatedAt: api.updated_at,
    firstSeenAt: prev?.firstSeenAt ?? syncedAt,
    statusChangedAt: statusChanged ? syncedAt : (prev?.statusChangedAt ?? null),
    statusHistory: history,
  };

  const full: ProductFull = {
    ...lite,
    // API gives the URL without extension + `ext` as a separate field; bare URL returns 403.
    images: (api.images || []).map((i) => ({
      url: i.ext ? `${i.url}.${i.ext}` : i.url,
      main: i.main,
      sort: i.sort,
    })),
    attributes: (api.attributes || []).map((a) => ({
      id: a.attribute_id,
      name: a.attribute_name,
      values: (a.values || []).map((v) => v.name),
    })),
    reviews: (api.reviews || []).map((r) => ({
      rating: r.rating,
      text: r.text,
      author: r.author,
      advantage: r.advantage,
      disadvantage: r.disadvantage,
      date: r.date,
      likes: r.likes,
      dislikes: r.dislikes,
    })),
  };

  return { lite, full, changed: statusChanged, isNew: prev == null };
}

// Diff two states of one product → list of ChangeEvents. Returns [] when
// nothing tracked has changed. Called per-product after each sync's full
// record is built; output is collected and flushed via appendChangesBulk.
function diffProduct(prev: ProductComparable, next: ProductFull, at: string): ChangeEvent[] {
  const events: ChangeEvent[] = [];

  if (prev.price !== next.price)
    events.push({ at, field: "price", from: prev.price, to: next.price });
  if (prev.priceBase !== next.priceBase)
    events.push({ at, field: "priceBase", from: prev.priceBase, to: next.priceBase });
  if (prev.discountPct !== next.discountPct)
    events.push({ at, field: "discountPct", from: prev.discountPct, to: next.discountPct });
  if (prev.statusId !== next.statusId)
    events.push({
      at, field: "status",
      from: { id: prev.statusId, name: prev.statusName },
      to:   { id: next.statusId, name: next.statusName },
    });
  if (prev.stockQty !== next.stockQty)
    events.push({ at, field: "stock", from: prev.stockQty, to: next.stockQty });
  if ((prev.sku ?? null) !== (next.sku ?? null))
    events.push({ at, field: "sku", from: prev.sku, to: next.sku });

  // Attributes — index by attribute_id, detect added/removed/changed values.
  const prevAttrs = new Map(prev.attributes.map((a) => [a.id, a]));
  const nextAttrs = new Map(next.attributes.map((a) => [a.id, a]));
  const added:   { id: number; name: string; values: string[] }[] = [];
  const removed: { id: number; name: string; values: string[] }[] = [];
  const changed: { id: number; name: string; from: string[]; to: string[] }[] = [];
  for (const [id, n] of nextAttrs) {
    const p = prevAttrs.get(id);
    if (!p) { added.push({ id, name: n.name, values: [...n.values] }); continue; }
    // Order-insensitive value compare
    const pv = [...p.values].sort().join("|");
    const nv = [...n.values].sort().join("|");
    if (pv !== nv) changed.push({ id, name: n.name, from: p.values, to: n.values });
  }
  for (const [id, p] of prevAttrs) {
    if (!nextAttrs.has(id)) removed.push({ id, name: p.name, values: [...p.values] });
  }
  if (added.length || removed.length || changed.length)
    events.push({ at, field: "attributes", added, removed, changed });

  // Images — compare by URL set; record count delta + added/removed URLs.
  const prevUrls = new Set(prev.imageUrls);
  const nextUrls = new Set(next.images.map((i) => i.url));
  const addedUrls:   string[] = [];
  const removedUrls: string[] = [];
  for (const u of nextUrls) if (!prevUrls.has(u)) addedUrls.push(u);
  for (const u of prevUrls) if (!nextUrls.has(u)) removedUrls.push(u);
  if (addedUrls.length || removedUrls.length)
    events.push({
      at, field: "images",
      fromCount: prev.imageUrls.length, toCount: next.images.length,
      addedUrls, removedUrls,
    });

  return events;
}

export async function runSync(): Promise<SyncState> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  await writeSyncState({ state: "running", startedAt, finishedAt: null });

  try {
    // 1) Refresh /filters cache + build brand name → id map
    const filters = await fetchFilters();
    await writeFiltersCache(filters);
    const brandIdByName = new Map<string, number>();
    for (const b of filters.brands) brandIdByName.set(b.name.toLowerCase(), b.id);

    // 2) Load previous snapshot (lite for table diff + comparable for full diff).
    //    The comparable map is built once from full shards — see ProductComparable
    //    for the trimmed shape. If this is the first sync ever, prevComparable
    //    will be empty and no change events will be recorded (we don't want
    //    spurious "added" events for every attribute/image on initial seed).
    const [prevList, prevComparable] = await Promise.all([
      readAllLite(),
      readAllComparable(),
    ]);
    const prevById = new Map<number, ProductLite>();
    for (const p of prevList) prevById.set(p.id, p);
    const isFirstSync = prevComparable.size === 0;

    // 3) Stream all pages, accumulate lite + diff stats.
    //    The Agromat API occasionally returns 500 on individual pages — we retry
    //    inside getJsonWithRetry, but if a page is still failing after retries we
    //    skip it (logging into stats) rather than aborting the whole sync.
    const lites: ProductLite[] = [];
    const fulls: ProductFull[] = [];
    const failedPages: number[] = [];
    const changesByProduct = new Map<number, ChangeEvent[]>();
    let pages = 0;
    let newCount = 0;
    let statusChanges = 0;

    // API occasionally returns "ghost" records with valid id/created_at but
    // empty name/code/brand — leftovers from products fully removed from the
    // catalog. Skip them; they carry no useful data.
    function isValid(api: ApiProduct): boolean {
      return !!(api.name && api.name.trim() && api.code);
    }

    let ghosts = 0;
    function processBatch(batch: ApiProduct[]) {
      for (const api of batch) {
        if (!isValid(api)) { ghosts++; continue; }
        const { lite, full, changed, isNew } = toLite(api, prevById.get(api.id), startedAt, brandIdByName);
        lites.push(lite);
        fulls.push(full);
        if (isNew) newCount++;
        if (changed) statusChanges++;

        // Diff against previous full record (if any). Skip on first-ever sync
        // and for products newly introduced — neither has a meaningful "from".
        if (!isFirstSync) {
          const prev = prevComparable.get(api.id);
          if (prev) {
            const events = diffProduct(prev, full, startedAt);
            if (events.length) changesByProduct.set(api.id, events);
          }
        }
      }
    }
    // Expose ghost count via console — surfaces them in sync logs without
    // polluting the SyncState contract.
    void ghosts;

    const first = await fetchProductsPage(1, 200);
    pages++;
    processBatch(first.data);
    const totalPages = first.meta.total_pages;

    // Initial progress snapshot — gives UI a target right away
    await writeSyncState({
      state: "running",
      startedAt,
      finishedAt: null,
      progress: { pages, totalPages, products: lites.length },
    });

    // Throttle Redis writes — once every 5 pages is enough for a smooth bar
    const PROGRESS_EVERY = 5;
    for (let page = 2; page <= totalPages; page++) {
      try {
        const p = await fetchProductsPage(page, 200);
        pages++;
        processBatch(p.data);
      } catch (e) {
        failedPages.push(page);
        console.warn(`[products-sync] page ${page} failed after retries:`, e instanceof Error ? e.message : e);
      }
      if (page === totalPages || page % PROGRESS_EVERY === 0) {
        await writeSyncState({
          state: "running",
          startedAt,
          finishedAt: null,
          progress: { pages, totalPages, products: lites.length },
        });
      }
    }

    // 4) Persist new snapshot — lite first (required for the table), then full
    //    shards (drill-down cache). If the full write fails partway, drill-down
    //    falls back to live API; the table still works.
    await writeAllLite(lites, startedAt);
    try {
      await writeAllFull(fulls);
    } catch (e) {
      console.warn("[products-sync] writeAllFull failed (drill-downs will fetch live):", e instanceof Error ? e.message : e);
    }

    // Per-day snapshot for the "view state on day X" picker. Best-effort.
    try {
      const today = startedAt.slice(0, 10); // YYYY-MM-DD from ISO
      await writeDailySnapshot(today, lites, startedAt);
    } catch (e) {
      console.warn("[products-sync] writeDailySnapshot failed:", e instanceof Error ? e.message : e);
    }

    // Per-product change log — powers the "Історія змін" modal. Best-effort:
    // failure here doesn't affect the catalog itself, only the history view.
    try {
      await appendChangesBulk(changesByProduct);
    } catch (e) {
      console.warn("[products-sync] appendChangesBulk failed:", e instanceof Error ? e.message : e);
    }

    const finishedAt = new Date().toISOString();
    const state: SyncState = {
      state: failedPages.length === totalPages - 1 ? "error" : "ok",
      startedAt,
      finishedAt,
      error: failedPages.length > 0
        ? `Skipped ${failedPages.length}/${totalPages} pages: ${failedPages.slice(0, 10).join(",")}${failedPages.length > 10 ? "…" : ""}`
        : undefined,
      stats: {
        total: lites.length,
        newCount,
        statusChanges,
        pages,
        durationMs: Date.now() - t0,
      },
    };
    await writeSyncState(state);
    return state;
  } catch (e) {
    const finishedAt = new Date().toISOString();
    const errMsg = e instanceof Error ? e.message : String(e);
    const state: SyncState = {
      state: "error",
      startedAt,
      finishedAt,
      error: errMsg,
    };
    await writeSyncState(state);
    return state;
  }
}

// Lightweight "is a sync currently running" guard — best-effort, not a true lock.
export async function isSyncRunning(): Promise<boolean> {
  const s = await readSyncState();
  if (s.state !== "running" || !s.startedAt) return false;
  // Stale lock (older than 15 min) — treat as not running
  const ageMs = Date.now() - Date.parse(s.startedAt);
  return ageMs < 15 * 60 * 1000;
}
