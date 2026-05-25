import { NextResponse } from "next/server";
import {
  readCategoryAttrsAggregate,
  writeCategoryAttrsAggregate,
  backfillCategoryAttrsAggregate,
  readExcludedCategories,
  writeExcludedCategories,
} from "@/lib/products-store";

export const dynamic = "force-dynamic";
// First-call backfill reads all full shards via Redis pipeline + aggregates ~31K
// products — keep ample headroom over Vercel's 10s default. Cached writes make
// every subsequent call <500ms.
export const maxDuration = 60;

export async function GET() {
  let agg = await readCategoryAttrsAggregate();
  // First-run fallback: aggregate was added after some syncs already ran, so
  // it may be missing from Redis. Build it from the full shards on demand and
  // cache so subsequent requests are instant.
  if (!agg) {
    const built = await backfillCategoryAttrsAggregate();
    if (built) {
      agg = built;
      try { await writeCategoryAttrsAggregate(built); } catch { /* best-effort cache */ }
    }
  }
  const excluded = await readExcludedCategories();
  return NextResponse.json({
    syncedAt: agg?.syncedAt ?? null,
    categories: agg?.categories ?? [],
    excluded,
  }, {
    headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" },
  });
}

export async function POST(req: Request) {
  // Dashboard-only mutation
  const dashboardSecret = process.env.NEXT_PUBLIC_DASHBOARD_SECRET;
  if (dashboardSecret) {
    const incoming = req.headers.get("x-dashboard-secret");
    if (incoming !== dashboardSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !Array.isArray((body as { excluded?: unknown }).excluded)) {
    return NextResponse.json({ error: "Body must be { excluded: number[] }" }, { status: 400 });
  }
  const ids = ((body as { excluded: unknown[] }).excluded)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
  await writeExcludedCategories(ids);
  return NextResponse.json({ ok: true, excluded: ids });
}
