import { BigQuery } from "@google-cloud/bigquery";
import {
  bigQueryCacheDay,
  readThroughBigQueryCache,
} from "@/lib/bigquery-result-cache";

export type SalesWebMetricMonth = {
  month: string;
  visits: number;
  carts: number;
  cartItems: number;
  avgCartItems: number | null;
};

export type SalesWebMetricsDataset = {
  filter: {
    from: string;
    to: string;
    country: "Ukraine";
  };
  definition: {
    visits: string;
    averageCartItems: string;
  };
  dataThrough: string | null;
  months: SalesWebMetricMonth[];
  totals: {
    visits: number;
    carts: number;
    cartItems: number;
    avgCartItems: number | null;
  };
};

type QueryRow = {
  month: string | { value?: string } | null;
  visits: number | string | null;
  carts: number | string | null;
  cart_items: number | string | null;
  avg_cart_items: number | string | null;
  data_through: string | { value?: string } | null;
};

function projectId() {
  return process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413";
}

function datasetId() {
  return process.env.BIGQUERY_DATASET_ID || "analytics_321347682";
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Некоректна дата");
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Некоректна дата");
  }
  return date;
}

function normalizeRange(from: string, to: string) {
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);
  const days = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (days < 1) throw new Error("Дата початку має бути раніше дати завершення");
  if (days > 366) throw new Error("Максимальний період вебаналітики — 366 днів");
  return { from, to };
}

function scalar(value: number | string | null): number {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function dateScalar(value: QueryRow["month"]): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value.value === "string") return value.value;
  return null;
}

function buildSql() {
  const project = projectId().replace(/`/g, "");
  const dataset = datasetId().replace(/`/g, "");
  return `
WITH calendar AS (
  SELECT month
  FROM UNNEST(GENERATE_DATE_ARRAY(
    DATE_TRUNC(PARSE_DATE('%Y%m%d', @suffixFrom), MONTH),
    DATE_TRUNC(PARSE_DATE('%Y%m%d', @suffixTo), MONTH),
    INTERVAL 1 MONTH
  )) AS month
),
base AS (
  SELECT
    PARSE_DATE('%Y%m%d', event_date) AS event_day,
    event_timestamp,
    event_name,
    user_pseudo_id,
    CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING) AS ga_session_id,
    items
  FROM \`${project}.${dataset}.events_*\`
  WHERE _TABLE_SUFFIX BETWEEN @suffixFrom AND @suffixTo
    AND event_name IN ('session_start', 'begin_checkout')
    AND geo.country = 'Ukraine'
),
visits AS (
  SELECT
    DATE_TRUNC(event_day, MONTH) AS month,
    COUNT(DISTINCT CONCAT(
      user_pseudo_id,
      '/',
      COALESCE(ga_session_id, CAST(event_timestamp AS STRING))
    )) AS visits
  FROM base
  WHERE event_name = 'session_start'
    AND user_pseudo_id IS NOT NULL
  GROUP BY month
),
cart_events AS (
  SELECT
    DATE_TRUNC(event_day, MONTH) AS month,
    event_timestamp,
    user_pseudo_id,
    SUM(COALESCE(item.quantity, 1)) AS cart_items
  FROM base
  CROSS JOIN UNNEST(items) AS item
  WHERE event_name = 'begin_checkout'
  GROUP BY month, event_timestamp, user_pseudo_id
),
carts AS (
  SELECT
    month,
    COUNT(*) AS carts,
    SUM(cart_items) AS cart_items,
    AVG(cart_items) AS avg_cart_items
  FROM cart_events
  GROUP BY month
),
freshness AS (
  SELECT MAX(event_day) AS data_through FROM base
)
SELECT
  FORMAT_DATE('%Y-%m', calendar.month) AS month,
  COALESCE(visits.visits, 0) AS visits,
  COALESCE(carts.carts, 0) AS carts,
  COALESCE(carts.cart_items, 0) AS cart_items,
  carts.avg_cart_items,
  FORMAT_DATE('%Y-%m-%d', freshness.data_through) AS data_through
FROM calendar
LEFT JOIN visits USING (month)
LEFT JOIN carts USING (month)
CROSS JOIN freshness
ORDER BY calendar.month
`;
}

export async function readSalesWebMetrics(input: {
  from: string;
  to: string;
}): Promise<SalesWebMetricsDataset> {
  const range = normalizeRange(input.from, input.to);
  const cacheKey = `${range.from}:${range.to}`;
  const rows = await readThroughBigQueryCache<QueryRow[]>({
    namespace: "sales-web-metrics",
    key: `v1:${bigQueryCacheDay()}:${projectId()}:${datasetId()}:${cacheKey}`,
    load: async () => {
      const bigQuery = new BigQuery({ projectId: projectId() });
      const [queryRows] = await bigQuery.query({
        query: buildSql(),
        params: {
          suffixFrom: range.from.replaceAll("-", ""),
          suffixTo: range.to.replaceAll("-", ""),
        },
        location: "EU",
        maximumBytesBilled: "50000000000",
      });
      return queryRows as QueryRow[];
    },
  });
  const months = rows.map((row): SalesWebMetricMonth => ({
    month: dateScalar(row.month) || "",
    visits: scalar(row.visits),
    carts: scalar(row.carts),
    cartItems: scalar(row.cart_items),
    avgCartItems: row.avg_cart_items == null ? null : scalar(row.avg_cart_items),
  }));
  const totals = months.reduce(
    (summary, month) => ({
      visits: summary.visits + month.visits,
      carts: summary.carts + month.carts,
      cartItems: summary.cartItems + month.cartItems,
      avgCartItems: null,
    }),
    { visits: 0, carts: 0, cartItems: 0, avgCartItems: null as number | null },
  );
  totals.avgCartItems = totals.carts > 0 ? totals.cartItems / totals.carts : null;
  const value: SalesWebMetricsDataset = {
    filter: { ...range, country: "Ukraine" },
    definition: {
      visits: "Унікальні GA4-сесії (session_start)",
      averageCartItems: "Середня сума item.quantity у події begin_checkout",
    },
    dataThrough: dateScalar(rows[0]?.data_through ?? null),
    months,
    totals,
  };
  return value;
}
