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

const COUNTRY = "Ukraine" as const;
const EVENT_SENTINEL = "__event__";
const MAXIMUM_BYTES_BILLED = "50000000000";
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

type TableRow = {
  table_count: number | string | null;
  data_from: string | { value?: string } | null;
  data_to: string | { value?: string } | null;
};

type AuditCubeRow = {
  period_kind: "week" | "month";
  period_year: number | string;
  period_number: number | string;
  event_name: string | null;
  parameter_key: string | null;
  occurrences: number | string | null;
  populated: number | string | null;
  string_values: number | string | null;
  integer_values: number | string | null;
  float_values: number | string | null;
  double_values: number | string | null;
  users: number | string | null;
  sessions: number | string | null;
  days_active: number | string | null;
  first_seen: string | { value?: string } | null;
  last_seen: string | { value?: string } | null;
};

type StoredAuditCube = {
  version: 2;
  countryFilter: typeof COUNTRY;
  savedAt: string;
  projectId: string;
  datasetId: string;
  datasetLocation: string;
  tableCount: number;
  dataFrom: string;
  dataTo: string;
  bytesProcessed: number;
  rows: AuditCubeRow[];
};

type AuditRange = {
  key: "current" | "previous" | "yearAgo";
  label: string;
  from: string;
  to: string;
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

function auditCubeFile(): string {
  return path.join(auditRoot(), "ukraine-period-cube-v2.json.gz");
}

async function readAuditCube(): Promise<{ cube: StoredAuditCube; compressedBytes: number } | null> {
  try {
    const file = auditCubeFile();
    const [raw, stat] = await Promise.all([gunzip(await fs.readFile(file)), fs.stat(file)]);
    const cube = JSON.parse(raw.toString("utf8")) as StoredAuditCube;
    if (cube.version !== 2 || cube.countryFilter !== COUNTRY || !Array.isArray(cube.rows)) return null;
    return { cube, compressedBytes: stat.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[bigquery-audit] failed to read saved cube:", error);
    }
    return null;
  }
}

async function saveAuditCube(cube: StoredAuditCube): Promise<number> {
  const file = auditCubeFile();
  const compressed = await gzip(JSON.stringify(cube), { level: 6 });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, compressed, { mode: 0o600 });
  await fs.rename(temporary, file);
  return compressed.byteLength;
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

function valueType(row: AuditCubeRow): BigQueryAuditParameter["valueType"] {
  const types = [
    ["string", numberValue(row.string_values)],
    ["integer", numberValue(row.integer_values)],
    ["float", numberValue(row.float_values)],
    ["double", numberValue(row.double_values)],
  ] as const;
  const winner = [...types].sort((left, right) => right[1] - left[1])[0];
  return winner?.[1] > 0 ? winner[0] : "unknown";
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

function cubeSql(project: string, dataset: string): string {
  return `
    WITH base AS (
      SELECT
        PARSE_DATE('%Y%m%d', event_date) AS event_day,
        event_name,
        user_pseudo_id,
        event_timestamp,
        event_params,
        CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING) AS session_id
      FROM \`${project}.${dataset}.events_*\`
      WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix
        AND geo.country = @country
    ),
    expanded AS (
      SELECT
        dimensions.period_kind,
        dimensions.period_year,
        dimensions.period_number,
        event_day,
        event_name,
        user_pseudo_id,
        event_timestamp,
        session_id,
        detail.*
      FROM base
      CROSS JOIN UNNEST([
        STRUCT('week' AS period_kind, EXTRACT(ISOYEAR FROM event_day) AS period_year, EXTRACT(ISOWEEK FROM event_day) AS period_number),
        STRUCT('month' AS period_kind, EXTRACT(YEAR FROM event_day) AS period_year, EXTRACT(MONTH FROM event_day) AS period_number)
      ]) AS dimensions
      CROSS JOIN UNNEST(ARRAY_CONCAT(
        [STRUCT('${EVENT_SENTINEL}' AS parameter_key, 1 AS populated, 0 AS string_values, 0 AS integer_values, 0 AS float_values, 0 AS double_values)],
        ARRAY(
          SELECT AS STRUCT
            parameter.key AS parameter_key,
            IF(parameter.value.string_value IS NOT NULL OR parameter.value.int_value IS NOT NULL OR parameter.value.float_value IS NOT NULL OR parameter.value.double_value IS NOT NULL, 1, 0) AS populated,
            IF(parameter.value.string_value IS NOT NULL, 1, 0) AS string_values,
            IF(parameter.value.int_value IS NOT NULL, 1, 0) AS integer_values,
            IF(parameter.value.float_value IS NOT NULL, 1, 0) AS float_values,
            IF(parameter.value.double_value IS NOT NULL, 1, 0) AS double_values
          FROM UNNEST(event_params) AS parameter
        )
      )) AS detail
    )
    SELECT
      period_kind,
      period_year,
      period_number,
      event_name,
      parameter_key,
      COUNT(*) AS occurrences,
      SUM(populated) AS populated,
      SUM(string_values) AS string_values,
      SUM(integer_values) AS integer_values,
      SUM(float_values) AS float_values,
      SUM(double_values) AS double_values,
      APPROX_COUNT_DISTINCT(IF(parameter_key = '${EVENT_SENTINEL}', user_pseudo_id, NULL)) AS users,
      APPROX_COUNT_DISTINCT(IF(parameter_key = '${EVENT_SENTINEL}', CONCAT(user_pseudo_id, '/', COALESCE(session_id, CAST(event_timestamp AS STRING))), NULL)) AS sessions,
      COUNT(DISTINCT event_day) AS days_active,
      FORMAT_DATE('%Y-%m-%d', MIN(event_day)) AS first_seen,
      FORMAT_DATE('%Y-%m-%d', MAX(event_day)) AS last_seen
    FROM expanded
    GROUP BY period_kind, period_year, period_number, event_name, parameter_key
    ORDER BY period_kind, period_year, period_number, occurrences DESC
  `;
}

async function buildAuditCube(): Promise<{ cube: StoredAuditCube; compressedBytes: number }> {
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
  const availableFrom = dateValue(tableInfo?.data_from);
  const dataTo = dateValue(tableInfo?.data_to);
  if (!availableFrom || !dataTo) throw new Error("У dataset не знайдено денні таблиці GA4 events_YYYYMMDD");
  const currentYear = Number(currentKyivDate().slice(0, 4));
  const requestedFrom = isoWeekStart(currentYear - 1, 1);
  const dataFrom = availableFrom > requestedFrom ? availableFrom : requestedFrom;
  const [job] = await bigQuery.createQueryJob({
    query: cubeSql(project, dataset),
    params: {
      fromSuffix: dataFrom.replaceAll("-", ""),
      toSuffix: dataTo.replaceAll("-", ""),
      country: COUNTRY,
    },
    location,
    maximumBytesBilled: MAXIMUM_BYTES_BILLED,
    useQueryCache: true,
  });
  const [rows] = await job.getQueryResults();
  const [jobMetadata] = await job.getMetadata();
  const cube: StoredAuditCube = {
    version: 2,
    countryFilter: COUNTRY,
    savedAt: new Date().toISOString(),
    projectId: project,
    datasetId: dataset,
    datasetLocation: location,
    tableCount: numberValue(tableInfo?.table_count),
    dataFrom,
    dataTo,
    bytesProcessed: numberValue(jobMetadata.statistics?.query?.totalBytesProcessed),
    rows: rows as AuditCubeRow[],
  };
  return { cube, compressedBytes: await saveAuditCube(cube) };
}

function periodIdentity(kind: "week" | "month", range: AuditRange): { year: number; number: number } {
  if (kind === "week") {
    const date = new Date(`${range.from}T12:00:00Z`);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    return { year: date.getUTCFullYear(), number: isoWeekNumber(range.from) };
  }
  return { year: Number(range.from.slice(0, 4)), number: Number(range.from.slice(5, 7)) };
}

function renderAudit(
  stored: { cube: StoredAuditCube; compressedBytes: number },
  periodKind: "week" | "month",
  selectedPeriod: number,
  selectedYear: number,
  source: "bigquery" | "saved",
): BigQueryAuditResponse {
  const { cube, compressedBytes } = stored;
  const ranges = requestedRanges(periodKind, selectedPeriod, selectedYear);
  if (ranges[0].to > cube.dataTo) {
    throw new Error(`Знімок містить завершені дані лише до ${cube.dataTo}. Оберіть завершений період.`);
  }
  const rangeRows = new Map<AuditRange["key"], AuditCubeRow[]>();
  for (const range of ranges) {
    const identity = periodIdentity(periodKind, range);
    rangeRows.set(range.key, cube.rows.filter((row) => row.period_kind === periodKind
      && numberValue(row.period_year) === identity.year
      && numberValue(row.period_number) === identity.number));
  }

  const emptyMetric = (): BigQueryAuditEventMetric => ({
    events: 0,
    users: 0,
    sessions: 0,
    daysActive: 0,
    firstSeen: null,
    lastSeen: null,
  });
  const byEvent = new Map<string, Record<AuditRange["key"], BigQueryAuditEventMetric>>();
  for (const range of ranges) {
    for (const row of rangeRows.get(range.key) || []) {
      if (row.parameter_key !== EVENT_SENTINEL) continue;
      const name = String(row.event_name || "(not set)");
      const metrics = byEvent.get(name) || { current: emptyMetric(), previous: emptyMetric(), yearAgo: emptyMetric() };
      metrics[range.key] = {
        events: numberValue(row.occurrences),
        users: numberValue(row.users),
        sessions: numberValue(row.sessions),
        daysActive: numberValue(row.days_active),
        firstSeen: dateValue(row.first_seen),
        lastSeen: dateValue(row.last_seen),
      };
      byEvent.set(name, metrics);
    }
  }
  const deltaPct = (current: number, comparison: number) => comparison > 0
    ? Math.round(((current - comparison) / comparison) * 10_000) / 100
    : null;
  const events = [...byEvent.entries()].map(([name, metrics]): BigQueryAuditEvent => ({
    name,
    ...metrics,
    deltaPreviousPct: deltaPct(metrics.current.events, metrics.previous.events),
    deltaYearAgoPct: deltaPct(metrics.current.events, metrics.yearAgo.events),
  })).sort((left, right) => right.current.events - left.current.events || left.name.localeCompare(right.name));

  const parameters = (rangeRows.get("current") || [])
    .filter((row) => row.parameter_key !== EVENT_SENTINEL)
    .map((row): BigQueryAuditParameter => {
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
    })
    .sort((left, right) => right.occurrences - left.occurrences);

  const periodSummary = (range: AuditRange): BigQueryAuditPeriod => {
    const rows = (rangeRows.get(range.key) || []).filter((row) => row.parameter_key === EVENT_SENTINEL);
    return {
      ...range,
      events: rows.reduce((sum, row) => sum + numberValue(row.occurrences), 0),
      users: Math.max(0, ...rows.map((row) => numberValue(row.users))),
      sessions: Math.max(0, ...rows.map((row) => numberValue(row.sessions))),
      eventTypes: rows.length,
    };
  };
  const summaries = ranges.map(periodSummary);
  const currentSummary = summaries[0];
  return {
    generatedAt: new Date().toISOString(),
    projectId: cube.projectId,
    datasetId: cube.datasetId,
    datasetLocation: cube.datasetLocation,
    countryFilter: COUNTRY,
    tableCount: cube.tableCount,
    dataFrom: cube.dataFrom,
    dataTo: cube.dataTo,
    periodKind,
    selectedPeriod,
    selectedYear,
    periods: {
      current: summaries[0],
      previous: summaries[1],
      yearAgo: summaries[2],
    },
    sampleFrom: ranges[0].from,
    sampleTo: ranges[0].to,
    sampledDays: Math.floor((new Date(`${ranges[0].to}T12:00:00Z`).getTime() - new Date(`${ranges[0].from}T12:00:00Z`).getTime()) / 86_400_000) + 1,
    totals: {
      events: currentSummary.events,
      users: currentSummary.users,
      sessions: currentSummary.sessions,
      eventTypes: currentSummary.eventTypes,
      parameters: parameters.length,
    },
    events,
    parameters,
    checks: auditChecks(events, parameters),
    bytesProcessed: cube.bytesProcessed,
    storage: {
      source,
      savedAt: cube.savedAt,
      compressedBytes,
    },
  };
}

export async function POST(request: Request) {
  if (!isDashboardRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const input = await request.json().catch(() => ({})) as {
      periodKind?: "week" | "month";
      period?: number;
      buildSnapshot?: boolean;
    };
    const today = currentKyivDate();
    const selectedYear = Number(today.slice(0, 4));
    const periodKind = input.periodKind === "month" ? "month" : "week";
    const defaultPeriod = periodKind === "month"
      ? Math.max(1, Number(today.slice(5, 7)) - 1)
      : Math.max(1, isoWeekNumber(today) - 1);
    const selectedPeriod = Math.round(Number(input.period || defaultPeriod));
    let stored = await readAuditCube();
    let source: "bigquery" | "saved" = "saved";
    if (input.buildSnapshot === true) {
      stored = await buildAuditCube();
      source = "bigquery";
    }
    if (!stored) {
      return NextResponse.json({
        error: "Локальний знімок України ще не створено. Створіть його один раз — звичайне відкриття не запускає BigQuery.",
        code: "snapshot_missing",
      }, { status: 409 });
    }
    return NextResponse.json(renderAudit(stored, periodKind, selectedPeriod, selectedYear, source));
  } catch (error) {
    const message = error instanceof Error ? error.message : "BigQuery audit failed";
    const credentialsMissing = /credential|authentication|Could not load/i.test(message);
    return NextResponse.json({
      error: credentialsMissing ? "BigQuery credentials не налаштовані на цьому сервері" : message,
      code: credentialsMissing ? "credentials_missing" : "audit_failed",
    }, { status: credentialsMissing ? 503 : 500 });
  }
}
