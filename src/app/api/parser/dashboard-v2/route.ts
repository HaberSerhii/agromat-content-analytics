import { NextResponse } from "next/server";
import { GET as parserPricesGet } from "@/app/api/parser/prices/route";
import { getSupabase } from "@/lib/supabase";
import { getServerResult, putServerResult } from "@/lib/server-result-cache";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;
const BASE_TTL_MS = 20 * 60 * 1000;
const PRICE_VIOLATION_RATIO = 0.95;
const HIDDEN_COMPETITOR_ADAPTERS = new Set(["santechshara"]);
const VTM_SANITARY = new Set(["DEVIT", "PRIMERA"]);
const VTM_TILE = new Set([
  "ALMERA CERAMICA",
  "ALMERA CERAMICA (SPAIN)",
  "ALMERA CERAMICA-2",
  "CERAMICA DESE0",
  "CERAMICA DESEO",
  "MEGAGRES",
  "MOZAICO DE LUX",
]);

type Segment = "tile" | "sanitary";
type ViewMode = "overview" | "changed" | "vtm-changed" | "not-median" | "vtm-not-median" | "new-feed" | "match-changed";
type MatchChange = "added" | "removed";
type CompetitorPriceChange = "increased" | "decreased";

interface Competitor {
  id: number;
  name: string;
  adapter_name: string;
  base_url: string | null;
}

interface PriceCell {
  price: number | null;
  observedPrice: number | null;
  status: string | null;
  url: string | null;
  confidence: string | null;
  foundBrand: string | null;
  reviewReason: string | null;
  matchChange?: MatchChange | null;
  priceChange?: CompetitorPriceChange | null;
  previousPrice?: number | null;
}

interface PriceRow {
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
  byCompetitor: Record<number, PriceCell>;
  matchChange?: MatchChange | null;
  newProductSearch?: NewProductSearchState | null;
}

interface NewProductSearchState {
  status: "pending" | "searching" | "ready" | "failed";
  queuedAt: string;
  startedAt: string | null;
  jobId: string | null;
  error: string | null;
  results: Array<{
    competitorId: number;
    competitor: string;
    url: string;
    price: number | null;
    status: string | null;
  }>;
}

interface PricesPayload {
  snapshotDate: string | null;
  competitors: Competitor[];
  lastUpdated: Record<number, string | null>;
  priceChanges: Record<number, number | null>;
  rows: PriceRow[];
  total: number;
}

interface ProductRow {
  id: number;
  brand: string | null;
  category: string | null;
  is_active: boolean | null;
}

interface AuditRow {
  action: string;
  product_id: number | null;
  snapshot_date: string | null;
  created_at: string;
  meta: Record<string, unknown> | null;
}

interface SegmentValues {
  tile: number;
  sanitary: number;
}

interface MetricValues extends SegmentValues {
  deltaTile: number;
  deltaSanitary: number;
}

interface FacetValue {
  value: string;
  count: number;
}

class ParserPricesError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ParserPricesError";
  }
}

interface DashboardBase {
  currentDate: string | null;
  previousDate: string | null;
  competitors: Competitor[];
  lastUpdated: Record<number, string | null>;
  priceChanges: Record<number, number | null>;
  currentRows: PriceRow[];
  previousRows: PriceRow[];
  changedProductIds: Set<number>;
  newProductQueue: Map<number, NewProductSearchState>;
  matchChanges: Map<number, MatchChange>;
  overview: {
    feed: MetricValues;
    matched: MetricValues;
    vtmFeed: MetricValues;
    vtmMatched: MetricValues;
    agromatLower: MetricValues;
    agromatHigher: MetricValues;
  };
  categories: string[];
  brands: string[];
  updates: Array<{
    competitorId: number;
    competitor: string;
    adapter: string;
    updatedAt: string | null;
    changedPrices: number | null;
    durationMinutes: number | null;
    manual: boolean;
  }>;
  progress: {
    completed: number;
    total: number;
    elapsedMinutes: number | null;
  };
}

