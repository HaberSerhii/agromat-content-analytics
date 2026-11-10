export type DailyMetric = "impressions" | "ctr" | "atc" | "contentScore";
export type MetricComparison = { current: number | null; year: number | null; through: string | null; yearThrough: string | null };
export type DailyComparisons = Record<DailyMetric, MetricComparison>;
export function relativeChange(current: number | null, previous: number | null) {
  return current != null && previous != null && previous > 0 ? (current - previous) / previous * 100 : null;
}
type Counts = { date: string; impressions: number | null; views?: number; carts?: number; contentScore: number | null };
export function dailyComparisons(points: Counts[], year: Counts[], through: string | null): DailyComparisons {
  const day = through?.slice(8);
  const currentRows = through ? points.filter(point => point.date <= through) : [];
  const previousRows = day ? year.filter(point => point.date.slice(8) <= day) : [];
  const aggregate = (rows: Counts[], metric: DailyMetric) => {
    const valid = rows.filter(row => row.impressions != null);
    if (!valid.length) return null;
    const impressions = valid.reduce((sum,row) => sum + row.impressions!,0);
    const views = valid.reduce((sum,row) => sum + (row.views || 0),0);
    const carts = valid.reduce((sum,row) => sum + (row.carts || 0),0);
    return metric === "impressions" ? impressions : metric === "ctr" ? (impressions > 0 ? views / impressions * 100 : null) : (views > 0 ? carts / views * 100 : null);
  };
  const latestScore = [...points].reverse().find(point => point.contentScore != null);
  const priorScore = latestScore ? year.find(point => point.date.slice(5) === latestScore.date.slice(5)) : null;
  const yearThrough = previousRows.at(-1)?.date ?? null;
  return Object.fromEntries((["impressions", "ctr", "atc", "contentScore"] as DailyMetric[]).map(metric => [metric, metric === "contentScore"
    ? {current: latestScore?.contentScore ?? null, year: priorScore?.contentScore ?? null, through: latestScore?.date ?? null, yearThrough: priorScore?.date ?? null}
    : {current: aggregate(currentRows,metric), year: aggregate(previousRows,metric), through, yearThrough}])) as DailyComparisons;
}
