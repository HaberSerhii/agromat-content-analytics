import { BigQuery } from "@google-cloud/bigquery";
import {
  bigQueryCacheDay,
  readThroughBigQueryCache,
} from "@/lib/bigquery-result-cache";
import { readAllLite } from "@/lib/products-store";
import {
  readCompletedSalesProductQuantities,
  readFormedSalesProductQuantities,
} from "@/lib/sales-s3";

export type SalesWebMetricMonth = {
  month: string;
  visits: number;
  carts: number;
  cartItems: number;
  avgCartItems: number | null;
};

export type SalesWebMetricsDataset = {
  mode: "live" | "demo";
  notice: string | null;
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
  conversions: {
    definition: string;
    minimumViews: number;
    categories: SalesConversionRow[];
    brands: SalesConversionRow[];
    products: SalesConversionRow[];
  };
};

export type SalesConversionRow = {
  key: string;
  label: string;
  views: number;
  orderedQty: number;
  soldQty: number;
  conversionPct: number;
  url?: string;
};

type QueryRow = {
  month: string | { value?: string } | null;
  visits: number | string | null;
  carts: number | string | null;
  cart_items: number | string | null;
  avg_cart_items: number | string | null;
  data_through: string | { value?: string } | null;
};

type ProductViewQueryRow = {
  goods_ref: number | string | null;
  views: number | string | null;
};

const MIN_CONVERSION_VIEWS = 20;
const CONVERSION_LIMIT = 20;
const DEMO_NOTICE = "Тестові дані для локального перегляду. У production метрики беруться з BigQuery та каталогу товарів — тих самих джерел, що й «Аналіз карток товару».";

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

function buildProductViewsSql() {
  const project = projectId().replace(/`/g, "");
  const dataset = datasetId().replace(/`/g, "");
  return `
SELECT
  SAFE_CAST(NULLIF(TRIM(item.item_id), '') AS INT64) AS goods_ref,
  COUNT(*) AS views
FROM \`${project}.${dataset}.events_*\` AS event
CROSS JOIN UNNEST(event.items) AS item
WHERE _TABLE_SUFFIX BETWEEN @suffixFrom AND @suffixTo
  AND event.event_name = 'view_item'
  AND event.geo.country = 'Ukraine'
  AND SAFE_CAST(NULLIF(TRIM(item.item_id), '') AS INT64) IS NOT NULL
GROUP BY goods_ref
`;
}

function conversionPct(soldQty: number, views: number) {
  return views > 0 ? (soldQty / views) * 100 : 0;
}

function monthKeys(from: string, to: string) {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 12));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 12));
  const result: string[] = [];
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

function demoConversionRows(labels: string[], kind: "category" | "brand" | "product"): SalesConversionRow[] {
  const baseViews = kind === "category" ? 8_400 : kind === "brand" ? 6_200 : 1_450;
  const viewStep = kind === "category" ? 247 : kind === "brand" ? 193 : 47;
  return labels.map((label, index) => {
    const views = baseViews - index * viewStep;
    const targetConversion = 12.6 - index * 0.48;
    const orderedQty = Math.max(1, Math.round(views * targetConversion / 100));
    return {
      key: `${kind}-${index + 1}`,
      label,
      views,
      orderedQty,
      soldQty: Math.round(orderedQty * 0.82),
      conversionPct: conversionPct(orderedQty, views),
    };
  });
}

export function buildDemoSalesWebMetrics(input: { from: string; to: string }): SalesWebMetricsDataset {
  const range = normalizeRange(input.from, input.to);
  const months = monthKeys(range.from, range.to).map((month, index): SalesWebMetricMonth => {
    const visits = 24_800 + index * 2_140 + (index % 3) * 780;
    const carts = Math.round(visits * (0.079 + (index % 4) * 0.004));
    const avgCartItems = 2.34 + (index % 5) * 0.13;
    const cartItems = Math.round(carts * avgCartItems);
    return { month, visits, carts, cartItems, avgCartItems: cartItems / carts };
  });
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

  const categories = [
    "Плитка для підлоги", "Керамограніт", "Змішувачі", "Унітази", "Раковини",
    "Ванни", "Душові системи", "Інсталяції", "Меблі для ванної", "Ламінат",
    "Вініл", "Мозаїка", "Клінкер", "Водонагрівачі", "Кухонні мийки",
    "Дзеркала", "Рушникосушки", "Сифони", "Клеї", "Затирки",
  ];
  const brands = [
    "Cersanit", "Grohe", "Geberit", "Hansgrohe", "Devit", "Baldocer", "Opoczno",
    "Villeroy & Boch", "Kaldewei", "Cerrad", "Primera", "Viega", "Tece", "Paffoni",
    "Simas", "EcoFlow", "Ceramika Gres", "Mainzu", "APE", "Golden Tile",
  ];
  const products = [
    "Керамограніт Urban Sand 60×60", "Змішувач Eurosmart для умивальника", "Інсталяція Duofix комплект",
    "Унітаз підвісний City Clean", "Плитка Calacatta White 60×120", "Душова система Raindance",
    "Раковина накладна Forma 55", "Ванна акрилова Comfort 170", "Кухонна мийка Linea 50",
    "Тумба з умивальником Loft 80", "Ламінат Oak Natural 8 мм", "Дзеркало LED Smart 80",
    "Змішувач для кухні Focus", "Керамограніт Stone Grey 30×60", "Рушникосушка Classic 500",
    "Сифон для умивальника Compact", "Мозаїка Marble Mix", "Клей для плитки ProFlex 25 кг",
    "Затирка Color 2 кг", "Клінкер фасадний Terra",
  ];

  return {
    mode: "demo",
    notice: DEMO_NOTICE,
    filter: { ...range, country: "Ukraine" },
    definition: {
      visits: "Демонстраційні GA4-сесії (session_start)",
      averageCartItems: "Демонстраційна середня кількість товарів у begin_checkout",
    },
    dataThrough: range.to,
    months,
    totals,
    conversions: {
      definition: "Продані одиниці у повністю завершених замовленнях / перегляди картки товару",
      minimumViews: MIN_CONVERSION_VIEWS,
      categories: demoConversionRows(categories, "category"),
      brands: demoConversionRows(brands, "brand"),
      products: demoConversionRows(products, "product"),
    },
  };
}

