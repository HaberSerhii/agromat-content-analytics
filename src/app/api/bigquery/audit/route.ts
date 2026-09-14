import { BigQuery } from "@google-cloud/bigquery";
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import type {
  BigQueryAuditCheck,
  BigQueryAuditEvent,
  BigQueryAuditEventMetric,
  BigQueryAuditParameter,
  BigQueryAuditPeriod,
  BigQueryAuditResponse,
} from "@/lib/bigquery-audit-types";

export const dynamic = "force-dynamic";

const MAXIMUM_BYTES_BILLED = "25000000000";
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

type StoredAudit = {
  version: 1;
  savedAt: string;
  value: BigQueryAuditResponse;
};

type TableRow = {
  table_count: number | string | null;
  data_from: string | { value?: string } | null;
  data_to: string | { value?: string } | null;
};

type EventRow = {
  period_key: "current" | "previous" | "yearAgo";
  event_name: string | null;
  events: number | string | null;
  users: number | string | null;
  sessions: number | string | null;
  days_active: number | string | null;
  first_seen: string | { value?: string } | null;
  last_seen: string | { value?: string } | null;
};

type ParameterRow = {
  event_name: string | null;
  parameter_key: string | null;
  occurrences: number | string | null;
  populated: number | string | null;
  string_values: number | string | null;
  integer_values: number | string | null;
  float_values: number | string | null;
  double_values: number | string | null;
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

function auditRoot(): string {
  if (process.env.BIGQUERY_AUDIT_DIR) return process.env.BIGQUERY_AUDIT_DIR;
  if (process.env.BIGQUERY_RESULT_CACHE_DIR) {
    return path.join(path.dirname(process.env.BIGQUERY_RESULT_CACHE_DIR), "bigquery-audits");
  }
  if (process.env.PRODUCT_SNAPSHOTS_DIR) {
    return path.join(path.dirname(process.env.PRODUCT_SNAPSHOTS_DIR), "bigquery-audits");
  }
  return path.join(process.cwd(), "data", "bigquery-audits");
}

function auditFile(kind: "week" | "month", year: number, period: number): string {
  return path.join(auditRoot(), String(year), `${kind}-${String(period).padStart(2, "0")}.json.gz`);
}

async function readStoredAudit(kind: "week" | "month", year: number, period: number): Promise<BigQueryAuditResponse | null> {
  try {
    const file = auditFile(kind, year, period);
    const [raw, stat] = await Promise.all([gunzip(await fs.readFile(file)), fs.stat(file)]);
    const stored = JSON.parse(raw.toString("utf8")) as StoredAudit;
    if (stored.version !== 1 || !stored.value) return null;
    return {
      ...stored.value,
      storage: { source: "saved", savedAt: stored.savedAt, compressedBytes: stat.size },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[bigquery-audit] failed to read saved audit:", error);
    }
    return null;
  }
}

async function saveAudit(value: BigQueryAuditResponse): Promise<BigQueryAuditResponse> {
  const file = auditFile(value.periodKind, value.selectedYear, value.selectedPeriod);
  const savedAt = new Date().toISOString();
  const stored: StoredAudit = { version: 1, savedAt, value };
  const compressed = await gzip(JSON.stringify(stored), { level: 6 });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, compressed, { mode: 0o600 });
  await fs.rename(temporary, file);
  return {
    ...value,
    storage: { source: "bigquery", savedAt, compressedBytes: compressed.byteLength },
  };
}

function numberValue(value: number | string | null | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: string | { value?: string } | null | undefined): string | null {
  if (typeof value === "string") return value.slice(0, 10);
  return value?.value?.slice(0, 10) || null;
}

function shiftDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function currentKyivDate(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isoWeekNumber(value: string): number {
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1, 12));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function weeksInIsoYear(year: number): number {
  return isoWeekNumber(`${year}-12-28`);
}

