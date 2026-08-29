import { NextResponse } from "next/server";
import { readFiltersCache } from "@/lib/products-store";

export const dynamic = "force-dynamic";

// Filters change only on sync (≤ a few times/day). Long browser cache is safe.
const CACHE = "private, max-age=60, stale-while-revalidate=600";

export async function GET(request: Request) {
  const view = new URL(request.url).searchParams.get("view");
  const cached = await readFiltersCache();
  if (!cached) {
    return NextResponse.json(
      { categories: [], statuses: [], brands: [], syncedAt: null, message: "No data — run /api/products/sync first" },
      { status: 200 },
    );
  }
  const payload = view === "compact"
    ? {
        categories: [],
        statuses: cached.filters.statuses,
        brands: [],
        syncedAt: cached.syncedAt,
      }
    : view === "categories"
      ? {
          categories: cached.filters.categories.map((category) => ({
            id: category.id,
            name: category.name,
            path: category.path,
          })),
          syncedAt: cached.syncedAt,
        }
      : { ...cached.filters, syncedAt: cached.syncedAt };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": CACHE },
  });
}
