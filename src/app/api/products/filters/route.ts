import { NextResponse } from "next/server";
import { readFiltersCache } from "@/lib/products-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const cached = await readFiltersCache();
  if (!cached) {
    return NextResponse.json(
      { categories: [], statuses: [], brands: [], syncedAt: null, message: "No data — run /api/products/sync first" },
      { status: 200 },
    );
  }
  return NextResponse.json({ ...cached.filters, syncedAt: cached.syncedAt });
}
