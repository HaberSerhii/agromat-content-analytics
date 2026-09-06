import { BigQuery } from "@google-cloud/bigquery";
import {
  bigQueryCacheDay,
  readThroughBigQueryCache,
} from "@/lib/bigquery-result-cache";
import { readAllLite } from "@/lib/products-store";
import {
  readCompletedSalesProductOrderRefs,
} from "@/lib/sales-s3";

export type SalesWebMetricMonth = {
  month: string;
  visits: number;
  addToCartSessions: number;
  addToCartItems: number;
  sessionToCartPct: number;
  avgCartItemsPerSession: number | null;
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
    addToCart: string;
    sessionToCart: string;
  };
  dataThrough: string | null;
  months: SalesWebMetricMonth[];
  totals: {
    visits: number;
    addToCartSessions: number;
    addToCartItems: number;
    sessionToCartPct: number;
    avgCartItemsPerSession: number | null;
  };
  conversions: {
    definition: string;
    categories: SalesConversionRow[];
    brands: SalesConversionRow[];
    products: SalesConversionRow[];
  };
};

export type SalesConversionRow = {
  key: string;
  label: string;
  addToCartSessions: number;
  addToCartItems: number;
  actualOrders: number;
  conversionPct: number;
  url?: string;
};

type QueryRow = {
  month: string | { value?: string } | null;
  visits: number | string | null;
  add_to_cart_sessions: number | string | null;
  add_to_cart_items: number | string | null;
  session_to_cart_pct: number | string | null;
  avg_cart_items_per_session: number | string | null;
  data_through: string | { value?: string } | null;
};

type ProductAddToCartQueryRow = {
  goods_ref: number | string | null;
  session_key: string | null;
  add_to_cart_items: number | string | null;
  total_sessions: number | string | null;
};

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
    AND event_name IN ('session_start', 'add_to_cart')
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
add_to_cart_events AS (
  SELECT
    DATE_TRUNC(event_day, MONTH) AS month,
    CONCAT(
      user_pseudo_id,
      '/',
      COALESCE(ga_session_id, CAST(event_timestamp AS STRING))
    ) AS session_key,
    SUM(COALESCE(item.quantity, 1)) AS add_to_cart_items
  FROM base
  CROSS JOIN UNNEST(items) AS item
  WHERE event_name = 'add_to_cart'
    AND user_pseudo_id IS NOT NULL
  GROUP BY month, session_key, event_timestamp
),
add_to_cart_sessions AS (
  SELECT
    month,
    session_key,
    SUM(add_to_cart_items) AS add_to_cart_items
  FROM add_to_cart_events
  GROUP BY month, session_key
),
add_to_cart_summary AS (
  SELECT
    month,
    COUNT(*) AS add_to_cart_sessions,
    SUM(add_to_cart_items) AS add_to_cart_items,
    AVG(add_to_cart_items) AS avg_cart_items_per_session
  FROM add_to_cart_sessions
  GROUP BY month
),
freshness AS (
  SELECT MAX(event_day) AS data_through FROM base
)
SELECT
  FORMAT_DATE('%Y-%m', calendar.month) AS month,
  COALESCE(visits.visits, 0) AS visits,
  COALESCE(add_to_cart_summary.add_to_cart_sessions, 0) AS add_to_cart_sessions,
  COALESCE(add_to_cart_summary.add_to_cart_items, 0) AS add_to_cart_items,
  SAFE_DIVIDE(COALESCE(add_to_cart_summary.add_to_cart_sessions, 0), COALESCE(visits.visits, 0)) * 100 AS session_to_cart_pct,
  add_to_cart_summary.avg_cart_items_per_session,
  FORMAT_DATE('%Y-%m-%d', freshness.data_through) AS data_through
FROM calendar
LEFT JOIN visits USING (month)
LEFT JOIN add_to_cart_summary USING (month)
CROSS JOIN freshness
ORDER BY calendar.month
`;
}

function buildProductAddToCartSql() {
  const project = projectId().replace(/`/g, "");
  const dataset = datasetId().replace(/`/g, "");
  return `
WITH total_sessions AS (
  SELECT COUNT(DISTINCT CONCAT(
    user_pseudo_id,
    '/',
    COALESCE(
      CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING),
      CAST(event_timestamp AS STRING)
    )
  )) AS total_sessions
  FROM \`${project}.${dataset}.events_*\`
  WHERE _TABLE_SUFFIX BETWEEN @suffixFrom AND @suffixTo
    AND event_name = 'session_start'
    AND geo.country = 'Ukraine'
    AND user_pseudo_id IS NOT NULL
),
cart_rows AS (
SELECT
  SAFE_CAST(NULLIF(TRIM(item.item_id), '') AS INT64) AS goods_ref,
  CONCAT(
    event.user_pseudo_id,
    '/',
    COALESCE(
      CAST((SELECT value.int_value FROM UNNEST(event.event_params) WHERE key = 'ga_session_id') AS STRING),
      CAST(event.event_timestamp AS STRING)
    )
  ) AS session_key,
  SUM(COALESCE(item.quantity, 1)) AS add_to_cart_items
FROM \`${project}.${dataset}.events_*\` AS event
CROSS JOIN UNNEST(event.items) AS item
WHERE _TABLE_SUFFIX BETWEEN @suffixFrom AND @suffixTo
  AND event.event_name = 'add_to_cart'
  AND event.geo.country = 'Ukraine'
  AND event.user_pseudo_id IS NOT NULL
  AND SAFE_CAST(NULLIF(TRIM(item.item_id), '') AS INT64) IS NOT NULL
GROUP BY goods_ref, session_key
)
SELECT
  cart_rows.goods_ref,
  cart_rows.session_key,
  cart_rows.add_to_cart_items,
  total_sessions.total_sessions
FROM cart_rows
CROSS JOIN total_sessions
`;
}

