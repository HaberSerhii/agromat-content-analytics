import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  competitorBrandAppearsInText,
  evaluateCompetitorPrice,
  type CompetitorPriceReviewReason,
} from "@/lib/competitor-price-quality";
import { getServerResult, putServerResult } from "@/lib/server-result-cache";

export const dynamic = "force-dynamic";

// PostgREST returns at most 1000 rows per request by default; the catalog
// has ~3K active products and ~1850 snapshots/day, so we MUST page through
// every list query. Helpers below page until the response is short.

const PAGE = 1000;
// PostgREST .in() encodes its argument list into the URL; an unbounded
// product-id list can blow past the nginx URL-length limit. Split into
// modest chunks — for a few thousand products this is 4–7 round trips.
const ID_CHUNK = 500;
const IDENTIFIER_CHUNK = 250;
const CACHE_TZ = "Europe/Kyiv";
const CACHE_MAX_ENTRIES = 200;
const CACHE_TTL_MS = 5 * 60 * 1000;
const BASE_CACHE_TTL_MS = 20 * 60 * 1000;
const HIDDEN_COMPETITOR_ADAPTERS = new Set(["santechshara"]);

type CacheableBody = Record<string, unknown>;

interface CacheEntry {
  body: CacheableBody;
  expiresAt: number;
  storedAt: number;
}

declare global {
  var _parserPricesCache: Map<string, CacheEntry> | undefined;
  var _parserPricesInflight: Map<string, Promise<NextResponse>> | undefined;
}

interface Competitor {
  id: number;
  name: string;
  adapter_name: string;
}

interface SnapshotRow {
  product_id: number;
  competitor_id: number;
  price: number | null;
  status: string | null;
  found_url: string | null;
  confidence: string | null;
  found_brand: string | null;
  url_approved: boolean | null;
}

interface ProductRow {
  id: number;
  code: number | null;
  goods_ref: number | null;
  sku: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  actual_price: number | null;
  url: string | null;
  agromat_status: string | null;
}

interface CompetitorCell {
  price: number | null;
  observedPrice: number | null;
  status: string | null;
  url: string | null;
  confidence: string | null;
  foundBrand: string | null;
  reviewReason: CompetitorPriceReviewReason;
}

interface PricesRow {
  productId: number;
  code: number | null;
  goodsRef: number | null;
  sku: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  ourPrice: number | null;
  ourUrl: string | null;
  status: string | null;
  byCompetitor: Record<number, CompetitorCell>;
}

interface ParserPricesMetadata {
  competitors: Competitor[];
  lastUpdated: Record<number, string | null>;
  priceChanges: Record<number, number | null>;
  latestDate: string | null;
}

interface ParserPricesDataset {
  snapshots: SnapshotRow[];
  products: ProductRow[];
  productIds: number[];
  snapshotByProduct: Map<number, Map<number, SnapshotRow>>;
}

type ParserSegment = "all" | "sanitary" | "tile";
type IdentifierField = "any" | "code";

function parserPricesCache(): Map<string, CacheEntry> {
  if (!global._parserPricesCache) global._parserPricesCache = new Map();
  return global._parserPricesCache;
}

function parserPricesInflight(): Map<string, Promise<NextResponse>> {
  if (!global._parserPricesInflight) global._parserPricesInflight = new Map();
  return global._parserPricesInflight;
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(byType.get("year")),
    Number(byType.get("month")) - 1,
    Number(byType.get("day")),
    Number(byType.get("hour")),
    Number(byType.get("minute")),
    Number(byType.get("second")),
  );
  return asUtc - date.getTime();
}

function nextKyivMidnightMs(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CACHE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const localMidnightAsUtc = Date.UTC(
    Number(byType.get("year")),
    Number(byType.get("month")) - 1,
    Number(byType.get("day")) + 1,
    0,
    0,
    0,
  );
  return localMidnightAsUtc - timeZoneOffsetMs(new Date(localMidnightAsUtc), CACHE_TZ);
}

