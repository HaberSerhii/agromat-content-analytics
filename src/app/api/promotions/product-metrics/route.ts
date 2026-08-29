import { NextResponse } from "next/server";
import { readPromotionProductMetrics } from "@/lib/promotion-product-metrics";
import type {
  WebFunnelChannel,
  WebFunnelDevice,
} from "@/lib/promotion-web-funnel-types";
import { canonicalSearchParams, getServerResult } from "@/lib/server-result-cache";

export const dynamic = "force-dynamic";

const COMPACT_CACHE_TTL_MS = 15 * 60_000;
const DETAIL_CACHE_TTL_MS = 5 * 60_000;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pageUrl = url.searchParams.get("url") || "";
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const channel = (url.searchParams.get("channel") || "all") as WebFunnelChannel;
    const device = (url.searchParams.get("device") || "all") as WebFunnelDevice;
    const includeOutOfStock = url.searchParams.get("include_out_of_stock") === "1";
    const compact = url.searchParams.get("compact") === "1";
    const cacheKey = canonicalSearchParams(new URLSearchParams({
      url: pageUrl,
      from,
      to,
      channel,
      device,
      include_out_of_stock: includeOutOfStock ? "1" : "0",
      compact: compact ? "1" : "0",
    }));
    const { value: json, status } = await getServerResult({
      namespace: "promotion-product-metrics-json-v1",
      key: cacheKey,
      ttlMs: compact ? COMPACT_CACHE_TTL_MS : DETAIL_CACHE_TTL_MS,
      maxEntries: 16,
      load: async () => JSON.stringify(await readPromotionProductMetrics({
        url: pageUrl,
        from,
        to,
        channel,
        device,
        includeOutOfStock,
        compact,
      })),
    });
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, max-age=60, stale-while-revalidate=900",
        "X-Agromat-Cache": status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не вдалося завантажити метрики товарів";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
