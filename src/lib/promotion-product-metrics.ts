import { BigQuery } from "@google-cloud/bigquery";
import { normalizeAnalyticsUrl } from "@/lib/promotion-web-funnel";
import type {
  PromotionProductMetricRow,
  PromotionProductMetricsResponse,
} from "@/lib/promotion-product-metrics-types";
import type {
  WebFunnelChannel,
  WebFunnelDevice,
} from "@/lib/promotion-web-funnel-types";
import { fetchDeletedProducts } from "@/lib/products-api";
import { readCompletedSalesProductQuantities } from "@/lib/sales-s3";
import { getSupabase } from "@/lib/supabase";
import {
  listSnapshotDates,
  readAllLite,
  readDailySnapshot,
  type ProductLite,
} from "@/lib/products-store";

const CHANNELS: WebFunnelChannel[] = ["all", "organic", "cpc", "direct"];
const DEVICES: WebFunnelDevice[] = ["all", "mobile", "desktop"];
const MAX_RANKING_ROWS = 250;
const MIN_LIST_IMPRESSIONS = 20;
const MIN_PRODUCT_VIEWS = 20;
const CACHE_TTL_MS = 15 * 60 * 1000;

type ProductMetricQueryRow = {
  goods_ref: number | string | null;
  add_to_cart_events: number | string | null;
  add_to_cart_users: number | string | null;
  list_impressions: number | string | null;
  list_clicks: number | string | null;
  add_to_wishlist_events: number | string | null;
  add_to_wishlist_users: number | string | null;
  product_view_events: number | string | null;
};

type CachedQuery = {
  expiresAt: number;
  rows: ProductMetricQueryRow[];
};

const queryCache = new Map<string, CachedQuery>();

type HistoricalProductMeta = Pick<ProductLite, "goodsRef" | "code" | "name">;

declare global {
  var _promotionHistoricalProductCache: {
    key: string;
    products: Map<number, HistoricalProductMeta>;
  } | undefined;
  var _promotionLegacyProductCache: {
    key: string;
    products: Map<number, HistoricalProductMeta>;
  } | undefined;
}

function getBigQueryProjectId(): string {
  return process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413";
}

function getBigQueryDatasetId(): string {
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

function validateRange(from: string, to: string): void {
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);
  const days = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (days < 1) throw new Error("Дата початку має бути раніше дати завершення");
  if (days > 366) throw new Error("Максимальний період — 366 днів");
}