function isoWeekStart(year: number, week: number): string {
  const januaryFourth = new Date(Date.UTC(year, 0, 4, 12));
  const day = januaryFourth.getUTCDay() || 7;
  januaryFourth.setUTCDate(januaryFourth.getUTCDate() - day + 1 + (week - 1) * 7);
  return januaryFourth.toISOString().slice(0, 10);
}

type AuditRange = { key: "current" | "previous" | "yearAgo"; label: string; from: string; to: string };

function requestedRanges(kind: "week" | "month", value: number, year: number): AuditRange[] {
  if (kind === "week") {
    if (value < 1 || value > weeksInIsoYear(year)) throw new Error("Некоректний номер тижня");
    const currentFrom = isoWeekStart(year, value);
    const previousFrom = shiftDays(currentFrom, -7);
    const yearAgoWeek = Math.min(value, weeksInIsoYear(year - 1));
    const yearAgoFrom = isoWeekStart(year - 1, yearAgoWeek);
    return [
      { key: "current", label: `Тиждень ${value}, ${year}`, from: currentFrom, to: shiftDays(currentFrom, 6) },
      { key: "previous", label: "Попередній тиждень", from: previousFrom, to: shiftDays(previousFrom, 6) },
      { key: "yearAgo", label: `Тиждень ${yearAgoWeek}, ${year - 1}`, from: yearAgoFrom, to: shiftDays(yearAgoFrom, 6) },
    ];
  }
  if (value < 1 || value > 12) throw new Error("Некоректний номер місяця");
  const monthRange = (targetYear: number, targetMonth: number) => {
    const from = `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`;
    const to = new Date(Date.UTC(targetYear, targetMonth, 0, 12)).toISOString().slice(0, 10);
    return { from, to };
  };
  const current = monthRange(year, value);
  const previous = value === 1 ? monthRange(year - 1, 12) : monthRange(year, value - 1);
  const yearAgo = monthRange(year - 1, value);
  const monthLabel = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" });
  return [
    { key: "current", label: monthLabel.format(new Date(`${current.from}T12:00:00Z`)), ...current },
    { key: "previous", label: monthLabel.format(new Date(`${previous.from}T12:00:00Z`)), ...previous },
    { key: "yearAgo", label: monthLabel.format(new Date(`${yearAgo.from}T12:00:00Z`)), ...yearAgo },
  ];
}

function equalizeRanges(ranges: AuditRange[], dataTo: string): AuditRange[] {
  const current = ranges[0];
  if (current.from > dataTo) throw new Error("За обраний період ще немає завершених даних GA4");
  const currentTo = current.to > dataTo ? dataTo : current.to;
  const elapsedDays = Math.floor((new Date(`${currentTo}T12:00:00Z`).getTime() - new Date(`${current.from}T12:00:00Z`).getTime()) / 86_400_000);
  return ranges.map((range, index) => ({
    ...range,
    to: index === 0 ? currentTo : shiftDays(range.from, elapsedDays),
  }));
}

function valueType(row: ParameterRow): BigQueryAuditParameter["valueType"] {
  const types = [
    ["string", numberValue(row.string_values)],
    ["integer", numberValue(row.integer_values)],
    ["float", numberValue(row.float_values)],
    ["double", numberValue(row.double_values)],
  ] as const;
  return [...types].sort((left, right) => right[1] - left[1])[0]?.[1] > 0
    ? [...types].sort((left, right) => right[1] - left[1])[0][0]
    : "unknown";
}