function normalizeBrand(value: string | null | undefined): string {
  return (value || "").trim().toUpperCase();
}

function segmentOf(category: string | null | undefined): Segment {
  return /плит|керам|кл[іи]нкер|моза|tile|gres/i.test(category || "") ? "tile" : "sanitary";
}

function isVtm(row: Pick<PriceRow, "brand"> | Pick<ProductRow, "brand">): boolean {
  const brand = normalizeBrand(row.brand);
  return VTM_SANITARY.has(brand) || VTM_TILE.has(brand);
}

function emptySegments(): SegmentValues {
  return { tile: 0, sanitary: 0 };
}

function countBySegment<T>(rows: T[], predicate: (row: T) => boolean, category: (row: T) => string | null): SegmentValues {
  const result = emptySegments();
  for (const row of rows) {
    if (!predicate(row)) continue;
    result[segmentOf(category(row))] += 1;
  }
  return result;
}

function metric(current: SegmentValues, previous: SegmentValues): MetricValues {
  return {
    ...current,
    deltaTile: current.tile - previous.tile,
    deltaSanitary: current.sanitary - previous.sanitary,
  };
}

function validCompetitorPrices(row: PriceRow, competitorIds?: Set<number>): number[] {
  return Object.entries(row.byCompetitor)
    .filter(([id]) => !competitorIds || competitorIds.has(Number(id)))
    .map(([, cell]) => cell?.price)
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price) && price > 0);
}

function hasMatch(row: PriceRow): boolean {
  return validCompetitorPrices(row).length > 0;
}

function hasValidCellPrice(cell: PriceCell | undefined): boolean {
  return typeof cell?.price === "number" && Number.isFinite(cell.price) && cell.price > 0;
}

function matchChanges(currentRows: PriceRow[], previousRows: PriceRow[]): Map<number, MatchChange> {
  const previousByProduct = new Map(previousRows.map((row) => [row.productId, row]));
  const result = new Map<number, MatchChange>();
  for (const row of currentRows) {
    const before = previousByProduct.get(row.productId);
    const matchedNow = hasMatch(row);
    const matchedBefore = before ? hasMatch(before) : false;
    if (matchedNow !== matchedBefore) result.set(row.productId, matchedNow ? "added" : "removed");
  }
  return result;
}

function annotateMatchChanges(row: PriceRow, before: PriceRow | undefined, change: MatchChange | undefined): PriceRow {
  if (!change) return row;
  return {
    ...row,
    matchChange: change,
    byCompetitor: Object.fromEntries(Object.entries(row.byCompetitor).map(([competitorId, cell]) => {
      const currentHasPrice = hasValidCellPrice(cell);
      const previousHasPrice = hasValidCellPrice(before?.byCompetitor[Number(competitorId)]);
      const cellChange: MatchChange | null = currentHasPrice === previousHasPrice
        ? null
        : currentHasPrice ? "added" : "removed";
      return [competitorId, { ...cell, matchChange: cellChange }];
    })),
  };
}

function annotatePriceChanges(row: PriceRow, before: PriceRow | undefined): PriceRow {
  if (!before) return row;
  return {
    ...row,
    byCompetitor: Object.fromEntries(Object.entries(row.byCompetitor).map(([competitorId, cell]) => {
      const currentPrice = cell?.price;
      const previousPrice = before.byCompetitor[Number(competitorId)]?.price;
      const changed = typeof currentPrice === "number"
        && typeof previousPrice === "number"
        && Number.isFinite(currentPrice)
        && Number.isFinite(previousPrice)
        && currentPrice !== previousPrice;
      return [competitorId, {
        ...cell,
        priceChange: changed ? (currentPrice > previousPrice ? "increased" : "decreased") : null,
        previousPrice: changed ? previousPrice : null,
      }];
    })),
  };
}

function agromatIsLower(row: PriceRow): boolean {
  if (row.ourPrice == null || row.ourPrice <= 0) return false;
  const prices = validCompetitorPrices(row);
  return prices.length > 0 && row.ourPrice < Math.min(...prices);
}

