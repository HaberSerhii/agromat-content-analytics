import { classifySalesCategory } from "@/lib/sales-business-segments";
import { promotionCatalogSegment, PROMOTION_SALES_SEGMENTS } from "@/lib/promotion-sales-segments";

export const WEBSHOP_REVENUE_CATEGORIES = ["Плитка", "Сантехніка", "Підлогові покриття", "Будівельна хімія", "Джерела живлення", "Інше"] as const;
type Product = { id: number; goodsRef: number; code: number; categoryPath: string; categoryName: string };
type Order = { totals: { cost: number }; items: Array<{ product_id: number | string; goods_ref: number | null; code: number | string | null; line_total: number }> };

export function webshopCategoryRevenue(orders: Order[], products: Product[], erpCategories: ReadonlyMap<string, string> = new Map()) {
  const byId = new Map(products.map(p => [String(p.id), p]));
  const byRef = new Map(products.filter(p => p.goodsRef).map(p => [String(p.goodsRef), p]));
  const byCode = new Map(products.filter(p => p.code).map(p => [String(p.code), p]));
  const totals = new Map<string, number>(WEBSHOP_REVENUE_CATEGORIES.map(label => [label, 0]));
  for (const order of orders) {
    const sum = order.items.reduce((value, item) => value + (Number(item.line_total) || 0), 0);
    let allocated = 0;
    if (!order.items.length) totals.set("Інше", totals.get("Інше")! + order.totals.cost);
    order.items.forEach((item, index) => {
      const product = byCode.get(String(item.code)) || byRef.get(String(item.goods_ref)) || byId.get(String(item.product_id));
      const segment = product ? promotionCatalogSegment(product.categoryPath, product.categoryName) : null;
      const erpKey = erpCategories.get(String(item.code)) || (product ? erpCategories.get(String(product.code)) : undefined);
      const erp = erpKey ? classifySalesCategory(erpKey) : null;
      const root = (product?.categoryPath || product?.categoryName || "").split("/")[0].trim();
      const catalogFallback = ["Змішувачі", "Душові кабіни та системи", "Унітази та інсталяції", "Раковини та умивальники", "Рушникосушарки", "Ванни", "Кухонні мийки", "Сантехніка"].includes(root) ? "Сантехніка"
        : root === "Підлогове покриття" ? "Підлогові покриття" : "Інше";
      const candidate = erp ? erp.otherGroup || erp.segment : segment ? PROMOTION_SALES_SEGMENTS[segment] : catalogFallback;
      const label = totals.has(candidate) ? candidate : "Інше";
      const revenue = index === order.items.length - 1 ? order.totals.cost - allocated
        : sum !== 0 ? order.totals.cost * (Number(item.line_total) || 0) / sum : order.totals.cost / order.items.length;
      allocated += revenue;
      totals.set(label, totals.get(label)! + revenue);
    });
  }
  const total = orders.reduce((sum, order) => sum + order.totals.cost, 0);
  return [...totals].map(([label, revenue]) => ({ label, revenue, share: total ? revenue / total * 100 : 0 }));
}
