import { NextResponse } from "next/server";
import { readPromotionProductMetrics } from "@/lib/promotion-product-metrics";
import type {
  WebFunnelChannel,
  WebFunnelDevice,
} from "@/lib/promotion-web-funnel-types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const data = await readPromotionProductMetrics({
      url: url.searchParams.get("url") || "",
      from: url.searchParams.get("from") || "",
      to: url.searchParams.get("to") || "",
      channel: (url.searchParams.get("channel") || "all") as WebFunnelChannel,
      device: (url.searchParams.get("device") || "all") as WebFunnelDevice,
      includeOutOfStock: url.searchParams.get("include_out_of_stock") === "1",
    });
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=900",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не вдалося завантажити метрики товарів";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
