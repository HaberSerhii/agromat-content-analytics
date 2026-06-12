import { NextResponse } from "next/server";
import {
  readAllLite,
  readDailySnapshot,
  readLiteSyncedAt,
  readRequiredAttrs,
  readSyncState,
  type ProductLite,
} from "@/lib/products-store";

export const dynamic = "force-dynamic";

// UI-only pseudo-status id for archived (deleted) products. Must not collide
// with real API status ids (which are positive integers).
const ARCHIVE_STATUS_ID = -1;

type SortKey =
  | "firstSeenAt"
  | "statusChangedAt"
  | "updatedAt"
  | "name"
  | "category"
  | "brand"
  | "price"
  | "stockQty"
  | "imagesCount"
  | "reviewsCount"
  | "attributesCount";

function parseIntList(s: string | null): number[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function parseBool(s: string | null): boolean | null {
  if (s === "true") return true;
  if (s === "false") return false;
  return null;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

function matchSearch(p: ProductLite, q: string): boolean {
  const s = q.toLowerCase();
  return (
    p.name.toLowerCase().includes(s) ||
    String(p.code).includes(s) ||
    String(p.goodsRef).includes(s) ||
    String(p.id).includes(s) ||
    (p.sku ?? "").toLowerCase().includes(s)
  );
}

// Per-product: how many required attributes (for its category) are missing?
function missingRequiredAttrs(
  _p: ProductLite,
  _required: Record<string, number[]>,
): number {
  // ProductLite doesn't carry attribute IDs (kept in ProductFull). For lite-table
  // filtering we use attributesCount as a coarse signal; precise per-attr check
  // happens in the drill-down modal using ProductFull.
  return 0;
}

const KYIV_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});

function kyivOffsetAt(ms: number) {
  const parts = Object.fromEntries(KYIV_DATE_TIME.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  ) - Math.floor(ms / 1000) * 1000;
}

function parseKyivCalendarDate(value: string | null, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const nextDay = Date.UTC(year, month - 1, day + (endOfDay ? 1 : 0));
  const firstPass = nextDay - kyivOffsetAt(nextDay);
  const start = nextDay - kyivOffsetAt(firstPass);
  return endOfDay ? start - 1 : start;
}

function kyivCalendarDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(KYIV_DATE_TIME.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function GET(request: Request) {
  const { searchParams: q } = new URL(request.url);

  const page = Math.max(1, parseInt(q.get("page") || "1", 10));
  // Cap at 50_000 — covers the whole catalog (~31K) in one shot for exports
  // while still bounding response size for malicious requests.
  const limit = Math.min(50000, Math.max(1, parseInt(q.get("limit") || "100", 10)));

  const search = (q.get("search") || "").trim();
  const categoryIds = new Set(parseIntList(q.get("category_ids")));
  const brandIds = new Set(parseIntList(q.get("brand_ids")));
  // `-1` is a UI-only pseudo-status that maps to deleted/archived products.
  const statusIdsRaw = parseIntList(q.get("status_ids"));
  const includeArchived = statusIdsRaw.includes(ARCHIVE_STATUS_ID);
  const statusIds = new Set(statusIdsRaw.filter((id) => id !== ARCHIVE_STATUS_ID));
  const hasImages = parseBool(q.get("has_images"));
  const hasAttributes = parseBool(q.get("has_attributes"));
  const hasReviews = parseBool(q.get("has_reviews"));
  const hasSku = parseBool(q.get("has_sku"));
  const deletedOnly = parseBool(q.get("deleted"));
  const onlyNewDays = parseInt(q.get("only_new_days") || "0", 10);
  const onlyStatusChangedDays = parseInt(q.get("only_status_changed_days") || "0", 10);
  const onlyNewSinceSync = q.get("only_new_since_sync") === "true";
  const minPrice = q.get("min_price") ? parseFloat(q.get("min_price")!) : null;
  const maxPrice = q.get("max_price") ? parseFloat(q.get("max_price")!) : null;
  const minStock = q.get("min_stock") ? parseInt(q.get("min_stock")!, 10) : null;
  const maxStock = q.get("max_stock") ? parseInt(q.get("max_stock")!, 10) : null;
  // Photo-count threshold: keep only products with imagesCount < maxImages.
  // Lets the catalog flag "products needing more photos" (e.g. < 2).
  const maxImages = q.get("max_images") ? parseInt(q.get("max_images")!, 10) : null;
  // Attribute-count threshold: keep only products with attributesCount < maxAttributes.
  const maxAttributes = q.get("max_attributes") ? parseInt(q.get("max_attributes")!, 10) : null;
  const statsFrom = q.get("stats_from");
  const statsTo = q.get("stats_to") || statsFrom;
  const statsFromMs = parseKyivCalendarDate(statsFrom);
  const statsToMs = parseKyivCalendarDate(statsTo, true);

  // Bulk-id filter: user pastes a list of identifiers (whitespace/comma separated)
  // → we filter to that exact set and report which inputs we couldn't find.
  // `ids_in` matches each value against BOTH `code` and `goods_ref` (parser-style,
  // no field toggle). `codes_in`/`refs_in` kept for backward compat with any
  // bookmarked URLs / older saved sets that still target a single field.
  const idsIn = parseIntList(q.get("ids_in"));
  const idsInSet = new Set(idsIn);
  const codesIn = parseIntList(q.get("codes_in"));
  const refsIn = parseIntList(q.get("refs_in"));
  const codesInSet = new Set(codesIn);
  const refsInSet = new Set(refsIn);

  const sortBy = (q.get("sort_by") as SortKey) || "firstSeenAt";
  const sortDir = q.get("sort_dir") === "asc" ? 1 : -1;

  // `as_of=YYYY-MM-DD` switches the data source from the live snapshot to a
  // frozen per-day snapshot. Sync state + filters are still global (live).
  const asOf = q.get("as_of");
  const asOfValid = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf);

  const [liveAll, liveSyncedAt, syncState, required, snap] = await Promise.all([
    asOfValid ? Promise.resolve([] as ProductLite[]) : readAllLite(),
    readLiteSyncedAt(),
    readSyncState(),
    readRequiredAttrs(),
    asOfValid ? readDailySnapshot(asOf!) : Promise.resolve(null),
  ]);

  const all: ProductLite[] = asOfValid ? (snap?.products ?? []) : liveAll;
  const syncedAt = asOfValid ? (snap?.syncedAt ?? null) : liveSyncedAt;

  const newCutoff = onlyNewDays > 0 ? daysAgoIso(onlyNewDays) : "";
  const stChCutoff = onlyStatusChangedDays > 0 ? daysAgoIso(onlyStatusChangedDays) : "";
  const newSinceSyncDay = onlyNewSinceSync ? kyivCalendarDate(syncedAt) : null;
  const newSinceSyncFromMs = parseKyivCalendarDate(newSinceSyncDay);
  const newSinceSyncToMs = parseKyivCalendarDate(newSinceSyncDay, true);

  // Predicate factory — `skip` lets us bypass a specific filter so each facet
  // dropdown can be populated with options that respect *other* active filters
  // (the classic "self-exclude" facet pattern).
  type Skip = "category" | "brand" | "price" | "stock" | null;
  const predicate = (skip: Skip) => (p: ProductLite): boolean => {
    if (search && !matchSearch(p, search)) return false;
    if (skip !== "category" && categoryIds.size && !categoryIds.has(p.categoryId)) return false;
    if (skip !== "brand" && brandIds.size && (p.brandId == null || !brandIds.has(p.brandId))) return false;
    if (statusIds.size || includeArchived) {
      const matchesReal = statusIds.size > 0 && !p.deleted && statusIds.has(p.statusId);
      const matchesArchive = includeArchived && p.deleted;
      if (!matchesReal && !matchesArchive) return false;
    }
    if (hasImages === true && p.imagesCount === 0) return false;
    if (hasImages === false && p.imagesCount > 0) return false;
    if (maxImages != null && p.imagesCount >= maxImages) return false;
    if (hasAttributes === true && p.attributesCount === 0) return false;
    if (hasAttributes === false && p.attributesCount > 0) return false;
    if (maxAttributes != null && p.attributesCount >= maxAttributes) return false;
    if (hasReviews === true && p.reviewsCount === 0) return false;
    if (hasReviews === false && p.reviewsCount > 0) return false;
    if (hasSku === true && (!p.sku || !p.sku.trim())) return false;
    if (hasSku === false && p.sku && p.sku.trim()) return false;
    if (deletedOnly === true && !p.deleted) return false;
    if (deletedOnly === false && p.deleted) return false;
    if (newCutoff && p.firstSeenAt < newCutoff) return false;
    if (newSinceSyncFromMs != null && newSinceSyncToMs != null) {
      const firstSeenMs = Date.parse(p.firstSeenAt);
      if (!Number.isFinite(firstSeenMs) || firstSeenMs < newSinceSyncFromMs || firstSeenMs > newSinceSyncToMs) return false;
    }
    if (stChCutoff && (!p.statusChangedAt || p.statusChangedAt < stChCutoff)) return false;
    if (skip !== "price") {
      if (minPrice != null && (p.price ?? 0) < minPrice) return false;
      if (maxPrice != null && (p.price ?? 0) > maxPrice) return false;
    }
    if (skip !== "stock") {
      if (minStock != null && (p.stockQty ?? 0) < minStock) return false;
      if (maxStock != null && (p.stockQty ?? 0) > maxStock) return false;
    }
    if (idsInSet.size && !(idsInSet.has(p.code) || idsInSet.has(p.goodsRef))) return false;
    if (codesInSet.size && !codesInSet.has(p.code)) return false;
    if (refsInSet.size && !refsInSet.has(p.goodsRef)) return false;
    return true;
  };

  const filtered = all.filter(predicate(null));

  // ── Facets: category + brand options derived from the filtered set.
  //    Each facet ignores its own filter — so picking a category still leaves
  //    every category visible in the dropdown (counts shift instead).
  const catCounts = new Map<number, { name: string; count: number }>();
  for (const p of all) {
    if (!predicate("category")(p)) continue;
    if (!p.categoryId) continue;
    const e = catCounts.get(p.categoryId) ?? { name: p.categoryName, count: 0 };
    e.count++;
    catCounts.set(p.categoryId, e);
  }
  const availableCategories = [...catCounts.entries()]
    .map(([id, v]) => ({ id, name: v.name, count: v.count }))
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));

  const brandCounts = new Map<number, { name: string; count: number }>();
  for (const p of all) {
    if (!predicate("brand")(p)) continue;
    if (p.brandId == null) continue;
    const e = brandCounts.get(p.brandId) ?? { name: p.brand, count: 0 };
    e.count++;
    brandCounts.set(p.brandId, e);
  }
  const availableBrands = [...brandCounts.entries()]
    .map(([id, v]) => ({ id, name: v.name, count: v.count }))
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));

  // Price bounds: max across the *price-unfiltered* set (so the slider's range
  // doesn't collapse when the user narrows it). Min is just 0.
  let priceMax = 0;
  for (const p of all) {
    if (!predicate("price")(p)) continue;
    if ((p.price ?? 0) > priceMax) priceMax = p.price ?? 0;
  }
  // Stock bounds — same self-exclude pattern as price.
  let stockMax = 0;
  for (const p of all) {
    if (!predicate("stock")(p)) continue;
    if ((p.stockQty ?? 0) > stockMax) stockMax = p.stockQty ?? 0;
  }

  // Bulk-id report: which of the inputs were not present in the catalog at all
  // (used by the "Набір товарів" UI to highlight missing items).
  let notFoundIds: number[] = [];
  let notFoundCodes: number[] = [];
  let notFoundRefs: number[] = [];
  if (idsInSet.size) {
    // An input is "found" if it matches a product's code OR its goods_ref.
    const present = new Set<number>();
    for (const p of all) {
      if (idsInSet.has(p.code)) present.add(p.code);
      if (idsInSet.has(p.goodsRef)) present.add(p.goodsRef);
    }
    notFoundIds = idsIn.filter((id) => !present.has(id));
  }
  if (codesInSet.size) {
    const presentCodes = new Set<number>();
    for (const p of all) if (codesInSet.has(p.code)) presentCodes.add(p.code);
    notFoundCodes = codesIn.filter((c) => !presentCodes.has(c));
  }
  if (refsInSet.size) {
    const presentRefs = new Set<number>();
    for (const p of all) if (refsInSet.has(p.goodsRef)) presentRefs.add(p.goodsRef);
    notFoundRefs = refsIn.filter((r) => !presentRefs.has(r));
  }

  filtered.sort((a, b) => {
    let av: string | number = "", bv: string | number = "";
    switch (sortBy) {
      case "firstSeenAt":      av = a.firstSeenAt; bv = b.firstSeenAt; break;
      case "statusChangedAt":  av = a.statusChangedAt || ""; bv = b.statusChangedAt || ""; break;
      case "updatedAt":        av = a.updatedAt; bv = b.updatedAt; break;
      case "name":             av = a.name; bv = b.name; break;
      case "category":         av = a.categoryName; bv = b.categoryName; break;
      case "brand":            av = a.brand; bv = b.brand; break;
      case "price":            av = a.price ?? -1; bv = b.price ?? -1; break;
      case "stockQty":         av = a.stockQty ?? -1; bv = b.stockQty ?? -1; break;
      case "imagesCount":      av = a.imagesCount; bv = b.imagesCount; break;
      case "reviewsCount":     av = a.reviewsCount; bv = b.reviewsCount; break;
      case "attributesCount":  av = a.attributesCount; bv = b.attributesCount; break;
    }
    if (av < bv) return -1 * sortDir;
    if (av > bv) return 1 * sortDir;
    return 0;
  });

  // ── Stats: derived from the *filtered* set so KPI cards react to filters.
  //    `totalAll` is the unfiltered catalog size — used as a constant reference.
  const total = filtered.length;
  const totalAll = all.length;
  const inStatsRange = (value: string | null | undefined) => {
    if (!value || statsFromMs == null || statsToMs == null) return false;
    const ms = Date.parse(value);
    return Number.isFinite(ms) && ms >= statsFromMs && ms <= statsToMs;
  };
  let newCountRange = 0, statusChangedRange = 0;
  let noImages = 0, noAttributes = 0, noReviews = 0, noSku = 0;
  for (const p of filtered) {
    if (inStatsRange(p.firstSeenAt)) newCountRange++;
    if (inStatsRange(p.statusChangedAt)) statusChangedRange++;
    if (p.imagesCount === 0) noImages++;
    if (p.attributesCount === 0) noAttributes++;
    if (p.reviewsCount === 0) noReviews++;
    if (!p.sku || !p.sku.trim()) noSku++;
  }

  // Avoid unused-var warning — kept for future precise-required-attr filter
  void missingRequiredAttrs;
  void required;

  // ── Pagination ─────────────────────────────────────────────────────────────
  const offset = (page - 1) * limit;
  const pageItems = filtered.slice(offset, offset + limit);

  return NextResponse.json({
    items: pageItems,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    availableCategories,
    availableBrands,
    priceMax,
    stockMax,
    notFoundIds,
    notFoundCodes,
    notFoundRefs,
    asOf: asOfValid ? asOf : null,
    syncedAt,
    syncState,
    stats: {
      totalAll,
      newCountRange,
      statusChangedRange,
      noImages,
      noAttributes,
      noReviews,
      noSku,
    },
  }, {
    // Short fresh window + SWR — tab-switches and small filter tweaks hit the
    // browser cache. Backend data only changes on sync, so 10s is conservative.
    headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=60" },
  });
}
