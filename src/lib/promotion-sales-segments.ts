import { classifySalesCategory } from "@/lib/sales-business-segments";

export const PROMOTION_SALES_SEGMENTS = {
  tile: "Плитка",
  plumbing: "Сантехніка",
  chemicals: "Будівельна хімія",
  furniture: "Меблі",
  power: "Джерела живлення",
  flooring: "Підлогові покриття",
} as const;

export type PromotionSalesSegment = keyof typeof PROMOTION_SALES_SEGMENTS;

export function promotionSalesSegment(categoryKey: string): PromotionSalesSegment | null {
  const { segment, otherGroup } = classifySalesCategory(categoryKey);
  const label = otherGroup ?? segment;
  return (Object.entries(PROMOTION_SALES_SEGMENTS)
    .find(([, value]) => value === label)?.[0] as PromotionSalesSegment | undefined) ?? null;
}
