import { NextResponse } from "next/server";
import { readPromotionWebFunnel } from "@/lib/promotion-web-funnel";
import type { WebFunnelPeriodKind } from "@/lib/promotion-web-funnel-types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pageUrl = url.searchParams.get("url") || "";
    const periodKind: WebFunnelPeriodKind = url.searchParams.get("period") === "month"
      ? "month"
      : "week";
    const anchor = url.searchParams.get("anchor") || undefined;
    const data = await readPromotionWebFunnel({ url: pageUrl, periodKind, anchor });
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=900",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не вдалося побудувати веб-воронку";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

