import {ga4Table, trafficFields, acquisition, transaction} from './overview-query.mjs';

export function contentFunnelQuery(project, dataset, periods, {device, source}) {
  const suffix = date => date.replaceAll('-', '');
  const bounds = Object.fromEntries(periods.flatMap(({from,to}, index) => [
    ['from'+index,suffix(from)], ['to'+index,suffix(to)],
  ]));
  const rangeFilter = periods.map((_,index) => `(_TABLE_SUFFIX BETWEEN @from${index} AND @to${index})`).join(' OR ');
  return {
    query: `WITH source_events AS (
      SELECT event_date AS day, event_timestamp AS ts, event_name AS event,
        user_pseudo_id AS visitor,
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key='ga_session_id' LIMIT 1) AS session_id,
        LOWER(device.category) AS device_category, ${trafficFields},
        ${transaction} AS transaction_id,
        (SELECT UPPER(value.string_value) FROM UNNEST(event_params) WHERE key='currency' LIMIT 1) AS currency,
        event_bundle_sequence_id AS bundle_id, batch_event_index AS batch_index, items
      FROM ${ga4Table(project,dataset)}
      WHERE (${rangeFilter})
        AND event_name IN ('view_item','add_to_cart','purchase')
    ), covered_days AS (
      SELECT DISTINCT day FROM source_events
    ), item_events AS (
      SELECT DISTINCT e.* EXCEPT(items), i.*
      FROM source_events e CROSS JOIN UNNEST(ARRAY(
        SELECT AS STRUCT SAFE_CAST(NULLIF(TRIM(item.item_id),'') AS INT64) AS ref,
          IF(e.event='purchase' AND e.currency='UAH' AND COUNTIF(item.item_revenue IS NULL)=0,
            SUM(item.item_revenue), NULL) AS item_revenue
        FROM UNNEST(e.items) item GROUP BY ref
      )) i
      WHERE visitor IS NOT NULL AND session_id IS NOT NULL
    ), period_events AS (
      SELECT p.key AS period, e.*
      FROM item_events e JOIN UNNEST(@periods) p ON e.day BETWEEN p.startDay AND p.endDay
    ), views AS (
      SELECT period, visitor, session_id, ref, COUNT(*) AS views,
        ARRAY_AGG(STRUCT(day, ts, ${acquisition} AS acquisition,
          IF(device_category IN ('mobile','desktop','tablet'),device_category,'other') AS device)
          ORDER BY ts, day, device_category, traffic_source, traffic_medium LIMIT 1)[OFFSET(0)] AS pdp
      FROM period_events WHERE event='view_item'
      GROUP BY period, visitor, session_id, ref
    ), carts AS (
      SELECT period, visitor, session_id, ref, MAX(ts) AS last_cart
      FROM period_events WHERE event='add_to_cart' AND ref > 0
      GROUP BY period, visitor, session_id, ref
    ), purchase_candidates AS (
      SELECT p.period, p.visitor, p.session_id, p.ref, p.transaction_id, p.item_revenue,
        ROW_NUMBER() OVER (
          PARTITION BY p.period, p.ref, p.transaction_id
          ORDER BY p.ts, p.visitor, p.session_id, p.item_revenue DESC
        ) AS duplicate_rank
      FROM period_events p JOIN views v USING(period, visitor, session_id, ref)
      WHERE p.event='purchase' AND p.ref > 0 AND p.ts > v.pdp.ts
    ), purchases AS (
      SELECT period, visitor, session_id, ref,
        COUNTIF(transaction_id IS NOT NULL) AS purchases,
        COUNTIF(transaction_id IS NULL OR item_revenue IS NULL) AS incomplete_revenue,
        SUM(IF(transaction_id IS NOT NULL, item_revenue, NULL)) AS revenue
      FROM purchase_candidates WHERE transaction_id IS NULL OR duplicate_rank=1
      GROUP BY period, visitor, session_id, ref
    )
    SELECT v.period, IF(v.period='current', v.pdp.day, '') AS day, v.ref, COUNT(*) AS sessions, SUM(v.views) AS views,
      COUNTIF(c.last_cart > v.pdp.ts) AS atc,
      COUNTIF(p.visitor IS NOT NULL) AS purchase_sessions, SUM(IFNULL(p.purchases,0)) AS purchases,
      SUM(IFNULL(p.incomplete_revenue,0)) AS incomplete_revenue, SUM(IFNULL(p.revenue,0)) AS revenue
    FROM views v LEFT JOIN carts c USING(period, visitor, session_id, ref)
    LEFT JOIN purchases p USING(period, visitor, session_id, ref)
    WHERE (@device='all' OR v.pdp.device=@device) AND (@source='all' OR v.pdp.acquisition=@source)
    GROUP BY v.period, day, v.ref
    UNION ALL
    SELECT 'coverage', day, NULL, 0, 0, 0, 0, 0, 0, 0 FROM covered_days`,
    params:{...bounds,device,source,periods:periods.map(({key,from,to})=>({key,startDay:suffix(from),endDay:suffix(to)}))},
    maximumBytesBilled:'20000000000',useQueryCache:true,jobTimeoutMs:60000,location:'EU',
  };
}

export async function readContentFunnel(run, project, dataset, periods, selection) {
  try { return await run(contentFunnelQuery(project,dataset,periods,selection)); }
  catch (error) {
    if (periods.length < 2 || !error.errors?.some(row => row.reason === 'bytesBilledLimitExceeded')) throw error;
    // Keep complete SKU-session windows intact when the two scans exceed the cap.
    for (const period of periods) await run(contentFunnelQuery(project,dataset,[period],selection));
  }
}