function auditChecks(events: BigQueryAuditEvent[], parameters: BigQueryAuditParameter[]): BigQueryAuditCheck[] {
  const eventNames = new Set(events.filter((event) => event.current.events > 0).map((event) => event.name));
  const paramsByEvent = new Map<string, Set<string>>();
  for (const parameter of parameters) {
    const keys = paramsByEvent.get(parameter.eventName) || new Set<string>();
    keys.add(parameter.key);
    paramsByEvent.set(parameter.eventName, keys);
  }
  const eventCheck = (eventKeys: string | string[], label: string, parameterKeys: string[] = []): BigQueryAuditCheck => {
    const candidates = Array.isArray(eventKeys) ? eventKeys : [eventKeys];
    const key = candidates.find((candidate) => eventNames.has(candidate)) || candidates[0];
    if (!eventNames.has(key)) {
      return { key: candidates.join(" / "), label, status: "missing", detail: "Подію не знайдено у вибраному періоді" };
    }
    const present = paramsByEvent.get(key) || new Set<string>();
    const missing = parameterKeys.filter((parameter) => !present.has(parameter));
    if (missing.length) {
      return { key, label, status: "warning", detail: `Подія є, але не знайдено параметри: ${missing.join(", ")}` };
    }
    return { key, label, status: "ok", detail: "Подія та очікувані параметри присутні" };
  };
  return [
    eventCheck("page_view", "Сторінки", ["page_location"]),
    eventCheck("view_item_list", "Покази товарів"),
    eventCheck("select_item", "Кліки по товарах"),
    eventCheck("view_item", "Перегляди карток"),
    eventCheck("add_to_cart", "Додавання в кошик"),
    eventCheck("begin_checkout", "Початок оформлення"),
    eventCheck("purchase", "Покупки"),
    eventCheck(["view_search_results", "view_search_result"], "Пошук", ["search_term"]),
    eventCheck("filter_click", "Фільтри", ["filter_name", "filter_category", "filter_value"]),
    eventCheck("menu_click", "Кліки каталогу", ["menu_category1", "menu_category2", "menu_category3"]),
  ];
}

