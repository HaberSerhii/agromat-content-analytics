import { NextResponse } from "next/server";
import {
  readSalesDataset,
  type SalesDataset,
  type SalesDateFilter,
} from "@/lib/sales-s3";
import { getServerResult } from "@/lib/server-result-cache";

export const dynamic = "force-dynamic";

function compactSalesDataset(dataset: SalesDataset): SalesDataset {
  return {
    ...dataset,
    rows: [],
    summary: {
      ...dataset.summary,
      byDate: dataset.summary.byDate.slice(-31),
      ordersByDate: dataset.summary.ordersByDate.slice(-31),
      categoryProducts: {},
    },
  };
}

async function salesResponse(filter: SalesDateFilter, compact: boolean) {
  try {
    const key = JSON.stringify({
      compact,
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
      namespace: "sales-json-v8",
      key,
      ttlMs: compact ? 20 * 60_000 : 5 * 60_000,
      maxEntries: 16,
      load: async () => {
        const dataset = await readSalesDataset(filter, {
          categoryProducts: compact ? false : "all",
        });
        return JSON.stringify(compact ? compactSalesDataset(dataset) : dataset);
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
    const message = error instanceof Error ? error.message : "Failed to load sales data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const compact = url.searchParams.get("compact") === "1";
  return salesResponse({
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    productCodes: url.searchParams.get("product_codes") || undefined,
    statuses: url.searchParams.getAll("status"),
  }, compact);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return salesResponse({
    from: typeof body?.from === "string" ? body.from : undefined,
    to: typeof body?.to === "string" ? body.to : undefined,
    productCodes: Array.isArray(body?.productCodes) || typeof body?.productCodes === "string" ? body.productCodes : undefined,
    statuses: Array.isArray(body?.statuses) || typeof body?.statuses === "string" ? body.statuses : undefined,
  }, body?.compact === true);
}