function buildProductMetricsSql(scope: "sitewide" | "page"): string {
  const projectId = getBigQueryProjectId().replace(/`/g, "");
  const datasetId = getBigQueryDatasetId().replace(/`/g, "");
  const scopedEvents = scope === "sitewide"
    ? `
scoped_events AS (
  SELECT e.*
  FROM events e
  WHERE e.event_name IN ('view_item_list', 'select_item', 'view_item', 'add_to_cart', 'add_to_wishlist')
    AND (@channel = 'all' OR e.channel = @channel)
    AND (@device = 'all' OR e.device = @device)
)`
    : `
landing_candidates AS (
  SELECT
    e.session_key,
    e.user_pseudo_id,
    e.event_timestamp,
    e.channel,
    e.device
  FROM events e
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
    session_key,
    ANY_VALUE(user_pseudo_id HAVING MIN event_timestamp) AS user_pseudo_id,
    ARRAY_AGG(STRUCT(event_timestamp, channel, device) ORDER BY event_timestamp LIMIT 1)[OFFSET(0)] AS first_landing
  FROM landing_candidates
  GROUP BY session_key
),
scoped_events AS (
  SELECT e.*
  FROM landings l
  JOIN events e USING (session_key)
  WHERE e.event_timestamp >= l.first_landing.event_timestamp
    AND e.event_name IN ('view_item_list', 'select_item', 'view_item', 'add_to_cart', 'add_to_wishlist')
    AND (@channel = 'all' OR l.first_landing.channel = @channel)
    AND (@device = 'all' OR l.first_landing.device = @device)
)`;

  return `
WITH base AS (
  SELECT
    event_timestamp,
    event_name,
    user_pseudo_id,
    CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING) AS ga_session_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page_location,
    LOWER(COALESCE(collected_traffic_source.manual_source, traffic_source.source, '')) AS traffic_source_name,
    LOWER(COALESCE(collected_traffic_source.manual_medium, traffic_source.medium, '')) AS traffic_medium,
    collected_traffic_source.gclid AS gclid,
    LOWER(device.category) AS device_category,
    items
  FROM \`${projectId}.${datasetId}.events_*\`
  WHERE _TABLE_SUFFIX BETWEEN @suffixFrom AND @suffixTo
    AND event_name IN ('page_view', 'view_item_list', 'select_item', 'view_item', 'add_to_cart', 'add_to_wishlist')
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
${scopedEvents},
item_events AS (
  SELECT
    e.event_name,
    e.event_timestamp,
    e.user_pseudo_id,
    e.session_key,
    SAFE_CAST(NULLIF(TRIM(item.item_id), '') AS INT64) AS goods_ref
  FROM scoped_events e
  CROSS JOIN UNNEST(e.items) AS item
  WHERE SAFE_CAST(NULLIF(TRIM(item.item_id), '') AS INT64) IS NOT NULL
),
cart AS (
  SELECT
    goods_ref,
    COUNT(*) AS add_to_cart_events,
    COUNT(DISTINCT user_pseudo_id) AS add_to_cart_users
  FROM item_events
  WHERE event_name = 'add_to_cart'
  GROUP BY goods_ref
),
wishlist AS (
  SELECT
    goods_ref,
    COUNT(*) AS add_to_wishlist_events,
    COUNT(DISTINCT user_pseudo_id) AS add_to_wishlist_users
  FROM item_events
  WHERE event_name = 'add_to_wishlist'
  GROUP BY goods_ref
),
product_views AS (
  SELECT
    goods_ref,
    COUNT(*) AS product_view_events
  FROM item_events
  WHERE event_name = 'view_item'
  GROUP BY goods_ref
),
list_metrics AS (
  SELECT
    goods_ref,
    COUNTIF(event_name = 'view_item_list') AS list_impressions,
    COUNTIF(event_name = 'select_item') AS list_clicks
  FROM item_events
  WHERE event_name IN ('view_item_list', 'select_item')
  GROUP BY goods_ref
),
goods_refs AS (
  SELECT goods_ref FROM cart
  UNION DISTINCT SELECT goods_ref FROM wishlist
  UNION DISTINCT SELECT goods_ref FROM product_views
  UNION DISTINCT SELECT goods_ref FROM list_metrics
)
SELECT
  goods_refs.goods_ref,
  COALESCE(cart.add_to_cart_events, 0) AS add_to_cart_events,
  COALESCE(cart.add_to_cart_users, 0) AS add_to_cart_users,
  COALESCE(list_metrics.list_impressions, 0) AS list_impressions,
  COALESCE(list_metrics.list_clicks, 0) AS list_clicks,
  COALESCE(wishlist.add_to_wishlist_events, 0) AS add_to_wishlist_events,
  COALESCE(wishlist.add_to_wishlist_users, 0) AS add_to_wishlist_users,
  COALESCE(product_views.product_view_events, 0) AS product_view_events
FROM goods_refs
LEFT JOIN cart USING (goods_ref)
LEFT JOIN wishlist USING (goods_ref)
LEFT JOIN product_views USING (goods_ref)
LEFT JOIN list_metrics USING (goods_ref)
`;
}

