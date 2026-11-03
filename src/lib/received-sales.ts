import { isSalesPlanService } from "@/lib/sales-plan-items";
import type { ApiOrder } from "@/lib/webshop-orders-api";
import type { ProductLite } from "@/lib/products-store";
import { orderOriginSource } from "@/lib/orders-origin";
import type { SalesChannel } from "@/lib/sales-order-origin";

type Product = { code: string; name: string; url: string; brand: string; category: string; orders: number; qty: number; revenue: number };
type Bucket = { label: string; docs: number; goods: number; revenue: number; avgMargin: null };
export function receivedSales(orders: ApiOrder[], products: ProductLite[], categories: ReadonlyMap<string, { category: string; categoryKey: string; brand: string }>, channel: SalesChannel) {
  const byId = new Map(products.map(p => [String(p.id), p]));
  const byRef = new Map(products.filter(p => p.goodsRef).map(p => [String(p.goodsRef), p]));
  const byCode = new Map(products.filter(p => p.code).map(p => [String(p.code), p]));
  const groups = { brands: new Map<string, { bucket: Bucket; docs: Set<number>; products: Map<string, Product>; productDocs: Map<string, Set<number>> }>(), categories: new Map<string, { bucket: Bucket; docs: Set<number>; products: Map<string, Product>; productDocs: Map<string, Set<number>> }>() };
  const seen = new Set<number>();
  for (const order of orders) {
    const source = orderOriginSource(order);
    const origin = source === "webshop" ? "site" : source;
    if (seen.has(order.id) || (channel !== "all" && origin !== channel)) continue;
    seen.add(order.id);
    // Orders without positions still count in the unknown dimension.
    const items = order.items.length ? order.items : [{ product_id: `unknown-${order.id}`, code: null, goods_ref: null, name: null, url: null, quantity: 0, line_total: Math.max(0, (Number(order.totals?.cost) || 0) - (Number(order.totals?.delivery) || 0)) }];
    for (const item of items) {
      const p = byCode.get(String(item.code)) || byRef.get(String(item.goods_ref)) || byId.get(String(item.product_id));
      const code = String(p?.code || item.code || item.goods_ref || item.product_id);
      const metadata = categories.get(code);
      const brand = metadata?.brand || p?.brand || "Без бренда";
      const category = metadata?.category || p?.categoryName || "Без категорії";
      if (isSalesPlanService({ code, name: item.name, category, categoryKey: metadata?.categoryKey })) continue;
      for (const dimension of ["brands", "categories"] as const) {
        const label = dimension === "brands" ? brand : category;
        let g = groups[dimension].get(label);
        if (!g) { g = { bucket: { label, docs: 0, goods: 0, revenue: 0, avgMargin: null }, docs: new Set(), products: new Map(), productDocs: new Map() }; groups[dimension].set(label, g); }
        g.docs.add(order.id);
        g.bucket.docs = g.docs.size;
        g.bucket.goods += Number(item.quantity) || 0;
        g.bucket.revenue += Number(item.line_total) || 0;
        const product = g.products.get(code) || { code, name: p?.name || item.name || "Без назви", url: p?.url || item.url || "", brand, category, orders: 0, qty: 0, revenue: 0 };
        const docs = g.productDocs.get(code) || new Set<number>();
        docs.add(order.id); g.productDocs.set(code, docs);
        product.orders = docs.size; product.qty += Number(item.quantity) || 0; product.revenue += Number(item.line_total) || 0;
        g.products.set(code, product);
      }
    }
  }
  const result = (dimension: keyof typeof groups) => ({ items: [...groups[dimension].values()].map(g => g.bucket), products: Object.fromEntries([...groups[dimension]].map(([label, g]) => [label, [...g.products.values()]])) });
  return { brands: result("brands"), categories: result("categories") };
}
