import { hasServerBearer } from "@/lib/dashboard-auth";
import { NextResponse } from "next/server";
import {
  readSalesDataset,
  type SalesDataset,
  type SalesDateFilter,
} from "@/lib/sales-s3";
import { getServerResult } from "@/lib/server-result-cache";
import { SALES_AUTO_REFRESH_MS } from "@/lib/sales-refresh";
import {
  normalizePromotionPricePosition,
  readPricePositionCodes,
} from "@/lib/promotion-price-position";

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

async function salesResponse(filter: SalesDateFilter, compact: boolean, refresh = false) {
  const started = performance.now();
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
      namespace: "sales-json-v10",
      key,
      ttlMs: compact ? SALES_AUTO_REFRESH_MS : 5 * 60_000,
      maxEntries: 16,
      refresh,
      staleMs: compact ? 60_000 : 0,
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
        "Cache-Control": "private, no-store",
        "X-Agromat-Cache": status,
        "Server-Timing": `sales;dur=${(performance.now() - started).toFixed(1)}`,
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
  const pricePosition = normalizePromotionPricePosition(url.searchParams.get("price_position"));
  const positionCodes = await readPricePositionCodes(pricePosition);
  return salesResponse({
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    productCodes: positionCodes
      ? positionCodes.size ? [...positionCodes] : [-1]
      : url.searchParams.get("product_codes") || undefined,
    statuses: url.searchParams.getAll("status"),
  }, compact, url.searchParams.get("prewarm") === "1" && hasServerBearer(req, "CRON_SECRET"));
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
