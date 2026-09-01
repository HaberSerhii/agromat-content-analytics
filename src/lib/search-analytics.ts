import { BigQuery } from "@google-cloud/bigquery";
import { readThroughBigQueryCache } from "@/lib/bigquery-result-cache";
import {
  ensureSearchQueryDiscovery,
  getSearchSheetRevision,
  listSearchQueryExclusions,
  listSearchQueryProcessing,
} from "@/lib/search-query-processing-store";
import type {
  SearchAnalyticsRow,
  SearchMonthlyMetric,
  SearchQueryProcessing,
  SearchQueryProduct,
} from "@/lib/search-analytics-types";
import { readAllLite, type ProductLite } from "@/lib/products-store";

type SourceQuery = {
  query: string;
  count: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

type SheetMapping = {
  queryUk: string;
  queryRu: string;
  goodsRefs: number[];
  rowNumber: number;
};

type MonthRange = {
  month: string;
  from: string;
  to: string;
};

type MutableRow = SearchAnalyticsRow & { aliasSet: Set<string> };

const MULTISEARCH_BASE = "https://multisearch.io/app/analytics/report";
const GOOGLE_SHEET_ID =
  process.env.MULTISEARCH_GOOGLE_SHEET_ID ||
  "12LQc7_q7ok9pufQJCNC-rtIYTc4OCdZwsdww_l_xrJc";
const DAY_MS = 24 * 60 * 60_000;

export function normalizeSearchQuery(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("uk")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ");
}

function dateInKyiv(date = new Date()): string {
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
}

function periodRange(today = dateInKyiv()): { from: string; to: string } {
  const toDate = new Date(`${today}T12:00:00Z`);
  toDate.setUTCDate(toDate.getUTCDate() - 1);
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - 29);
  return {
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
  };
}

function monthRanges(today = dateInKyiv()): MonthRange[] {
  const anchor = new Date(`${today}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return [2, 1, 0].map((offset) => {
    const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - offset, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    if (last > anchor) last.setTime(anchor.getTime());
    return {
      month: first.toISOString().slice(0, 7),
      from: first.toISOString().slice(0, 10),
      to: last.toISOString().slice(0, 10),
    };
  });
}

function sourceCacheKey(from: string, to: string, cacheDay: string): string {
  const monthEnd = new Date(`${from.slice(0, 7)}-01T12:00:00Z`);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  monthEnd.setUTCDate(0);
  const closedMonth = from.endsWith("-01") && to === monthEnd.toISOString().slice(0, 10);
  return closedMonth ? `closed:${from}:${to}` : `daily:${cacheDay}:${from}:${to}`;
}

function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

async function loadSheetMappings(cacheDay: string, revision: number): Promise<SheetMapping[]> {
  return readThroughBigQueryCache({
    namespace: "multisearch-google-sheet",
    key: `${cacheDay}:r${revision}`,
    load: async () => {
      const response = await fetch(
        `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`,
        { signal: AbortSignal.timeout(20_000) },
      );
      if (!response.ok) throw new Error(`Google Sheets HTTP ${response.status}`);
      return csvRows(await response.text())
        .slice(1)
        .map((row, index) => ({
          queryUk: String(row[0] || "").trim(),
          queryRu: String(row[1] || "").trim(),
          goodsRefs: String(row[2] || "")
            .split(",")
            .map((item) => Number(item.trim()))
            .filter(Number.isSafeInteger),
          rowNumber: index + 2,
        }))
        .filter((row) => row.queryUk || row.queryRu);
    },
  });
}

async function loadMultisearchQueries(
  kind: "found" | "no-results",
  from: string,
  to: string,
  cacheDay: string,
): Promise<SourceQuery[]> {
  const key = process.env.MULTISEARCH_ANALYTICS_KEY;
  if (!key) throw new Error("MULTISEARCH_ANALYTICS_KEY is not configured");
  return readThroughBigQueryCache({
    namespace: `multisearch-${kind}`,
    key: sourceCacheKey(from, to, cacheDay),
    load: async () => {
      const rows: SourceQuery[] = [];
      const chunk = 10_000;
      for (let offset = 0; offset < 50_000; offset += chunk) {
        const url = new URL(MULTISEARCH_BASE);
        url.searchParams.set("key", key);
        url.searchParams.set("start_date", from);
        url.searchParams.set("end_date", to);
        url.searchParams.set("dimensions", "queries");
        url.searchParams.set(
          "filters",
          kind === "no-results"
            ? "name=noresults"
            : "name[]=find&name[]=keyboard&name[]=spellcheck",
        );
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("limit", String(chunk));
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok)
          throw new Error(`Multisearch HTTP ${response.status}`);
        const payload = (await response.json()) as {
          rows?: Array<[unknown, unknown]>;
        };
        const batch = payload.rows || [];
        for (const item of batch) {
          const query = String(item[0] || "").trim();
          const count = Number(item[1]) || 0;
          if (query) rows.push({ query, count, firstSeenAt: from, lastSeenAt: to });
        }
        if (batch.length < chunk) break;
      }
      return rows;
    },
  });
}

async function loadBigQueryQueries(
  from: string,
  to: string,
  cacheDay: string,
): Promise<SourceQuery[]> {
  const project = process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413";
  const dataset = process.env.BIGQUERY_DATASET_ID || "analytics_321347682";
  const fromSuffix = from.replaceAll("-", "");
  const toSuffix = to.replaceAll("-", "");
  return readThroughBigQueryCache({
    namespace: "search-queries-ga4",
    key: sourceCacheKey(from, to, cacheDay),
    load: async () => {
      const client = new BigQuery({ projectId: project });
      const [rows] = await client.query({
        query: `
          SELECT
            LOWER(TRIM((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'search_term'))) AS query,
            COUNT(*) AS search_count,
            MIN(PARSE_DATE('%Y%m%d', event_date)) AS first_seen,
            MAX(PARSE_DATE('%Y%m%d', event_date)) AS last_seen
          FROM \`${project}.${dataset}.events_*\`
          WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix
            AND event_name IN ('view_search_result', 'view_search_results')
          GROUP BY query
          HAVING query IS NOT NULL AND query != ''
          ORDER BY search_count DESC
        `,
        params: { fromSuffix, toSuffix },
      });
      return rows.map((row) => ({
        query: String(row.query || "").trim(),
        count: Number(row.search_count) || 0,
        firstSeenAt: String(row.first_seen?.value || row.first_seen || from),
        lastSeenAt: String(row.last_seen?.value || row.last_seen || to),
      }));
    },
  });
}

