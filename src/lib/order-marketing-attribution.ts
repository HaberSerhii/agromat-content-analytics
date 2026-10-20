export type MarketingAttribution = {
  channel: string;
  source: string;
  medium: string;
  campaign: string;
  method: "ga4" | "utm" | "marketplace" | "unknown";
  transactionId?: string;
  reason?: "not_found" | "ambiguous";
};
export type Ga4OrderTransaction = Omit<MarketingAttribution, "method" | "reason"> & { transactionId: string };
export type MarketingOrder = {
  id: number;
  origin?: { source?: string | null } | null;
  source?: { utm_source?: string | null; utm_campaign?: string | null; utm_medium?: string | null } | null;
  marketing?: MarketingAttribution;
};
export const UNKNOWN_CHANNEL = "Джерело не визначено";
export const UTM_CHANNEL = "UTM · канал не визначено";
export const ROZETKA_CHANNEL = "Маркетплейс · Rozetka";

export function transactionIndex(rows: Ga4OrderTransaction[]) {
  const index = new Map<string, Ga4OrderTransaction | null>();
  for (const row of rows) {
    const id = row.transactionId.trim();
    if (!id || id === "(not set)" || id === "(other)" || id === "0") continue;
    const previous = index.get(id);
    if (previous === null) continue;
    if (previous && ["channel", "source", "medium", "campaign"].some(field => previous[field as keyof Ga4OrderTransaction] !== row[field as keyof Ga4OrderTransaction])) {
      index.set(id, null);
    } else index.set(id, row);
  }
  return index;
}

export function attributeOrder<T extends MarketingOrder>(order: T, index: ReturnType<typeof transactionIndex>): T & { marketing: MarketingAttribution } {
  const origin = order.origin?.source?.trim().toLowerCase();
  if (origin === "rozetka") return { ...order, marketing: { channel: ROZETKA_CHANNEL, source: "rozetka", medium: "marketplace", campaign: "(not set)", method: "marketplace" } };
  // GA4 transaction_id was verified against the website's internal order.id.
  // Never guess from order_num, ERP IDs, amount, contact details or date.
  const transaction = origin && !["site", "webshop"].includes(origin) ? undefined : index.get(String(order.id));
  if (transaction) return { ...order, marketing: { ...transaction, method: "ga4" } };
  const source = order.source?.utm_source?.trim();
  const campaign = order.source?.utm_campaign?.trim();
  const reason = transaction === null ? "ambiguous" : "not_found";
  if (source || campaign) return { ...order, marketing: { channel: UTM_CHANNEL, source: source || "(not set)", medium: order.source?.utm_medium?.trim() || "(not set)", campaign: campaign || "(not set)", method: "utm", reason } };
  return { ...order, marketing: { channel: UNKNOWN_CHANNEL, source: "(not set)", medium: "(not set)", campaign: "(not set)", method: "unknown", reason } };
}

export function matchesMarketing(order: MarketingOrder, source: string, campaign: string, channel = "", medium = "") {
  const value = (field: "source" | "campaign") => {
    const v = order.marketing?.[field];
    return !v || v === "(not set)" ? "missing" : `value:${v}`;
  };
  return (!source || value("source") === source) && (!campaign || value("campaign") === campaign) && (!channel || order.marketing?.channel === channel) && (!medium || order.marketing?.medium === medium);
}

export type MarketingOrderGroup = {
  channel: string; source: string; medium: string; campaign: string;
  orders: number; revenue: number; averageOrder: number;
};
export function marketingOrderGroups(orders: Array<MarketingOrder & { totals: { cost: number } }>): MarketingOrderGroup[] {
  const groups = new Map<string, MarketingOrderGroup>();
  for (const order of orders) {
    if (!order.marketing) continue;
    const {channel, source, medium, campaign} = order.marketing;
    const key = marketingGroupKey({channel, source, medium, campaign});
    const group = groups.get(key) || {channel, source, medium, campaign, orders: 0, revenue: 0, averageOrder: 0};
    group.orders++;
    group.revenue += Number(order.totals.cost) || 0;
    group.averageOrder = group.revenue / group.orders;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.revenue - a.revenue);
}
export function marketingGroupKey(row: { channel: string; source: string; medium: string; campaign: string }) {
  return JSON.stringify([row.channel, row.source, row.medium, row.campaign]);
}
