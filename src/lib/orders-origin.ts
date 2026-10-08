export type OrderOrigin = { source?: string | null; external_order_id?: string | number | null };

type OriginOrder = { origin?: OrderOrigin | null; totals?: { cost?: number } };

export function orderOriginSource(order: OriginOrder): string {
  return order.origin?.source?.trim().toLowerCase() || "webshop";
}

export function orderOriginLabel(source: string): string {
  if (source === "rozetka") return "Rozetka";
  if (source === "webshop") return "Вебшоп AGROMAT";
  return source;
}

export function matchesOrderOrigin(order: OriginOrder, source: string): boolean {
  return !source || source === "all" || orderOriginSource(order) === source;
}

export function summarizeOrderOrigins(orders: OriginOrder[]) {
  const channels = new Map<string, { key: string; label: string; docs: number; revenue: number; averageOrder: number }>();
  for (const order of orders) {
    const key = orderOriginSource(order);
    const row = channels.get(key) || { key, label: orderOriginLabel(key), docs: 0, revenue: 0, averageOrder: 0 };
    row.docs += 1;
    row.revenue += Number(order.totals?.cost) || 0;
    row.averageOrder = row.revenue / row.docs;
    channels.set(key, row);
  }
  return [...channels.values()].sort((a, b) => b.docs - a.docs);
}
