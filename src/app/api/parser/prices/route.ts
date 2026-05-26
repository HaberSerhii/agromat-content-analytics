import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const search = (q.get("search") || "").trim().toLowerCase();
  const page = Math.max(parseIntOr(q.get("page"), 1), 1);
  const limit = Math.min(Math.max(parseIntOr(q.get("limit"), 50), 1), 200);
  const snapshotDate = q.get("snapshot_date") || null;

  const db = getSupabase();

  // 1) Competitors — usually 3 rows, cache via Supabase. Sorted to keep column
  //    order stable across requests.
  const { data: competitorsRaw, error: cErr } = await db
    .from("competitors")
    .select("id, name, adapter_name")
    .order("id", { ascending: true });
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  const competitors = (competitorsRaw || []) as Competitor[];

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
  let snapshots: SnapshotRow[] = [];
  if (effectiveDate) {
    const { data: snapRows, error: sErr } = await db
      .from("price_snapshots")
      .select("product_id, competitor_id, price, status, found_url")
      .eq("snapshot_date", effectiveDate);
    if (sErr) {
      return NextResponse.json({ error: sErr.message }, { status: 500 });
    }
    snapshots = (snapRows || []) as SnapshotRow[];
  }

  // 4) Restrict to products that have at least one competitor entry — keeps
  //    the table dense and the page count meaningful.
  const productIdsWithSnap = new Set(snapshots.map((s) => s.product_id));
  const productIdList = [...productIdsWithSnap];

  // Supabase has no UPSERT-like batched IN with large lists in the JS client
  // beyond ~1000 items, but the parser's product table is in the low thousands
  // so `.in()` is safe here.
  let productsQuery = db
    .from("products")
    .select("id, sku, name, brand, category, actual_price, url, agromat_status")
    .eq("is_active", true);

  if (productIdList.length > 0) {
    productsQuery = productsQuery.in("id", productIdList);
  } else {
    // Empty: return an empty page rather than every product.
    return NextResponse.json({
      snapshotDate: effectiveDate,
      competitors,
      rows: [],
      total: 0,
      page,
      limit,
    });
  }

  if (search) {
    // Search by name OR sku — case-insensitive partial match.
    const like = `%${search}%`;
    productsQuery = productsQuery.or(`name.ilike.${like},sku.ilike.${like}`);
  }

  const { data: productsRaw, error: pErr } = await productsQuery;
  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }
  const products = (productsRaw || []) as ProductRow[];

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
    rows: paged,
    total,
    page,
    limit,
  });
}
