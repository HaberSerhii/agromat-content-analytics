import { BigQuery } from "@google-cloud/bigquery";
import { NextResponse } from "next/server";
import {
  listSnapshotDates,
  readAllLite,
  readDailySnapshot,
  readLiteSyncedAt,
  readProductAttributeIndex,
  readRequiredAttrs,
  readSyncState,
  type ProductLite,
} from "@/lib/products-store";

export const dynamic = "force-dynamic";

type Segment = "tile" | "sanitary";
type SegmentMetric = {
  tile: number;
  sanitary: number;
  deltaTile: number;
  deltaSanitary: number;
};

type DashboardFilters = {
  view?: "overview" | "new" | "categories" | "products";
  page?: number;
  limit?: number;
  exportAll?: boolean;
  search?: string;
  bulkIds?: number[];
  categoryId?: number | null;
  brandId?: number | null;
  statusId?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minStock?: number | null;
  maxStock?: number | null;
  productSignal?:
    | "highImpressions"
    | "lowCtr"
    | "lowAtc"
    | "poorContent"
    | null;
};

type MonthlyCtrRow = {
  month: string | { value?: string } | null;
  goods_ref: number | string | null;
  impressions: number | string | null;
  clicks: number | string | null;
  product_views: number | string | null;
  add_to_cart: number | string | null;
};

type CtrRow = {
  period: "current" | "previous";
  goods_ref: number | string | null;
  impressions: number | string | null;
  clicks: number | string | null;
};

type ProductPerformanceRow = {
  goods_ref: number | string | null;
  impressions: number | string | null;
  clicks: number | string | null;
  product_views: number | string | null;
  add_to_cart: number | string | null;
};

const CHART_COLORS = [
  "#118dff",
  "#4a6ee0",
  "#6d5bd0",
  "#16a085",
  "#f39c4a",
  "#e05c68",
  "#38a3a5",
  "#78909c",
  "#9b59b6",
  "#2d98da",
];
const CTR_MIN_IMPRESSIONS = 20;
const CTR_CACHE_TTL_MS = 15 * 60_000;

let ctrCache: { key: string; expiresAt: number; value: CtrSummary } | null =
  null;
let monthlyCtrCache: {
  key: string;
  expiresAt: number;
  rows: MonthlyCtrRow[];
} | null = null;
let productPerformanceCache: {
  key: string;
  expiresAt: number;
  rows: ProductPerformanceRow[];
} | null = null;

type CtrSummary = {
  available: boolean;
  benchmark: number | null;
  tile: number | null;
  sanitary: number | null;
  scoreTile: number;
  scoreSanitary: number;
  improvedTile: number;
  improvedSanitary: number;
  declinedTile: number;
  declinedSanitary: number;
  error?: string;
};

function dateInKyiv(date = new Date()): string {
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
}

function monthRanges(today: string) {
  const [year, month, day] = today.split("-").map(Number);
  const currentFrom = `${year}-${String(month).padStart(2, "0")}-01`;
  const previousMonthDate = new Date(Date.UTC(year, month - 2, 1));
  const previousYear = previousMonthDate.getUTCFullYear();
  const previousMonth = previousMonthDate.getUTCMonth() + 1;
  const previousLastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const previousFrom = `${previousYear}-${String(previousMonth).padStart(2, "0")}-01`;
  const previousTo = `${previousYear}-${String(previousMonth).padStart(2, "0")}-${String(Math.min(day, previousLastDay)).padStart(2, "0")}`;
  return { currentFrom, currentTo: today, previousFrom, previousTo };
}

function segmentOf(
  product: Pick<ProductLite, "categoryName" | "categoryPath">,
): Segment {
  const category = `${product.categoryName} ${product.categoryPath}`;
  return /плит|керам|кл[іи]нкер|моза|tile|gres/i.test(category)
    ? "tile"
    : "sanitary";
}

function countSegments(
  products: ProductLite[],
  predicate: (product: ProductLite) => boolean,
) {
  const result = { tile: 0, sanitary: 0 };
  for (const product of products) {
    if (!predicate(product)) continue;
    result[segmentOf(product)]++;
  }
  return result;
}

function metric(
  current: { tile: number; sanitary: number },
  previous: { tile: number; sanitary: number },
): SegmentMetric {
  return {
    ...current,
    deltaTile: current.tile - previous.tile,
    deltaSanitary: current.sanitary - previous.sanitary,
  };
}

function isInactive(product: ProductLite) {
  return product.deleted || (product.statusId !== 5 && product.statusId !== 3);
}

function inDateRange(
  value: string | null | undefined,
  from: string,
  to: string,
) {
  if (!value) return false;
  const date = value.slice(0, 10);
  return date >= from && date <= to;
}

function scalar(value: number | string | null): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthScalar(value: MonthlyCtrRow["month"]): string {
  if (typeof value === "string") return value;
  return value?.value || "";
}

function monthKey(year: number, monthIndex: number) {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function lastDayOfMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ];
}

