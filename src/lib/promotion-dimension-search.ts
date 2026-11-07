import type { PromotionSalesBucket } from "./promotion-sales-types";

export function selectPromotionDimensions(items: PromotionSalesBucket[], search: string) {
  const query = search.trim().toLocaleLowerCase("uk-UA");
  const visible = query ? items.filter(item => item.label.toLocaleLowerCase("uk-UA").includes(query)) : items;
  return {
    items: visible,
    count: visible.length,
    productCount: visible.reduce((sum, item) => sum + item.productCount, 0),
    revenue: visible.reduce((sum, item) => sum + item.revenue, 0),
  };
}
