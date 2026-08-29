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
type ViewMode = "overview" | "changed" | "vtm-changed" | "below-median" | "vtm-below-median";

interface Competitor {
  id: number;
  name: string;
  adapter_name: string;
}

interface PriceCell {
  price: number | null;
  observedPrice: number | null;
  status: string | null;
  url: string | null;
  confidence: string | null;
  foundBrand: string | null;
  reviewReason: string | null;
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

interface DashboardBase {
  currentDate: string | null;
  previousDate: string | null;
  competitors: Competitor[];
  lastUpdated: Record<number, string | null>;
  priceChanges: Record<number, number | null>;
  currentRows: PriceRow[];
  previousRows: PriceRow[];
  changedProductIds: Set<number>;
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

function agromatIsBelowMedian(row: PriceRow): boolean {
  if (row.ourPrice == null || row.ourPrice <= 0) return false;
  const competitorMedian = median(validCompetitorPrices(row));
  return competitorMedian != null && row.ourPrice < competitorMedian;
}

function previousDate(date: string | null): string | null {
  if (!date) return null;
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

async function loadPrices(snapshotDate?: string): Promise<PricesPayload> {
  async function loadPage(page: number): Promise<PricesPayload> {
    const url = new URL("http://internal/api/parser/prices");
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", "200");
    if (snapshotDate) url.searchParams.set("snapshot_date", snapshotDate);
    const response = await parserPricesGet(new Request(url));
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`parser_prices_${response.status}:${body.slice(0, 160)}`);
    }
    return response.json() as Promise<PricesPayload>;
  }

  const first = await loadPage(1);
  const pageCount = Math.ceil(first.total / 200);
  if (pageCount <= 1) return first;
  const rest = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => loadPage(index + 2)));
  return { ...first, rows: [first, ...rest].flatMap((payload) => payload.rows) };
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

async function buildDashboardBase(): Promise<DashboardBase> {
  const current = await loadPrices();
  const priorDate = previousDate(current.snapshotDate);
  const [prior, products, auditRows] = await Promise.all([
    priorDate ? loadPrices(priorDate) : Promise.resolve({ rows: [] } as unknown as PricesPayload),
    fetchAllProducts(),
    fetchAuditForDate(current.snapshotDate),
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

function rowMatchesView(row: PriceRow, view: ViewMode, changedIds: Set<number>): boolean {
  if (view === "changed") return changedIds.has(row.productId);
  if (view === "vtm-changed") return isVtm(row) && changedIds.has(row.productId);
  if (view === "below-median") return agromatIsBelowMedian(row);
  if (view === "vtm-below-median") return isVtm(row) && agromatIsBelowMedian(row);
  return true;
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const forceRefresh = query.get("refresh") === "1";
    let base: DashboardBase;
    let cacheStatus: string = "miss";
    if (forceRefresh) {
      base = await buildDashboardBase();
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
    const selectedCompetitors = parseIdSet(query.get("competitors"));
    const ids = parseIdSet(query.get("ids"));
    const requestedView = query.get("view") || "overview";
    const view: ViewMode = ["changed", "vtm-changed", "below-median", "vtm-below-median"].includes(requestedView)
      ? requestedView as ViewMode
      : "overview";

    const filtered = base.currentRows.filter((row) => {
      if (!rowMatchesView(row, view, base.changedProductIds)) return false;
      if (category && row.category !== category) return false;
      if (brand && row.brand !== brand) return false;
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
      if (selectedCompetitors.size && validCompetitorPrices(row, selectedCompetitors).length === 0) return false;
      if (price === "lower" && !agromatIsLower(row)) return false;
      if (price === "higher" && !agromatIsHigher(row)) return false;
      return true;
    });
    const violationRows = filtered.length ? filtered : base.currentRows;
    const violations = base.competitors.map((competitor) => ({
      competitorId: competitor.id,
      competitor: competitor.name,
      count: violationRows.reduce((count, row) => {
        const competitorPrice = row.byCompetitor[competitor.id]?.price;
        return count + (row.ourPrice != null && competitorPrice != null && competitorPrice < row.ourPrice * PRICE_VIOLATION_RATIO ? 1 : 0);
      }, 0),
    })).sort((a, b) => b.count - a.count);
    const start = (page - 1) * limit;

    const responseBody = {
      prototype: true,
      cacheStatus,
      currentDate: base.currentDate,
      previousDate: base.previousDate,
      overview: base.overview,
      competitors: base.competitors,
      categories: base.categories,
      brands: base.brands,
      updates: base.updates,
      progress: base.progress,
      violations,
      rows: filtered.slice(start, start + limit),
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
    }, { status: 500 });
  }
}