function categoryCtrMonths(today: string) {
  const [year, month] = today.split("-").map(Number);
  const currentMonthIndex = month - 1;
  const currentThree = [-3, -2, -1].map((offset) =>
    monthKey(year, currentMonthIndex + offset),
  );
  const lastYear = [-3, -2, -1, 0].map((offset) =>
    monthKey(year - 1, currentMonthIndex + offset),
  );
  return {
    currentThree,
    lastYear,
    currentFrom: `${currentThree[0]}-01`,
    currentTo: lastDayOfMonth(currentThree[2]),
    lastYearFrom: `${lastYear[0]}-01`,
    lastYearTo: lastDayOfMonth(lastYear[3]),
  };
}

function monthlyCtrSql() {
  const project = (
    process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413"
  ).replace(/`/g, "");
  const dataset = (
    process.env.BIGQUERY_DATASET_ID || "analytics_321347682"
  ).replace(/`/g, "");
  return `
WITH item_events AS (
  SELECT
    FORMAT_DATE('%Y-%m', PARSE_DATE('%Y%m%d', event_date)) AS month,
    event_name,
    SAFE_CAST(NULLIF(TRIM(item.item_id), '') AS INT64) AS goods_ref
  FROM \`${project}.${dataset}.events_*\`
  CROSS JOIN UNNEST(items) AS item
  WHERE (
      _TABLE_SUFFIX BETWEEN @currentFrom AND @currentTo
      OR _TABLE_SUFFIX BETWEEN @lastYearFrom AND @lastYearTo
    )
    AND event_name IN ('view_item_list', 'select_item', 'view_item', 'add_to_cart')
    AND geo.country = 'Ukraine'
)
SELECT
  month,
  goods_ref,
  COUNTIF(event_name = 'view_item_list') AS impressions,
  COUNTIF(event_name = 'select_item') AS clicks,
  COUNTIF(event_name = 'view_item') AS product_views,
  COUNTIF(event_name = 'add_to_cart') AS add_to_cart
FROM item_events
WHERE goods_ref IS NOT NULL
GROUP BY month, goods_ref
`;
}

async function readMonthlyCtr(
  today: string,
): Promise<{ rows: MonthlyCtrRow[]; available: boolean; error?: string }> {
  const months = categoryCtrMonths(today);
  const key = `${months.currentFrom}:${months.currentTo}:${months.lastYearFrom}:${months.lastYearTo}`;
  if (
    monthlyCtrCache &&
    monthlyCtrCache.key === key &&
    monthlyCtrCache.expiresAt > Date.now()
  ) {
    return {
      rows: monthlyCtrCache.rows,
      available: monthlyCtrCache.rows.length > 0,
    };
  }
  try {
    const bigQuery = new BigQuery({
      projectId: process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413",
    });
    const [rawRows] = await bigQuery.query({
      query: monthlyCtrSql(),
      params: {
        currentFrom: months.currentFrom.replaceAll("-", ""),
        currentTo: months.currentTo.replaceAll("-", ""),
        lastYearFrom: months.lastYearFrom.replaceAll("-", ""),
        lastYearTo: months.lastYearTo.replaceAll("-", ""),
      },
      location: "EU",
      maximumBytesBilled: "50000000000",
    });
    const rows = rawRows as MonthlyCtrRow[];
    monthlyCtrCache = { key, expiresAt: Date.now() + CTR_CACHE_TTL_MS, rows };
    return { rows, available: rows.length > 0 };
  } catch (error) {
    return {
      rows: [],
      available: false,
      error:
        error instanceof Error ? error.message : "BigQuery monthly CTR failed",
    };
  }
}

