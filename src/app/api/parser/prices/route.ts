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

function parseIntOr(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
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
  db: SupabaseClient, ids: number[], search: string,
): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  const out: ProductRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    let q = db
      .from("products")
      .select("id, sku, name, brand, category, actual_price, url, agromat_status")
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
    out.push(...((data || []) as ProductRow[]));
  }
  return out;
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const search = (q.get("search") || "").trim().toLowerCase();
  const page = Math.max(parseIntOr(q.get("page"), 1), 1);
  const limit = Math.min(Math.max(parseIntOr(q.get("limit"), 50), 1), 200);
  const snapshotDate = q.get("snapshot_date") || null;

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
  const lastUpdated: Record<number, string | null> = {};
  await Promise.all(
    competitors.map(async (c) => {
      const { data } = await db
        .from("price_snapshots")
        .select("created_at")
        .eq("competitor_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1);
      lastUpdated[c.id] = (data?.[0]?.created_at as string | undefined) ?? null;
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
      rows: [],
      total: 0,
      page,
      limit,
    });
  }

  let products: ProductRow[];
  try {
    products = await fetchProductsByIds(db, productIdList, search);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "products_failed" }, { status: 500 });
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
    rows: paged,
    total,
    page,
    limit,
  });
}