function numberValue(value: number | string | null): number {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function topRows(
  rows: PromotionProductMetricRow[],
  predicate: (row: PromotionProductMetricRow) => boolean,
  compare: (left: PromotionProductMetricRow, right: PromotionProductMetricRow) => number,
): { rows: PromotionProductMetricRow[]; total: number } {
  const matching = rows.filter(predicate).sort(compare);
  return { rows: matching.slice(0, MAX_RANKING_ROWS), total: matching.length };
}

async function readHistoricalProductMeta(targetDate: string): Promise<Map<number, HistoricalProductMeta>> {
  const snapshots = await listSnapshotDates();
  if (snapshots.length === 0) return new Map();
  const newest = snapshots[0]?.date;
  const oldest = snapshots[snapshots.length - 1]?.date;
  const closest = snapshots.find((snapshot) => snapshot.date <= targetDate)?.date || newest;
  const selectedDates = [...new Set([closest, newest, oldest].filter(Boolean) as string[])];
  const key = selectedDates.join(":");
  const cached = global._promotionHistoricalProductCache;
  if (cached?.key === key) return cached.products;

  const products = new Map<number, HistoricalProductMeta>();
  const historicalSnapshots = await Promise.all(selectedDates.map((date) => readDailySnapshot(date)));
  for (const snapshot of historicalSnapshots) {
    for (const product of snapshot?.products || []) {
      if (!products.has(product.goodsRef) && product.code) {
        products.set(product.goodsRef, {
          goodsRef: product.goodsRef,
          code: product.code,
          name: product.name,
        });
      }
    }
  }
  global._promotionHistoricalProductCache = { key, products };
  return products;
}

async function readLegacyProductMeta(goodsRefs: number[]): Promise<Map<number, HistoricalProductMeta>> {
  const uniqueRefs = [...new Set(goodsRefs)].sort((left, right) => left - right);
  if (uniqueRefs.length === 0) return new Map();
  const key = uniqueRefs.join(",");
  const cached = global._promotionLegacyProductCache;
  if (cached?.key === key) return cached.products;
  const products = new Map<number, HistoricalProductMeta>();
  try {
    const db = getSupabase();
    for (let offset = 0; offset < uniqueRefs.length; offset += 500) {
      const chunk = uniqueRefs.slice(offset, offset + 500);
      const { data, error } = await db
        .from("products")
        .select("goods_ref, code, name")
        .in("goods_ref", chunk)
        .range(0, 999);
      if (error) throw new Error(error.message);
      for (const product of data || []) {
        const goodsRef = Number(product.goods_ref);
        const code = Number(product.code);
        if (!Number.isFinite(goodsRef) || !Number.isFinite(code) || code <= 0) continue;
        products.set(goodsRef, {
          goodsRef,
          code,
          name: String(product.name || `goods_ref ${goodsRef}`),
        });
      }
    }
  } catch {
    // Historical metadata is an export aid only; analytics must stay usable
    // when the competitor-parser database is temporarily unavailable.
  }
  global._promotionLegacyProductCache = { key, products };
  return products;
}

export async function readPromotionProductMetrics(input: {
  url: string;
  from: string;
  to: string;
  channel: WebFunnelChannel;
  device: WebFunnelDevice;
  includeOutOfStock: boolean;
  compact?: boolean;
}): Promise<PromotionProductMetricsResponse> {
  const { requestedUrl, normalizedUrl } = normalizeAnalyticsUrl(input.url);
  const scope = normalizedUrl === "agromat.ua" ? "sitewide" : "page";
  validateRange(input.from, input.to);
  const channel = CHANNELS.includes(input.channel) ? input.channel : "all";
  const device = DEVICES.includes(input.device) ? input.device : "all";
  const cacheKey = `${normalizedUrl}:${input.from}:${input.to}:${channel}:${device}`;
  const cached = queryCache.get(cacheKey);
  let queryRows: ProductMetricQueryRow[];

  if (cached && cached.expiresAt > Date.now()) {
    queryRows = cached.rows;
  } else {
    const bigQuery = new BigQuery({ projectId: getBigQueryProjectId() });
    const [rows] = await bigQuery.query({
      query: buildProductMetricsSql(scope),
      params: {
        normalizedUrl,
        suffixFrom: input.from.replaceAll("-", ""),
        suffixTo: input.to.replaceAll("-", ""),
        channel,
        device,
      },
      location: "EU",
      maximumBytesBilled: "50000000000",
    });
    queryRows = rows as ProductMetricQueryRow[];
    queryCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, rows: queryRows });
  }

  const [products, soldQtyByCode, deletedProducts] = await Promise.all([
    readAllLite(),
    readCompletedSalesProductQuantities({ from: input.from, to: input.to }),
    fetchDeletedProducts(),
  ]);
  const productsByGoodsRef = new Map(products.map((product) => [product.goodsRef, product]));
  const deletedProductsByGoodsRef = new Map(deletedProducts.map((product) => [product.goods_ref, product]));
  const unmatchedRefs = queryRows
    .map((row) => numberValue(row.goods_ref))
    .filter((goodsRef) => !productsByGoodsRef.has(goodsRef));
  const [historicalProducts, legacyProducts] = await Promise.all([
    readHistoricalProductMeta(input.to),
    readLegacyProductMeta(unmatchedRefs),
  ]);
  const rows = queryRows.map((row): PromotionProductMetricRow => {
    const goodsRef = numberValue(row.goods_ref);
    const product = productsByGoodsRef.get(goodsRef);
    const deletedProduct = deletedProductsByGoodsRef.get(goodsRef);
    const legacyProduct = legacyProducts.get(goodsRef);
    const historicalProduct = historicalProducts.get(goodsRef);
    const listImpressions = numberValue(row.list_impressions);
    const listClicks = numberValue(row.list_clicks);
    const code = product?.code ?? deletedProduct?.code ?? legacyProduct?.code ?? historicalProduct?.code ?? null;
    const stockQty = product?.stockQty ?? null;
    const productViews = numberValue(row.product_view_events);
    const soldQty = code == null ? 0 : soldQtyByCode.get(code) || 0;
    return {
      goodsRef,
      code,
      name: product?.name || deletedProduct?.name || legacyProduct?.name || historicalProduct?.name || `goods_ref ${goodsRef}`,
      url: product?.url || null,
      stockQty,
      inStock: stockQty != null && stockQty > 1,
      addToCartEvents: numberValue(row.add_to_cart_events),
      addToCartUsers: numberValue(row.add_to_cart_users),
      listImpressions,
      listClicks,
      listToProductConversionPct: listImpressions > 0
        ? (listClicks / listImpressions) * 100
        : null,
      addToWishlistEvents: numberValue(row.add_to_wishlist_events),
      addToWishlistUsers: numberValue(row.add_to_wishlist_users),
      productViews,
      soldQty,
      productToSaleConversionPct: productViews > 0 ? (soldQty / productViews) * 100 : null,
    };
  });
  const missingProducts = rows
    .filter((row) => !productsByGoodsRef.has(row.goodsRef) && row.code != null)
    .map((row) => ({ goodsRef: row.goodsRef, code: row.code, name: row.name }))
    .sort((left, right) => (left.code ?? Number.MAX_SAFE_INTEGER) - (right.code ?? Number.MAX_SAFE_INTEGER));
  const stockRows = input.includeOutOfStock ? rows : rows.filter((row) => row.inStock);
  const addToCart = topRows(
    stockRows,
    (row) => row.addToCartEvents > 0,
    (left, right) => right.addToCartEvents - left.addToCartEvents
      || right.addToCartUsers - left.addToCartUsers
      || left.name.localeCompare(right.name, "uk"),
  );
  const listToProduct = topRows(
    stockRows,
    (row) => row.listImpressions >= MIN_LIST_IMPRESSIONS,
    (left, right) => (right.listToProductConversionPct || 0) - (left.listToProductConversionPct || 0)
      || right.listClicks - left.listClicks
      || right.listImpressions - left.listImpressions
      || left.name.localeCompare(right.name, "uk"),
  );
  const addToWishlist = topRows(
    stockRows,
    (row) => row.addToWishlistEvents > 0,
    (left, right) => right.addToWishlistEvents - left.addToWishlistEvents
      || right.addToWishlistUsers - left.addToWishlistUsers
      || left.name.localeCompare(right.name, "uk"),
  );
  const productToSale = topRows(
    stockRows,
    (row) => row.productViews >= MIN_PRODUCT_VIEWS && row.soldQty > 0,
    (left, right) => (right.productToSaleConversionPct || 0) - (left.productToSaleConversionPct || 0)
      || right.soldQty - left.soldQty
      || right.productViews - left.productViews
      || left.name.localeCompare(right.name, "uk"),
  );
  const antiListToProduct = topRows(
    stockRows,
    (row) => row.listImpressions >= MIN_LIST_IMPRESSIONS,
    (left, right) => (left.listToProductConversionPct || 0) - (right.listToProductConversionPct || 0)
      || right.listImpressions - left.listImpressions
      || left.listClicks - right.listClicks
      || left.name.localeCompare(right.name, "uk"),
  );
  const antiProductToSale = topRows(
    stockRows,
    (row) => row.productViews >= MIN_PRODUCT_VIEWS,
    (left, right) => (left.productToSaleConversionPct || 0) - (right.productToSaleConversionPct || 0)
      || right.productViews - left.productViews
      || left.soldQty - right.soldQty
      || left.name.localeCompare(right.name, "uk"),
  );

  return {
    requestedUrl,
    normalizedUrl,
    scope,
    countryFilter: "Ukraine",
    from: input.from,
    to: input.to,
    channel,
    device,
    includeOutOfStock: input.includeOutOfStock,
    generatedAt: new Date().toISOString(),
    tracking: {
      addToCartEvents: rows.reduce((sum, row) => sum + row.addToCartEvents, 0),
      viewItemListEvents: rows.reduce((sum, row) => sum + row.listImpressions, 0),
      selectItemEvents: rows.reduce((sum, row) => sum + row.listClicks, 0),
      addToWishlistEvents: rows.reduce((sum, row) => sum + row.addToWishlistEvents, 0),
      productViewEvents: rows.reduce((sum, row) => sum + row.productViews, 0),
      unmatchedGoodsRefs: missingProducts.length,
    },
    missingProducts: input.compact ? [] : missingProducts,
    rankings: {
      addToCart: input.compact ? [] : addToCart.rows,
      listToProduct: input.compact ? listToProduct.rows.slice(0, 20) : listToProduct.rows,
      addToWishlist: input.compact ? [] : addToWishlist.rows,
      productToSale: input.compact ? productToSale.rows.slice(0, 20) : productToSale.rows,
      antiListToProduct: input.compact ? antiListToProduct.rows.slice(0, 20) : antiListToProduct.rows,
      antiProductToSale: input.compact ? antiProductToSale.rows.slice(0, 20) : antiProductToSale.rows,
    },
    totals: {
      addToCart: addToCart.total,
      listToProduct: listToProduct.total,
      addToWishlist: addToWishlist.total,
      productToSale: productToSale.total,
      antiListToProduct: antiListToProduct.total,
      antiProductToSale: antiProductToSale.total,
    },
  };
}