function canonicalQueryKey(q: URLSearchParams): string {
  const pairs = [...q.entries()].sort(([ak, av], [bk, bv]) => {
    const keyCmp = ak.localeCompare(bk);
    return keyCmp || av.localeCompare(bv);
  });
  return new URLSearchParams(pairs).toString();
}

function cacheHeaders(entry: CacheEntry, status: "HIT" | "MISS"): HeadersInit {
  const ttl = Math.max(0, Math.floor((entry.expiresAt - Date.now()) / 1000));
  return {
    "Cache-Control": `private, max-age=${ttl}`,
    "x-cache": status,
    "x-cache-expires-at": new Date(entry.expiresAt).toISOString(),
    "x-cache-stored-at": new Date(entry.storedAt).toISOString(),
  };
}

function pruneCache(cache: Map<string, CacheEntry>, now = Date.now()) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function parseIntOr(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseIntList(v: string | null): number[] {
  if (!v) return [];
  return v
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function parseParserSegment(v: string | null): ParserSegment {
  return v === "sanitary" || v === "tile" ? v : "all";
}

function parseIdentifierField(v: string | null): IdentifierField {
  return v === "code" ? "code" : "any";
}

function matchesParserSegment(category: string | null, segment: ParserSegment): boolean {
  if (segment === "all") return true;
  const s = (category || "").toLowerCase();
  if (segment === "tile") {
    return /плит|керамогран|моза|tile|gres/.test(s);
  }
  return /сантех|ванн|умив|раков|зміш|смес|душ|унітаз|унитаз|інсталяц|инсталляц/.test(s);
}

function matchesProductSearch(p: ProductRow, search: string): boolean {
  if (!search) return true;
  return (
    p.name.toLowerCase().includes(search) ||
    String(p.id).includes(search) ||
    String(p.code ?? "").includes(search) ||
    String(p.goods_ref ?? "").includes(search) ||
    (p.sku ?? "").toLowerCase().includes(search)
  );
}

function filterProductRows(products: ProductRow[], search: string, segment: ParserSegment): ProductRow[] {
  return products.filter((p) => matchesProductSearch(p, search) && matchesParserSegment(p.category, segment));
}

async function fetchAllSnapshotsForDate(
  db: SupabaseClient, snapshotDate: string, competitorIds: number[],
): Promise<SnapshotRow[]> {
  const latestByProductCompetitor = new Map<string, SnapshotRow>();
  let from = 0;
  // Rows written today win. Within the day, the newest row for a product and
  // competitor wins when a product was refreshed more than once.
  for (let i = 0; i < 50; i++) {
    const { data, error } = await db
      .from("price_snapshots")
      .select("product_id, competitor_id, price, status, found_url, confidence, found_brand, url_approved")
      .eq("snapshot_date", snapshotDate)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as SnapshotRow[];
    for (const row of rows) {
      const key = `${row.product_id}:${row.competitor_id}`;
      if (!latestByProductCompetitor.has(key)) latestByProductCompetitor.set(key, row);
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  // Partial/test refreshes must not make every untouched competitor price
  // disappear. Fill missing cells from each competitor's immediately previous
  // snapshot date instead of scanning its entire history.
  const competitorsWithCurrentRows = new Set(
    [...latestByProductCompetitor.values()].map((row) => row.competitor_id),
  );
  await Promise.all(competitorIds.map(async (competitorId) => {
    // A completed/current run is authoritative, including products it marks
    // unavailable or fails to verify. Never fill its missing items with stale
    // prices. The previous date is only a cross-competitor date fallback.
    if (competitorsWithCurrentRows.has(competitorId)) return;
    const { data: dateRows, error: dateError } = await db
      .from("price_snapshots")
      .select("snapshot_date")
      .eq("competitor_id", competitorId)
      .lt("snapshot_date", snapshotDate)
      .order("snapshot_date", { ascending: false })
      .limit(1);
    if (dateError) throw new Error(dateError.message);
    const previousDate = dateRows?.[0]?.snapshot_date as string | undefined;
    if (!previousDate) return;

    let previousFrom = 0;
    for (let i = 0; i < 50; i++) {
      const { data, error } = await db
        .from("price_snapshots")
        .select("product_id, competitor_id, price, status, found_url, confidence, found_brand, url_approved")
        .eq("competitor_id", competitorId)
        .eq("snapshot_date", previousDate)
        .not("price", "is", null)
        .order("created_at", { ascending: false })
        .range(previousFrom, previousFrom + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data || []) as SnapshotRow[];
      for (const row of rows) {
        const key = `${row.product_id}:${row.competitor_id}`;
        if (!latestByProductCompetitor.has(key)) latestByProductCompetitor.set(key, row);
      }
      if (rows.length < PAGE) break;
      previousFrom += PAGE;
    }
  }));
  return [...latestByProductCompetitor.values()];
}

async function fetchProductsByIds(
  db: SupabaseClient, ids: number[], search: string, segment: ParserSegment,
): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  const out: ProductRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const q = db
      .from("products")
      .select("id, code, goods_ref, sku, name, brand, category, actual_price, url, agromat_status")
      .eq("is_active", true)
      .in("id", chunk)
      // A single chunk can never overflow because chunk ≤ 500 ≤ PAGE; but
      // set range explicitly to be safe under future schema changes.
      .range(0, PAGE - 1);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...filterProductRows((data || []) as ProductRow[], search, segment));
  }
  return out;
}

async function fetchProductsByIdentifiers(
  db: SupabaseClient,
  ids: number[],
  search: string,
  segment: ParserSegment,
  identifierField: IdentifierField = "any",
): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  const byId = new Map<number, ProductRow>();
  const fields = identifierField === "code"
    ? (["code"] as const)
    : (["id", "code", "goods_ref"] as const);

  for (let i = 0; i < ids.length; i += IDENTIFIER_CHUNK) {
    const chunk = ids.slice(i, i + IDENTIFIER_CHUNK);
    await Promise.all(fields.map(async (field) => {
      const { data, error } = await db
        .from("products")
        .select("id, code, goods_ref, sku, name, brand, category, actual_price, url, agromat_status")
        .eq("is_active", true)
        .in(field, chunk)
        .range(0, PAGE - 1);
      if (error) throw new Error(error.message);
      for (const product of filterProductRows((data || []) as ProductRow[], search, segment)) {
        byId.set(product.id, product);
      }
    }));
  }

  return [...byId.values()];
}

