import { BigQuery } from "@google-cloud/bigquery";
import {
  bigQueryCacheDay,
  readThroughBigQueryCache,
} from "@/lib/bigquery-result-cache";
import type {
  PromotionWebFunnelResponse,
  WebFunnelChannel,
  WebFunnelComparison,
  WebFunnelDevice,
  WebFunnelPeriod,
  WebFunnelPeriodKind,
  WebFunnelStage,
  WebFunnelStageKey,
} from "@/lib/promotion-web-funnel-types";

const CHANNELS: WebFunnelChannel[] = ["all", "organic", "cpc", "direct"];
const DEVICES: WebFunnelDevice[] = ["all", "mobile", "desktop"];
const STAGES: Array<{ key: WebFunnelStageKey; label: string; order: number }> = [
  { key: "landing", label: "Старт", order: 1 },
  { key: "view_item", label: "Перегляд картки товару", order: 2 },
  { key: "cart", label: "Кошик", order: 3 },
  { key: "begin_checkout", label: "Checkout", order: 4 },
  { key: "purchase", label: "Замовлення", order: 5 },
];

type PeriodKey = "current" | "previous" | "yearAgo";

type PeriodRange = {
  key: PeriodKey;
  from: string;
  to: string;
  label: string;
  shortLabel: string;
};

type QueryRow = {
  period_key: PeriodKey;
  channel: WebFunnelChannel;
  device: WebFunnelDevice;
  stage_key: WebFunnelStageKey;
  users: number | string | null;
};

function getBigQueryProjectId(): string {
  return process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413";
}

function getBigQueryDatasetId(): string {
  return process.env.BIGQUERY_DATASET_ID || "analytics_321347682";
}

function getBigQueryClient(): BigQuery {
  return new BigQuery({
    projectId: getBigQueryProjectId(),
  });
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Некоректна дата");
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Некоректна дата");
  if (isoDate(date) !== value) throw new Error("Некоректна дата");
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function shiftYears(value: string, years: number): string {
  const date = parseIsoDate(value);
  const targetYear = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(targetYear, month + 1, 0, 12)).getUTCDate();
  return isoDate(new Date(Date.UTC(targetYear, month, Math.min(day, lastDay), 12)));
}

function inclusiveDays(from: string, to: string): number {
  return Math.floor((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000) + 1;
}

function startOfWeek(value: string): string {
  const date = parseIsoDate(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return isoDate(date);
}

function startOfMonth(value: string): string {
  const date = parseIsoDate(value);
  date.setUTCDate(1);
  return isoDate(date);
}

function shiftMonths(value: string, months: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  return isoDate(date);
}

function endOfMonth(value: string): string {
  const date = parseIsoDate(value);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return isoDate(date);
}

function currentKyivDate(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isoWeekNumber(value: string): { week: number; year: number } {
  const date = parseIsoDate(value);
  const target = new Date(date);
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1, 12));
  return {
    week: Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7),
    year: target.getUTCFullYear(),
  };
}

function formatRangeDate(value: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseIsoDate(value));
}