async function readConversionRankings(range: { from: string; to: string }) {
  const cacheKey = `${range.from}:${range.to}`;
  const [viewRows, products, orderedQtyByCode, soldQtyByCode] = await Promise.all([
    readThroughBigQueryCache<ProductViewQueryRow[]>({
      namespace: "sales-conversion-product-views",
      key: `v1:${bigQueryCacheDay()}:${projectId()}:${datasetId()}:${cacheKey}`,
      load: async () => {
        const bigQuery = new BigQuery({ projectId: projectId() });
        const [rows] = await bigQuery.query({
          query: buildProductViewsSql(),
          params: {
            suffixFrom: range.from.replaceAll("-", ""),
            suffixTo: range.to.replaceAll("-", ""),
          },
          location: "EU",
          maximumBytesBilled: "50000000000",
        });
        return rows as ProductViewQueryRow[];
      },
    }),
    readAllLite(),
    readFormedSalesProductQuantities(range),
    readCompletedSalesProductQuantities(range),
  ]);
  const productsByGoodsRef = new Map(products.map((product) => [product.goodsRef, product]));
  const categoryTotals = new Map<string, { views: number; orderedQty: number; soldQty: number }>();
  const brandTotals = new Map<string, { views: number; orderedQty: number; soldQty: number }>();
  const productRows: SalesConversionRow[] = [];

  for (const row of viewRows) {
    const goodsRef = scalar(row.goods_ref);
    const views = scalar(row.views);
    const product = productsByGoodsRef.get(goodsRef);
    if (!product || views <= 0) continue;
    const orderedQty = orderedQtyByCode.get(product.code) || 0;
    const soldQty = soldQtyByCode.get(product.code) || 0;
    const category = product.categoryName || "Без категорії";
    const brand = product.brand || "Без бренду";
    const categoryTotal = categoryTotals.get(category) || { views: 0, orderedQty: 0, soldQty: 0 };
    categoryTotal.views += views;
    categoryTotal.orderedQty += orderedQty;
    categoryTotal.soldQty += soldQty;
    categoryTotals.set(category, categoryTotal);
    const brandTotal = brandTotals.get(brand) || { views: 0, orderedQty: 0, soldQty: 0 };
    brandTotal.views += views;
    brandTotal.orderedQty += orderedQty;
    brandTotal.soldQty += soldQty;
    brandTotals.set(brand, brandTotal);
    if (views >= MIN_CONVERSION_VIEWS && orderedQty > 0) {
      productRows.push({
        key: String(product.code),
        label: product.name,
        views,
        orderedQty,
        soldQty,
        conversionPct: conversionPct(orderedQty, views),
        url: product.url,
      });
    }
  }

  const groupedRows = (totals: Map<string, { views: number; orderedQty: number; soldQty: number }>): SalesConversionRow[] => (
    [...totals.entries()]
      .filter(([, value]) => value.views >= MIN_CONVERSION_VIEWS && value.orderedQty > 0)
      .map(([label, value]) => ({
        key: label,
        label,
        views: value.views,
        orderedQty: value.orderedQty,
        soldQty: value.soldQty,
        conversionPct: conversionPct(value.orderedQty, value.views),
      }))
      .sort((left, right) => right.conversionPct - left.conversionPct || right.orderedQty - left.orderedQty)
      .slice(0, CONVERSION_LIMIT)
  );
  productRows.sort((left, right) => right.conversionPct - left.conversionPct || right.orderedQty - left.orderedQty);
  return {
    definition: "Оформлені одиниці у замовленнях зі статусом «Сформовано» / перегляди картки товару; факт — повністю відвантажені одиниці",
    minimumViews: MIN_CONVERSION_VIEWS,
    categories: groupedRows(categoryTotals),
    brands: groupedRows(brandTotals),
    products: productRows.slice(0, CONVERSION_LIMIT),
  };
}

export async function readSalesWebMetrics(input: {
  from: string;
  to: string;
}): Promise<SalesWebMetricsDataset> {
  const range = normalizeRange(input.from, input.to);
  const cacheKey = `${range.from}:${range.to}`;
  const [rows, conversions] = await Promise.all([
    readThroughBigQueryCache<QueryRow[]>({
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
    }),
    readConversionRankings(range),
  ]);
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
    mode: "live",
    notice: null,
    filter: { ...range, country: "Ukraine" },
    definition: {
      visits: "Унікальні GA4-сесії (session_start)",
      averageCartItems: "Середня сума item.quantity у події begin_checkout",
    },
    dataThrough: dateScalar(rows[0]?.data_through ?? null),
    months,
    totals,
    conversions,
  };
  return value;
}
