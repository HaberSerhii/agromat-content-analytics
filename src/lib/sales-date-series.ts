export type SalesDailyPoint = {
  date: string;
  docs: number;
  goods: number;
  revenue: number;
};

export type SalesOrderDailyPoint<TManager = { seller: string; docs: number }> = {
  date: string;
  docs: number;
  managers: TManager[];
};

function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function calendarDates(from: string | null, to: string | null) {
  const start = from ? parseIsoDate(from) : null;
  const end = to ? parseIsoDate(to) : null;
  if (!start || !end || start > end) return [];

  const dates: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(isoDate(cursor));
  }
  return dates;
}

export function fillSalesDateSeries(
  points: SalesDailyPoint[],
  from: string | null,
  to: string | null,
) {
  const byDate = new Map(points.map((point) => [point.date, point]));
  const dates = calendarDates(from, to);
  if (!dates.length) return [...points].sort((left, right) => left.date.localeCompare(right.date));
  return dates.map((date) => byDate.get(date) || { date, docs: 0, goods: 0, revenue: 0 });
}

export function fillOrderDateSeries<TManager>(
  points: SalesOrderDailyPoint<TManager>[],
  from: string | null,
  to: string | null,
) {
  const byDate = new Map(points.map((point) => [point.date, point]));
  const dates = calendarDates(from, to);
  if (!dates.length) return [...points].sort((left, right) => left.date.localeCompare(right.date));
  return dates.map((date) => byDate.get(date) || { date, docs: 0, managers: [] });
}