function periodLabel(
  kind: WebFunnelPeriodKind,
  from: string,
  to = from,
): { label: string; shortLabel: string } {
  if (kind === "week") {
    const { week, year } = isoWeekNumber(from);
    return {
      label: `Тиждень ${week} (${year})`,
      shortLabel: `Тиждень ${week}`,
    };
  }
  if (kind === "custom") {
    return {
      label: `${formatRangeDate(from)} – ${formatRangeDate(to)}`,
      shortLabel: `${formatRangeDate(from)} – ${formatRangeDate(to)}`,
    };
  }
  const date = parseIsoDate(from);
  const label = new Intl.DateTimeFormat("uk-UA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return {
    label: label.charAt(0).toUpperCase() + label.slice(1),
    shortLabel: new Intl.DateTimeFormat("uk-UA", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(date),
  };
}

function periodRanges(
  kind: WebFunnelPeriodKind,
  anchor?: string,
  customFrom?: string,
  customTo?: string,
): {
  ranges: PeriodRange[];
  previousAnchor: string;
  nextAnchor: string;
  canGoNext: boolean;
} {
  const today = currentKyivDate();
  let currentFrom: string;
  let currentTo: string;
  let previousFrom: string;
  let previousTo: string;
  let yearAgoFrom: string;
  let yearAgoTo: string;
  let nextAnchor: string;

  if (kind === "custom") {
    if (!customFrom || !customTo) throw new Error("Оберіть початок і кінець періоду");
    currentFrom = isoDate(parseIsoDate(customFrom));
    currentTo = isoDate(parseIsoDate(customTo));
    const days = inclusiveDays(currentFrom, currentTo);
    if (days < 1) throw new Error("Дата початку має бути раніше дати завершення");
    if (days > 366) throw new Error("Максимальний період — 366 днів");
    if (currentTo >= today) throw new Error("Оберіть завершений період не пізніше вчорашнього дня");
    previousTo = shiftDays(currentFrom, -1);
    previousFrom = shiftDays(previousTo, -(days - 1));
    yearAgoFrom = shiftYears(currentFrom, -1);
    yearAgoTo = shiftYears(currentTo, -1);
    nextAnchor = currentFrom;
  } else if (kind === "week") {
    const latestCompleteFrom = shiftDays(startOfWeek(today), -7);
    currentFrom = anchor ? startOfWeek(anchor) : latestCompleteFrom;
    currentTo = shiftDays(currentFrom, 6);
    previousFrom = shiftDays(currentFrom, -7);
    previousTo = shiftDays(currentTo, -7);
    yearAgoFrom = shiftDays(currentFrom, -364);
    yearAgoTo = shiftDays(currentTo, -364);
    nextAnchor = shiftDays(currentFrom, 7);
  } else {
    const latestCompleteFrom = shiftMonths(startOfMonth(today), -1);
    currentFrom = anchor ? startOfMonth(anchor) : latestCompleteFrom;
    currentTo = endOfMonth(currentFrom);
    previousFrom = shiftMonths(currentFrom, -1);
    previousTo = endOfMonth(previousFrom);
    yearAgoFrom = shiftMonths(currentFrom, -12);
    yearAgoTo = endOfMonth(yearAgoFrom);
    nextAnchor = shiftMonths(currentFrom, 1);
  }

  const range = (key: PeriodKey, from: string, to: string): PeriodRange => ({
    key,
    from,
    to,
    ...periodLabel(kind, from, to),
  });

  const latestCompleteFrom = kind === "week"
    ? shiftDays(startOfWeek(today), -7)
    : kind === "month"
      ? shiftMonths(startOfMonth(today), -1)
      : currentFrom;

  return {
    ranges: [
      range("current", currentFrom, currentTo),
      range("previous", previousFrom, previousTo),
      range("yearAgo", yearAgoFrom, yearAgoTo),
    ],
    previousAnchor: previousFrom,
    nextAnchor,
    canGoNext: kind !== "custom" && nextAnchor <= latestCompleteFrom,
  };
}

export function normalizeAnalyticsUrl(value: string): { requestedUrl: string; normalizedUrl: string } {
  const requestedUrl = value.trim();
  if (!requestedUrl) throw new Error("Вкажіть URL сторінки");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(requestedUrl) ? requestedUrl : `https://${requestedUrl}`);
  } catch {
    throw new Error("Некоректний URL сторінки");
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "agromat.ua" && !hostname.endsWith(".agromat.ua")) {
    throw new Error("Дозволені лише сторінки домену agromat.ua");
  }
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  return {
    requestedUrl,
    normalizedUrl: `${hostname}${pathname === "/" ? "" : pathname}`.toLowerCase(),
  };
}

