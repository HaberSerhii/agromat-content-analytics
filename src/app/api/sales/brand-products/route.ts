import { NextResponse } from "next/server";
import { readSalesBrandProducts, type SalesDateFilter } from "@/lib/sales-s3";
import { getServerResult } from "@/lib/server-result-cache";

export const dynamic = "force-dynamic";

async function brandProductsResponse(brand: string, filter: SalesDateFilter) {
  if (!brand.trim()) {
    return NextResponse.json({ error: "Brand is required" }, { status: 400 });
  }
  try {
    const key = JSON.stringify({
      brand,
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
      namespace: "sales-brand-products-json-v2",
      key,
      ttlMs: 60_000,
      maxEntries: 32,
      load: async () => JSON.stringify({
        category: brand,
        items: await readSalesBrandProducts(brand, filter),
      }),
    });
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
        "X-Agromat-Cache": status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load brand products";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  return brandProductsResponse(url.searchParams.get("brand") || "", {
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    productCodes: url.searchParams.get("product_codes") || undefined,
    statuses: url.searchParams.getAll("status"),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return brandProductsResponse(
    typeof body?.brand === "string" ? body.brand : "",
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