export async function POST(request: Request) {
  if (!isDashboardRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = await request.json().catch(() => ({})) as { periodKind?: "week" | "month"; period?: number; refresh?: boolean };
    const today = currentKyivDate();
    const selectedYear = Number(today.slice(0, 4));
    const periodKind = input.periodKind === "month" ? "month" : "week";
    const defaultPeriod = periodKind === "month" ? Number(today.slice(5, 7)) : isoWeekNumber(today);
    const selectedPeriod = Math.round(Number(input.period || defaultPeriod));
    if (!input.refresh) {
      const saved = await readStoredAudit(periodKind, selectedYear, selectedPeriod);
      if (saved) return NextResponse.json(saved);
    }
    const project = projectId();
    const dataset = datasetId();
    const bigQuery = new BigQuery({ projectId: project });
    const [metadata] = await bigQuery.dataset(dataset).getMetadata();
    const location = typeof metadata.location === "string" ? metadata.location : "EU";
    const [tableRows] = await bigQuery.query({
      query: `
        SELECT
          COUNT(*) AS table_count,
          FORMAT_DATE('%Y-%m-%d', MIN(SAFE.PARSE_DATE('%Y%m%d', REGEXP_EXTRACT(table_name, r'^events_(\\d{8})$')))) AS data_from,
          FORMAT_DATE('%Y-%m-%d', MAX(SAFE.PARSE_DATE('%Y%m%d', REGEXP_EXTRACT(table_name, r'^events_(\\d{8})$')))) AS data_to
        FROM \`${project}.${dataset}.INFORMATION_SCHEMA.TABLES\`
        WHERE REGEXP_CONTAINS(table_name, r'^events_(intraday_)?\\d{8}$')
      `,
      location,
      maximumBytesBilled: MAXIMUM_BYTES_BILLED,
    });
    const tableInfo = (tableRows as TableRow[])[0];
    const dataFrom = dateValue(tableInfo?.data_from);
    const dataTo = dateValue(tableInfo?.data_to);
    if (!dataTo) throw new Error("У dataset не знайдено денні таблиці GA4 events_YYYYMMDD");
    const ranges = equalizeRanges(requestedRanges(periodKind, selectedPeriod, selectedYear), dataTo);
    const currentRange = ranges[0];
    const suffixFilter = ranges.map((range) => `(_TABLE_SUFFIX BETWEEN '${range.from.replaceAll("-", "")}' AND '${range.to.replaceAll("-", "")}')`).join(" OR ");
    const periodRows = ranges.map((range) => `SELECT '${range.key}' AS period_key, DATE '${range.from}' AS date_from, DATE '${range.to}' AS date_to`).join(" UNION ALL ");

    const [eventJob] = await bigQuery.createQueryJob({
      query: `
        WITH periods AS (${periodRows}),
        base AS (
          SELECT *, PARSE_DATE('%Y%m%d', event_date) AS event_day
          FROM \`${project}.${dataset}.events_*\`
          WHERE ${suffixFilter}
        )
        SELECT
          period_key,
          event_name,
          COUNT(*) AS events,
          APPROX_COUNT_DISTINCT(user_pseudo_id) AS users,
          APPROX_COUNT_DISTINCT(CONCAT(user_pseudo_id, '/', COALESCE(CAST((
            SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id'
          ) AS STRING), CAST(event_timestamp AS STRING)))) AS sessions,
          COUNT(DISTINCT event_date) AS days_active,
          FORMAT_DATE('%Y-%m-%d', MIN(PARSE_DATE('%Y%m%d', event_date))) AS first_seen,
          FORMAT_DATE('%Y-%m-%d', MAX(PARSE_DATE('%Y%m%d', event_date))) AS last_seen
        FROM base
        JOIN periods ON event_day BETWEEN date_from AND date_to
        GROUP BY period_key, event_name
        ORDER BY period_key, events DESC
      `,
      location,
      maximumBytesBilled: MAXIMUM_BYTES_BILLED,
    });
    const [eventRows] = await eventJob.getQueryResults();

    const [parameterJob] = await bigQuery.createQueryJob({
      query: `
        SELECT
          event_name,
          parameter.key AS parameter_key,
          COUNT(*) AS occurrences,
          COUNTIF(parameter.value.string_value IS NOT NULL
            OR parameter.value.int_value IS NOT NULL
            OR parameter.value.float_value IS NOT NULL
            OR parameter.value.double_value IS NOT NULL) AS populated,
          COUNTIF(parameter.value.string_value IS NOT NULL) AS string_values,
          COUNTIF(parameter.value.int_value IS NOT NULL) AS integer_values,
          COUNTIF(parameter.value.float_value IS NOT NULL) AS float_values,
          COUNTIF(parameter.value.double_value IS NOT NULL) AS double_values
        FROM \`${project}.${dataset}.events_*\`, UNNEST(event_params) AS parameter
        WHERE _TABLE_SUFFIX BETWEEN '${currentRange.from.replaceAll("-", "")}' AND '${currentRange.to.replaceAll("-", "")}'
        GROUP BY event_name, parameter_key
        ORDER BY occurrences DESC
        LIMIT 2000
      `,
      location,
      maximumBytesBilled: MAXIMUM_BYTES_BILLED,
    });
    const [parameterRows] = await parameterJob.getQueryResults();

    const rawEvents = (eventRows as EventRow[]).map((row) => ({
      periodKey: row.period_key,
      name: String(row.event_name || "(not set)"),
      events: numberValue(row.events),
      users: numberValue(row.users),
      sessions: numberValue(row.sessions),
      daysActive: numberValue(row.days_active),
      firstSeen: dateValue(row.first_seen),
      lastSeen: dateValue(row.last_seen),
    }));
    const emptyMetric = (): BigQueryAuditEventMetric => ({ events: 0, users: 0, sessions: 0, daysActive: 0, firstSeen: null, lastSeen: null });
    const byEvent = new Map<string, Record<"current" | "previous" | "yearAgo", BigQueryAuditEventMetric>>();
    for (const row of rawEvents) {
      const metrics = byEvent.get(row.name) || { current: emptyMetric(), previous: emptyMetric(), yearAgo: emptyMetric() };
      metrics[row.periodKey] = { events: row.events, users: row.users, sessions: row.sessions, daysActive: row.daysActive, firstSeen: row.firstSeen, lastSeen: row.lastSeen };
      byEvent.set(row.name, metrics);
    }
    const deltaPct = (current: number, comparison: number) => comparison > 0 ? Math.round(((current - comparison) / comparison) * 10_000) / 100 : null;
    const events = [...byEvent.entries()].map(([name, metrics]): BigQueryAuditEvent => ({
      name,
      ...metrics,
      deltaPreviousPct: deltaPct(metrics.current.events, metrics.previous.events),
      deltaYearAgoPct: deltaPct(metrics.current.events, metrics.yearAgo.events),
    })).sort((left, right) => right.current.events - left.current.events || left.name.localeCompare(right.name));
    const parameters = (parameterRows as ParameterRow[]).map((row): BigQueryAuditParameter => {
      const occurrences = numberValue(row.occurrences);
      const populated = numberValue(row.populated);
      return {
        eventName: String(row.event_name || "(not set)"),
        key: String(row.parameter_key || "(not set)"),
        occurrences,
        populated,
        populationPct: occurrences > 0 ? Math.round((populated / occurrences) * 10_000) / 100 : 0,
        valueType: valueType(row),
      };
    });
    const eventMetadata = await eventJob.getMetadata();
    const parameterMetadata = await parameterJob.getMetadata();
    const bytesProcessed = numberValue(eventMetadata[0]?.statistics?.query?.totalBytesProcessed)
      + numberValue(parameterMetadata[0]?.statistics?.query?.totalBytesProcessed);
    const totals = events.reduce((result, event) => ({
      events: result.events + event.current.events,
      users: Math.max(result.users, event.current.users),
      sessions: Math.max(result.sessions, event.current.sessions),
      eventTypes: result.eventTypes + (event.current.events > 0 ? 1 : 0),
      parameters: parameters.length,
    }), { events: 0, users: 0, sessions: 0, eventTypes: 0, parameters: parameters.length });
    const periodSummary = (range: AuditRange): BigQueryAuditPeriod => {
      const rows = rawEvents.filter((row) => row.periodKey === range.key);
      return {
        ...range,
        events: rows.reduce((sum, row) => sum + row.events, 0),
        users: Math.max(0, ...rows.map((row) => row.users)),
        sessions: Math.max(0, ...rows.map((row) => row.sessions)),
        eventTypes: rows.length,
      };
    };
    const periodSummaries = ranges.map(periodSummary);
    const response: BigQueryAuditResponse = {
      generatedAt: new Date().toISOString(),
      projectId: project,
      datasetId: dataset,
      datasetLocation: location,
      tableCount: numberValue(tableInfo?.table_count),
      dataFrom,
      dataTo,
      periodKind,
      selectedPeriod,
      selectedYear,
      periods: {
        current: periodSummaries[0],
        previous: periodSummaries[1],
        yearAgo: periodSummaries[2],
      },
      sampleFrom: currentRange.from,
      sampleTo: currentRange.to,
      sampledDays: Math.floor((new Date(`${currentRange.to}T12:00:00Z`).getTime() - new Date(`${currentRange.from}T12:00:00Z`).getTime()) / 86_400_000) + 1,
      totals,
      events,
      parameters,
      checks: auditChecks(events, parameters),
      bytesProcessed,
      storage: {
        source: "bigquery",
        savedAt: new Date().toISOString(),
        compressedBytes: 0,
      },
    };
    return NextResponse.json(await saveAudit(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : "BigQuery audit failed";
    const credentialsMissing = /credential|authentication|Could not load/i.test(message);
    return NextResponse.json({
      error: credentialsMissing
        ? "BigQuery credentials не налаштовані на цьому сервері"
        : message,
      code: credentialsMissing ? "credentials_missing" : "audit_failed",
    }, { status: credentialsMissing ? 503 : 500 });
  }
}
