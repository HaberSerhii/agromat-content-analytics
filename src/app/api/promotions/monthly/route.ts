import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { monthlyPeriods, priorYearDate } from "@/lib/sales-monthly";
import { fetchAllPromotions, isBundlePromotion } from "@/lib/products-api";
import { readPromotionMonthlyBuckets, readSalesProductDimensionLookup } from "@/lib/sales-s3";
import { readBaseOrders } from "@/lib/webshop-orders-api";
import { readAllLite, readLiteSyncedAt } from "@/lib/products-store";
import { readDashboardReport } from "@/lib/dashboard-report-cache";
import { normalizePromotionSalesChannel } from "@/lib/sales-order-origin";
import { normalizePromotionPricePosition, readPricePositionCodes } from "@/lib/promotion-price-position";
import { validateGa4Dates } from "@/lib/ga4-marketing-report";
import { buildPromotionMonthly, type PromotionMonthlyOrder } from "@/lib/promotion-monthly";
import { promotionSalesSegment, promotionCatalogSegment, PROMOTION_SALES_SEGMENTS } from "@/lib/promotion-sales-segments";
import { orderOriginSource } from "@/lib/orders-origin";
import { isSalesPlanService } from "@/lib/sales-plan-items";

export const dynamic = "force-dynamic";
const kyivDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" });
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const to = params.get("to") || "", count = Number(params.get("count"));
  try { validateGa4Dates(to, to); } catch { return NextResponse.json({ error: "Некоректна дата" }, { status: 400 }); }
  if (!Number.isInteger(count) || count < 1 || count > 12) return NextResponse.json({ error: "Некоректний період" }, { status: 400 });
  const segment = params.get("segment") || "Усі";
  if (!["Усі", ...Object.values(PROMOTION_SALES_SEGMENTS)].includes(segment)) return NextResponse.json({ error: "Некоректний сегмент" }, { status: 400 });
  const periods = monthlyPeriods(to, count), compare = params.get("compare") === "1";
  const prior = compare ? periods.map(p => ({ from: priorYearDate(p.from), to: priorYearDate(p.to) })) : [];
  const channel = normalizePromotionSalesChannel(params.get("channel"));
  const dimension = params.get("dimension") === "categories" ? "categories" : "brands";
  const pricePosition = normalizePromotionPricePosition(params.get("price_position"));
  const measure = params.get("measure") === "received" ? "received" : "shipped";
  try {
    const [allPromotions, allowedCodes] = await Promise.all([fetchAllPromotions(), readPricePositionCodes(pricePosition)]);
    const promotions = allPromotions.filter(p => !p.has_related && !isBundlePromotion(p)).map(p => ({
      id: p.id, idinc: p.idinc, name: p.name, startDate: p.start_date,
      endDate: p.is_unlimited ? null : p.end_date, publicUrl: null,
      productCodes: [...new Set(p.products.map(item => item.code).filter(code => code > 0 && (!allowedCodes || allowedCodes.has(code))))],
    })).filter(p => p.productCodes.length);
    const all = [...periods, ...prior];
    const result = measure === "shipped"
      ? await readPromotionMonthlyBuckets(all, promotions, channel, dimension, segment)
      : await readDashboardReport("promotion-monthly-received-v1", createHash("sha256").update(JSON.stringify({ all, channel, dimension, segment, promotions, syncedAt: await readLiteSyncedAt() })).digest("hex"), 15 * 60_000, async () => {
        const [products, metadata] = await Promise.all([readAllLite(), readSalesProductDimensionLookup()]);
        const byCode = new Map(products.map(p => [String(p.code), p]));
        const byId = new Map(products.map(p => [String(p.id), p]));
        const byRef = new Map(products.filter(p => p.goodsRef).map(p => [String(p.goodsRef), p]));
        const result = [];
        for (const range of [periods, prior]) {
          if (!range.length) continue;
          const { value: orders } = await readBaseOrders(range[0].from, range.at(-1)!.to);
          function* mapped(): Iterable<PromotionMonthlyOrder> {
            for (const order of orders) {
              const origin = orderOriginSource(order);
              if (channel !== "all" && (origin === "webshop" ? "site" : origin) !== channel) continue;
              const created = kyivDay.format(new Date(order.date));
              yield { id: String(order.id), created, shipped: null, items: order.items.flatMap(item => {
                const product = byCode.get(String(item.code)) || byRef.get(String(item.goods_ref)) || byId.get(String(item.product_id));
                const code = Number(product?.code || item.code);
                const meta = metadata.get(String(code));
                const category = meta?.category || product?.categoryName || "Без категорії";
                if (isSalesPlanService({ code: String(code), name: item.name, category, categoryKey: meta?.categoryKey })) return [];
                const key = meta?.categoryKey ? promotionSalesSegment(meta.categoryKey) : promotionCatalogSegment(product?.categoryPath || "", category);
                return [{ code, category, brand: meta?.brand || product?.brand || "Без бренда", segment: key ? PROMOTION_SALES_SEGMENTS[key] : "Інше", qty: Number(item.quantity) || 0, revenue: Number(item.line_total) || 0 }];
              }) };
            }
          }
          result.push(...buildPromotionMonthly(mapped(), range, promotions, dimension, "received", segment));
        }
        return result;
      });
    const months = periods.map((p, i) => ({ ...p, current: result.value[i].items, previous: compare ? result.value[i + periods.length].items : [] }));
    return NextResponse.json(months, { headers: { "Cache-Control": "private, no-store", "X-Agromat-Cache": result.status } });
  } catch {
    return NextResponse.json({ error: "Не вдалося завантажити помісячні акційні продажі" }, { status: 502 });
  }
}