function conversionPct(addToCartSessions: number, totalSessions: number) {
  return totalSessions > 0 ? (addToCartSessions / totalSessions) * 100 : 0;
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
  const baseSessions = kind === "category" ? 24_800 : kind === "brand" ? 18_600 : 6_400;
  const sessionStep = kind === "category" ? 247 : kind === "brand" ? 193 : 47;
  const totalSessions = 240_000;
  return labels.map((label, index) => {
    const addToCartSessions = Math.max(1, baseSessions - index * sessionStep);
    const addToCartItems = Math.round(addToCartSessions * (1.35 + (index % 4) * 0.12));
    return {
      key: `${kind}-${index + 1}`,
      label,
      addToCartSessions,
      addToCartItems,
      actualOrders: Math.max(1, Math.round(addToCartSessions * 0.16)),
      conversionPct: conversionPct(addToCartSessions, totalSessions),
    };
  });
}

export function buildDemoSalesWebMetrics(input: { from: string; to: string }): SalesWebMetricsDataset {
  const range = normalizeRange(input.from, input.to);
  const months = monthKeys(range.from, range.to).map((month, index): SalesWebMetricMonth => {
    const visits = 24_800 + index * 2_140 + (index % 3) * 780;
    const addToCartSessions = Math.round(visits * (0.079 + (index % 4) * 0.004));
    const avgCartItemsPerSession = 1.34 + (index % 5) * 0.13;
    const addToCartItems = Math.round(addToCartSessions * avgCartItemsPerSession);
    return {
      month,
      visits,
      addToCartSessions,
      addToCartItems,
      sessionToCartPct: conversionPct(addToCartSessions, visits),
      avgCartItemsPerSession: addToCartItems / addToCartSessions,
    };
  });
  const totals = months.reduce(
    (summary, month) => ({
      visits: summary.visits + month.visits,
      addToCartSessions: summary.addToCartSessions + month.addToCartSessions,
      addToCartItems: summary.addToCartItems + month.addToCartItems,
      sessionToCartPct: 0,
      avgCartItemsPerSession: null,
    }),
    {
      visits: 0,
      addToCartSessions: 0,
      addToCartItems: 0,
      sessionToCartPct: 0,
      avgCartItemsPerSession: null as number | null,
    },
  );
  totals.sessionToCartPct = conversionPct(totals.addToCartSessions, totals.visits);
  totals.avgCartItemsPerSession = totals.addToCartSessions > 0
    ? totals.addToCartItems / totals.addToCartSessions
    : null;

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
      addToCart: "Демонстраційні GA4-додавання в кошик (add_to_cart)",
      sessionToCart: "Демонстраційна частка сесій з add_to_cart від усіх сесій",
    },
    dataThrough: range.to,
    months,
    totals,
    conversions: {
      definition: "Сесії з add_to_cart / усі GA4-сесії; факт — кількість повністю відвантажених замовлень",
      categories: demoConversionRows(categories, "category"),
      brands: demoConversionRows(brands, "brand"),
      products: demoConversionRows(products, "product"),
    },
  };
}

