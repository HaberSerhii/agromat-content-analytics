// Shared by the initial cube build and the incremental background refresh.
export function cpoCubeSql(project, dataset, incremental = false) {
  if (![project, dataset].every(value => /^[a-zA-Z0-9_-]+$/.test(value))) throw new Error("Invalid BigQuery identifier");
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
${incremental ? "WHERE CONCAT(period_kind, '-', CAST(period_year AS STRING), '-', CAST(period_number AS STRING)) IN UNNEST(@periodKeys)" : ""}
GROUP BY period_kind, period_year, period_number, dimension_name, dimension_value
ORDER BY period_kind, period_year, period_number, dimension_name, sessions DESC
`;
}