function buildSql(ranges: PeriodRange[], scope: "sitewide" | "page"): string {
  const projectId = getBigQueryProjectId().replace(/`/g, "");
  const datasetId = getBigQueryDatasetId().replace(/`/g, "");
  const suffixFilter = ranges.map((range) =>
    `(_TABLE_SUFFIX BETWEEN '${range.from.replaceAll("-", "")}' AND '${range.to.replaceAll("-", "")}')`
  ).join("\n      OR ");
  const periodRows = ranges.map((range) =>
    `SELECT '${range.key}' AS period_key, DATE '${range.from}' AS date_from, DATE '${range.to}' AS date_to`
  ).join("\nUNION ALL\n");
  const stageCtes = scope === "sitewide"
    ? `
stage_rows AS (
  SELECT
    p.period_key,
    e.channel,
    e.device,
    CASE e.event_name
      WHEN 'session_start' THEN 'landing'
      WHEN 'view_item' THEN 'view_item'
      WHEN 'add_to_cart' THEN 'cart'
      WHEN 'begin_checkout' THEN 'begin_checkout'
      WHEN 'purchase' THEN 'purchase'
    END AS stage_key,
    e.user_pseudo_id
  FROM events e
  JOIN periods p ON e.event_day BETWEEN p.date_from AND p.date_to
  WHERE e.event_name IN ('session_start', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase')
)`
    : `
landing_candidates AS (
  SELECT
    p.period_key,
    e.session_key,
    e.user_pseudo_id,
    e.event_timestamp,
    e.channel,
    e.device
  FROM events e
  JOIN periods p ON e.event_day BETWEEN p.date_from AND p.date_to
  WHERE e.event_name = 'page_view'
    AND e.session_key IS NOT NULL
    AND REGEXP_REPLACE(
      REGEXP_REPLACE(LOWER(SPLIT(e.page_location, '?')[SAFE_OFFSET(0)]), r'^https?://(www\\.)?', ''),
      r'/+$',
      ''
    ) = @normalizedUrl
),
landings AS (
  SELECT
    period_key,
    session_key,
    ANY_VALUE(user_pseudo_id HAVING MIN event_timestamp) AS user_pseudo_id,
    ARRAY_AGG(STRUCT(event_timestamp, channel, device) ORDER BY event_timestamp LIMIT 1)[OFFSET(0)] AS first_landing
  FROM landing_candidates
  GROUP BY period_key, session_key
),
step_landing AS (
  SELECT
    period_key,
    session_key,
    user_pseudo_id,
    first_landing.event_timestamp AS step_ts,
    first_landing.channel AS channel,
    first_landing.device AS device
  FROM landings
),
stage_rows AS (
  SELECT period_key, channel, device, 'landing' AS stage_key, user_pseudo_id
  FROM step_landing

  UNION ALL

  SELECT
    s.period_key,
    s.channel,
    s.device,
    CASE e.event_name
      WHEN 'view_item' THEN 'view_item'
      WHEN 'add_to_cart' THEN 'cart'
      WHEN 'begin_checkout' THEN 'begin_checkout'
      WHEN 'purchase' THEN 'purchase'
    END AS stage_key,
    s.user_pseudo_id
  FROM step_landing s
  JOIN events e USING (session_key)
  WHERE e.event_timestamp >= s.step_ts
    AND e.event_name IN ('view_item', 'add_to_cart', 'begin_checkout', 'purchase')
)`;

  return `
WITH periods AS (
  ${periodRows}
),
base AS (
  SELECT
    PARSE_DATE('%Y%m%d', event_date) AS event_day,
    event_timestamp,
    event_name,
    user_pseudo_id,
    CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING) AS ga_session_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page_location,
    LOWER(COALESCE(collected_traffic_source.manual_source, traffic_source.source, '')) AS traffic_source_name,
    LOWER(COALESCE(collected_traffic_source.manual_medium, traffic_source.medium, '')) AS traffic_medium,
    collected_traffic_source.gclid AS gclid,
    LOWER(device.category) AS device_category
  FROM \`${projectId}.${datasetId}.events_*\`
  WHERE (
      ${suffixFilter}
    )
    AND event_name IN ('session_start', 'page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase')
    AND user_pseudo_id IS NOT NULL
    AND geo.country = 'Ukraine'
),
events AS (
  SELECT
    *,
    IF(ga_session_id IS NULL, NULL, CONCAT(user_pseudo_id, '/', ga_session_id)) AS session_key,
    CASE
      WHEN gclid IS NOT NULL
        OR traffic_medium IN ('cpc', 'ppc', 'paid', 'paid_search', 'paidsearch')
        THEN 'cpc'
      WHEN traffic_medium = 'organic' THEN 'organic'
      WHEN (traffic_source_name IN ('', '(direct)', 'direct')
        AND traffic_medium IN ('', '(none)', 'none', '(not set)'))
        THEN 'direct'
      ELSE 'other'
    END AS channel,
    CASE
      WHEN device_category = 'mobile' THEN 'mobile'
      WHEN device_category = 'desktop' THEN 'desktop'
      ELSE 'other'
    END AS device
  FROM base
),
${stageCtes},
expanded_dimensions AS (
  SELECT
    period_key,
    selected_channel AS channel,
    selected_device AS device,
    stage_key,
    user_pseudo_id
  FROM stage_rows,
  UNNEST([channel, 'all']) AS selected_channel,
  UNNEST([device, 'all']) AS selected_device
)
SELECT
  period_key,
  channel,
  device,
  stage_key,
  COUNT(DISTINCT user_pseudo_id) AS users
FROM expanded_dimensions
WHERE channel IN ('all', 'organic', 'cpc', 'direct')
  AND device IN ('all', 'mobile', 'desktop')
GROUP BY period_key, channel, device, stage_key
ORDER BY period_key, channel, device, stage_key
`;
}

function stageDefinitions(scope: "sitewide" | "page") {
  return STAGES.map((stage) => stage.key === "landing"
    ? { ...stage, label: scope === "sitewide" ? "Старт сеансу" : "Відвідувачі сторінки" }
    : stage);
}