// Latest price per product for one competitor on one snapshot_date. A day can
// hold several rows per product (e.g. a manual reparse on top of the auto run),
// so we order by created_at and let the newest win — same rule the table uses.
// Returns null on error so the caller can degrade gracefully.
async function fetchPricesForCompetitorDate(
  db: SupabaseClient, competitorId: number, date: string,
): Promise<Map<number, number | null> | null> {
  const map = new Map<number, number | null>();
  let from = 0;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await db
      .from("price_snapshots")
      .select("product_id, price")
      .eq("competitor_id", competitorId)
      .eq("snapshot_date", date)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return null;
    const rows = (data || []) as { product_id: number; price: number | null }[];
    for (const r of rows) map.set(r.product_id, r.price);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

// How many products' price changed between this competitor's latest run and its
// previous run — i.e. compare the latest snapshot_date against the prior distinct
// snapshot_date and count products whose (non-null) price differs. This is the
// "скільки цін змінилось" figure shown under each competitor. Best-effort: any
// failure yields null and the UI just omits the number.
async function countPriceChanges(
  db: SupabaseClient, competitorId: number, latestDate: string,
): Promise<number | null> {
  const { data: prevRows, error: pErr } = await db
    .from("price_snapshots")
    .select("snapshot_date")
    .eq("competitor_id", competitorId)
    .lt("snapshot_date", latestDate)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (pErr) return null;
  const prevDate = prevRows?.[0]?.snapshot_date as string | undefined;
  if (!prevDate) return 0; // first ever run for this competitor — nothing to diff

  const [latest, prev] = await Promise.all([
    fetchPricesForCompetitorDate(db, competitorId, latestDate),
    fetchPricesForCompetitorDate(db, competitorId, prevDate),
  ]);
  if (!latest || !prev) return null;

  let changed = 0;
  for (const [pid, price] of latest) {
    const before = prev.get(pid);
    if (before != null && price != null && Number(before) !== Number(price)) changed++;
  }
  return changed;
}

async function loadParserPricesMetadata(db: SupabaseClient): Promise<ParserPricesMetadata> {
  const { data: competitorsRaw, error: cErr } = await db
    .from("competitors")
    .select("id, name, adapter_name")
    .order("id", { ascending: true });
  if (cErr) throw new Error(cErr.message);

  const competitors = ((competitorsRaw || []) as Competitor[]).filter(
    (competitor) => !HIDDEN_COMPETITOR_ADAPTERS.has(competitor.adapter_name.trim().toLowerCase()),
  );
  const lastUpdated: Record<number, string | null> = {};
  const priceChanges: Record<number, number | null> = {};

  const [latestRows] = await Promise.all([
    db
      .from("price_snapshots")
      .select("snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .then(({ data }) => data),
    Promise.all(
      competitors.map(async (competitor) => {
        const { data } = await db
          .from("price_snapshots")
          .select("created_at, snapshot_date")
          .eq("competitor_id", competitor.id)
          .order("snapshot_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1);
        const row = data?.[0] as { created_at?: string; snapshot_date?: string } | undefined;
        lastUpdated[competitor.id] = row?.created_at ?? null;
        priceChanges[competitor.id] = row?.snapshot_date
          ? await countPriceChanges(db, competitor.id, row.snapshot_date)
          : null;
      }),
    ),
  ]);

  return {
    competitors,
    lastUpdated,
    priceChanges,
    latestDate: latestRows?.[0]?.snapshot_date ?? null,
  };
}

async function parserPricesMetadata(
  db: SupabaseClient,
  forceRefresh: boolean,
): Promise<ParserPricesMetadata> {
  if (forceRefresh) {
    const value = await loadParserPricesMetadata(db);
    putServerResult({
      namespace: "parser-prices-metadata-v1",
      key: "current",
      value,
      ttlMs: BASE_CACHE_TTL_MS,
      maxEntries: 1,
    });
    return value;
  }
  return (await getServerResult({
    namespace: "parser-prices-metadata-v1",
    key: "current",
    ttlMs: BASE_CACHE_TTL_MS,
    maxEntries: 1,
    load: () => loadParserPricesMetadata(db),
  })).value;
}

async function loadParserPricesDataset(
  db: SupabaseClient,
  snapshotDate: string | null,
  competitorIds: number[],
): Promise<ParserPricesDataset> {
  const snapshots = snapshotDate
    ? await fetchAllSnapshotsForDate(db, snapshotDate, competitorIds)
    : [];
  const productIds = [...new Set(snapshots.map((snapshot) => snapshot.product_id))];
  const products = productIds.length
    ? await fetchProductsByIds(db, productIds, "", "all")
    : [];
  const snapshotByProduct = new Map<number, Map<number, SnapshotRow>>();
  for (const snapshot of snapshots) {
    let bucket = snapshotByProduct.get(snapshot.product_id);
    if (!bucket) {
      bucket = new Map();
      snapshotByProduct.set(snapshot.product_id, bucket);
    }
    bucket.set(snapshot.competitor_id, snapshot);
  }
  return { snapshots, products, productIds, snapshotByProduct };
}

async function parserPricesDataset(
  db: SupabaseClient,
  snapshotDate: string | null,
  competitorIds: number[],
  forceRefresh: boolean,
): Promise<ParserPricesDataset> {
  const key = `${snapshotDate || "none"}:${competitorIds.join(",")}`;
  if (forceRefresh) {
    const value = await loadParserPricesDataset(db, snapshotDate, competitorIds);
    putServerResult({
      namespace: "parser-prices-dataset-v1",
      key,
      value,
      ttlMs: BASE_CACHE_TTL_MS,
      maxEntries: 4,
    });
    return value;
  }
  return (await getServerResult({
    namespace: "parser-prices-dataset-v1",
    key,
    ttlMs: BASE_CACHE_TTL_MS,
    maxEntries: 4,
    load: () => loadParserPricesDataset(db, snapshotDate, competitorIds),
  })).value;
}

async function pricesResponse(q: URLSearchParams, maxLimit = 200, forceBaseRefresh = false) {
  const search = (q.get("search") || "").trim().toLowerCase();
  const page = Math.max(parseIntOr(q.get("page"), 1), 1);
  const limit = Math.min(Math.max(parseIntOr(q.get("limit"), 50), 1), maxLimit);
  const snapshotDate = q.get("snapshot_date") || null;
  const idsIn = parseIntList(q.get("ids_in"));
  const idsInSet = new Set(idsIn);
  const segment = parseParserSegment(q.get("segment"));
  const identifierField = parseIdentifierField(q.get("identifier_field"));

  const db = getSupabase();
  let metadata: ParserPricesMetadata;
  let dataset: ParserPricesDataset;
  try {
    metadata = await parserPricesMetadata(db, forceBaseRefresh);
    const effectiveDate = snapshotDate || metadata.latestDate;
    dataset = await parserPricesDataset(
      db,
      effectiveDate,
      metadata.competitors.map((competitor) => competitor.id),
      forceBaseRefresh,
    );
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "parser_prices_base_failed",
    }, { status: 500 });
  }
  const { competitors, lastUpdated, priceChanges } = metadata;
  const effectiveDate = snapshotDate || metadata.latestDate;
  const { productIds: productIdList, snapshotByProduct } = dataset;

  // 4) Default view is restricted to products with at least one competitor
  //    snapshot. With a pasted set, resolve products directly from Agromat
  //    identifiers first; snapshots only fill competitor cells. Otherwise a
  //    895-item set collapses to only the few products already present in the
  //    parser snapshot.
  if (!idsInSet.size && productIdList.length === 0) {
    return NextResponse.json({
      snapshotDate: effectiveDate,
      competitors,
      lastUpdated,
      priceChanges,
      rows: [],
      total: 0,
      page,
      limit,
      notFoundIds: idsIn,
    });
  }

  let products: ProductRow[];
  try {
    products = idsInSet.size
      ? await fetchProductsByIdentifiers(db, idsIn, search, segment, identifierField)
      : filterProductRows(dataset.products, search, segment);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "products_failed" }, { status: 500 });
  }

  let notFoundIds: number[] = [];
  if (idsInSet.size) {
    const present = new Set<number>();
    for (const p of products) {
      if (identifierField === "code") {
        if (p.code != null && idsInSet.has(p.code)) present.add(p.code);
      } else {
        if (idsInSet.has(p.id)) present.add(p.id);
        if (p.code != null && idsInSet.has(p.code)) present.add(p.code);
        if (p.goods_ref != null && idsInSet.has(p.goods_ref)) present.add(p.goods_ref);
      }
    }
    notFoundIds = idsIn.filter((id) => !present.has(id));
  }

  // 6) Build response rows. Sort by name for predictable order.
  const rows: PricesRow[] = products
    .map((p) => {
      const snapshotsForProduct = snapshotByProduct.get(p.id) || new Map<number, SnapshotRow>();
      const byCompetitor: Record<number, CompetitorCell> = {};
      for (const c of competitors) {
        const snapshot = snapshotsForProduct.get(c.id);
        if (!snapshot) {
          byCompetitor[c.id] = {
            price: null,
            observedPrice: null,
            status: null,
            url: null,
            confidence: null,
            foundBrand: null,
            reviewReason: null,
          };
          continue;
        }
        const observedPrice = snapshot.price == null ? null : Number(snapshot.price);
        const foundBrand = snapshot.found_brand
          || (competitorBrandAppearsInText(p.brand, snapshot.found_url) ? p.brand : null);
        const evaluated = evaluateCompetitorPrice({
          observedPrice,
          status: snapshot.status,
          confidence: snapshot.confidence,
          expectedBrand: p.brand,
          foundBrand,
        });
        byCompetitor[c.id] = {
          price: evaluated.price,
          observedPrice,
          status: snapshot.status,
          url: snapshot.found_url,
          confidence: snapshot.confidence,
          foundBrand,
          reviewReason: evaluated.reviewReason,
        };
      }
      return {
        productId: p.id,
        code: p.code,
        goodsRef: p.goods_ref,
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        category: p.category,
        ourPrice: p.actual_price != null ? Number(p.actual_price) : null,
        ourUrl: p.url,
        status: p.agromat_status,
        byCompetitor,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));

  const total = rows.length;
  const start = (page - 1) * limit;
  const paged = rows.slice(start, start + limit);

  return NextResponse.json({
    snapshotDate: effectiveDate,
    competitors,
    lastUpdated,
    priceChanges,
    rows: paged,
    total,
    page,
    limit,
    notFoundIds,
  });
}

