import { BigQuery } from "@google-cloud/bigquery";
import { currentKyivIdentity, isoWeekStart } from "./periods";
import { readCpoCube, saveCpoCube } from "./store";
import type { CpoAnalyticsCube, CpoCubeRow, CpoDimension, CpoPeriodKind } from "./types";

const COUNTRY = "Ukraine" as const;
const MAXIMUM_BYTES_BILLED = "100000000000";

type MetadataRow = {
  data_from: string | { value?: string } | null;
  data_to: string | { value?: string } | null;
};

type QueryRow = {
  period_kind: CpoPeriodKind;
  period_year: number | string;
  period_number: number | string;
  dimension_name: CpoDimension;
  dimension_value: string | null;
  users: number | string | null;
  sessions: number | string | null;
  view_item_sessions: number | string | null;
  add_to_cart_sessions: number | string | null;
  begin_checkout_sessions: number | string | null;
  purchase_sessions: number | string | null;
  orders: number | string | null;
  revenue: number | string | null;
  view_item_events: number | string | null;
  add_to_cart_events: number | string | null;
  begin_checkout_events: number | string | null;
  purchase_events: number | string | null;
};

function cleanIdentifier(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Некоректний BigQuery identifier");
  return value;
}

function projectId(): string {
  return cleanIdentifier(process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413");
}

function datasetId(): string {
  return cleanIdentifier(process.env.BIGQUERY_DATASET_ID || "analytics_321347682");
}

function scalar(value: number | string | null): number {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function dateScalar(value: MetadataRow["data_from"]): string | null {
  if (typeof value === "string") return value.slice(0, 10);
  return value?.value?.slice(0, 10) || null;
}

function sql(project: string, dataset: string): string {
  return `
WITH raw AS (
  SELECT
    PARSE_DATE('%Y%m%d', event_date) AS event_day,
    event_timestamp,
    event_name,
    user_pseudo_id,
    CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING) AS ga_session_id,
    LOWER(NULLIF(device.category, '')) AS device_category,
    NULLIF(geo.city, '') AS city,
    LOWER(NULLIF(COALESCE(collected_traffic_source.manual_source, traffic_source.source), '')) AS traffic_source_name,
    LOWER(NULLIF(COALESCE(collected_traffic_source.manual_medium, traffic_source.medium), '')) AS traffic_medium,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page_location,
    NULLIF(COALESCE(ecommerce.transaction_id, (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'transaction_id')), '') AS transaction_id,
    COALESCE(
      ecommerce.purchase_revenue,
      (SELECT COALESCE(value.double_value, value.float_value, CAST(value.int_value AS FLOAT64)) FROM UNNEST(event_params) WHERE key = 'value'),
      0
    ) AS purchase_revenue
  FROM \`${project}.${dataset}.events_*\`
  WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix
    AND geo.country = @country
    AND user_pseudo_id IS NOT NULL
    AND event_name IN ('session_start', 'page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase')
),
identified AS (
  SELECT
    *,
    CONCAT(user_pseudo_id, '/', COALESCE(ga_session_id, CONCAT('event-', CAST(event_timestamp AS STRING)))) AS session_key,
    COALESCE(transaction_id, CONCAT('event-', user_pseudo_id, '-', CAST(event_timestamp AS STRING))) AS purchase_key
  FROM raw
),
events AS (
  SELECT *
  FROM identified
  QUALIFY event_name != 'purchase'
    OR ROW_NUMBER() OVER (PARTITION BY purchase_key ORDER BY event_timestamp) = 1
),
session_facts AS (
  SELECT
    session_key,
    ANY_VALUE(user_pseudo_id HAVING MIN event_timestamp) AS user_pseudo_id,
    MIN(event_day) AS session_day,
    ARRAY_AGG(device_category IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS device_category,
    ARRAY_AGG(city IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS city,
    ARRAY_AGG(traffic_source_name IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS source_name,
    ARRAY_AGG(traffic_medium IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS medium_name,
    ARRAY_AGG(
      IF(event_name = 'page_view',
        REGEXP_REPLACE(REGEXP_REPLACE(LOWER(SPLIT(page_location, '?')[SAFE_OFFSET(0)]), r'^https?://(www\\.)?agromat\\.ua', ''), r'/+$', ''),
        NULL
      ) IGNORE NULLS ORDER BY event_timestamp LIMIT 1
    )[SAFE_OFFSET(0)] AS landing_page,
    COUNTIF(event_name = 'session_start') AS session_start_events,
    COUNTIF(event_name = 'view_item') AS view_item_events,
    COUNTIF(event_name = 'add_to_cart') AS add_to_cart_events,
    COUNTIF(event_name = 'begin_checkout') AS begin_checkout_events,
    COUNTIF(event_name = 'purchase') AS purchase_events,
    COUNT(DISTINCT IF(event_name = 'purchase', purchase_key, NULL)) AS orders,
    SUM(IF(event_name = 'purchase', purchase_revenue, 0)) AS revenue
  FROM events
  GROUP BY session_key
),
periodized AS (
  SELECT session_facts.*, period.*
  FROM session_facts
  CROSS JOIN UNNEST([
    STRUCT('week' AS period_kind, EXTRACT(ISOYEAR FROM session_day) AS period_year, EXTRACT(ISOWEEK FROM session_day) AS period_number),
    STRUCT('month' AS period_kind, EXTRACT(YEAR FROM session_day) AS period_year, EXTRACT(MONTH FROM session_day) AS period_number)
  ]) AS period
),
segmented AS (
  SELECT periodized.*, segment.*
  FROM periodized
  CROSS JOIN UNNEST([
    STRUCT('overall' AS dimension_name, 'all' AS dimension_value),
    STRUCT('device' AS dimension_name, COALESCE(device_category, '(not set)') AS dimension_value),
    STRUCT('source_medium' AS dimension_name, CONCAT(COALESCE(source_name, '(direct)'), ' / ', COALESCE(medium_name, '(none)')) AS dimension_value),
    STRUCT('city' AS dimension_name, COALESCE(city, '(not set)') AS dimension_value),
    STRUCT('landing_page' AS dimension_name, COALESCE(NULLIF(landing_page, ''), '/') AS dimension_value)
  ]) AS segment
)
SELECT
  period_kind,
  period_year,
  period_number,
  dimension_name,
  dimension_value,
  APPROX_COUNT_DISTINCT(IF(session_start_events > 0, user_pseudo_id, NULL)) AS users,
  COUNTIF(session_start_events > 0) AS sessions,
  COUNTIF(view_item_events > 0) AS view_item_sessions,
  COUNTIF(add_to_cart_events > 0) AS add_to_cart_sessions,
  COUNTIF(begin_checkout_events > 0) AS begin_checkout_sessions,
  COUNTIF(purchase_events > 0) AS purchase_sessions,
  SUM(orders) AS orders,
  SUM(revenue) AS revenue,
  SUM(view_item_events) AS view_item_events,
  SUM(add_to_cart_events) AS add_to_cart_events,
  SUM(begin_checkout_events) AS begin_checkout_events,
  SUM(purchase_events) AS purchase_events
FROM segmented
GROUP BY period_kind, period_year, period_number, dimension_name, dimension_value
ORDER BY period_kind, period_year, period_number, dimension_name, sessions DESC
`;
}

async function metadata(client: BigQuery, project: string, dataset: string, location: string): Promise<{ dataFrom: string; dataTo: string }> {
  const [rows] = await client.query({
    query: `
      SELECT
        FORMAT_DATE('%Y-%m-%d', MIN(SAFE.PARSE_DATE('%Y%m%d', REGEXP_EXTRACT(table_name, r'^events_(\\d{8})$')))) AS data_from,
        FORMAT_DATE('%Y-%m-%d', MAX(SAFE.PARSE_DATE('%Y%m%d', REGEXP_EXTRACT(table_name, r'^events_(\\d{8})$')))) AS data_to
      FROM \`${project}.${dataset}.INFORMATION_SCHEMA.TABLES\`
      WHERE REGEXP_CONTAINS(table_name, r'^events_\\d{8}$')
    `,
    location,
  });
  const row = (rows as MetadataRow[])[0];
  const availableFrom = dateScalar(row?.data_from);
  const dataTo = dateScalar(row?.data_to);
  if (!availableFrom || !dataTo) throw new Error("У dataset не знайдено денні GA4 tables");
  const requestedFrom = isoWeekStart(currentKyivIdentity().year - 1, 1);
  return { dataFrom: availableFrom > requestedFrom ? availableFrom : requestedFrom, dataTo };
}

async function context() {
  const project = projectId();
  const dataset = datasetId();
  const client = new BigQuery({ projectId: project });
  const [datasetMetadata] = await client.dataset(dataset).getMetadata();
  const location = typeof datasetMetadata.location === "string" ? datasetMetadata.location : "EU";
  const range = await metadata(client, project, dataset, location);
  const options = {
    query: sql(project, dataset),
    params: { fromSuffix: range.dataFrom.replaceAll("-", ""), toSuffix: range.dataTo.replaceAll("-", ""), country: COUNTRY },
    location,
    maximumBytesBilled: MAXIMUM_BYTES_BILLED,
    useQueryCache: true,
  };
  return { project, dataset, client, location, range, options };
}

export async function estimateCpoCubeBytes(): Promise<number> {
  const { client, options } = await context();
  const [job] = await client.createQueryJob({ ...options, dryRun: true });
  return scalar(job.metadata.statistics?.query?.totalBytesProcessed || null);
}

export async function buildCpoCube(): Promise<{ cube: CpoAnalyticsCube; compressedBytes: number }> {
  const existing = await readCpoCube();
  if (existing) return existing;
  const { project, dataset, client, location, range, options } = await context();
  const [job] = await client.createQueryJob(options);
  // Fetch in bounded pages. The cube can contain many distinct landing pages
  // and cities; relying on the client's automatic pagination may keep the
  // request open indefinitely while materialising all rows at once.
  const queryRows: QueryRow[] = [];
  let pageToken: string | undefined;
  let jobComplete = false;
  do {
    const [page, nextQuery, response] = await job.getQueryResults({
      autoPaginate: false,
      maxResults: 10000,
      ...(pageToken ? { pageToken } : {}),
    });
    queryRows.push(...(page as QueryRow[]));
    pageToken = nextQuery?.pageToken;
    jobComplete = response?.jobComplete !== false;
    if (!jobComplete && !pageToken) await new Promise((resolve) => setTimeout(resolve, 1500));
  } while (pageToken || !jobComplete);
  if (queryRows.length === 0) throw new Error("BigQuery returned an empty CPO result");
  const [jobMetadata] = await job.getMetadata();
  const rows = (queryRows as QueryRow[]).map((row): CpoCubeRow => ({
    periodKind: row.period_kind,
    periodYear: scalar(row.period_year),
    periodNumber: scalar(row.period_number),
    dimension: row.dimension_name,
    dimensionValue: String(row.dimension_value || "(not set)"),
    users: scalar(row.users),
    sessions: scalar(row.sessions),
    viewItemSessions: scalar(row.view_item_sessions),
    addToCartSessions: scalar(row.add_to_cart_sessions),
    beginCheckoutSessions: scalar(row.begin_checkout_sessions),
    purchaseSessions: scalar(row.purchase_sessions),
    orders: scalar(row.orders),
    revenue: scalar(row.revenue),
    viewItemEvents: scalar(row.view_item_events),
    addToCartEvents: scalar(row.add_to_cart_events),
    beginCheckoutEvents: scalar(row.begin_checkout_events),
    purchaseEvents: scalar(row.purchase_events),
  }));
  const cube: CpoAnalyticsCube = {
    version: 1,
    countryFilter: COUNTRY,
    savedAt: new Date().toISOString(),
    projectId: project,
    datasetId: dataset,
    datasetLocation: location,
    dataFrom: range.dataFrom,
    dataTo: range.dataTo,
    bytesProcessed: scalar(jobMetadata.statistics?.query?.totalBytesProcessed || null),
    rows,
  };
  return { cube, compressedBytes: await saveCpoCube(cube) };
}
