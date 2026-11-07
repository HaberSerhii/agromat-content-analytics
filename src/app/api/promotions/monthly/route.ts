import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { monthlyPeriods, priorYearDate } from "@/lib/sales-monthly";
import { fetchAllPromotions, isBundlePromotion } from "@/lib/products-api";
import { readPromotionMonthlyBuckets, readPromotionPeriodSummary, readSalesProductDimensionLookup } from "@/lib/sales-s3";
import { readBaseOrders } from "@/lib/webshop-orders-api";
import { readAllLite, readLiteSyncedAt } from "@/lib/products-store";
import { readDashboardReport } from "@/lib/dashboard-report-cache";
import { normalizePromotionSalesChannel } from "@/lib/sales-order-origin";
import { normalizePromotionPricePosition, readPricePositionCodes } from "@/lib/promotion-price-position";
import { validateGa4Dates } from "@/lib/ga4-marketing-report";
import { buildPromotionMonthly, buildPromotionPeriodSummary, type PromotionPeriodSummary, type PromotionMonthlyOrder } from "@/lib/promotion-monthly";
import { promotionSalesSegment, promotionCatalogSegment, PROMOTION_SALES_SEGMENTS } from "@/lib/promotion-sales-segments";
import { orderOriginSource } from "@/lib/orders-origin";
import { isSalesPlanService } from "@/lib/sales-plan-items";

export const dynamic = "force-dynamic";
const kyivDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" });
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const to = params.get("to") || "", count = Number(params.get("count"));
  const summaryView = params.get("view") === "summary", from = params.get("from") || to;
  if (summaryView) { try { validateGa4Dates(from, to); } catch { return NextResponse.json({ error: "Некоректний період календаря" }, { status: 400 }); } }
  const selected = [...new Set(params.getAll("label"))], search = params.get("search") || "";
  if (selected.length > 2000 || selected.some(label => label.length > 300) || search.length > 300) return NextResponse.json({ error: "Некоректний фільтр" }, { status: 400 });
  try { validateGa4Dates(to, to); } catch { return NextResponse.json({ error: "Некоректна дата" }, { status: 400 }); }
  if (!summaryView && (!Number.isInteger(count) || count < 1 || count > 12)) return NextResponse.json({ error: "Некоректний період" }, { status: 400 });
  const segment = params.get("segment") || "Усі";
  if (!["Усі", ...Object.values(PROMOTION_SALES_SEGMENTS)].includes(segment)) return NextResponse.json({ error: "Некоректний сегмент" }, { status: 400 });
  const calendarMonths = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
  const periods = monthlyPeriods(to, summaryView ? calendarMonths : count);
  if (summaryView) periods[0].from = from;
  const compare = !summaryView && params.get("compare") === "1";
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
    if (summaryView && measure === "shipped") {
      const report = await readPromotionPeriodSummary(periods, promotions, channel, dimension, segment, selected, search);
      return NextResponse.json(report.value, { headers: { "Cache-Control": "private, no-store", "X-Agromat-Cache": report.status } });
    }
    const result = measure === "shipped"
      ? await readPromotionMonthlyBuckets(all, promotions, channel, dimension, segment)
      : await readDashboardReport("promotion-monthly-received-v2", createHash("sha256").update(JSON.stringify({ all, channel, dimension, segment, promotions, summaryView, selected, search, syncedAt: await readLiteSyncedAt() })).digest("hex"), 15 * 60_000, async () => {
        const [products, metadata] = await Promise.all([readAllLite(), readSalesProductDimensionLookup()]);
        const byCode = new Map(products.map(p => [String(p.code), p]));
        const byId = new Map(products.map(p => [String(p.id), p]));
        const byRef = new Map(products.filter(p => p.goodsRef).map(p => [String(p.goodsRef), p]));
        const result = [];
        let summary: PromotionPeriodSummary | null = null;
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
          if (summaryView) summary = buildPromotionPeriodSummary(mapped(), { from, to }, promotions, dimension, "received", segment, selected, search);
          else result.push(...buildPromotionMonthly(mapped(), range, promotions, dimension, "received", segment));
        }
        return { months: result, summary };
      });
    if (summaryView && "summary" in result.value) return NextResponse.json(result.value.summary, { headers: { "Cache-Control": "private, no-store", "X-Agromat-Cache": result.status } });
    const values = "months" in result.value ? result.value.months : result.value;
    const months = periods.map((p, i) => ({ ...p, current: values[i].items, previous: compare ? values[i + periods.length].items : [] }));
    return NextResponse.json(months, { headers: { "Cache-Control": "private, no-store", "X-Agromat-Cache": result.status } });
  } catch {
    return NextResponse.json({ error: "Не вдалося завантажити помісячні акційні продажі" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некоректні параметри" }, { status: 400 }); }
  const url = new URL(request.url); url.search = ""; url.searchParams.set("view", "summary");
  for (const key of ["from", "to", "dimension", "measure", "channel", "segment", "price_position", "search"]) {
    if (body?.[key] !== undefined && typeof body[key] !== "string") return NextResponse.json({ error: "Некоректні параметри" }, { status: 400 });
    if (body?.[key] !== undefined) url.searchParams.set(key, body[key]);
  }
  const labels = body?.selected ?? [];
  if (!Array.isArray(labels) || labels.length > 2000 || labels.some((label: unknown) => typeof label !== "string" || label.length > 300)) return NextResponse.json({ error: "Некоректний вибір" }, { status: 400 });
  for (const label of labels) url.searchParams.append("label", label);
  return GET(new Request(url));
}
