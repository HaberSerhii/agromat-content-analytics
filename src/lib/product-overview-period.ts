import { BigQuery } from "@google-cloud/bigquery";
import { readThroughBigQueryCache } from "@/lib/bigquery-result-cache";
import type { ProductLite } from "@/lib/products-store";
export type OverviewPoint = {
  date: string;
  impressions: number;
  views: number;
  newProducts: number;
  ctr: number | null;
  atc: number | null;
  contentScore: number | null;
};
export type OverviewPeriod = {
  from: string;
  to: string;
  current: OverviewPoint[];
  year: OverviewPoint[];
  month: OverviewPoint[];
  contentScore: number | null;
  analyticsAvailable: boolean;
};
export function shiftOverviewDate(date: string, months: number) {
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export async function buildOverviewPeriod(
  products: ProductLite[],
  from: string,
  to: string,
  table: string,
  contentScore: number | null,
): Promise<OverviewPeriod> {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(to)) ||
    from > to ||
    (Date.parse(to) - Date.parse(from)) / 86400000 > 366
  )
    throw new Error("Оберіть коректний період до 367 днів");
  const ranges = [
    [from, to],
    [shiftOverviewDate(from, -12), shiftOverviewDate(to, -12)],
    [shiftOverviewDate(from, -1), shiftOverviewDate(to, -1)],
  ];
  type Row = {
    date: string | { value: string };
    impressions: number;
    views: number;
    carts: number;
  };
  let available = true;
  const series = await Promise.all(
    ranges.map(async ([start, end]) => {
      let rows: Row[] = [];
      if (products.length)
        try {
          rows = await readThroughBigQueryCache<Row[]>({
            namespace: "product-overview-daily",
            key: JSON.stringify([
              table,
              start,
              end,
              products.map((p) => p.goodsRef).sort((a, b) => a - b),
            ]),
            load: async () => {
              const [result] = await new BigQuery({
                projectId:
                  process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413",
              }).query({
                query: `SELECT event_date AS date, COUNTIF(event_name = 'view_item_list') AS impressions, COUNTIF(event_name = 'view_item') AS views, COUNTIF(event_name = 'add_to_cart') AS carts FROM ${table} WHERE event_date BETWEEN DATE(@start) AND DATE(@end) AND SAFE_CAST(NULLIF(TRIM(item_id), '') AS INT64) IN UNNEST(@refs) AND event_name IN ('view_item_list','view_item','add_to_cart') GROUP BY event_date`,
                params: { start, end, refs: products.map((p) => p.goodsRef) },
                location: "EU",
                maximumBytesBilled: "50000000000",
              });
              return result as Row[];
            },
          });
        } catch {
          available = false;
        }
      const byDate = new Map(
        rows.map((r) => [
          typeof r.date === "string" ? r.date : r.date.value,
          r,
        ]),
      );
      const points: (OverviewPoint & { impressions: number; views: number })[] =
        [];
      for (
        let d = new Date(`${start}T12:00:00Z`);
        d.toISOString().slice(0, 10) <= end;
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        const date = d.toISOString().slice(0, 10),
          r = byDate.get(date);
        points.push({
          date,
          newProducts: products.filter(
            (p) => p.firstSeenAt.slice(0, 10) === date,
          ).length,
          ctr:
            r && Number(r.impressions) > 0
              ? (Number(r.views) / Number(r.impressions)) * 100
              : null,
          atc: available ? Number(r?.carts || 0) : null,
          contentScore: null,
          impressions: Number(r?.impressions || 0),
          views: Number(r?.views || 0),
        });
      }
      return points;
    }),
  );
  // A failed source must not turn missing analytics into zeros.
  if (!available)
    series.forEach((s) =>
      s.forEach((p) => {
        p.ctr = null;
        p.atc = null;
      }),
    );
  return {
    from,
    to,
    current: series[0],
    year: series[1],
    month: series[2],
    contentScore,
    analyticsAvailable: available,
  };
}