function rollingThirtyDays(today: string) {
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function productPerformanceSql() {
  const project = (
    process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413"
  ).replace(/`/g, "");
  const dataset = (
    process.env.BIGQUERY_DATASET_ID || "analytics_321347682"
  ).replace(/`/g, "");
  return `
WITH item_events AS (
  SELECT
    event_name,
    SAFE_CAST(NULLIF(TRIM(item.item_id), '') AS INT64) AS goods_ref
  FROM \`${project}.${dataset}.events_*\`
  CROSS JOIN UNNEST(items) AS item
  WHERE _TABLE_SUFFIX BETWEEN @dateFrom AND @dateTo
    AND event_name IN ('view_item_list', 'select_item', 'view_item', 'add_to_cart')
    AND geo.country = 'Ukraine'
)
SELECT
  goods_ref,
  COUNTIF(event_name = 'view_item_list') AS impressions,
  COUNTIF(event_name = 'select_item') AS clicks,
  COUNTIF(event_name = 'view_item') AS product_views,
  COUNTIF(event_name = 'add_to_cart') AS add_to_cart
FROM item_events
WHERE goods_ref IS NOT NULL
GROUP BY goods_ref
`;
}

async function readProductPerformance(today: string): Promise<{
  rows: ProductPerformanceRow[];
  available: boolean;
  error?: string;
}> {
  const range = rollingThirtyDays(today);
  const key = `${range.from}:${range.to}`;
  if (
    productPerformanceCache &&
    productPerformanceCache.key === key &&
    productPerformanceCache.expiresAt > Date.now()
  ) {
    return {
      rows: productPerformanceCache.rows,
      available: productPerformanceCache.rows.length > 0,
    };
  }
  try {
    const bigQuery = new BigQuery({
      projectId: process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413",
    });
    const [rawRows] = await bigQuery.query({
      query: productPerformanceSql(),
      params: {
        dateFrom: range.from.replaceAll("-", ""),
        dateTo: range.to.replaceAll("-", ""),
      },
      location: "EU",
      maximumBytesBilled: "50000000000",
    });
    const rows = rawRows as ProductPerformanceRow[];
    productPerformanceCache = {
      key,
      expiresAt: Date.now() + CTR_CACHE_TTL_MS,
      rows,
    };
    return { rows, available: rows.length > 0 };
  } catch (error) {
    return {
      rows: [],
      available: false,
      error:
        error instanceof Error
          ? error.message
          : "BigQuery product performance failed",
    };
  }
}

function bigQuerySql() {
  const project = (
    process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413"
  ).replace(/`/g, "");
  const dataset = (
    process.env.BIGQUERY_DATASET_ID || "analytics_321347682"
  ).replace(/`/g, "");
  return `
WITH periods AS (
  SELECT 'current' AS period, @currentFrom AS suffix_from, @currentTo AS suffix_to
  UNION ALL
  SELECT 'previous' AS period, @previousFrom AS suffix_from, @previousTo AS suffix_to
),
events AS (
  SELECT
    CASE
      WHEN _TABLE_SUFFIX BETWEEN @currentFrom AND @currentTo THEN 'current'
      ELSE 'previous'
    END AS period,
    event_name,
    items
  FROM \`${project}.${dataset}.events_*\`
  WHERE (
      _TABLE_SUFFIX BETWEEN @currentFrom AND @currentTo
      OR _TABLE_SUFFIX BETWEEN @previousFrom AND @previousTo
    )
    AND event_name IN ('view_item_list', 'select_item')
    AND geo.country = 'Ukraine'
),
item_events AS (
  SELECT
    period,
    event_name,
    SAFE_CAST(NULLIF(TRIM(item.item_id), '') AS INT64) AS goods_ref
  FROM events
  CROSS JOIN UNNEST(items) AS item
)
SELECT
  period,
  goods_ref,
  COUNTIF(event_name = 'view_item_list') AS impressions,
  COUNTIF(event_name = 'select_item') AS clicks
FROM item_events
WHERE goods_ref IS NOT NULL
GROUP BY period, goods_ref
`;
}

async function readCtr(
  products: ProductLite[],
  today: string,
): Promise<CtrSummary> {
  const ranges = monthRanges(today);
  const key = Object.values(ranges).join(":");
  if (ctrCache && ctrCache.key === key && ctrCache.expiresAt > Date.now())
    return ctrCache.value;

  try {
    const bigQuery = new BigQuery({
      projectId: process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413",
    });
    const [rawRows] = await bigQuery.query({
      query: bigQuerySql(),
      params: {
        currentFrom: ranges.currentFrom.replaceAll("-", ""),
        currentTo: ranges.currentTo.replaceAll("-", ""),
        previousFrom: ranges.previousFrom.replaceAll("-", ""),
        previousTo: ranges.previousTo.replaceAll("-", ""),
      },
      location: "EU",
      maximumBytesBilled: "50000000000",
    });
    const rows = rawRows as CtrRow[];
    const productByRef = new Map(
      products.map((product) => [product.goodsRef, product]),
    );
    const byRef = new Map<
      number,
      {
        current?: { impressions: number; clicks: number };
        previous?: { impressions: number; clicks: number };
      }
    >();
    for (const row of rows) {
      const goodsRef = scalar(row.goods_ref);
      if (!productByRef.has(goodsRef)) continue;
      const current = byRef.get(goodsRef) || {};
      current[row.period] = {
        impressions: scalar(row.impressions),
        clicks: scalar(row.clicks),
      };
      byRef.set(goodsRef, current);
    }

    const totals = {
      tile: { impressions: 0, clicks: 0 },
      sanitary: { impressions: 0, clicks: 0 },
    };
    let totalImpressions = 0;
    let totalClicks = 0;
    let scoreTile = 0;
    let scoreSanitary = 0;
    let improvedTile = 0;
    let improvedSanitary = 0;
    let declinedTile = 0;
    let declinedSanitary = 0;

    for (const [goodsRef, periods] of byRef) {
      const product = productByRef.get(goodsRef)!;
      const segment = segmentOf(product);
      const current = periods.current;
      const previous = periods.previous;
      if (current) {
        totals[segment].impressions += current.impressions;
        totals[segment].clicks += current.clicks;
        totalImpressions += current.impressions;
        totalClicks += current.clicks;
      }
      if (
        !current ||
        !previous ||
        current.impressions < CTR_MIN_IMPRESSIONS ||
        previous.impressions < CTR_MIN_IMPRESSIONS
      )
        continue;
      const currentCtr = current.clicks / current.impressions;
      const previousCtr = previous.clicks / previous.impressions;
      if (currentCtr > previousCtr) {
        if (segment === "tile") {
          scoreTile++;
          improvedTile++;
        } else {
          scoreSanitary++;
          improvedSanitary++;
        }
      } else if (currentCtr < previousCtr) {
        if (segment === "tile") {
          scoreTile--;
          declinedTile++;
        } else {
          scoreSanitary--;
          declinedSanitary++;
        }
      }
    }

    const ctr = (segment: Segment) =>
      totals[segment].impressions > 0
        ? (totals[segment].clicks / totals[segment].impressions) * 100
        : null;
    const value: CtrSummary = {
      available: totalImpressions > 0,
      benchmark:
        totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null,
      tile: ctr("tile"),
      sanitary: ctr("sanitary"),
      scoreTile,
      scoreSanitary,
      improvedTile,
      improvedSanitary,
      declinedTile,
      declinedSanitary,
    };
    ctrCache = { key, expiresAt: Date.now() + CTR_CACHE_TTL_MS, value };
    return value;
  } catch (error) {
    return {
      available: false,
      benchmark: null,
      tile: null,
      sanitary: null,
      scoreTile: 0,
      scoreSanitary: 0,
      improvedTile: 0,
      improvedSanitary: 0,
      declinedTile: 0,
      declinedSanitary: 0,
      error: error instanceof Error ? error.message : "CTR unavailable",
    };
  }
}

function normalizeFilters(input: DashboardFilters): Required<DashboardFilters> {
  const exportAll = input.exportAll === true;
  return {
    view:
      input.view === "new" ||
      input.view === "categories" ||
      input.view === "products"
        ? input.view
        : "overview",
    page: exportAll ? 1 : Math.max(1, Number(input.page) || 1),
    limit: exportAll
      ? Math.min(250_000, Math.max(1, Number(input.limit) || 250_000))
      : Math.min(100, Math.max(1, Number(input.limit) || 15)),
    exportAll,
    search: String(input.search || "").trim(),
    bulkIds: Array.isArray(input.bulkIds)
      ? input.bulkIds.filter(Number.isFinite).slice(0, 5000)
      : [],
    categoryId: Number.isFinite(input.categoryId)
      ? Number(input.categoryId)
      : null,
    brandId: Number.isFinite(input.brandId) ? Number(input.brandId) : null,
    statusId: Number.isFinite(input.statusId) ? Number(input.statusId) : null,
    minPrice: Number.isFinite(input.minPrice) ? Number(input.minPrice) : null,
    maxPrice: Number.isFinite(input.maxPrice) ? Number(input.maxPrice) : null,
    minStock: Number.isFinite(input.minStock) ? Number(input.minStock) : null,
    maxStock: Number.isFinite(input.maxStock) ? Number(input.maxStock) : null,
    productSignal:
      input.productSignal === "highImpressions" ||
      input.productSignal === "lowCtr" ||
      input.productSignal === "lowAtc" ||
      input.productSignal === "poorContent"
        ? input.productSignal
        : null,
  };
}

async function buildDashboard(input: DashboardFilters) {
  const filters = normalizeFilters(input);
  const today = dateInKyiv();
  const ranges = monthRanges(today);
  const [products, syncedAt, syncState, snapshots, attrIndex, requiredAttrs] =
    await Promise.all([
      readAllLite(),
      readLiteSyncedAt(),
      readSyncState(),
      listSnapshotDates(),
      readProductAttributeIndex(),
      readRequiredAttrs(),
    ]);
  const comparisonDate =
    snapshots.find((snapshot) => snapshot.date < today)?.date || null;
  const comparisonSnapshot = comparisonDate
    ? await readDailySnapshot(comparisonDate)
    : null;
  const previousProducts = comparisonSnapshot?.products || products;
  const ctr = await readCtr(products, today);

  const currentNew = countSegments(products, (product) =>
    inDateRange(product.firstSeenAt, ranges.currentFrom, ranges.currentTo),
  );
  const previousNew = countSegments(previousProducts, (product) =>
    inDateRange(
      product.firstSeenAt,
      ranges.currentFrom,
      comparisonDate || ranges.currentTo,
    ),
  );
  const currentInactive = countSegments(products, isInactive);
  const previousInactive = countSegments(previousProducts, isInactive);
  const currentPromo = countSegments(
    products,
    (product) => !product.deleted && product.isOnSale,
  );
  const previousPromo = countSegments(
    previousProducts,
    (product) => !product.deleted && product.isOnSale,
  );

  const search = filters.search.toLocaleLowerCase("uk");
  const bulkIds = new Set(filters.bulkIds);
  const matchesFacetFilters = (product: ProductLite) => {
    if (filters.categoryId != null && product.categoryId !== filters.categoryId)
      return false;
    if (filters.brandId != null && product.brandId !== filters.brandId)
      return false;
    if (filters.statusId != null) {
      if (
        filters.statusId === -1
          ? !product.deleted
          : product.deleted || product.statusId !== filters.statusId
      )
        return false;
    }
    return true;
  };
  const filtered = products
    .filter((product) => {
      if (!matchesFacetFilters(product)) return false;
      if (
        filters.view === "new" &&
        !inDateRange(product.firstSeenAt, ranges.currentFrom, ranges.currentTo)
      )
        return false;
      if (filters.view === "categories") return true;
      if (
        search &&
        !`${product.code} ${product.goodsRef} ${product.sku || ""} ${product.name} ${product.brand}`
          .toLocaleLowerCase("uk")
          .includes(search)
      )
        return false;
      if (
        bulkIds.size &&
        !bulkIds.has(product.code) &&
        !bulkIds.has(product.goodsRef) &&
        !bulkIds.has(product.id)
      )
        return false;
      if (filters.minPrice != null && (product.price ?? 0) < filters.minPrice)
        return false;
      if (filters.maxPrice != null && (product.price ?? 0) > filters.maxPrice)
        return false;
      if (
        filters.minStock != null &&
        (product.stockQty ?? 0) < filters.minStock
      )
        return false;
      if (
        filters.maxStock != null &&
        (product.stockQty ?? 0) > filters.maxStock
      )
        return false;
      return true;
    })
    .sort((left, right) => right.firstSeenAt.localeCompare(left.firstSeenAt));

  const attributeNameById = new Map<number, string>();
  for (const attributes of attrIndex.values()) {
    for (const attribute of attributes) {
      if (!attributeNameById.has(attribute.id))
        attributeNameById.set(attribute.id, attribute.name);
    }
  }
  const missingRequiredAttributes = (product: ProductLite) => {
    const required = requiredAttrs[String(product.categoryId)] || [];
    if (!required.length) return [];
    const present = new Set(
      (attrIndex.get(product.id) || []).map((attribute) => attribute.id),
    );
    return required
      .filter((attributeId) => !present.has(attributeId))
      .map(
        (attributeId) =>
          attributeNameById.get(attributeId) || `Атрибут #${attributeId}`,
      );
  };
  const missingRequiredCount = (product: ProductLite) =>
    missingRequiredAttributes(product).length;

  const facetRows = <K extends string | number>(
    values: Map<K, { name: string; count: number }>,
  ) =>
    [...values.entries()]
      .map(([key, value]) => ({ key: String(key), ...value }))
      .sort(
        (left, right) =>
          right.count - left.count || left.name.localeCompare(right.name, "uk"),
      );
  const categoryMap = new Map<number, { name: string; count: number }>();
  const brandMap = new Map<number, { name: string; count: number }>();
  const statusMap = new Map<number, { name: string; count: number }>();
  for (const product of filtered) {
    const category = categoryMap.get(product.categoryId) || {
      name: product.categoryName || product.categoryPath || "Без категорії",
      count: 0,
    };
    category.count++;
    categoryMap.set(product.categoryId, category);
    if (product.brandId != null) {
      const brand = brandMap.get(product.brandId) || {
        name: product.brand || "Без бренду",
        count: 0,
      };
      brand.count++;
      brandMap.set(product.brandId, brand);
    }
    const statusId = product.deleted ? -1 : product.statusId;
    const status = statusMap.get(statusId) || {
      name: product.deleted ? "Архів" : product.statusName,
      count: 0,
    };
    status.count++;
    statusMap.set(statusId, status);
  }

  const categoryAnalysis = [] as Array<{
    categoryId: number;
    categoryName: string;
    total: number;
    totalDelta: number;
    withPhotosPct: number;
    withPhotosDelta: number;
    missingAttrsPct: number | null;
    available: number;
    availableDelta: number;
    inactive: number;
    inactiveDelta: number;
  }>;
  let categoryCtrAvailable = false;
  let categoryCtrError = "";
  let categoryCtrSummary = {
    currentThree: [] as Array<{
      month: string;
      pdpCtr: number | null;
      atcCtr: number | null;
    }>,
    lastYear: [] as Array<{
      month: string;
      pdpCtr: number | null;
      atcCtr: number | null;
    }>,
  };
  if (filters.view === "categories") {
    const previousFiltered = previousProducts.filter(matchesFacetFilters);
    const previousByCategory = new Map<number, ProductLite[]>();
    for (const product of previousFiltered) {
      const rows = previousByCategory.get(product.categoryId) || [];
      rows.push(product);
      previousByCategory.set(product.categoryId, rows);
    }
    const ctrDataset = await readMonthlyCtr(today);
    categoryCtrAvailable = ctrDataset.available;
    categoryCtrError = ctrDataset.error || "";
    const ctrByRefMonth = new Map<
      string,
      {
        impressions: number;
        clicks: number;
        productViews: number;
        addToCart: number;
      }
    >();
    for (const row of ctrDataset.rows) {
      ctrByRefMonth.set(`${scalar(row.goods_ref)}:${monthScalar(row.month)}`, {
        impressions: scalar(row.impressions),
        clicks: scalar(row.clicks),
        productViews: scalar(row.product_views),
        addToCart: scalar(row.add_to_cart),
      });
    }
    const monthConfig = categoryCtrMonths(today);
    const byCategory = new Map<number, ProductLite[]>();
    for (const product of filtered) {
      const rows = byCategory.get(product.categoryId) || [];
      rows.push(product);
      byCategory.set(product.categoryId, rows);
    }
    const pct = (value: number, total: number) =>
      total ? Math.round((value / total) * 1000) / 10 : 0;
    const categoryCtr = (rows: ProductLite[], month: string) => {
      let impressions = 0;
      let clicks = 0;
      let productViews = 0;
      let addToCart = 0;
      for (const product of rows) {
        const metric = ctrByRefMonth.get(`${product.goodsRef}:${month}`);
        if (!metric) continue;
        impressions += metric.impressions;
        clicks += metric.clicks;
        productViews += metric.productViews;
        addToCart += metric.addToCart;
      }
      return {
        impressions,
        clicks,
        productViews,
        addToCart,
        pdpCtr: impressions > 0 ? (clicks / impressions) * 100 : null,
        atcCtr: productViews > 0 ? (addToCart / productViews) * 100 : null,
      };
    };
    const series = (months: string[]) =>
      months.map((month) => {
        const values = categoryCtr(filtered, month);
        return { month, pdpCtr: values.pdpCtr, atcCtr: values.atcCtr };
      });
    categoryCtrSummary = {
      currentThree: series(monthConfig.currentThree),
      lastYear: series(monthConfig.lastYear),
    };
    for (const [categoryId, rows] of byCategory) {
      const before = previousByCategory.get(categoryId) || [];
      const withPhotos = rows.filter(
        (product) => product.imagesCount > 0,
      ).length;
      const beforeWithPhotos = before.filter(
        (product) => product.imagesCount > 0,
      ).length;
      const available = rows.filter(
        (product) =>
          !product.deleted &&
          (product.statusId === 5 || product.statusId === 3),
      ).length;
      const beforeAvailable = before.filter(
        (product) =>
          !product.deleted &&
          (product.statusId === 5 || product.statusId === 3),
      ).length;
      const inactive = rows.filter(isInactive).length;
      const beforeInactive = before.filter(isInactive).length;
      categoryAnalysis.push({
        categoryId,
        categoryName:
          rows[0]?.categoryName || rows[0]?.categoryPath || "Без категорії",
        total: rows.length,
        totalDelta: rows.length - before.length,
        withPhotosPct: pct(withPhotos, rows.length),
        withPhotosDelta:
          Math.round(
            (pct(withPhotos, rows.length) -
              pct(beforeWithPhotos, before.length)) *
              10,
          ) / 10,
        missingAttrsPct: requiredAttrs[String(categoryId)]?.length
          ? pct(
              rows.filter((product) => missingRequiredCount(product) > 0)
                .length,
              rows.length,
            )
          : null,
        available,
        availableDelta: available - beforeAvailable,
        inactive,
        inactiveDelta: inactive - beforeInactive,
      });
    }
    categoryAnalysis.sort(
      (left, right) =>
        right.total - left.total ||
        left.categoryName.localeCompare(right.categoryName, "uk"),
    );
  }

  type ProductAnalysisRow = ProductLite & {
    missingRequiredAttrsCount: number;
    missingRequiredAttrs: string[];
    requiredAttrsConfigured: boolean;
    impressions: number;
    pdpViews: number;
    ctr: number | null;
    atc: number | null;
    contentScore: number | null;
    photoScore: number;
    attributeScore: number | null;
    reviewScore: number;
    categoryP75Impressions: number;
    categoryMedianCtr: number;
    categoryMedianAtc: number;
    categoryMedianContent: number | null;
  };
  let productRows: ProductAnalysisRow[] = [];
  let productAnalysis = {
    available: false,
    error: "",
    contentAvailable: Object.keys(requiredAttrs).length > 0,
    currentThree: [] as Array<{
      month: string;
      ctr: number | null;
      atc: number | null;
    }>,
    lastYear: [] as Array<{
      month: string;
      ctr: number | null;
      atc: number | null;
    }>,
    signalCounts: {
      highImpressions: 0,
      lowCtr: 0,
      lowAtc: 0,
      poorContent: 0,
    },
  };
  if (filters.view === "products") {
    const [performanceDataset, monthlyDataset] = await Promise.all([
      readProductPerformance(today),
      readMonthlyCtr(today),
    ]);
    const performanceByRef = new Map<
      number,
      {
        impressions: number;
        clicks: number;
        productViews: number;
        addToCart: number;
      }
    >();
    for (const row of performanceDataset.rows) {
      performanceByRef.set(scalar(row.goods_ref), {
        impressions: scalar(row.impressions),
        clicks: scalar(row.clicks),
        productViews: scalar(row.product_views),
        addToCart: scalar(row.add_to_cart),
      });
    }
    const monthlyByRef = new Map<
      string,
      {
        impressions: number;
        clicks: number;
        productViews: number;
        addToCart: number;
      }
    >();
    for (const row of monthlyDataset.rows) {
      monthlyByRef.set(`${scalar(row.goods_ref)}:${monthScalar(row.month)}`, {
        impressions: scalar(row.impressions),
        clicks: scalar(row.clicks),
        productViews: scalar(row.product_views),
        addToCart: scalar(row.add_to_cart),
      });
    }
    const contentFor = (product: ProductLite) => {
      const required = requiredAttrs[String(product.categoryId)] || [];
      const requiredAttrsConfigured = required.length > 0;
      const missingNames = requiredAttrsConfigured
        ? missingRequiredAttributes(product)
        : [];
      const missing = missingNames.length;
      const photoScore = Math.min(100, (product.imagesCount / 6) * 100);
      const attributeScore = requiredAttrsConfigured
        ? Math.max(0, ((required.length - missing) / required.length) * 100)
        : null;
      const reviewScore = product.reviewsCount > 0 ? 100 : 0;
      return {
        missing,
        missingNames,
        requiredAttrsConfigured,
        photoScore,
        attributeScore,
        reviewScore,
        contentScore:
          attributeScore == null
            ? null
            : Math.round(
                (photoScore * 0.4 + attributeScore * 0.4 + reviewScore * 0.2) *
                  10,
              ) / 10,
      };
    };
    const baseRows = products.map((product) => {
      const metric = performanceByRef.get(product.goodsRef) || {
        impressions: 0,
        clicks: 0,
        productViews: 0,
        addToCart: 0,
      };
      const content = contentFor(product);
      return {
        ...product,
        missingRequiredAttrsCount: content.missing,
        missingRequiredAttrs: content.missingNames,
        requiredAttrsConfigured: content.requiredAttrsConfigured,
        impressions: metric.impressions,
        pdpViews: metric.productViews,
        ctr:
          metric.impressions > 0
            ? (metric.clicks / metric.impressions) * 100
            : null,
        atc:
          metric.productViews > 0
            ? (metric.addToCart / metric.productViews) * 100
            : null,
        contentScore: content.contentScore,
        photoScore: content.photoScore,
        attributeScore: content.attributeScore,
        reviewScore: content.reviewScore,
      };
    });
    const byCategory = new Map<number, typeof baseRows>();
    for (const row of baseRows) {
      const rows = byCategory.get(row.categoryId) || [];
      rows.push(row);
      byCategory.set(row.categoryId, rows);
    }
    const benchmarks = new Map<
      number,
      {
        p75Impressions: number;
        medianCtr: number;
        medianAtc: number;
        medianContent: number | null;
      }
    >();
    for (const [categoryId, rows] of byCategory) {
      benchmarks.set(categoryId, {
        p75Impressions: percentile(
          rows.map((row) => row.impressions),
          0.75,
        ),
        medianCtr: median(
          rows
            .filter((row) => row.impressions >= 500 && row.ctr != null)
            .map((row) => row.ctr || 0),
        ),
        medianAtc: median(
          rows
            .filter((row) => row.pdpViews >= 50 && row.atc != null)
            .map((row) => row.atc || 0),
        ),
        medianContent: rows.some((row) => row.contentScore != null)
          ? median(
              rows
                .filter((row) => row.contentScore != null)
                .map((row) => row.contentScore || 0),
            )
          : null,
      });
    }
    const enriched = baseRows.map((row) => {
      const benchmark = benchmarks.get(row.categoryId)!;
      return {
        ...row,
        categoryP75Impressions: benchmark.p75Impressions,
        categoryMedianCtr: benchmark.medianCtr,
        categoryMedianAtc: benchmark.medianAtc,
        categoryMedianContent: benchmark.medianContent,
      };
    });
    const filteredIds = new Set(filtered.map((product) => product.id));
    const selected = enriched.filter((row) => filteredIds.has(row.id));
    const isHighImpressions = (row: ProductAnalysisRow) =>
      row.impressions >= 500 && row.impressions >= row.categoryP75Impressions;
    const isLowCtr = (row: ProductAnalysisRow) =>
      row.impressions >= 500 &&
      row.ctr != null &&
      row.categoryMedianCtr > 0 &&
      row.ctr < row.categoryMedianCtr * 0.7;
    const isLowAtc = (row: ProductAnalysisRow) =>
      row.pdpViews >= 50 &&
      row.atc != null &&
      row.categoryMedianAtc > 0 &&
      row.atc < row.categoryMedianAtc * 0.7;
    const isPoorContent = (row: ProductAnalysisRow) =>
      row.contentScore != null &&
      row.categoryMedianContent != null &&
      row.contentScore < Math.min(70, row.categoryMedianContent * 0.8);
    productAnalysis.signalCounts = {
      highImpressions: selected.filter(isHighImpressions).length,
      lowCtr: selected.filter(isLowCtr).length,
      lowAtc: selected.filter(isLowAtc).length,
      poorContent: selected.filter(isPoorContent).length,
    };
    productRows = selected.filter((row) => {
      if (filters.productSignal === "highImpressions")
        return isHighImpressions(row);
      if (filters.productSignal === "lowCtr") return isLowCtr(row);
      if (filters.productSignal === "lowAtc") return isLowAtc(row);
      if (filters.productSignal === "poorContent") return isPoorContent(row);
      return true;
    });
    productRows.sort((left, right) => {
      if (filters.productSignal === "lowCtr")
        return (left.ctr ?? Infinity) - (right.ctr ?? Infinity);
      if (filters.productSignal === "lowAtc")
        return (left.atc ?? Infinity) - (right.atc ?? Infinity);
      if (filters.productSignal === "poorContent")
        return (
          (left.contentScore ?? Infinity) - (right.contentScore ?? Infinity)
        );
      return right.impressions - left.impressions;
    });
    const monthConfig = categoryCtrMonths(today);
    const aggregateMonth = (month: string) => {
      let impressions = 0;
      let clicks = 0;
      let productViews = 0;
      let addToCart = 0;
      for (const row of productRows) {
        const metric = monthlyByRef.get(`${row.goodsRef}:${month}`);
        if (!metric) continue;
        impressions += metric.impressions;
        clicks += metric.clicks;
        productViews += metric.productViews;
        addToCart += metric.addToCart;
      }
      return {
        month,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
        atc: productViews > 0 ? (addToCart / productViews) * 100 : null,
      };
    };
    productAnalysis = {
      ...productAnalysis,
      available: performanceDataset.available && monthlyDataset.available,
      error: [performanceDataset.error, monthlyDataset.error]
        .filter(Boolean)
        .join(" · "),
      contentAvailable: baseRows.some((row) => row.requiredAttrsConfigured),
      currentThree: monthConfig.currentThree.map(aggregateMonth),
      lastYear: monthConfig.lastYear.map(aggregateMonth),
    };
  }

  const offset = (filters.page - 1) * filters.limit;
  const outputRows = filters.view === "products" ? productRows : filtered;
  return {
    currentDate: today,
    monthFrom: ranges.currentFrom,
    comparisonDate,
    syncedAt,
    syncState,
    metrics: {
      newProducts: metric(currentNew, previousNew),
      inactiveProducts: metric(currentInactive, previousInactive),
      promoProducts: metric(currentPromo, previousPromo),
      ctr: {
        tile: ctr.tile,
        sanitary: ctr.sanitary,
        deltaTile: ctr.scoreTile,
        deltaSanitary: ctr.scoreSanitary,
        benchmark: ctr.benchmark,
        available: ctr.available,
        improvedTile: ctr.improvedTile,
        improvedSanitary: ctr.improvedSanitary,
        declinedTile: ctr.declinedTile,
        declinedSanitary: ctr.declinedSanitary,
        error: ctr.error || "",
      },
    },
    facets: {
      categories: facetRows(categoryMap),
      brands: facetRows(brandMap),
      statuses: facetRows(statusMap),
      colors: CHART_COLORS,
    },
    rows: outputRows.slice(offset, offset + filters.limit).map((product) => ({
      ...product,
      ...(filters.view === "products"
        ? {}
        : {
            missingRequiredAttrsCount: missingRequiredCount(product),
            requiredAttrsConfigured: Boolean(
              requiredAttrs[String(product.categoryId)]?.length,
            ),
          }),
    })),
    categoryAnalysis,
    categoryCtrAvailable,
    categoryCtrError,
    categoryCtrSummary,
    productAnalysis,
    total: outputRows.length,
    page: filters.page,
    limit: filters.limit,
    totalPages: Math.max(1, Math.ceil(outputRows.length / filters.limit)),
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return NextResponse.json(
    await buildDashboard({
      view: (params.get("view") || "overview") as DashboardFilters["view"],
      page: Number(params.get("page")) || 1,
      limit: Number(params.get("limit")) || 15,
      search: params.get("search") || "",
      categoryId: params.has("categoryId")
        ? Number(params.get("categoryId"))
        : null,
      brandId: params.has("brandId") ? Number(params.get("brandId")) : null,
      statusId: params.has("statusId") ? Number(params.get("statusId")) : null,
      minPrice: params.has("minPrice") ? Number(params.get("minPrice")) : null,
      maxPrice: params.has("maxPrice") ? Number(params.get("maxPrice")) : null,
      minStock: params.has("minStock") ? Number(params.get("minStock")) : null,
      maxStock: params.has("maxStock") ? Number(params.get("maxStock")) : null,
      productSignal: (params.get("productSignal") ||
        null) as DashboardFilters["productSignal"],
    }),
    {
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
      },
    },
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(await buildDashboard(body as DashboardFilters), {
    headers: {
      "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
    },
  });
}