function emptyPeriod(range: PeriodRange, scope: "sitewide" | "page"): WebFunnelPeriod {
  const stages: WebFunnelStage[] = stageDefinitions(scope).map((stage) => ({
    key: stage.key,
    label: stage.label,
    users: 0,
    conversionFromPreviousPct: null,
    conversionFromStartPct: null,
  }));
  return {
    ...range,
    available: false,
    stages,
    startUsers: 0,
    orderUsers: 0,
    conversionRatePct: null,
  };
}

function makePeriod(
  range: PeriodRange,
  values: Map<WebFunnelStageKey, number>,
  scope: "sitewide" | "page",
): WebFunnelPeriod {
  const startUsers = values.get("landing") || 0;
  let previousUsers: number | null = null;
  const stages: WebFunnelStage[] = stageDefinitions(scope).map((stage) => {
    const users = values.get(stage.key) || 0;
    const result: WebFunnelStage = {
      key: stage.key,
      label: stage.label,
      users,
      conversionFromPreviousPct: previousUsers && previousUsers > 0 ? (users / previousUsers) * 100 : null,
      conversionFromStartPct: startUsers > 0 ? (users / startUsers) * 100 : null,
    };
    previousUsers = users;
    return result;
  });
  const orderUsers = values.get("purchase") || 0;
  return {
    ...range,
    available: startUsers > 0,
    stages,
    startUsers,
    orderUsers,
    conversionRatePct: startUsers > 0 ? (orderUsers / startUsers) * 100 : null,
  };
}

export async function readPromotionWebFunnel(input: {
  url: string;
  periodKind: WebFunnelPeriodKind;
  anchor?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<PromotionWebFunnelResponse> {
  const { requestedUrl, normalizedUrl } = normalizeAnalyticsUrl(input.url);
  const scope = normalizedUrl === "agromat.ua" ? "sitewide" : "page";
  const periodKind: WebFunnelPeriodKind = input.periodKind === "month" || input.periodKind === "custom"
    ? input.periodKind
    : "week";
  const periodInfo = periodRanges(periodKind, input.anchor, input.dateFrom, input.dateTo);
  const cacheKey = `${normalizedUrl}:${periodKind}:${periodInfo.ranges[0].from}:${periodInfo.ranges[0].to}`;
  const rows = await readThroughBigQueryCache<QueryRow[]>({
    namespace: "promotion-web-funnel",
    key: `v1:${bigQueryCacheDay()}:${getBigQueryProjectId()}:${getBigQueryDatasetId()}:${cacheKey}`,
    load: async () => {
      const bigQuery = getBigQueryClient();
      const [queryRows] = await bigQuery.query({
        query: buildSql(periodInfo.ranges, scope),
        params: { normalizedUrl },
        location: "EU",
        maximumBytesBilled: "50000000000",
      });
      return queryRows as QueryRow[];
    },
  });

  const values = new Map<string, Map<WebFunnelStageKey, number>>();
  for (const row of rows) {
    const key = `${row.period_key}:${row.device}:${row.channel}`;
    const stageValues = values.get(key) || new Map<WebFunnelStageKey, number>();
    stageValues.set(row.stage_key, Number(row.users || 0));
    values.set(key, stageValues);
  }

  const rangeMap = new Map(periodInfo.ranges.map((range) => [range.key, range]));
  const comparisonsByDevice = Object.fromEntries(DEVICES.map((device) => {
    const channelComparisons = Object.fromEntries(CHANNELS.map((channel) => {
      const period = (key: PeriodKey) => {
        const range = rangeMap.get(key);
        if (!range) throw new Error(`Missing ${key} period`);
        const stageValues = values.get(`${key}:${device}:${channel}`);
        return stageValues ? makePeriod(range, stageValues, scope) : emptyPeriod(range, scope);
      };
      const comparison: WebFunnelComparison = {
        current: period("current"),
        previous: period("previous"),
        yearAgo: period("yearAgo"),
      };
      return [channel, comparison];
    })) as Record<WebFunnelChannel, WebFunnelComparison>;
    return [device, channelComparisons];
  })) as Record<WebFunnelDevice, Record<WebFunnelChannel, WebFunnelComparison>>;
  const comparisons = comparisonsByDevice.all;

  const result: PromotionWebFunnelResponse = {
    requestedUrl,
    normalizedUrl,
    scope,
    countryFilter: "Ukraine",
    periodKind,
    generatedAt: new Date().toISOString(),
    navigation: {
      previousAnchor: periodInfo.previousAnchor,
      nextAnchor: periodInfo.nextAnchor,
      canGoNext: periodInfo.canGoNext,
    },
    comparisons,
    comparisonsByDevice,
  };
  return result;
}