function productProjection(product: ProductLite): SearchQueryProduct {
  return {
    code: product.code,
    goodsRef: product.goodsRef,
    name: product.name,
    url: product.url,
    stockQty: product.stockQty,
    statusName: product.statusName,
  };
}

function classifyGarbage(
  query: string,
  products: ProductLite[],
  codeSet: Set<string>,
  goodsRefSet: Set<string>,
  skuSet: Set<string>,
): string | null {
  const normalized = normalizeSearchQuery(query);
  if (codeSet.has(normalized)) return "IDD товару";
  if (goodsRefSet.has(normalized)) return "goods_ref товару";
  if (skuSet.has(normalized)) return "Артикул товару";
  if (/^\d{4,}$/.test(normalized)) return "Числовий ідентифікатор";
  if (
    normalized.length >= 6 &&
    !normalized.includes(" ") &&
    /\d/.test(normalized) &&
    /^[\p{L}\d._/-]+$/u.test(normalized)
  )
    return "Схоже на артикул";
  if (normalized.length < 2 || !/[\p{L}\d]/u.test(normalized))
    return "Некорисний запит";
  void products;
  return null;
}

function emptyRow(key: string, query: string): MutableRow {
  return {
    key,
    query,
    queryUk: query,
    queryRu: query,
    aliases: [query],
    aliasSet: new Set([normalizeSearchQuery(query)]),
    sources: [],
    bigQueryCount: 0,
    multisearchFoundCount: 0,
    multisearchNoResultsCount: 0,
    totalSearches: 0,
    monthly: [],
    firstSeenAt: null,
    lastSeenAt: null,
    status: "new",
    manager: null,
    garbageReason: null,
    products: [],
    sheetSynced: false,
    sheetRow: null,
    processedAt: null,
    updatedAt: null,
  };
}

function addSource(
  row: MutableRow,
  source: SearchAnalyticsRow["sources"][number],
  item: SourceQuery,
) {
  if (!row.sources.includes(source)) row.sources.push(source);
  if (!row.aliasSet.has(normalizeSearchQuery(item.query))) {
    row.aliasSet.add(normalizeSearchQuery(item.query));
    row.aliases.push(item.query);
  }
  if (source === "bigquery") row.bigQueryCount += item.count;
  if (source === "multisearch-found") row.multisearchFoundCount += item.count;
  if (source === "multisearch-no-results")
    row.multisearchNoResultsCount += item.count;
  row.totalSearches =
    Math.max(
      row.bigQueryCount,
      row.multisearchFoundCount + row.multisearchNoResultsCount,
    );
  if (item.firstSeenAt && (!row.firstSeenAt || item.firstSeenAt < row.firstSeenAt))
    row.firstSeenAt = item.firstSeenAt;
  if (item.lastSeenAt && (!row.lastSeenAt || item.lastSeenAt > row.lastSeenAt))
    row.lastSeenAt = item.lastSeenAt;
}

