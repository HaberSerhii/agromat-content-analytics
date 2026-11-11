import type { ContentScoreChange } from "@/lib/product-content-history";
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
  atcTotals?: { current: number | null; year: number | null; month: number | null };
  contentScoreChange?: ContentScoreChange;
  contentScoreError?: string;
  analyticsAvailable: boolean;
  analyticsLoaded?: boolean;
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
  includeAnalytics = true,
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
    pdp_users?: number;
    cart_users?: number;
    scope?: string;
  };
  let available = includeAnalytics;
  const refs = [...new Set(products.map((p) => p.goodsRef))].sort(
    (a, b) => a - b,
  );
  const newByDate = new Map<string, number>();
  for (const product of products) {
    const date = product.firstSeenAt.slice(0, 10);
    newByDate.set(date, (newByDate.get(date) || 0) + 1);
  }
  let rows: Row[] = [];
  if (includeAnalytics && refs.length)
    try {
      rows = await readThroughBigQueryCache<Row[]>({
        namespace: "product-overview-periods",
        key: JSON.stringify([
          "v3-user-atc",
          new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }),
          table,
          ranges,
          refs,
        ]),
        load: async () => {
          const [result] = await new BigQuery({
            projectId:
              process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413",
          }).query({
            query: `WITH periods AS (
              SELECT 'current' AS period, DATE(@start) AS start_date, DATE(@end) AS end_date
              UNION ALL SELECT 'year', DATE(@yearStart), DATE(@yearEnd)
              UNION ALL SELECT 'month', DATE(@monthStart), DATE(@monthEnd)
            ), event_counts AS (
              SELECT event_date AS date,
                COUNTIF(event_name = 'view_item_list') AS impressions,
                COUNTIF(event_name = 'view_item') AS views,
                COUNTIF(event_name = 'add_to_cart') AS carts
              FROM ${table}
              WHERE EXISTS (SELECT 1 FROM periods WHERE event_date BETWEEN start_date AND end_date)
                AND SAFE_CAST(NULLIF(TRIM(item_id), '') AS INT64) IN UNNEST(@refs)
                AND event_name IN ('view_item_list','view_item','add_to_cart')
              GROUP BY event_date
            ), raw_items AS (
              SELECT PARSE_DATE('%Y%m%d', event_date) AS date, event_timestamp,
                event_name, user_pseudo_id,
                SAFE_CAST(NULLIF(TRIM(item.item_id), '') AS INT64) AS goods_ref
              FROM ${table.replace(/\.[^.`]+`$/, '.events_*`')}, UNNEST(items) AS item
              WHERE ((_TABLE_SUFFIX BETWEEN REPLACE(@start, '-', '') AND REPLACE(@end, '-', ''))
                OR (_TABLE_SUFFIX BETWEEN REPLACE(@yearStart, '-', '') AND REPLACE(@yearEnd, '-', ''))
                OR (_TABLE_SUFFIX BETWEEN REPLACE(@monthStart, '-', '') AND REPLACE(@monthEnd, '-', '')))
                AND event_name IN ('view_item', 'add_to_cart')
                AND NULLIF(user_pseudo_id, '') IS NOT NULL
                AND SAFE_CAST(NULLIF(TRIM(item.item_id), '') AS INT64) IN UNNEST(@refs)
            ), scoped AS (
              SELECT CONCAT('day:', CAST(date AS STRING)) AS scope, * FROM raw_items
              UNION ALL
              SELECT period AS scope, r.* FROM raw_items r
              JOIN periods p ON r.date BETWEEN p.start_date AND p.end_date
            ), user_products AS (
              SELECT scope, user_pseudo_id, goods_ref,
                MIN(IF(event_name = 'view_item', event_timestamp, NULL)) AS first_view,
                MAX(IF(event_name = 'add_to_cart', event_timestamp, NULL)) AS last_cart
              FROM scoped GROUP BY scope, user_pseudo_id, goods_ref
            ), user_funnel AS (
              SELECT scope, user_pseudo_id,
                COUNTIF(first_view IS NOT NULL) > 0 AS viewed,
                COUNTIF(first_view IS NOT NULL AND last_cart >= first_view) > 0 AS converted
              FROM user_products GROUP BY scope, user_pseudo_id
            ), funnel AS (
              SELECT scope, COUNTIF(viewed) AS pdp_users, COUNTIF(converted) AS cart_users
              FROM user_funnel GROUP BY scope
            )
            SELECT e.date, e.impressions, e.views, e.carts, f.pdp_users, f.cart_users,
              CONCAT('day:', CAST(e.date AS STRING)) AS scope
            FROM event_counts e LEFT JOIN funnel f ON f.scope = CONCAT('day:', CAST(e.date AS STRING))
            UNION ALL
            SELECT CAST(NULL AS DATE), 0, 0, 0, COALESCE(f.pdp_users, 0), COALESCE(f.cart_users, 0), p.period
            FROM periods p LEFT JOIN funnel f ON f.scope = p.period`,
            params: {
              start: from,
              end: to,
              yearStart: ranges[1][0],
              yearEnd: ranges[1][1],
              monthStart: ranges[2][0],
              monthEnd: ranges[2][1],
              refs,
            },
            location: "EU",
            maximumBytesBilled: "50000000000",
          });
          return result as Row[];
        },
      });
    } catch (error) {
      available = false;
      console.error("[product-overview-period]", error);
    }
  const series = ranges.map(([start, end]) => {
    const byDate = new Map(
      rows.filter((r) => r.date != null).map((r) => [typeof r.date === "string" ? r.date : r.date.value, r]),
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
        newProducts: newByDate.get(date) || 0,
        ctr:
          r && Number(r.impressions) > 0
            ? (Number(r.views) / Number(r.impressions)) * 100
            : null,
        atc: available && Number(r?.pdp_users) > 0
          ? Number(r?.cart_users || 0) / Number(r?.pdp_users) * 100 : null,
        contentScore: null,
        impressions: Number(r?.impressions || 0),
        views: Number(r?.views || 0),
      });
    }
    return points;
  });
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
    atcTotals: Object.fromEntries(["current", "year", "month"].map(scope => {
      const row = rows.find(row => row.scope === scope);
      return [scope, available && Number(row?.pdp_users) > 0
        ? Number(row?.cart_users || 0) / Number(row?.pdp_users) * 100 : null];
    })) as NonNullable<OverviewPeriod["atcTotals"]>,
    analyticsAvailable: available,
    analyticsLoaded: includeAnalytics,
  };
}
