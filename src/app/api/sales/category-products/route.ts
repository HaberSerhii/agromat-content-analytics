import { NextResponse } from "next/server";
import { readSalesCategoryProducts, type SalesDateFilter } from "@/lib/sales-s3";
import { getServerResult } from "@/lib/server-result-cache";

export const dynamic = "force-dynamic";

async function categoryProductsResponse(
  category: string,
  filter: SalesDateFilter,
) {
  if (!category.trim()) {
    return NextResponse.json({ error: "Category is required" }, { status: 400 });
  }
  try {
    const key = JSON.stringify({
      category,
      from: filter.from || "",
      to: filter.to || "",
      productCodes: Array.isArray(filter.productCodes)
        ? [...filter.productCodes].map(String).sort()
        : filter.productCodes || "",
      statuses: Array.isArray(filter.statuses)
        ? [...filter.statuses].sort()
        : filter.statuses || "",
    });
    const { value: json, status } = await getServerResult({
      namespace: "sales-category-products-json-v3",
      key,
      ttlMs: 60_000,
      maxEntries: 32,
      load: async () => {
        return JSON.stringify({
          category,
          items: await readSalesCategoryProducts(category, filter),
        });
      },
    });
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
        "X-Agromat-Cache": status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load category products";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  return categoryProductsResponse(url.searchParams.get("category") || "", {
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    productCodes: url.searchParams.get("product_codes") || undefined,
    statuses: url.searchParams.getAll("status"),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return categoryProductsResponse(
    typeof body?.category === "string" ? body.category : "",
    {
      from: typeof body?.from === "string" ? body.from : undefined,
      to: typeof body?.to === "string" ? body.to : undefined,
      productCodes: Array.isArray(body?.productCodes) || typeof body?.productCodes === "string"
        ? body.productCodes
        : undefined,
      statuses: Array.isArray(body?.statuses) || typeof body?.statuses === "string"
        ? body.statuses
        : undefined,
    },
  );
}