export async function buildSearchAnalyticsDataset(): Promise<{
  rows: SearchAnalyticsRow[];
  from: string;
  to: string;
  warnings: string[];
  sourceStats: {
    bigQueryQueries: number;
    bigQueryEvents: number;
    multisearchFoundQueries: number;
    multisearchFoundEvents: number;
    multisearchNoResultsQueries: number;
    multisearchNoResultsEvents: number;
    sheetMappings: number;
  };
}> {
  const cacheDay = dateInKyiv();
  const { from, to } = periodRange(cacheDay);
  const months = monthRanges(cacheDay);
  const warnings: string[] = [];
  const sheetRevision = await getSearchSheetRevision();
  const [settled, monthlySettled] = await Promise.all([
    Promise.allSettled([
      loadBigQueryQueries(from, to, cacheDay),
      loadMultisearchQueries("found", from, to, cacheDay),
      loadMultisearchQueries("no-results", from, to, cacheDay),
      loadSheetMappings(cacheDay, sheetRevision),
    ]),
    Promise.all(
      months.map((range) =>
        Promise.allSettled([
          loadBigQueryQueries(range.from, range.to, cacheDay),
          loadMultisearchQueries("found", range.from, range.to, cacheDay),
          loadMultisearchQueries("no-results", range.from, range.to, cacheDay),
        ]),
      ),
    ),
  ]);
  const value = <T>(index: number, label: string): T[] => {
    const result = settled[index];
    if (result.status === "fulfilled") return result.value as T[];
    warnings.push(`${label}: ${result.reason instanceof Error ? result.reason.message : "помилка"}`);
    return [];
  };
  const bigQuery = value<SourceQuery>(0, "BigQuery");
  const found = value<SourceQuery>(1, "Multisearch з результатами");
  const noResults = value<SourceQuery>(2, "Multisearch без результатів");
  const sheet = value<SheetMapping>(3, "Google Sheets");
  const monthlySources = monthlySettled.map((results, monthIndex) => {
    const read = (index: number, label: string): SourceQuery[] => {
      const result = results[index];
      if (result.status === "fulfilled") return result.value;
      warnings.push(
        `${label} ${months[monthIndex].month}: ${result.reason instanceof Error ? result.reason.message : "помилка"}`,
      );
      return [];
    };
    return {
      bigQuery: read(0, "BigQuery"),
      found: read(1, "Multisearch з результатами"),
      noResults: read(2, "Multisearch без результатів"),
    };
  });
  const [products, processing, exclusions] = await Promise.all([
    readAllLite(),
    listSearchQueryProcessing(),
    listSearchQueryExclusions(),
  ]);
  const byGoodsRef = new Map(products.map((item) => [item.goodsRef, item]));
  const codeSet = new Set(products.map((item) => String(item.code)));
  const goodsRefSet = new Set(products.map((item) => String(item.goodsRef)));
  const skuSet = new Set(
    products
      .map((item) => normalizeSearchQuery(item.sku || ""))
      .filter(Boolean),
  );
  const rows = new Map<string, MutableRow>();
  const aliasToKey = new Map<string, string>();

  sheet.forEach((mapping, index) => {
    const key = `sheet:${index + 2}`;
    const query = mapping.queryUk || mapping.queryRu;
    const row = emptyRow(key, query);
    row.queryUk = mapping.queryUk;
    row.queryRu = mapping.queryRu;
    row.aliases = [...new Set([mapping.queryUk, mapping.queryRu].filter(Boolean))];
    row.aliasSet = new Set(row.aliases.map(normalizeSearchQuery));
    row.sources.push("google-sheet");
    row.status = "processed";
    row.sheetSynced = true;
    row.sheetRow = mapping.rowNumber;
    row.products = mapping.goodsRefs
      .map((goodsRef) => byGoodsRef.get(goodsRef))
      .filter((item): item is ProductLite => Boolean(item))
      .map(productProjection);
    rows.set(key, row);
    for (const alias of row.aliasSet) if (!aliasToKey.has(alias)) aliasToKey.set(alias, key);
  });

  const merge = (
    items: SourceQuery[],
    source: SearchAnalyticsRow["sources"][number],
  ) => {
    for (const item of items) {
      const normalized = normalizeSearchQuery(item.query);
      if (!normalized) continue;
      const key = aliasToKey.get(normalized) || `query:${normalized}`;
      let row = rows.get(key);
      if (!row) {
        row = emptyRow(key, item.query);
        rows.set(key, row);
        aliasToKey.set(normalized, key);
      }
      addSource(row, source, item);
    }
  };
  merge(bigQuery, "bigquery");
  merge(found, "multisearch-found");
  merge(noResults, "multisearch-no-results");

  const countMap = (items: SourceQuery[]) => {
    const map = new Map<string, number>();
    for (const item of items) {
      const key = normalizeSearchQuery(item.query);
      if (key) map.set(key, (map.get(key) || 0) + item.count);
    }
    return map;
  };
  const monthlyLookups = monthlySources.map((sources) => ({
    bigQuery: countMap(sources.bigQuery),
    found: countMap(sources.found),
    noResults: countMap(sources.noResults),
  }));

  const discovery = await ensureSearchQueryDiscovery(
    [...rows.values()].map((row) => normalizeSearchQuery(row.query)),
    cacheDay,
  );

  for (const row of rows.values()) {
    row.firstSeenAt = discovery[normalizeSearchQuery(row.query)] || cacheDay;
    const stored = [...row.aliasSet]
      .map((alias) => processing[alias])
      .find(Boolean);
    if (stored) {
      applyProcessing(row, stored);
      for (const alias of [stored.queryUk, stored.queryRu]) {
        const normalized = normalizeSearchQuery(alias);
        if (normalized) {
          row.aliasSet.add(normalized);
          if (!row.aliases.some((item) => normalizeSearchQuery(item) === normalized))
            row.aliases.push(alias);
        }
      }
    }
    if (row.status === "new") {
      row.garbageReason = classifyGarbage(
        row.query,
        products,
        codeSet,
        goodsRefSet,
        skuSet,
      );
      if (row.garbageReason) row.status = "garbage";
    }
    row.aliases = [...row.aliasSet].map(
      (alias) => row.aliases.find((item) => normalizeSearchQuery(item) === alias) || alias,
    );
    row.monthly = months.map((range, index): SearchMonthlyMetric => {
      const lookup = monthlyLookups[index];
      const aliases = [...row.aliasSet];
      const bigQueryCount = aliases.reduce(
        (sum, alias) => sum + (lookup.bigQuery.get(alias) || 0),
        0,
      );
      const multisearchFoundCount = aliases.reduce(
        (sum, alias) => sum + (lookup.found.get(alias) || 0),
        0,
      );
      const multisearchNoResultsCount = aliases.reduce(
        (sum, alias) => sum + (lookup.noResults.get(alias) || 0),
        0,
      );
      return {
        ...range,
        bigQueryCount,
        multisearchFoundCount,
        multisearchNoResultsCount,
        totalSearches: Math.max(
          bigQueryCount,
          multisearchFoundCount + multisearchNoResultsCount,
        ),
      };
    });
  }

  const visibleRows = [...rows.values()];
  for (const row of visibleRows) {
    const exclusion = [...row.aliasSet]
      .map((alias) => exclusions[alias])
      .find(Boolean);
    if (!exclusion) continue;
    row.status = exclusion.reason === "brand-not-found"
      ? "brand-not-found"
      : "deleted";
  }

  return {
    rows: visibleRows.map((row) => {
      const finalRow = { ...row } as Partial<MutableRow>;
      delete finalRow.aliasSet;
      return finalRow as SearchAnalyticsRow;
    }),
    from,
    to,
    warnings,
    sourceStats: {
      bigQueryQueries: bigQuery.length,
      bigQueryEvents: bigQuery.reduce((sum, item) => sum + item.count, 0),
      multisearchFoundQueries: found.length,
      multisearchFoundEvents: found.reduce((sum, item) => sum + item.count, 0),
      multisearchNoResultsQueries: noResults.length,
      multisearchNoResultsEvents: noResults.reduce((sum, item) => sum + item.count, 0),
      sheetMappings: sheet.length,
    },
  };
}

function applyProcessing(row: MutableRow, stored: SearchQueryProcessing) {
  row.status = "processed";
  row.manager = stored.manager;
  row.queryUk = stored.queryUk;
  row.queryRu = stored.queryRu;
  row.products = stored.products;
  row.sheetSynced = stored.sheetSynced;
  row.sheetRow = stored.sheetRow ?? row.sheetRow;
  row.processedAt = stored.processedAt;
  row.updatedAt = stored.updatedAt;
  if (stored.sheetSynced && !row.sources.includes("google-sheet"))
    row.sources.push("google-sheet");
}

export function searchAnalyticsPeriod(): { from: string; to: string } {
  return periodRange();
}

export async function readMultisearchNoResultsCounts(
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const rows = await loadMultisearchQueries(
    "no-results",
    from,
    to,
    dateInKyiv(),
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeSearchQuery(row.query);
    if (key) counts.set(key, (counts.get(key) || 0) + row.count);
  }
  return counts;
}

export const SEARCH_ANALYTICS_CACHE_TTL_MS = DAY_MS;
