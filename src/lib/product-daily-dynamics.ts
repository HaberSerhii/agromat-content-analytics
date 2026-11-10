import { dailyComparisons } from "@/lib/product-daily-comparison";
import { BigQuery } from "@google-cloud/bigquery";
import { readProductContentHistory } from "@/lib/product-content-history";
import { readThroughBigQueryCache } from "@/lib/bigquery-result-cache";

export type DailyProductPoint = { date: string; impressions: number | null; ctr: number | null; atc: number | null; contentScore: number | null; views?: number; carts?: number };
type ScoredProduct = { code: number; goodsRef: number; contentScore: number | null };
type EventDay = { available_through?: string | { value: string } | null; date: string | { value: string }; impressions: number; views: number; carts: number };

export function dailyProductPoints(today: string, rows: EventDay[], scores: Map<string, number | null>, available: boolean): DailyProductPoint[] {
  const byDate = new Map(rows.map(row => [typeof row.date === "string" ? row.date : row.date.value, row]));
  return Array.from({ length: Number(today.slice(8)) }, (_, index) => {
    const date = `${today.slice(0, 8)}${String(index + 1).padStart(2, "0")}`;
    const row = byDate.get(date);
    const impressions = Number(row?.impressions || 0), views = Number(row?.views || 0), carts = Number(row?.carts || 0);
    return { date, impressions: available ? impressions : null,
      ctr: available && impressions > 0 ? views / impressions * 100 : null,
      atc: available && views > 0 ? carts / views * 100 : null, contentScore: scores.get(date) ?? null, views, carts };
  });
}

export function previousYearPeriod(today: string) {
  const year = Number(today.slice(0,4)) - 1;
  const month = Number(today.slice(5,7));
  const day = Math.min(Number(today.slice(8)), new Date(Date.UTC(year, month, 0)).getUTCDate());
  const from = `${year}-${today.slice(5,7)}-01`;
  return { from, to: `${year}-${today.slice(5,7)}-${String(day).padStart(2,"0")}` };
}

export function dailyMonthPeriod(today: string, month = today.slice(0,7)) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > today.slice(0,7) || month < "2000-01") throw new Error("Оберіть коректний місяць не пізніше поточного");
  const end = month === today.slice(0,7) ? today : new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
  const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate()-1);
  return {from: `${month}-01`, end, completedThrough: end < today ? end : yesterday.toISOString().slice(0,10)};
}
export async function buildProductDailyDynamics(today: string, selected: ScoredProduct[], all: ScoredProduct[], table: string, month = today.slice(0,7)) {
  const period = dailyMonthPeriod(today, month);
  const {from} = period;
  const year = previousYearPeriod(period.end);
  const refs = [...new Set(selected.map(row => row.goodsRef))].sort((a,b) => a-b);
  let rows: EventDay[] = [], available = true, error = "";
  if (refs.length) {
    try {
      rows = await readThroughBigQueryCache<EventDay[]>({
        namespace: "product-daily-dynamics", key: JSON.stringify(["year-v3-month", today, month, table, refs]),
        load: async () => {
          const [result] = await new BigQuery({ projectId: process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413" }).query({
            query: `WITH source AS (
              SELECT event_date, event_name, item_id FROM ${table}
              WHERE ((event_date BETWEEN DATE(@from) AND DATE(@to)) OR (event_date BETWEEN DATE(@yearFrom) AND DATE(@yearTo)))
              AND event_name IN ('view_item_list','view_item','add_to_cart')
            ), freshness AS (
              SELECT MAX(IF(event_date BETWEEN DATE(@from) AND DATE(@completedThrough), event_date, NULL)) AS available_through FROM source
            ), daily AS (SELECT event_date AS date, COUNTIF(event_name = 'view_item_list') AS impressions,
              COUNTIF(event_name = 'view_item') AS views, COUNTIF(event_name = 'add_to_cart') AS carts
              FROM source WHERE SAFE_CAST(NULLIF(TRIM(item_id), '') AS INT64) IN UNNEST(@refs)
              GROUP BY event_date) SELECT daily.*, freshness.available_through FROM freshness LEFT JOIN daily ON TRUE`,
            params: { from, to: period.end, completedThrough: period.completedThrough, yearFrom: year.from, yearTo: year.to, refs }, location: "EU", maximumBytesBilled: "50000000000",
          });
          return result as EventDay[];
        },
      });
    } catch { available = false; error = "Не вдалося завантажити денні показники GA4"; }
  }
  const requestedDates = [period.end, year.to].flatMap(end => dailyProductPoints(end, [], new Map(), false).map(point => point.date));
  const history = await readProductContentHistory(today, selected.map(row => row.code), all, year.from, today, requestedDates);
  error = [error, history.error].filter(Boolean).join(" · ");
  const eventRows = rows.filter(row => row.date);
  const scalar = (value: string | { value: string }) => typeof value === "string" ? value : value.value;
  const metadata = rows.find(row => Object.hasOwn(row, "available_through"));
  const lastCompleteDay = period.completedThrough;
  const through = metadata ? (metadata.available_through ? scalar(metadata.available_through) : null)
    : eventRows.map(row => scalar(row.date)).filter(date => date >= from && date <= lastCompleteDay).sort().at(-1) ?? null;
  const yearHasEvents = eventRows.some(row => scalar(row.date).startsWith(year.from.slice(0,7)));
  const points = dailyProductPoints(period.end, eventRows, history.scores, available);
  const previous = dailyProductPoints(year.to, eventRows, history.scores, available && yearHasEvents);
  for (const point of points) if (!through || point.date > through) { point.impressions = null; point.ctr = null; point.atc = null; }
  for (const point of previous) if (!through || point.date.slice(8) > through.slice(8)) { point.impressions = null; point.ctr = null; point.atc = null; }
  return { points, year: previous, summary: dailyComparisons(points, previous, available ? through : null), error };
}
