export type MarketingDay = { date: string; transactions: number; revenue: number; aov: number };

// Aggregate the complete filtered order set, before registry pagination.
export function marketingDailySeries(orders: Array<{ date: string; totals: { cost: number } }>, from: string, to: string): MarketingDay[] {
  const days = new Map<string, MarketingDay>();
  const first = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime())) return [];
  for (const day = new Date(first); day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    days.set(date, {date, transactions: 0, revenue: 0, aov: 0});
  }
  const formatter = new Intl.DateTimeFormat("sv-SE", {timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit"});
  for (const order of orders) {
    const timestamp = new Date(order.date);
    if (!Number.isFinite(timestamp.getTime())) continue;
    const day = days.get(formatter.format(timestamp));
    if (!day) continue;
    day.transactions++;
    day.revenue += Number(order.totals.cost) || 0;
  }
  return [...days.values()].map(day => ({...day, aov: day.transactions ? day.revenue / day.transactions : 0}));
}