async function readConversionRankings(range: { from: string; to: string }) {
  const cacheKey = `${range.from}:${range.to}`;
  const [cartRows, products, actualOrderRefsByCode] = await Promise.all([
    readThroughBigQueryCache<ProductAddToCartQueryRow[]>({
      namespace: "sales-conversion-add-to-cart",
      key: `v1:${bigQueryCacheDay()}:${projectId()}:${datasetId()}:${cacheKey}`,
      load: async () => {
        const bigQuery = new BigQuery({ projectId: projectId() });
        const [rows] = await bigQuery.query({
          query: buildProductAddToCartSql(),
          params: {
            suffixFrom: range.from.replaceAll("-", ""),
            suffixTo: range.to.replaceAll("-", ""),
          },
          location: "EU",
          maximumBytesBilled: "50000000000",
        });
        return rows as ProductAddToCartQueryRow[];
      },
    }),
    readAllLite(),
    readCompletedSalesProductOrderRefs(range),
  ]);
  const productsByGoodsRef = new Map(products.map((product) => [product.goodsRef, product]));
  const categoryTotals = new Map<string, { sessions: Set<string>; items: number; actualOrders: Set<string> }>();
  const brandTotals = new Map<string, { sessions: Set<string>; items: number; actualOrders: Set<string> }>();
  const productTotals = new Map<number, { sessions: Set<string>; items: number }>();
  let totalSessions = 0;
  const productRows: SalesConversionRow[] = [];

  for (const row of cartRows) {
    const goodsRef = scalar(row.goods_ref);
    const product = productsByGoodsRef.get(goodsRef);
    if (!product || !row.session_key) continue;
    totalSessions = Math.max(totalSessions, scalar(row.total_sessions));
    const addToCartItems = scalar(row.add_to_cart_items);
    const productTotal = productTotals.get(product.code) || { sessions: new Set<string>(), items: 0 };
    productTotal.sessions.add(row.session_key);
    productTotal.items += addToCartItems;
    productTotals.set(product.code, productTotal);
    const category = product.categoryName || "Без категорії";
    const brand = product.brand || "Без бренду";
    const actualOrders = actualOrderRefsByCode.get(product.code) || new Set<string>();
    const categoryTotal = categoryTotals.get(category) || { sessions: new Set<string>(), items: 0, actualOrders: new Set<string>() };
    categoryTotal.sessions.add(row.session_key);
    categoryTotal.items += addToCartItems;
    for (const order of actualOrders) categoryTotal.actualOrders.add(order);
    categoryTotals.set(category, categoryTotal);
    const brandTotal = brandTotals.get(brand) || { sessions: new Set<string>(), items: 0, actualOrders: new Set<string>() };
    brandTotal.sessions.add(row.session_key);
    brandTotal.items += addToCartItems;
    for (const order of actualOrders) brandTotal.actualOrders.add(order);
    brandTotals.set(brand, brandTotal);
  }

  for (const [code, value] of productTotals) {
    const product = products.find((item) => item.code === code);
    if (!product) continue;
    productRows.push({
      key: String(product.code),
      label: product.name,
      addToCartSessions: value.sessions.size,
      addToCartItems: value.items,
      actualOrders: actualOrderRefsByCode.get(code)?.size || 0,
      conversionPct: conversionPct(value.sessions.size, totalSessions),
      url: product.url,
    });
  }

  const groupedRows = (totals: Map<string, { sessions: Set<string>; items: number; actualOrders: Set<string> }>): SalesConversionRow[] => (
    [...totals.entries()]
      .filter(([, value]) => value.sessions.size > 0)
      .map(([label, value]) => ({
        key: label,
        label,
        addToCartSessions: value.sessions.size,
        addToCartItems: value.items,
        actualOrders: value.actualOrders.size,
        conversionPct: conversionPct(value.sessions.size, totalSessions),
      }))
      .sort((left, right) => right.conversionPct - left.conversionPct || right.addToCartSessions - left.addToCartSessions)
      .slice(0, CONVERSION_LIMIT)
  );
  productRows.sort((left, right) => right.conversionPct - left.conversionPct || right.addToCartSessions - left.addToCartSessions);
  return {
    definition: "Сесії з add_to_cart / усі GA4-сесії; факт — кількість повністю відвантажених замовлень",
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
      namespace: "sales-web-metrics-v2",
      key: `v2:${bigQueryCacheDay()}:${projectId()}:${datasetId()}:${cacheKey}`,
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
    addToCartSessions: scalar(row.add_to_cart_sessions),
    addToCartItems: scalar(row.add_to_cart_items),
    sessionToCartPct: scalar(row.session_to_cart_pct),
    avgCartItemsPerSession: row.avg_cart_items_per_session == null ? null : scalar(row.avg_cart_items_per_session),
  }));
  const totals = months.reduce(
    (summary, month) => ({
      visits: summary.visits + month.visits,
      addToCartSessions: summary.addToCartSessions + month.addToCartSessions,
      addToCartItems: summary.addToCartItems + month.addToCartItems,
      sessionToCartPct: 0,
      avgCartItemsPerSession: null,
    }),
    {
      visits: 0,
      addToCartSessions: 0,
      addToCartItems: 0,
      sessionToCartPct: 0,
      avgCartItemsPerSession: null as number | null,
    },
  );
  totals.sessionToCartPct = conversionPct(totals.addToCartSessions, totals.visits);
  totals.avgCartItemsPerSession = totals.addToCartSessions > 0
    ? totals.addToCartItems / totals.addToCartSessions
    : null;
  const value: SalesWebMetricsDataset = {
    mode: "live",
    notice: null,
    filter: { ...range, country: "Ukraine" },
    definition: {
      visits: "Унікальні GA4-сесії (session_start)",
      addToCart: "Сума item.quantity у подіях GA4 add_to_cart",
      sessionToCart: "Унікальні сесії з add_to_cart / усі унікальні GA4-сесії",
    },
    dataThrough: dateScalar(rows[0]?.data_through ?? null),
    months,
    totals,
    conversions,
  };
  return value;
}