async function cachedPricesResponse(q: URLSearchParams) {
  const now = Date.now();
  const forceRefresh = q.get("refresh") === "1";
  const canonicalQuery = new URLSearchParams(q);
  canonicalQuery.delete("refresh");
  const key = canonicalQueryKey(canonicalQuery);
  const cache = parserPricesCache();
  pruneCache(cache, now);

  const cached = cache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    cache.delete(key);
    cache.set(key, cached);
    return NextResponse.json(cached.body, { headers: cacheHeaders(cached, "HIT") });
  }

  const inflight = parserPricesInflight();
  const pending = inflight.get(key);
  if (pending) return pending;

  const work = (async () => {
    const response = await pricesResponse(canonicalQuery, 200, forceRefresh);
    if (response.status !== 200) return response;

    const body = await response.clone().json() as CacheableBody;
    const entry: CacheEntry = {
      body,
      expiresAt: Math.min(nextKyivMidnightMs(), Date.now() + CACHE_TTL_MS),
      storedAt: Date.now(),
    };
    cache.set(key, entry);
    pruneCache(cache);
    return NextResponse.json(body, { headers: cacheHeaders(entry, "MISS") });
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, work);
  return work;
}

export async function GET(request: Request) {
  return cachedPricesResponse(new URL(request.url).searchParams);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (Array.isArray(body?.ids)) {
    const ids = [...new Set(body.ids
      .map((value: unknown) => Number(value))
      .filter((value: number) => Number.isSafeInteger(value) && value > 0))];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Не передано жодного коду товару" }, { status: 400 });
    }
    if (ids.length > 10_000) {
      return NextResponse.json({ error: "Забагато кодів товарів (максимум 10 000)" }, { status: 400 });
    }
    const q = new URLSearchParams({
      ids_in: ids.join(","),
      identifier_field: body.identifierField === "code" ? "code" : "any",
      limit: String(ids.length),
      page: "1",
    });
    return pricesResponse(q, 10_000);
  }
  const queryString = typeof body?.queryString === "string" ? body.queryString : "";
  return cachedPricesResponse(new URLSearchParams(queryString));
}
