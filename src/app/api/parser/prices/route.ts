import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// PostgREST returns at most 1000 rows per request by default; the catalog
// has ~3K active products and ~1850 snapshots/day, so we MUST page through
// every list query. Helpers below page until the response is short.

const PAGE = 1000;
// PostgREST .in() encodes its argument list into the URL; an unbounded
// product-id list can blow past the nginx URL-length limit. Split into
// modest chunks — for a few thousand products this is 4–7 round trips.
const ID_CHUNK = 500;

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
  status: string | null;
  url: string | null;
}

interface PricesRow {
  productId: number;
  sku: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  ourPrice: number | null;
  ourUrl: string | null;
  status: string | null;
  byCompetitor: Record<number, CompetitorCell>;
}

type ParserSegment = "all" | "sanitary" | "tile";

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

function matchesParserSegment(category: string | null, segment: ParserSegment): boolean {
  if (segment === "all") return true;
  const s = (category || "").toLowerCase();
  if (segment === "tile") {
    return /плит|керамогран|моза|tile|gres/.test(s);
  }
  return /сантех|ванн|умив|раков|зміш|смес|душ|унітаз|унитаз|інсталяц|инсталляц/.test(s);
}

async function fetchAllSnapshotsForDate(
  db: SupabaseClient, snapshotDate: string,
): Promise<SnapshotRow[]> {
  const out: SnapshotRow[] = [];
  let from = 0;
  // Bounded at 50 pages = 50k rows defensively in case of pathological data.
  for (let i = 0; i < 50; i++) {
    const { data, error } = await db
      .from("price_snapshots")
      .select("product_id, competitor_id, price, status, found_url")
      .eq("snapshot_date", snapshotDate)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as SnapshotRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function fetchProductsByIds(
  db: SupabaseClient, ids: number[], search: string, idsInSet: Set<number>, segment: ParserSegment,
): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  const out: ProductRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    let q = db
      .from("products")
      .select("id, code, goods_ref, sku, name, brand, category, actual_price, url, agromat_status")
      .eq("is_active", true)
      .in("id", chunk)
      // A single chunk can never overflow because chunk ≤ 500 ≤ PAGE; but
      // set range explicitly to be safe under future schema changes.
      .range(0, PAGE - 1);
    if (search) {
      const like = `%${search}%`;
      q = q.or(`name.ilike.${like},sku.ilike.${like}`);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data || []) as ProductRow[];
    if (idsInSet.size) {
      out.push(...rows.filter((p) =>
        idsInSet.has(p.id) ||
        (p.code != null && idsInSet.has(p.code)) ||
        (p.goods_ref != null && idsInSet.has(p.goods_ref)),
      ).filter((p) => matchesParserSegment(p.category, segment)));
    } else {
      out.push(...rows.filter((p) => matchesParserSegment(p.category, segment)));
    }
  }
  return out;
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

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const search = (q.get("search") || "").trim().toLowerCase();
  const page = Math.max(parseIntOr(q.get("page"), 1), 1);
  const limit = Math.min(Math.max(parseIntOr(q.get("limit"), 50), 1), 200);
  const snapshotDate = q.get("snapshot_date") || null;
  const idsIn = parseIntList(q.get("ids_in"));
  const idsInSet = new Set(idsIn);
  const segment = parseParserSegment(q.get("segment"));

  const db = getSupabase();

  // 1) Competitors — usually 3 rows, sorted for stable column order.
  const { data: competitorsRaw, error: cErr } = await db
    .from("competitors")
    .select("id, name, adapter_name")
    .order("id", { ascending: true });
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  const competitors = (competitorsRaw || []) as Competitor[];

  // 1b) Last price-write time per competitor — the freshest `created_at` across
  //     all of that competitor's snapshots. Surfaces "when were these prices last
  //     refreshed" in the UI (incl. the daily 05:00 auto-run). One indexed
  //     order-by-limit-1 query per competitor (~3 round trips). Best-effort:
  //     a failure just yields null, never blocks the table.
  //     Same query also yields the latest snapshot_date, which seeds the
  //     per-competitor "price changed" count (latest run vs previous run).
  const lastUpdated: Record<number, string | null> = {};
  const priceChanges: Record<number, number | null> = {};
  await Promise.all(
    competitors.map(async (c) => {
      const { data } = await db
        .from("price_snapshots")
        .select("created_at, snapshot_date")
        .eq("competitor_id", c.id)
        .order("snapshot_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);
      const row = data?.[0] as { created_at?: string; snapshot_date?: string } | undefined;
      lastUpdated[c.id] = row?.created_at ?? null;
      priceChanges[c.id] = row?.snapshot_date
        ? await countPriceChanges(db, c.id, row.snapshot_date)
        : null;
    }),
  );

  // 2) Resolve effective snapshot_date — explicit param wins, otherwise pick
  //    the latest one that has any snapshots.
  let effectiveDate = snapshotDate;
  if (!effectiveDate) {
    const { data: latestRows } = await db
      .from("price_snapshots")
      .select("snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(1);
    effectiveDate = latestRows?.[0]?.snapshot_date ?? null;
  }

  // 3) Snapshots for the chosen date — one row per (product, competitor).
  //    Paged to bypass PostgREST's default 1000-row cap.
  let snapshots: SnapshotRow[] = [];
  if (effectiveDate) {
    try {
      snapshots = await fetchAllSnapshotsForDate(db, effectiveDate);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "snapshots_failed" }, { status: 500 });
    }
  }

  // 4) Restrict to products that have at least one competitor snapshot — keeps
  //    the table dense and the page count meaningful.
  const productIdList = [...new Set(snapshots.map((s) => s.product_id))];
  if (productIdList.length === 0) {
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
    products = await fetchProductsByIds(db, productIdList, search, idsInSet, segment);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "products_failed" }, { status: 500 });
  }

  let notFoundIds: number[] = [];
  if (idsInSet.size) {
    const present = new Set<number>();
    for (const p of products) {
      if (idsInSet.has(p.id)) present.add(p.id);
      if (p.code != null && idsInSet.has(p.code)) present.add(p.code);
      if (p.goods_ref != null && idsInSet.has(p.goods_ref)) present.add(p.goods_ref);
    }
    notFoundIds = idsIn.filter((id) => !present.has(id));
  }

  // 5) Index snapshots by product → competitor for O(1) cell lookup.
  const cellByProduct = new Map<number, Map<number, CompetitorCell>>();
  for (const s of snapshots) {
    let bucket = cellByProduct.get(s.product_id);
    if (!bucket) {
      bucket = new Map();
      cellByProduct.set(s.product_id, bucket);
    }
    bucket.set(s.competitor_id, {
      price: s.price,
      status: s.status,
      url: s.found_url,
    });
  }

  // 6) Build response rows. Sort by name for predictable order.
  const rows: PricesRow[] = products
    .map((p) => {
      const cells = cellByProduct.get(p.id) || new Map();
      const byCompetitor: Record<number, CompetitorCell> = {};
      for (const c of competitors) {
        byCompetitor[c.id] = cells.get(c.id) ?? { price: null, status: null, url: null };
      }
      return {
        productId: p.id,
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