function agromatIsHigher(row: PriceRow): boolean {
  if (row.ourPrice == null || row.ourPrice <= 0) return false;
  const prices = validCompetitorPrices(row);
  return prices.length > 0 && row.ourPrice > Math.min(...prices);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

// The Excel competitor report treats AGROMAT as "in the median" while our
// price does not exceed the median of quality-checked competitor prices.
// Keep the dashboard filter identical to that established report logic.
function agromatIsNotInMedian(row: PriceRow): boolean {
  if (row.ourPrice == null || row.ourPrice <= 0) return false;
  const competitorMedian = median(validCompetitorPrices(row));
  return competitorMedian != null && row.ourPrice > competitorMedian;
}

function previousDate(date: string | null): string | null {
  if (!date) return null;
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

async function loadPrices(
  snapshotDate?: string,
  includeAllProducts = false,
  forceRefresh = false,
): Promise<PricesPayload> {
  const url = new URL("http://internal/api/parser/prices");
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", "10000");
  if (snapshotDate) url.searchParams.set("snapshot_date", snapshotDate);
  if (includeAllProducts) url.searchParams.set("include_all", "1");
  if (forceRefresh) url.searchParams.set("refresh", "1");
  const authorization = process.env.CRON_SECRET
    ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
    : undefined;
  const response = await parserPricesGet(new Request(url, { headers: authorization }));
  if (!response.ok) {
    const body = await response.text();
    throw new ParserPricesError(response.status, `parser_prices_${response.status}:${body.slice(0, 160)}`);
  }
  return response.json() as Promise<PricesPayload>;
}

async function fetchAllProducts(): Promise<ProductRow[]> {
  const db = getSupabase();
  const rows: ProductRow[] = [];
  for (let from = 0; from < 50_000; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("products")
      .select("id, brand, category, is_active")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const chunk = (data || []) as ProductRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchAuditForDate(snapshotDate: string | null): Promise<AuditRow[]> {
  if (!snapshotDate) return [];
  const db = getSupabase();
  const rows: AuditRow[] = [];
  for (let from = 0; from < 10_000; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("audit_log")
      .select("action, product_id, snapshot_date, created_at, meta")
      .eq("snapshot_date", snapshotDate)
      .in("action", ["parser_run", "sync_added", "inactive", "reactivated"])
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const chunk = (data || []) as AuditRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchOpenNewProductQueue(): Promise<Map<number, NewProductSearchState>> {
  const { data, error } = await getSupabase()
    .from("new_product_search_queue")
    .select("product_id, status, queued_at, started_at, search_job_id, last_error, results")
    .is("completed_at", null)
    .order("queued_at", { ascending: true });
  if (error) throw new Error(error.message);
  return new Map((data || []).map((row) => [Number(row.product_id), {
    status: row.status as NewProductSearchState["status"],
    queuedAt: row.queued_at,
    startedAt: row.started_at || null,
    jobId: row.search_job_id || null,
    error: row.last_error || null,
    results: Array.isArray(row.results) ? row.results : [],
  }]));
}

function changedProducts(currentRows: PriceRow[], previousRows: PriceRow[]): Set<number> {
  const previousByProduct = new Map(previousRows.map((row) => [row.productId, row]));
  const changed = new Set<number>();
  for (const row of currentRows) {
    const before = previousByProduct.get(row.productId);
    if (!before) continue;
    for (const [competitorId, cell] of Object.entries(row.byCompetitor)) {
      const currentPrice = cell?.price;
      const previousPrice = before.byCompetitor[Number(competitorId)]?.price;
      if (currentPrice != null && previousPrice != null && Number(currentPrice) !== Number(previousPrice)) {
        changed.add(row.productId);
        break;
      }
    }
  }
  return changed;
}

async function buildDashboardBase(forceRefresh = false): Promise<DashboardBase> {
  const current = await loadPrices(undefined, true, forceRefresh);
  const priorDate = previousDate(current.snapshotDate);
  const [prior, products, auditRows, newProductQueue] = await Promise.all([
    priorDate ? loadPrices(priorDate) : Promise.resolve({ rows: [] } as unknown as PricesPayload),
    fetchAllProducts(),
    fetchAuditForDate(current.snapshotDate),
    fetchOpenNewProductQueue(),
  ]);
  const activeProducts = products.filter((product) => product.is_active !== false);
  const productById = new Map(products.map((product) => [product.id, product]));

  const feedNow = countBySegment(activeProducts, () => true, (row) => row.category);
  const feedDelta = emptySegments();
  const vtmFeedDelta = emptySegments();
  for (const event of auditRows) {
    if (!event.product_id || !["sync_added", "inactive", "reactivated"].includes(event.action)) continue;
    const product = productById.get(event.product_id);
    if (!product) continue;
    const direction = event.action === "inactive" ? -1 : 1;
    const segment = segmentOf(product.category);
    feedDelta[segment] += direction;
    if (isVtm(product)) vtmFeedDelta[segment] += direction;
  }
  const feedBefore = {
    tile: feedNow.tile - feedDelta.tile,
    sanitary: feedNow.sanitary - feedDelta.sanitary,
  };
  const vtmFeedNow = countBySegment(activeProducts, isVtm, (row) => row.category);
  const vtmFeedBefore = {
    tile: vtmFeedNow.tile - vtmFeedDelta.tile,
    sanitary: vtmFeedNow.sanitary - vtmFeedDelta.sanitary,
  };

  const currentMatched = countBySegment(current.rows, hasMatch, (row) => row.category);
  const previousMatched = countBySegment(prior.rows || [], hasMatch, (row) => row.category);
  const currentVtmMatched = countBySegment(current.rows, (row) => isVtm(row) && hasMatch(row), (row) => row.category);
  const previousVtmMatched = countBySegment(prior.rows || [], (row) => isVtm(row) && hasMatch(row), (row) => row.category);
  const currentLower = countBySegment(current.rows, agromatIsLower, (row) => row.category);
  const previousLower = countBySegment(prior.rows || [], agromatIsLower, (row) => row.category);
  const currentHigher = countBySegment(current.rows, agromatIsHigher, (row) => row.category);
  const previousHigher = countBySegment(prior.rows || [], agromatIsHigher, (row) => row.category);
  const currentMatchChanges = matchChanges(current.rows, prior.rows || []);

  const parserRuns = auditRows.filter((row) => row.action === "parser_run");
  const latestRunByAdapter = new Map<string, AuditRow>();
  for (const run of parserRuns) {
    const adapter = String(run.meta?.competitor_filter || "").trim().toLowerCase();
    if (adapter) latestRunByAdapter.set(adapter, run);
  }
  const competitors = current.competitors.filter(
    (competitor) => !HIDDEN_COMPETITOR_ADAPTERS.has(competitor.adapter_name.trim().toLowerCase()),
  );
  const updates = competitors.map((competitor) => {
    const adapter = competitor.adapter_name.trim().toLowerCase();
    const run = latestRunByAdapter.get(adapter);
    const source = String(run?.meta?.source || "").toLowerCase();
    const duration = Number(run?.meta?.duration_minutes ?? run?.meta?.duration_sec);
    return {
      competitorId: competitor.id,
      competitor: competitor.name,
      adapter,
      updatedAt: run?.created_at || current.lastUpdated?.[competitor.id] || null,
      changedPrices: Number.isFinite(Number(run?.meta?.price_changes))
        ? Number(run?.meta?.price_changes)
        : current.priceChanges?.[competitor.id] ?? null,
      durationMinutes: Number.isFinite(duration)
        ? (run?.meta?.duration_sec != null ? Math.round(duration / 60) : Math.round(duration))
        : null,
      manual: /manual|local/.test(source),
    };
  }).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  const completedTimes = updates
    .filter((update) => update.updatedAt?.startsWith(current.snapshotDate || ""))
    .map((update) => new Date(update.updatedAt as string).getTime())
    .filter(Number.isFinite);
  const elapsedMinutes = completedTimes.length > 1
    ? Math.max(0, Math.round((Math.max(...completedTimes) - Math.min(...completedTimes)) / 60_000))
    : null;

  return {
    currentDate: current.snapshotDate,
    previousDate: priorDate,
    competitors,
    lastUpdated: current.lastUpdated,
    priceChanges: current.priceChanges,
    currentRows: current.rows,
    previousRows: prior.rows || [],
    changedProductIds: changedProducts(current.rows, prior.rows || []),
    newProductQueue,
    matchChanges: currentMatchChanges,
    overview: {
      feed: metric(feedNow, feedBefore),
      matched: metric(currentMatched, previousMatched),
      vtmFeed: metric(vtmFeedNow, vtmFeedBefore),
      vtmMatched: metric(currentVtmMatched, previousVtmMatched),
      agromatLower: metric(currentLower, previousLower),
      agromatHigher: metric(currentHigher, previousHigher),
    },
    categories: [...new Set(current.rows.map((row) => row.category).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "uk")),
    brands: [...new Set(current.rows.map((row) => row.brand).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "uk")),
    updates,
    progress: {
      completed: completedTimes.length,
      total: competitors.length,
      elapsedMinutes,
    },
  };
}

function parseIdSet(value: string | null): Set<number> {
  return new Set((value || "")
    .split(/[\s,;]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isSafeInteger(item) && item > 0));
}

function rowMatchesView(row: PriceRow, view: ViewMode, base: DashboardBase, vtmOnly = false): boolean {
  if (vtmOnly && !isVtm(row)) return false;
  if (view === "changed") return base.changedProductIds.has(row.productId);
  if (view === "vtm-changed") return isVtm(row) && base.changedProductIds.has(row.productId);
  if (view === "not-median") return agromatIsNotInMedian(row);
  if (view === "vtm-not-median") return isVtm(row) && agromatIsNotInMedian(row);
  if (view === "new-feed") return base.newProductQueue.has(row.productId);
  if (view === "match-changed") return base.matchChanges.has(row.productId);
  return true;
}

function facetValues(rows: PriceRow[], field: "category" | "brand"): FacetValue[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[field]?.trim();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value, "uk"));
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const forceRefresh = query.get("refresh") === "1";
    let base: DashboardBase;
    let cacheStatus: string = "miss";
    if (forceRefresh) {
      base = await buildDashboardBase(true);
      putServerResult({
        namespace: "parser-dashboard-v2",
        key: "base",
        value: base,
        ttlMs: BASE_TTL_MS,
        maxEntries: 1,
      });
    } else {
      const cached = await getServerResult({
        namespace: "parser-dashboard-v2",
        key: "base",
        ttlMs: BASE_TTL_MS,
        maxEntries: 1,
        load: buildDashboardBase,
      });
      base = cached.value;
      cacheStatus = cached.status;
    }
    const page = Math.max(1, Number(query.get("page")) || 1);
    const limit = Math.min(100, Math.max(10, Number(query.get("limit")) || 20));
    const search = (query.get("search") || "").trim().toLowerCase();
    const category = query.get("category") || "";
    const brand = query.get("brand") || "";
    const price = query.get("price") || "all";
    const competitorPrice = query.get("competitor_price") || "all";
    const selectedCompetitors = parseIdSet(query.get("competitors"));
    const violationCompetitorId = Number(query.get("violation_competitor")) || 0;
    const vtmOnly = query.get("vtm") === "1";
    const ids = parseIdSet(query.get("ids"));
    const requestedView = query.get("view") || "overview";
    const legacyView = requestedView === "below-median"
      ? "not-median"
      : requestedView === "vtm-below-median"
        ? "vtm-not-median"
        : requestedView;
    const view: ViewMode = ["changed", "vtm-changed", "not-median", "vtm-not-median", "new-feed", "match-changed"].includes(legacyView)
      ? legacyView as ViewMode
      : "overview";

    const matchesFilters = (row: PriceRow, omit?: "category" | "brand") => {
      if (!rowMatchesView(row, view, base, vtmOnly)) return false;
      if (omit !== "category" && category && row.category !== category) return false;
      if (omit !== "brand" && brand && row.brand !== brand) return false;
      if (ids.size && !ids.has(row.productId) && !ids.has(row.code || -1) && !ids.has(row.goodsRef || -1)) return false;
      if (search && ![
        row.name,
        row.brand || "",
        row.category || "",
        row.sku || "",
        String(row.productId),
        String(row.code || ""),
        String(row.goodsRef || ""),
      ].some((value) => value.toLowerCase().includes(search))) return false;
      const scopedCompetitorPrices = validCompetitorPrices(row, selectedCompetitors.size ? selectedCompetitors : undefined);
      if (competitorPrice === "with" && scopedCompetitorPrices.length === 0) return false;
      if (competitorPrice === "without" && scopedCompetitorPrices.length > 0) return false;
      if (violationCompetitorId) {
        const competitorPrice = row.byCompetitor[violationCompetitorId]?.price;
        if (row.ourPrice == null || competitorPrice == null || competitorPrice >= row.ourPrice * PRICE_VIOLATION_RATIO) return false;
      }
      if (price === "lower" && !agromatIsLower(row)) return false;
      if (price === "higher" && !agromatIsHigher(row)) return false;
      return true;
    };

    const filtered = base.currentRows.filter((row) => matchesFilters(row));
    if (view === "new-feed") {
      filtered.sort((left, right) => String(base.newProductQueue.get(right.productId)?.queuedAt || "")
        .localeCompare(String(base.newProductQueue.get(left.productId)?.queuedAt || "")));
    }
    const categories = facetValues(base.currentRows.filter((row) => matchesFilters(row, "category")), "category");
    const brands = facetValues(base.currentRows.filter((row) => matchesFilters(row, "brand")), "brand");
    const violationRows = filtered;
    const violations = base.competitors.map((competitor) => ({
      competitorId: competitor.id,
      competitor: competitor.name,
      count: violationRows.reduce((count, row) => {
        const competitorPrice = row.byCompetitor[competitor.id]?.price;
        return count + (row.ourPrice != null && competitorPrice != null && competitorPrice < row.ourPrice * PRICE_VIOLATION_RATIO ? 1 : 0);
      }, 0),
    })).sort((a, b) => b.count - a.count);
    const previousByProduct = new Map(base.previousRows.map((row) => [row.productId, row]));
    const start = (page - 1) * limit;
    const responseRows = filtered.slice(start, start + limit).map((row) => {
      const before = previousByProduct.get(row.productId);
      const withMatchChanges = annotateMatchChanges(row, before, base.matchChanges.get(row.productId));
      const annotated = view === "changed" || view === "vtm-changed"
        ? annotatePriceChanges(withMatchChanges, before)
        : withMatchChanges;
      return view === "new-feed"
        ? { ...annotated, newProductSearch: base.newProductQueue.get(row.productId) || null }
        : annotated;
    });

    const responseBody = {
      prototype: true,
      cacheStatus,
      currentDate: base.currentDate,
      previousDate: base.previousDate,
      overview: base.overview,
      competitors: base.competitors,
      categories,
      brands,
      updates: base.updates,
      progress: base.progress,
      violations,
      rows: responseRows,
      total: filtered.length,
      page,
      limit,
    };
    if (query.get("compact") === "1") {
      return NextResponse.json({
        currentDate: base.currentDate,
        competitors: base.competitors,
        rows: responseBody.rows,
        total: responseBody.total,
        page,
        limit,
      });
    }
    return NextResponse.json(responseBody);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "parser_dashboard_v2_failed",
    }, { status: error instanceof ParserPricesError ? error.status : 500 });
  }
}
