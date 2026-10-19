import { NextResponse } from "next/server";
import { fetchAllPromotions } from "@/lib/products-api";
import { readPromotionsDailySnapshot, selectPromotionsForDailySnapshot, writePromotionsDailySnapshot } from "@/lib/promotions-daily-snapshots";
import { inventoryOnDate, inventoryChanges, type PromotionInventory } from "@/lib/promotion-inventory";
import { normalizePromotionPricePosition, readPricePositionCodes } from "@/lib/promotion-price-position";
import { getServerResult } from "@/lib/server-result-cache";
import { PROMOTION_SALES_SEGMENTS } from "@/lib/promotion-sales-segments";
import { readPromotionProductSegments } from "@/lib/sales-s3";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const requestedDate = params.get("date") || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !Number.isFinite(Date.parse(`${requestedDate}T12:00:00Z`)) || new Date(`${requestedDate}T12:00:00Z`).toISOString().slice(0, 10) !== requestedDate) {
      return NextResponse.json({ error: "Некоректна дата" }, { status: 400 });
    }
    const date = requestedDate > today ? today : requestedDate;
    const previous = new Date(`${date}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const previousDate = previous.toISOString().slice(0, 10);
    const segment = params.get("segment") || "all";
    if (segment !== "all" && !Object.hasOwn(PROMOTION_SALES_SEGMENTS, segment)) return NextResponse.json({ error: "Невідомий сегмент" }, { status: 400 });
    const pricePosition = normalizePromotionPricePosition(params.get("price_position"));
    const { value, status } = await getServerResult({
      namespace: "promotion-inventory-v1", key: `${date}:${segment}:${pricePosition}`, ttlMs: 60_000, maxEntries: 48,
      load: async (): Promise<PromotionInventory> => {
        const target = date === today
          ? { date, capturedAt: new Date().toISOString(), promotions: await fetchAllPromotions() }
          : readPromotionsDailySnapshot(date);
        if (target && date === today) writePromotionsDailySnapshot(date, selectPromotionsForDailySnapshot(target.promotions, date), target.capturedAt);
        const baseline = readPromotionsDailySnapshot(previousDate);
        let allowedCodes = await readPricePositionCodes(pricePosition);
        if (segment !== "all") {
          const segments = await readPromotionProductSegments();
          allowedCodes = new Set([...segments].filter(([code, value]) => value === segment && (!allowedCodes || allowedCodes.has(code))).map(([code]) => code));
        }
        const current = inventoryOnDate(target?.promotions ?? [], date, allowedCodes);
        return { date, previousDate, available: Boolean(target), changesAvailable: Boolean(target && baseline), capturedAt: target?.capturedAt ?? null,
          ...current, changes: target && baseline ? inventoryChanges(current, inventoryOnDate(baseline.promotions, previousDate, allowedCodes)) : null };
      },
    });
    return NextResponse.json(value, { headers: { "Cache-Control": "private, no-store", "X-Agromat-Cache": status } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не вдалося завантажити актуальні акції" }, { status: 500 });
  }
}
