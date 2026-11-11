import { matchesSalesSearch } from "@/lib/sales-search";
import { classifySalesCategory, matchesSalesSegment } from "@/lib/sales-business-segments";
import { promotionCatalogSegment } from "@/lib/promotion-sales-segments";
import { fillSalesDateSeries } from "@/lib/sales-date-series";
import { isSalesPlanService } from "@/lib/sales-plan-items";
import type { ApiOrder } from "@/lib/webshop-orders-api";
import type { ProductLite } from "@/lib/products-store";
import { orderOriginSource } from "@/lib/orders-origin";
import type { SalesChannel } from "@/lib/sales-order-origin";

type Product = { code: string; name: string; url: string; brand: string; category: string; orders: number; qty: number; revenue: number };
type Bucket = { label: string; docs: number; goods: number; revenue: number; avgMargin: null };
const productIndexes = new WeakMap<ProductLite[], { byId: Map<string, ProductLite>; byRef: Map<string, ProductLite>; byCode: Map<string, ProductLite> }>();
function indexesForProducts(products: ProductLite[]) {
  let indexes = productIndexes.get(products);
  if (!indexes) {
    indexes = { byId: new Map(products.map(p => [String(p.id), p])), byRef: new Map(products.filter(p => p.goodsRef).map(p => [String(p.goodsRef), p])), byCode: new Map(products.filter(p => p.code).map(p => [String(p.code), p])) };
    productIndexes.set(products, indexes);
  }
  return indexes;
}
export function receivedSales(orders: ApiOrder[], products: ProductLite[], categories: ReadonlyMap<string, { category: string; categoryKey: string; brand: string }>, channel: SalesChannel, filter: { search?: string; segment?: string; categories?: string[]; brands?: string[]; from?: string; to?: string; details?: boolean } = {}) {
  const { byId, byRef, byCode } = indexesForProducts(products);
  const groups = { brands: new Map<string, { bucket: Bucket; docs: Set<number>; products: Map<string, Product>; productDocs: Map<string, Set<number>> }>(), categories: new Map<string, { bucket: Bucket; docs: Set<number>; products: Map<string, Product>; productDocs: Map<string, Set<number>> }>() };
  const totals = { docs: 0, goods: 0, revenue: 0 };
  const byDate = new Map<string, { date: string; docs: number; goods: number; revenue: number }>();
  const segments = new Map<string, { label: string; docs: number; goods: number; revenue: number }>();
  const categoryOptions = new Map<string, { label: string; segment: string }>();
  const brandOptions = new Map<string, { label: string; segment: string; category: string }>();
  const otherGroups = new Map<string, number>();
  const seen = new Set<number>();
  for (const order of orders) {
    const source = orderOriginSource(order);
    const origin = source === "webshop" ? "site" : source;
    if (seen.has(order.id) || (channel !== "all" && origin !== channel)) continue;
    seen.add(order.id);
    // Orders without positions still count in the unknown dimension.
    const items = order.items.length ? order.items : [{ product_id: `unknown-${order.id}`, code: null, goods_ref: null, name: null, url: null, quantity: 0, line_total: Math.max(0, (Number(order.totals?.cost) || 0) - (Number(order.totals?.delivery) || 0)) }];
    let orderGoods = 0, orderRevenue = 0, matched = false;
    const orderSegments = new Set<string>();
    for (const item of items) {
      const p = byCode.get(String(item.code)) || byRef.get(String(item.goods_ref)) || byId.get(String(item.product_id));
      const code = String(p?.code || item.code || item.goods_ref || item.product_id);
      const metadata = categories.get(code);
      const brand = metadata?.brand || p?.brand || "Без бренда";
      const category = metadata?.category || p?.categoryName || "Без категорії";
      if (isSalesPlanService({ code, name: item.name, category, categoryKey: metadata?.categoryKey })) continue;
      const catalog = promotionCatalogSegment(p?.categoryPath || "", category);
      const classification = metadata?.categoryKey ? classifySalesCategory(metadata.categoryKey)
        : { segment: catalog === "tile" ? "Плитка" : catalog === "plumbing" ? "Сантехніка" : "Інше", otherGroup: null };
      categoryOptions.set(category, { label: category, segment: classification.segment });
      brandOptions.set(JSON.stringify([brand, classification.segment, category]), { label: brand, segment: classification.segment, category });
      if (!matchesSalesSegment(classification, filter.segment)) continue;
      if (filter.categories?.length && !filter.categories.includes(category)) continue;
      if (filter.brands?.length && !filter.brands.includes(brand)) continue;
      if (!matchesSalesSearch({ code, name: p?.name || item.name, brand, category }, filter.search)) continue;
      matched = true;
      const qty = Number(item.quantity) || 0, revenue = Number(item.line_total) || 0;
      orderGoods += qty; orderRevenue += revenue;
      const segment = segments.get(classification.segment) || { label: classification.segment, docs: 0, goods: 0, revenue: 0 };
      if (!orderSegments.has(classification.segment)) segment.docs++;
      orderSegments.add(classification.segment);
      segment.goods += qty; segment.revenue += revenue; segments.set(classification.segment, segment);
      if (classification.segment === "Інше") {
        const label = classification.otherGroup || category;
        otherGroups.set(label, (otherGroups.get(label) || 0) + revenue);
      }
      for (const dimension of ["brands", "categories"] as const) {
        const label = dimension === "brands" ? brand : category;
        let g = groups[dimension].get(label);
        if (!g) { g = { bucket: { label, docs: 0, goods: 0, revenue: 0, avgMargin: null }, docs: new Set(), products: new Map(), productDocs: new Map() }; groups[dimension].set(label, g); }
        g.docs.add(order.id);
        g.bucket.docs = g.docs.size;
        g.bucket.goods += Number(item.quantity) || 0;
        g.bucket.revenue += Number(item.line_total) || 0;
        if (filter.details === false) continue;
        const product = g.products.get(code) || { code, name: p?.name || item.name || "Без назви", url: p?.url || item.url || "", brand, category, orders: 0, qty: 0, revenue: 0 };
        const docs = g.productDocs.get(code) || new Set<number>();
        docs.add(order.id); g.productDocs.set(code, docs);
        product.orders = docs.size; product.qty += Number(item.quantity) || 0; product.revenue += Number(item.line_total) || 0;
        g.products.set(code, product);
      }
    }
    if (matched) {
      totals.docs++; totals.goods += orderGoods; totals.revenue += orderRevenue;
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(order.date || "1970-01-01"));
      const day = byDate.get(date) || { date, docs: 0, goods: 0, revenue: 0 };
      day.docs++; day.goods += orderGoods; day.revenue += orderRevenue; byDate.set(date, day);
    }
  }
  const result = (dimension: keyof typeof groups) => ({ items: [...groups[dimension].values()].map(g => g.bucket), products: Object.fromEntries([...groups[dimension]].map(([label, g]) => [label, [...g.products.values()]])) });
  return { brands: result("brands"), categories: result("categories"), overview: {
    ...totals, averageCheck: totals.docs ? totals.revenue / totals.docs : null,
    segments: [...segments.values()], categoryOptions: [...categoryOptions.values()], brandOptions: [...brandOptions.values()],
    otherGroups: [...otherGroups].map(([label, revenue]) => ({ label, revenue })),
    byDate: fillSalesDateSeries([...byDate.values()], filter.from || null, filter.to || null),
  } };
}
