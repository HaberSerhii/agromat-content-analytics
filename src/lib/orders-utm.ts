export type OrderUtmField = "utm_source" | "utm_campaign";
type Order = { source?: Partial<Record<OrderUtmField, string | null>> | null };

export function utmValue(order: Order, field: OrderUtmField): string {
  const value = order.source?.[field]?.trim();
  return value ? `value:${value}` : "missing";
}

export function matchesUtm(order: Order, source: string, campaign: string): boolean {
  return (!source || utmValue(order, "utm_source") === source)
    && (!campaign || utmValue(order, "utm_campaign") === campaign);
}

export function utmOptions(orders: Order[], field: OrderUtmField) {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const value = utmValue(order, field);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, label: value === "missing" ? "Без UTM" : value.slice(6), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
