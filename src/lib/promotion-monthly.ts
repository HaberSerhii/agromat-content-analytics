import type { PromotionSalesPromotionInput } from "./promotion-sales-types";

export type PromotionMonthlyOrder = {
  id: string; created: string; shipped: string | null;
  items: Array<{ code: number; brand: string; category: string; segment: string; qty: number; revenue: number }>;
};
export type PromotionMonthlyBucket = { label: string; docs: number; goods: number; revenue: number };

/** One traversal, with promotion membership checked on each sale date. An item
 * belonging to overlapping promotions contributes once, never once per offer. */
export function buildPromotionMonthly(
  orders: Iterable<PromotionMonthlyOrder>,
  periods: Array<{ from: string; to: string }>,
  promotions: PromotionSalesPromotionInput[],
  dimension: "brands" | "categories",
  measure: "received" | "shipped",
  segment = "Усі",
) {
  const byCode = new Map<number, PromotionSalesPromotionInput[]>();
  for (const promotion of promotions) for (const code of new Set(promotion.productCodes)) {
    const list = byCode.get(code) || []; list.push(promotion); byCode.set(code, list);
  }
  const indexed = new Map(periods.map(period => [period.from.slice(0, 7), {
    ...period, buckets: new Map<string, { label: string; docs: Set<string>; goods: number; revenue: number }>(),
  }]));
  for (const order of orders) {
    const date = measure === "received" ? order.created : order.shipped;
    if (!date) continue;
    const period = indexed.get(date.slice(0, 7));
    if (!period || date < period.from || date > period.to) continue;
    if (measure === "shipped" && (order.created < period.from || order.created > date)) continue;
    for (const item of order.items) {
      if (segment !== "Усі" && item.segment !== segment) continue;
      if (!(byCode.get(item.code) || []).some(promotion =>
        (!promotion.startDate || order.created >= promotion.startDate)
        && (!promotion.endDate || order.created <= promotion.endDate)
        && (!promotion.startDate || date >= promotion.startDate)
        && (!promotion.endDate || date <= promotion.endDate))) continue;
      const label = (dimension === "brands" ? item.brand : item.category) || "Без даних";
      const bucket = period.buckets.get(label) || { label, docs: new Set<string>(), goods: 0, revenue: 0 };
      bucket.docs.add(order.id); bucket.goods += item.qty; bucket.revenue += item.revenue;
      period.buckets.set(label, bucket);
    }
  }
  return [...indexed.values()].map(({ from, to, buckets }) => ({ from, to,
    items: [...buckets.values()].map(({ docs, ...bucket }) => ({ ...bucket, docs: docs.size })),
  }));
}
