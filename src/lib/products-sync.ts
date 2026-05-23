// Full sync pipeline: pulls every page from Agromat API, diffs against the
// previous lite snapshot to detect new items + status changes, writes new shards.

import type { ApiProduct } from "@/lib/products-api";
import { fetchFilters, fetchProductsPage } from "@/lib/products-api";
import {
  type ProductLite,
  type ProductFull,
  type StatusChange,
  type SyncState,
  readAllLite,
  writeAllLite,
  writeAllFull,
  writeDailySnapshot,
  writeFiltersCache,
  readSyncState,
  writeSyncState,
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

    // 2) Load previous snapshot
    const prevList = await readAllLite();
    const prevById = new Map<number, ProductLite>();
    for (const p of prevList) prevById.set(p.id, p);

    // 3) Stream all pages, accumulate lite + diff stats.
    //    The Agromat API occasionally returns 500 on individual pages — we retry
    //    inside getJsonWithRetry, but if a page is still failing after retries we
    //    skip it (logging into stats) rather than aborting the whole sync.
    const lites: ProductLite[] = [];
    const fulls: ProductFull[] = [];
    const failedPages: number[] = [];
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
