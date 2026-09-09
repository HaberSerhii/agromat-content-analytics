import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { createHash } from "node:crypto";
import { readPersistentResult, writePersistentResult } from "@/lib/persistent-result-cache";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getMonthlyManagerPlan, getMonthlySalesPlan, normalizeSalesPlanSegment, SALES_DASHBOARD_MANAGER_IDS, SALES_PLAN_SEGMENTS } from "@/lib/sales-plan";
import { readAllLite } from "@/lib/products-store";
import { isDeliverySalesItem, isDimensionOrderInPeriod } from "@/lib/sales-dimension-filter";
import { fillOrderDateSeries, fillSalesDateSeries } from "@/lib/sales-date-series";
import type {
  PromotionSalesDataset,
  PromotionSalesDailySummary,
  PromotionSalesPromotionInput,
  PromotionSalesProductSummary,
  PromotionSalesPublicGroup,
  PromotionSalesStatus,
} from "@/lib/promotion-sales-types";

export type SalesRow = {
  docsRef: string;
  number: string;
  createdDate: string;
  shippedDate: string | null;
  seller: string;
  state: string;
  docsSum: number;
  returnSum: number;
  goodsCount: number;
  goodsCodes: string;
  trademarksNames: string;
  groupRefs: string;
  goodsNames: string;
  margin: number | null;
  stockm: string;
  planGroup: string;
};

export type SalesBucketSummary = {
  label: string;
  docs: number;
  goods: number;
  revenue: number;
  avgMargin: number | null;
};

export type SalesProductSummary = {
  code: string;
  name: string;
  url: string;
  brand: string;
  category: string;
  orders: number;
  qty: number;
  revenue: number;
};

export type SalesDateSummary = {
  date: string;
  docs: number;
  goods: number;
  revenue: number;
};

export type SalesOrderDateSummary = {
  date: string;
  docs: number;
  managers: Array<{ seller: string; docs: number }>;
};

export type SalesMonthSummary = {
  month: string;
  docs: number;
  goods: number;
  revenue: number;
};

export type SalesPlanSummary = {
  month: string;
  plan: number | null;
  revenue: number;
  goods: number;
  docs: number;
  completionPct: number | null;
  segments: Array<{
    segment: string;
    plan: number;
    revenue: number;
    goods: number;
    docs: number;
    completionPct: number | null;
  }>;
  previousMonthRevenue: number;
  revenueDeltaPct: number | null;
  forecastRevenue: number | null;
  forecastCompletionPct: number | null;
  elapsedDays: number;
  daysInMonth: number;
};

export type SalesOrderInsightsSummary = {
  onlineOrders: {
    totalDocs: number;
    webshopDocs: number;
    webshopRevenue: number;
    webshopAverageOrderRevenue: number | null;
    webshopSharePct: number | null;
    marketingDocs: number;
    marketingRevenue: number;
    programs: Array<{ program: string; docs: number; revenue: number }>;
  };
  shippedEconomics: {
    shippedDocs: number;
    ordersWithReturns: number;
    returnRatePct: number | null;
    returnedPositions: number;
    returnedRevenue: number;
    costCoveredDocs: number;
    costCoveragePct: number | null;
    revenueWithCost: number;
    ownCost: number;
    estimatedGrossProfit: number;
    estimatedGrossMarginPct: number | null;
    returnedProducts: Array<{ code: string; name: string; positions: number; revenue: number }>;
  };
};

export type SalesWebshopOrderItem = {
  number: string;
  webshopId: string;
  createdDate: string;
  shippedDate: string | null;
  seller: string;
  state: string;
  docsSum: number;
  returnSum: number;
  marketingProgram: string;
  stockm: string;
  ownCost: number | null;
  estimatedGrossProfit: number | null;
  estimatedGrossMarginPct: number | null;
  items: Array<{
    code: string;
    name: string;
    brand: string;
    category: string;
    qty: number;
    revenue: number;
    returned: boolean;
    returnRevenue: number;
  }>;
};

export type SalesWebshopOrdersDataset = {
  filter: { from: string | null; to: string | null; label: string; statuses: string[] };
  total: number;
  items: SalesWebshopOrderItem[];
};

export type SalesWebshopReturnInfo = {
  webshopId: string;
  docsRef: string;
  number: string;
  returnSum: number;
  returnGoodsCodes: string[];
};

export type SalesCancellationProductSummary = {
  code: string;
  name: string;
  url: string;
  brand: string;
  category: string;
  docs: number;
  qty: number;
};

export type SalesCancelReasonSummary = {
  reason: string;
  docs: number;
  revenue: number;
  products: SalesCancellationProductSummary[];
};

export type SalesDocumentStatusSummary = {
  states: Array<{ state: string; docs: number; revenue: number }>;
  cancelReasons: SalesCancelReasonSummary[];
};

export type SalesManagerSummary = SalesDocumentStatusSummary & {
  seller: string;
  plan: number | null;
  planSource: "configured" | "equal-share" | "missing";
  planRevenue: number;
  planCompletionPct: number | null;
  forecastRevenue: number | null;
  forecastCompletionPct: number | null;
  orderedDocs: number;
  completedDocs: number;
  completedUnits: number;
  unitsPerCheck: number | null;
  orderCompletionPct: number | null;
  orderedRevenue: number;
  completedRevenue: number;
  revenueCompletionPct: number | null;
  averageOrderRevenue: number | null;
  averageCompletedRevenue: number | null;
  averageRevenueCompletionPct: number | null;
};

export type SalesDataset = {
  source: {
    bucket: string;
    key: string;
    size: number | null;
    lastModified: string | null;
    refreshPolicy: string;
    nextRefreshAt: string | null;
  };
  filter: {
    from: string | null;
    to: string | null;
    label: string;
    productCodes: number[];
    matchedProductCodes: number[];
    statuses: string[];
  };
  rows: SalesRow[];
  summary: {
    totalDocs: number;
    shippedDocs: number;
    shippedGoods: number;
    shippedRevenue: number;
    canceledDocs: number;
    returnedRevenue: number;
    firstShippedDate: string | null;
    lastShippedDate: string | null;
    selected: {
      docs: number;
      goods: number;
      revenue: number;
      returnedRevenue: number;
      canceledDocs: number;
      canceledRevenue: number;
    };
    plan: SalesPlanSummary;
    orderInsights: SalesOrderInsightsSummary;
    byDate: SalesDateSummary[];
    ordersByDate: SalesOrderDateSummary[];
    months: SalesMonthSummary[];
    segments: SalesBucketSummary[];
    shippedSegments: SalesBucketSummary[];
    brands: SalesBucketSummary[];
    categories: SalesBucketSummary[];
    categoryProducts: Record<string, SalesProductSummary[]>;
    states: Array<{ state: string; docs: number; revenue: number }>;
    availableStates: Array<{ state: string; docs: number; revenue: number }>;
    cancelReasons: SalesCancelReasonSummary[];
    documentStatusesBySegment: Array<SalesDocumentStatusSummary & { segment: "Плитка" | "Сантехніка" }>;
    managers: SalesManagerSummary[];
  };
};

type MutableBucket = SalesBucketSummary & {
  marginSum: number;
  marginCount: number;
};

type ParsedSalesItem = {
  code: string;
  name: string;
  url: string;
  brand: string;
  category: string;
  qty: number;
  revenue: number;
};

type ParsedSalesRow = SalesRow & {
  items: ParsedSalesItem[];
  goodsCodeNumbers: number[];
  cancelReason: string;
  webshopId: string;
  marketingProgram: string;
  hasReturns: boolean;
  returnGoodsCodes: string[];
  returnRowSums: number[];
  ownCost: number;
  hasOwnCostData: boolean;
};

type MutableSalesProductSummary = SalesProductSummary & {
  orderRefs: Set<string>;
};

type MutableCancelReasonSummary = Omit<SalesCancelReasonSummary, "products"> & {
  products: Map<string, SalesCancellationProductSummary & { orderRefs: Set<string> }>;
};

type CacheEntry = {
  signature: string;
  rows: ParsedSalesRow[];
  source: SalesDataset["source"];
  expiresAt: number;
};

type CachedSalesRows = {
  rows: ParsedSalesRow[];
  source: SalesDataset["source"];
};

type SalesRowsCacheState = {
  cached: CacheEntry | null;
  nextSignatureCheckAt: number;
  pending?: Promise<CachedSalesRows>;
};

declare global {
  var _agromatSalesRowsCacheState: SalesRowsCacheState | undefined;
  var _agromatSalesS3Client: S3Client | undefined;
}

let productMetaByCodeCache: Map<string, { name: string; brand: string; category: string; url: string }> | null = null;
let groupNameByIdCache: Map<string, string> | null = null;

const PROMOTION_SALES_STATUSES: PromotionSalesStatus[] = [
  "Повністю відвантажений",
  "відвантаження дозволено",
];

export type SalesDateFilter = {
  from?: string;
  to?: string;
  productCodes?: string | number[];
  statuses?: string | string[];
};

export type SalesDatasetOptions = {
  // The dashboard normally loads category products only when a category is
  // expanded. The default remains "all" for backward-compatible callers.
  categoryProducts?: "all" | string | false;
};

function getSalesS3Url() {
  return process.env.SALES_S3_URL || "s3://dataset4bq/analysebillsofparsel.csv";
}

function getSalesGroupsS3Url() {
  return process.env.SALES_GROUPS_S3_URL || "s3://dataset4bq/inventorygroups.csv";
}

function getSalesS3RevalidateMs() {
  const configured = Number(process.env.SALES_S3_REVALIDATE_MS);
  if (!Number.isFinite(configured) || configured <= 0) return 5 * 60_000;
  return Math.max(5_000, Math.min(configured, 10 * 60_000));
}

function getSalesRowsCacheState(): SalesRowsCacheState {
  globalThis._agromatSalesRowsCacheState ??= {
    cached: null,
    nextSignatureCheckAt: 0,
  };
  return globalThis._agromatSalesRowsCacheState;
}

export function parseS3Url(value: string) {
  const match = value.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Bad SALES_S3_URL: ${value}`);
  return { bucket: match[1], key: match[2] };
}

function getS3Client() {
  globalThis._agromatSalesS3Client ??= new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
  });
  return globalThis._agromatSalesS3Client;
}

function getKyivParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function getCurrentKyivMonth() {
  const { year, month } = getKyivParts();
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getNextKyivSix() {
  const now = new Date();
  const parts = getKyivParts(now);
  const targetDay = parts.hour < 6 ? parts.day : parts.day + 1;
  const utcGuess = Date.UTC(parts.year, parts.month - 1, targetDay, 6, 0, 0, 0);
  const offsetMs = getTimeZoneOffsetMs(new Date(utcGuess), "Europe/Kyiv");
  return new Date(utcGuess - offsetMs);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - date.getTime();
}

function daysInMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function elapsedDaysForMonth(monthKey: string) {
  const current = getKyivParts();
  const currentMonth = `${current.year}-${String(current.month).padStart(2, "0")}`;
  if (monthKey !== currentMonth) return daysInMonth(monthKey);
  return Math.max(1, Math.min(current.day, daysInMonth(monthKey)));
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      values.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  values.push(current);
  return values;
}

async function readS3Text(s3Url: string) {
  const { bucket, key } = parseS3Url(s3Url);
  const client = getS3Client();
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const text = await object.Body?.transformToString();
  if (!text) throw new Error(`S3 object is empty: ${s3Url}`);
  return text;
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function parseNullableNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const num = parseNumber(value);
  return Number.isFinite(num) ? num : null;
}

function splitList(value: string | undefined): string[] {
  return (value || "").split("|").map((part) => part.trim()).filter(Boolean);
}

function formatCategoryFallback(value: string | undefined) {
  if (!value) return "Без категорії";
  return /^\d+$/.test(value) ? `Категорія #${value}` : value;
}

function getProductSearchUrl(code: string | undefined) {
  return code ? `https://www.agromat.ua/search/?q=${encodeURIComponent(code)}` : "";
}

function cleanSegment(value: string) {
  const parts = splitList(value);
  return normalizeSalesPlanSegment(parts[0] || "");
}

function businessSegmentFromText(value: string) {
  const normalized = value.toLocaleLowerCase("uk");
  if (/(плит|мозаїк|керамограніт|керамогранит|клінкер|клинкер)/.test(normalized)) return "Плитка";
  if (/(унітаз|раковин|змішувач|душ|ванн|сифон|інсталяц|клавіш|кришк|сантех|водонагр|бойлер|рушник)/.test(normalized)) return "Сантехніка";
  return null;
}

function getRowBusinessSegment(row: SalesRow, categories: string[] = [], goodsNames: string[] = []) {
  const planSegment = normalizeSalesPlanSegment(row.planGroup);
  if (planSegment === "Плитка") return "Плитка";
  if (planSegment === "Інше") return "Інше";
  for (const value of [...categories, ...goodsNames]) {
    const segment = businessSegmentFromText(value);
    if (segment) return segment;
  }
  return planSegment === "Сантехніка" ? "Сантехніка" : "Інше";
}

function normalizeShippedDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

function normalizeDateFilter(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function getEffectiveFilter(filter: SalesDateFilter | undefined) {
  const rawFrom = normalizeDateFilter(filter?.from);
  const rawTo = normalizeDateFilter(filter?.to);
  const from = rawFrom && rawTo && rawFrom > rawTo ? rawTo : rawFrom;
  const to = rawFrom && rawTo && rawFrom > rawTo ? rawFrom : rawTo;
  const productCodes = parseProductCodes(filter?.productCodes);
  const statuses = parseStatuses(filter?.statuses);
  return { from: from || null, to: to || null, productCodes, statuses };
}

function isWithinFilter(date: string, filter: ReturnType<typeof getEffectiveFilter>) {
  if (filter.from && date < filter.from) return false;
  if (filter.to && date > filter.to) return false;
  return true;
}

function isWithinOptionalFilter(date: string | null, filter: ReturnType<typeof getEffectiveFilter>) {
  return Boolean(date) && isWithinFilter(date || "", filter);
}

function getFilterLabel(filter: ReturnType<typeof getEffectiveFilter>) {
  if (filter.from && filter.to) return `${filter.from} — ${filter.to}`;
  if (filter.from) return `з ${filter.from}`;
  if (filter.to) return `до ${filter.to}`;
  return "Весь період";
}

function parseProductCodes(value: SalesDateFilter["productCodes"]): number[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.map(String) : value.split(/[\s,;|]+/);
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of raw) {
    const n = parseInt(String(part).trim(), 10);
    if (Number.isFinite(n) && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function parseStatuses(value: SalesDateFilter["statuses"]): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const status = String(item).trim();
    if (status && !seen.has(status)) {
      seen.add(status);
      out.push(status);
    }
  }
  return out;
}

function matchesProductCodes(goodsCodes: number[], productCodeSet: Set<number>) {
  if (productCodeSet.size === 0) return true;
  return goodsCodes.some((code) => productCodeSet.has(code));
}

function scopeSalesRowToProductCodes(
  row: ParsedSalesRow,
  productCodeSet: ReadonlySet<number>,
): ParsedSalesRow | null {
  if (productCodeSet.size === 0) return row;
  const items = row.items.filter((item) => {
    const code = Number(item.code);
    return Number.isFinite(code) && productCodeSet.has(code);
  });
  if (!items.length) return null;

  const fallbackRevenue = row.goodsCount > 0 ? row.docsSum / row.goodsCount : 0;
  const docsSum = items.reduce((sum, item) => sum + (item.revenue || fallbackRevenue), 0);
  const matchingReturns = row.returnGoodsCodes
    .map((code, index) => ({ code, revenue: row.returnRowSums[index] || 0 }))
    .filter((item) => productCodeSet.has(Number(item.code)));
  const returnSum = matchingReturns.reduce((sum, item) => sum + item.revenue, 0);
  const revenueShare = row.docsSum > 0 ? docsSum / row.docsSum : 0;

  return {
    ...row,
    items,
    goodsCodeNumbers: items.map((item) => Number(item.code)).filter(Number.isFinite),
    goodsCount: items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0),
    goodsCodes: items.map((item) => item.code).join("|"),
    goodsNames: items.map((item) => item.name).join("|"),
    trademarksNames: items.map((item) => item.brand).join("|"),
    docsSum,
    returnSum,
    returnGoodsCodes: matchingReturns.map((item) => item.code),
    returnRowSums: matchingReturns.map((item) => item.revenue),
    hasReturns: matchingReturns.length > 0 || returnSum > 0,
    ownCost: row.ownCost * revenueShare,
  };
}

function getPlanMonthForFilter(filter: ReturnType<typeof getEffectiveFilter>) {
  const fromMonth = filter.from?.slice(0, 7);
  const toMonth = filter.to?.slice(0, 7);
  if (fromMonth && toMonth && fromMonth === toMonth) return fromMonth;
  if (fromMonth && !toMonth) return fromMonth;
  if (!fromMonth && toMonth) return toMonth;
  return getCurrentKyivMonth();
}

function isCanceled(state: string) {
  return state.toLocaleLowerCase("uk").includes("скас");
}

const ANALYTICS_EXCLUDED_REASONS = [
  "створення нового замовлення",
  "дубль замовлення",
  "фейкове замовлення",
  "попередній прорахунок",
];

function isExcludedAnalyticsOrder(row: ParsedSalesRow) {
  const reason = row.cancelReason.toLocaleLowerCase("uk").replace(/\s+/g, " ").trim();
  return ANALYTICS_EXCLUDED_REASONS.some((excludedReason) => reason.includes(excludedReason));
}

function isShipmentAllowed(state: string) {
  return state.toLocaleLowerCase("uk") === "відвантаження дозволено";
}

function isShipped(row: SalesRow) {
  return Boolean(row.shippedDate) && row.state.toLocaleLowerCase("uk").includes("повністю відвантаж");
}

function managerLabel(value: string) {
  return value.trim() || "Без менеджера";
}

function isDashboardManager(value: string) {
  const sellerId = getSellerId(value);
  return Boolean(sellerId && SALES_DASHBOARD_MANAGER_IDS.has(sellerId));
}

function getSellerId(value: string) {
  return value.match(/\((\d+)\)\s*$/)?.[1] || null;
}

function getNetRevenue(row: SalesRow) {
  return row.docsSum - row.returnSum;
}

function addBucket(map: Map<string, MutableBucket>, label: string, row: SalesRow, revenue: number, goods = 1) {
  const item = map.get(label) || {
    label,
    docs: 0,
    goods: 0,
    revenue: 0,
    avgMargin: null,
    marginSum: 0,
    marginCount: 0,
  };
  item.docs += 1;
  item.goods += goods;
  item.revenue += revenue;
  if (row.margin != null) {
    item.marginSum += row.margin;
    item.marginCount += 1;
  }
  map.set(label, item);
}

function finishBuckets(map: Map<string, MutableBucket>) {
  return [...map.values()]
    .map(({ marginSum, marginCount, ...bucket }) => ({
      ...bucket,
      avgMargin: marginCount ? marginSum / marginCount : null,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

function finishSegmentBuckets(map: Map<string, MutableBucket>) {
  const buckets = new Map(finishBuckets(map).map((bucket) => [bucket.label, bucket]));
  return SALES_PLAN_SEGMENTS.map((segment) => buckets.get(segment) || {
    label: segment,
    docs: 0,
    goods: 0,
    revenue: 0,
    avgMargin: null,
  });
}

function toPublicRow(row: ParsedSalesRow): SalesRow {
  return {
    docsRef: row.docsRef,
    number: row.number,
    createdDate: row.createdDate,
    shippedDate: row.shippedDate,
    seller: row.seller,
    state: row.state,
    docsSum: row.docsSum,
    returnSum: row.returnSum,
    goodsCount: row.goodsCount,
    goodsCodes: row.goodsCodes,
    trademarksNames: row.trademarksNames,
    groupRefs: row.groupRefs,
    goodsNames: row.goodsNames,
    margin: row.margin,
    stockm: row.stockm,
    planGroup: row.planGroup,
  };
}

function addDate(map: Map<string, SalesDateSummary>, date: string, row: SalesRow) {
  const item = map.get(date) || { date, docs: 0, goods: 0, revenue: 0 };
  item.docs += 1;
  item.goods += row.goodsCount;
  item.revenue += row.docsSum;
  map.set(date, item);
}

function addOrderDate(
  map: Map<string, { date: string; docs: number; managers: Map<string, number> }>,
  date: string,
  seller: string,
) {
  const item = map.get(date) || { date, docs: 0, managers: new Map<string, number>() };
  item.docs += 1;
  const manager = managerLabel(seller);
  item.managers.set(manager, (item.managers.get(manager) || 0) + 1);
  map.set(date, item);
}

function addState(map: Map<string, { state: string; docs: number; revenue: number }>, state: string, revenue: number) {
  const label = state || "Без статусу";
  const item = map.get(label) || { state: label, docs: 0, revenue: 0 };
  item.docs += 1;
  item.revenue += revenue;
  map.set(label, item);
}

function addCancelReason(map: Map<string, MutableCancelReasonSummary>, reason: string, row: ParsedSalesRow) {
  const label = reason || "Без причини";
  const item = map.get(label) || { reason: label, docs: 0, revenue: 0, products: new Map() };
  item.docs += 1;
  item.revenue += row.docsSum;
  const orderRef = row.docsRef || row.number;
  for (const product of row.items) {
    if (isDeliverySalesItem(product)) continue;
    const key = product.code || `${product.name}:${product.brand}`;
    const current = item.products.get(key) || {
      code: product.code,
      name: product.name || "Без назви",
      url: product.url,
      brand: product.brand || "Без бренда",
      category: product.category || "Без категорії",
      docs: 0,
      qty: 0,
      orderRefs: new Set<string>(),
    };
    current.orderRefs.add(orderRef || `${key}:${current.orderRefs.size}`);
    current.docs = current.orderRefs.size;
    current.qty += Number(product.qty) || 0;
    item.products.set(key, current);
  }
  map.set(label, item);
}

function finishCancelReasons(map: Map<string, MutableCancelReasonSummary>): SalesCancelReasonSummary[] {
  return [...map.values()]
    .map((item) => ({
      reason: item.reason,
      docs: item.docs,
      revenue: item.revenue,
      products: [...item.products.values()]
        .map((product) => ({
          code: product.code,
          name: product.name,
          url: product.url,
          brand: product.brand,
          category: product.category,
          docs: product.docs,
          qty: product.qty,
        }))
        .sort((left, right) => right.qty - left.qty || left.name.localeCompare(right.name, "uk")),
    }))
    .sort((left, right) => right.docs - left.docs);
}

function addCategoryProduct(
  map: Map<string, Map<string, MutableSalesProductSummary>>,
  item: ParsedSalesItem,
  row: SalesRow,
  fallbackRevenue: number,
  groupKey = item.category,
) {
  let products = map.get(groupKey);
  if (!products) {
    products = new Map<string, MutableSalesProductSummary>();
    map.set(groupKey, products);
  }
  const key = item.code || `${item.name}:${item.brand}`;
  const current = products.get(key) || {
    code: item.code,
    name: item.name || "Без назви",
    url: item.url,
    brand: item.brand || "Без бренда",
    category: item.category,
    orders: 0,
    qty: 0,
    revenue: 0,
    orderRefs: new Set<string>(),
  };
  current.orderRefs.add(row.docsRef || row.number || `${item.code}:${current.orderRefs.size}`);
  current.orders = current.orderRefs.size;
  current.qty += item.qty || 1;
  current.revenue += item.revenue || fallbackRevenue;
  products.set(key, current);
}

function addMonth(map: Map<string, SalesMonthSummary>, month: string, row: SalesRow) {
  const item = map.get(month) || { month, docs: 0, goods: 0, revenue: 0 };
  item.docs += 1;
  item.goods += row.goodsCount;
  item.revenue += row.docsSum;
  map.set(month, item);
}

function addRevenue(map: Map<string, number>, month: string, revenue: number) {
  map.set(month, (map.get(month) || 0) + revenue);
}

function buildPlanSummary(
  months: SalesMonthSummary[],
  returnedRevenueByMonth: Map<string, number>,
  currentMonthSegments: SalesBucketSummary[],
  currentMonth: string,
): SalesPlanSummary {
  const monthlyPlan = getMonthlySalesPlan(currentMonth);
  const plan = monthlyPlan?.total ?? null;
  const current = months.find((month) => month.month === currentMonth);
  const previousMonth = (() => {
    const [year, month] = currentMonth.split("-").map(Number);
    const previous = new Date(Date.UTC(year, month - 2, 1));
    return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
  })();
  const previous = months.find((month) => month.month === previousMonth);
  const revenue = Math.round(current?.revenue || 0) - Math.round(returnedRevenueByMonth.get(currentMonth) || 0);
  const previousRevenue = Math.round(previous?.revenue || 0) - Math.round(returnedRevenueByMonth.get(previousMonth) || 0);
  const elapsedDays = elapsedDaysForMonth(currentMonth);
  const totalDays = daysInMonth(currentMonth);
  const forecastRevenue = revenue > 0 ? (revenue / elapsedDays) * totalDays : null;

  return {
    month: currentMonth,
    plan,
    revenue,
    goods: current?.goods || 0,
    docs: current?.docs || 0,
    completionPct: plan ? (revenue / plan) * 100 : null,
    segments: SALES_PLAN_SEGMENTS.map((segmentName) => {
      const actual = currentMonthSegments.find((segment) => segment.label === segmentName);
      const segmentPlan = monthlyPlan?.segments[segmentName] || 0;
      return {
        segment: segmentName,
        plan: segmentPlan,
        revenue: actual?.revenue || 0,
        goods: actual?.goods || 0,
        docs: actual?.docs || 0,
        completionPct: segmentPlan ? ((actual?.revenue || 0) / segmentPlan) * 100 : null,
      };
    }),
    previousMonthRevenue: previousRevenue,
    revenueDeltaPct: previousRevenue ? ((revenue - previousRevenue) / previousRevenue) * 100 : null,
    forecastRevenue,
    forecastCompletionPct: plan && forecastRevenue ? (forecastRevenue / plan) * 100 : null,
    elapsedDays,
    daysInMonth: totalDays,
  };
}

async function getProductMetaByCode() {
  if (productMetaByCodeCache) return productMetaByCodeCache;
  try {
    const products = await readAllLite();
    productMetaByCodeCache = new Map(products.map((product) => [String(product.code), {
      name: product.name,
      brand: product.brand || "Без бренда",
      category: product.categoryName || product.categoryPath || String(product.categoryId),
      url: product.url,
    }]));
  } catch {
    productMetaByCodeCache = new Map();
  }
  return productMetaByCodeCache;
}

async function getGroupNameById() {
  if (groupNameByIdCache) return groupNameByIdCache;
  try {
    const csvText = await readS3Text(getSalesGroupsS3Url());
    const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    const headers = parseCsvLine(lines[0] || "");
    const idx = new Map(headers.map((header, index) => [header, index]));
    const idIndex = idx.get("id") ?? 0;
    const nameIndex = idx.get("name") ?? 1;
    groupNameByIdCache = new Map();
    for (const line of lines.slice(1)) {
      const values = parseCsvLine(line);
      const id = values[idIndex]?.trim();
      const name = values[nameIndex]?.trim();
      if (id && name) groupNameByIdCache.set(id, name);
    }
  } catch {
    groupNameByIdCache = new Map();
  }
  return groupNameByIdCache;
}

function* iterateSalesRows(
  csvText: string,
  groupNameById: Map<string, string>,
  productMetaByCode: Map<string, { name: string; brand: string; category: string; url: string }>,
): Generator<ParsedSalesRow> {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] || "");
  const idx = new Map(headers.map((header, index) => [header, index]));

  const get = (values: string[], key: string) => values[idx.get(key) ?? -1] || "";

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const goodsCodes = splitList(get(values, "goods_codes"));
    const brandsList = splitList(get(values, "trademarks_names"));
    const categoriesList = splitList(get(values, "groups_refs"));
    const goodsNamesList = splitList(get(values, "goods_names"));
    const rowSums = splitList(get(values, "rows_sums")).map(parseNumber);
    const ownCosts = splitList(get(values, "rows_owncost")).map(parseNumber);
    const returnGoodsCodes = splitList(get(values, "return_goods"));
    const returnRowSums = splitList(get(values, "returnrow_sum")).map(parseNumber);
    const rowQty = (
      splitList(get(values, "rows_qty")).length ? splitList(get(values, "rows_qty")) :
      splitList(get(values, "rows_count")).length ? splitList(get(values, "rows_count")) :
      splitList(get(values, "rows_counts")).length ? splitList(get(values, "rows_counts")) :
      splitList(get(values, "goods_qty")).length ? splitList(get(values, "goods_qty")) :
      splitList(get(values, "goods_count"))
    ).map(parseNumber);
    const goodsCount = Math.max(goodsCodes.length, brandsList.length, categoriesList.length, rowSums.length, rowQty.length, 1);
    const state = get(values, "state");
    const categoryNames = Array.from({ length: goodsCount }, (_, i) => (
      groupNameById.get(categoriesList[i]) || productMetaByCode.get(goodsCodes[i])?.category || formatCategoryFallback(categoriesList[i])
    ));
    const cancelReason = (
      get(values, "cancel_reason") ||
      get(values, "cancelation_reason") ||
      get(values, "cancellation_reason") ||
      get(values, "closed_reason") ||
      get(values, "close_reason") ||
      get(values, "closure_reason") ||
      get(values, "reason") ||
      get(values, "reason_closed") ||
      get(values, "state_reason")
    ).trim();
    const row: ParsedSalesRow = {
      docsRef: get(values, "docs_ref"),
      number: get(values, "number"),
      createdDate: get(values, "datecreation"),
      shippedDate: normalizeShippedDate(get(values, "fullyshipped_datetime")),
      seller: get(values, "seller"),
      state,
      docsSum: parseNumber(get(values, "docs_sum")),
      returnSum: parseNumber(get(values, "return_sum")),
      goodsCount,
      goodsCodes: get(values, "goods_codes"),
      trademarksNames: get(values, "trademarks_names"),
      groupRefs: get(values, "groups_refs"),
      goodsNames: get(values, "goods_names"),
      margin: parseNullableNumber(get(values, "margin")),
      stockm: get(values, "stockm"),
      planGroup: getRowBusinessSegment(
        { planGroup: cleanSegment(get(values, "plangroup")) } as SalesRow,
        categoryNames,
        goodsNamesList,
      ),
      items: Array.from({ length: goodsCount }, (_, i) => ({
        code: goodsCodes[i] || "",
        name: goodsNamesList[i] || productMetaByCode.get(goodsCodes[i])?.name || "Без назви",
        url: productMetaByCode.get(goodsCodes[i])?.url || getProductSearchUrl(goodsCodes[i]),
        brand: brandsList[i] || productMetaByCode.get(goodsCodes[i])?.brand || "Без бренда",
        category: categoryNames[i],
        qty: rowQty[i] || 1,
        revenue: rowSums[i] || 0,
      })),
      goodsCodeNumbers: goodsCodes
        .map((code) => parseInt(code, 10))
        .filter((code) => Number.isFinite(code)),
      cancelReason,
      webshopId: get(values, "webshop_id").trim(),
      marketingProgram: get(values, "marketingprogram").trim(),
      hasReturns: ["1", "t", "true", "yes"].includes(get(values, "exists_returns").trim().toLocaleLowerCase("uk")),
      returnGoodsCodes,
      returnRowSums,
      ownCost: ownCosts.reduce((sum, value) => sum + value, 0),
      hasOwnCostData: ownCosts.some((value) => value > 0),
    };

    yield row;
  }

}

export function parseSalesRows(...args: Parameters<typeof iterateSalesRows>): ParsedSalesRow[] {
  return Array.from(iterateSalesRows(...args));
}

async function parseSalesRowsBatched(...args: Parameters<typeof iterateSalesRows>): Promise<ParsedSalesRow[]> {
  const rows: ParsedSalesRow[] = [];
  for (const row of iterateSalesRows(...args)) {
    rows.push(row);
    // Yield between small batches so another dashboard is not blocked by CSV parsing.
    if (rows.length % 256 === 0) await yieldToEventLoop();
  }
  return rows;
}

function buildDataset(
  rows: ParsedSalesRow[],
  source: SalesDataset["source"],
  dateFilter?: SalesDateFilter,
  options: SalesDatasetOptions = {},
): SalesDataset {
  const filter = getEffectiveFilter(dateFilter);
  const categoryProductsMode = options.categoryProducts ?? "all";
  const productCodeSet = new Set(filter.productCodes);
  const statusSet = new Set(filter.statuses);
  const planMonth = getPlanMonthForFilter(filter);
  const matchedProductCodes = new Set<number>();
  const filteredRows: ParsedSalesRow[] = [];
  const byDate = new Map<string, SalesDateSummary>();
  const ordersByDate = new Map<string, { date: string; docs: number; managers: Map<string, number> }>();
  const marketingPrograms = new Map<string, { program: string; docs: number; revenue: number }>();
  const returnedProducts = new Map<string, { code: string; name: string; positions: number; revenue: number }>();
  const months = new Map<string, SalesMonthSummary>();
  const allMonths = new Map<string, SalesMonthSummary>();
  const allReturnedRevenueByMonth = new Map<string, number>();
  const segments = new Map<string, MutableBucket>();
  const shippedSegments = new Map<string, MutableBucket>();
  const allSegmentsByMonth = new Map<string, Map<string, MutableBucket>>();
  const brands = new Map<string, MutableBucket>();
  const categories = new Map<string, MutableBucket>();
  const categoryProducts = new Map<string, Map<string, MutableSalesProductSummary>>();
  const states = new Map<string, { state: string; docs: number; revenue: number }>();
  const availableStates = new Map<string, { state: string; docs: number; revenue: number }>();
  const cancelReasons = new Map<string, MutableCancelReasonSummary>();
  const documentStatusesBySegment = new Map<
    "Плитка" | "Сантехніка",
    {
      states: Map<string, { state: string; docs: number; revenue: number }>;
      cancelReasons: Map<string, MutableCancelReasonSummary>;
    }
  >([
    ["Плитка", { states: new Map(), cancelReasons: new Map() }],
    ["Сантехніка", { states: new Map(), cancelReasons: new Map() }],
  ]);
  const managers = new Map<
    string,
    {
      orderedDocs: number;
      completedDocs: number;
      completedUnits: number;
      orderedRevenue: number;
      completedRevenue: number;
      states: Map<string, { state: string; docs: number; revenue: number }>;
      cancelReasons: Map<string, MutableCancelReasonSummary>;
    }
  >();
  const managerPlanRevenueByMonth = new Map<string, Map<string, number>>();
  const planMonths = new Map<string, SalesMonthSummary>();
  const planReturnedRevenueByMonth = new Map<string, number>();
  const planSegmentsByMonth = new Map<string, Map<string, MutableBucket>>();

  let shippedDocs = 0;
  let shippedGoods = 0;
  let shippedRevenue = 0;
  let canceledDocs = 0;
  let returnedRevenue = 0;
  let filteredDocs = 0;
  let selectedGoods = 0;
  let selectedRevenue = 0;
  let selectedReturnedRevenue = 0;
  let selectedCanceledDocs = 0;
  let selectedCanceledRevenue = 0;
  let firstShippedDate: string | null = null;
  let lastShippedDate: string | null = null;
  let onlineOrdersTotal = 0;
  let webshopDocs = 0;
  let webshopRevenue = 0;
  let marketingDocs = 0;
  let marketingRevenue = 0;
  let shippedInsightDocs = 0;
  let ordersWithReturns = 0;
  let returnedPositions = 0;
  let insightReturnedRevenue = 0;
  let costCoveredDocs = 0;
  let revenueWithCost = 0;
  let ownCost = 0;

  for (const sourceRow of rows) {
    const row = scopeSalesRowToProductCodes(sourceRow, productCodeSet);
    if (!row) continue;
    const goodsCodes = row.goodsCodeNumbers;
    if (
      matchesProductCodes(goodsCodes, productCodeSet)
      && (statusSet.size === 0 || statusSet.has(row.state || "Без статусу"))
      && isWithinOptionalFilter(row.createdDate, filter)
      && !isExcludedAnalyticsOrder(row)
    ) {
      addOrderDate(ordersByDate, row.createdDate, row.seller);
      onlineOrdersTotal += 1;
      if (row.webshopId) {
        webshopDocs += 1;
        webshopRevenue += row.docsSum;
      }
      if (row.webshopId && row.marketingProgram) {
        marketingDocs += 1;
        marketingRevenue += row.docsSum;
        const program = marketingPrograms.get(row.marketingProgram) || {
          program: row.marketingProgram,
          docs: 0,
          revenue: 0,
        };
        program.docs += 1;
        program.revenue += row.docsSum;
        marketingPrograms.set(row.marketingProgram, program);
      }
    }
    if (matchesProductCodes(goodsCodes, productCodeSet)) {
      const statusDate = row.shippedDate || row.createdDate;
      const statusIgnoresDate = isShipmentAllowed(row.state);
      const matchesStatusDate = statusIgnoresDate || isWithinOptionalFilter(statusDate, filter);
      if (matchesStatusDate) {
        addState(availableStates, row.state, row.docsSum);
        addState(states, row.state, row.docsSum);
        if (isCanceled(row.state)) addCancelReason(cancelReasons, row.cancelReason, row);

        if (row.planGroup === "Плитка" || row.planGroup === "Сантехніка") {
          const segmentSummary = documentStatusesBySegment.get(row.planGroup);
          if (segmentSummary) {
            addState(segmentSummary.states, row.state, row.docsSum);
            if (isCanceled(row.state)) {
              addCancelReason(segmentSummary.cancelReasons, row.cancelReason, row);
            }
          }
        }

        if (statusDate?.slice(0, 7) === planMonth && !isExcludedAnalyticsOrder(row)) {
          const seller = managerLabel(row.seller);
          const manager = managers.get(seller) || {
            orderedDocs: 0,
            completedDocs: 0,
            completedUnits: 0,
            orderedRevenue: 0,
            completedRevenue: 0,
            states: new Map<string, { state: string; docs: number; revenue: number }>(),
            cancelReasons: new Map<string, MutableCancelReasonSummary>(),
          };
          manager.orderedDocs += 1;
          manager.orderedRevenue += row.docsSum;
          if (isShipped(row)) {
            manager.completedDocs += 1;
            manager.completedUnits += row.items.reduce((total, item) => total + item.qty, 0);
            manager.completedRevenue += row.docsSum;
          }
          addState(manager.states, row.state, row.docsSum);
          if (isCanceled(row.state)) addCancelReason(manager.cancelReasons, row.cancelReason, row);
          managers.set(seller, manager);
        }
      }
    }

    const analysisDate = row.shippedDate || row.createdDate;
    const selectedStatusIgnoresDate = statusSet.has("відвантаження дозволено") && isShipmentAllowed(row.state);
    if (
      matchesProductCodes(goodsCodes, productCodeSet)
      && (statusSet.size === 0 || statusSet.has(row.state || "Без статусу"))
      && (isWithinOptionalFilter(analysisDate, filter) || selectedStatusIgnoresDate)
      && !isExcludedAnalyticsOrder(row)
    ) {
      filteredRows.push(row);
      filteredDocs += 1;
      selectedGoods += row.goodsCount;
      selectedRevenue += row.docsSum;
      selectedReturnedRevenue += row.returnSum;
      if (isCanceled(row.state)) {
        selectedCanceledDocs += 1;
        selectedCanceledRevenue += row.docsSum;
      }

      addBucket(segments, row.planGroup, row, row.docsSum, row.goodsCount);
    }

    if (!isShipped(row) || !row.shippedDate) continue;

    const shippedMonth = row.shippedDate.slice(0, 7);
    const netRevenue = getNetRevenue(row);
    addMonth(allMonths, shippedMonth, row);
    addRevenue(allReturnedRevenueByMonth, shippedMonth, row.returnSum);
    let allMonthSegments = allSegmentsByMonth.get(shippedMonth);
    if (!allMonthSegments) {
      allMonthSegments = new Map<string, MutableBucket>();
      allSegmentsByMonth.set(shippedMonth, allMonthSegments);
    }
    addBucket(allMonthSegments, row.planGroup, row, netRevenue, row.goodsCount);

    if (!matchesProductCodes(goodsCodes, productCodeSet)) continue;
    if (isDimensionOrderInPeriod(row, filter) && !isExcludedAnalyticsOrder(row)) {
      for (const item of row.items) {
        if (isDeliverySalesItem(item)) continue;
        addBucket(brands, item.brand, row, item.revenue || row.docsSum / row.goodsCount, item.qty || 1);
        addBucket(categories, item.category, row, item.revenue || row.docsSum / row.goodsCount, item.qty || 1);
        if (categoryProductsMode === "all" || categoryProductsMode === item.category) {
          addCategoryProduct(categoryProducts, item, row, row.docsSum / row.goodsCount);
        }
      }
    }
    if (!isExcludedAnalyticsOrder(row)) {
      let managerMonthRevenue = managerPlanRevenueByMonth.get(shippedMonth);
      if (!managerMonthRevenue) {
        managerMonthRevenue = new Map<string, number>();
        managerPlanRevenueByMonth.set(shippedMonth, managerMonthRevenue);
      }
      const shippedSeller = managerLabel(row.seller);
      managerMonthRevenue.set(shippedSeller, (managerMonthRevenue.get(shippedSeller) || 0) + netRevenue);
    }
    for (const code of goodsCodes) {
      if (productCodeSet.has(code)) matchedProductCodes.add(code);
    }

    addMonth(planMonths, shippedMonth, row);
    addRevenue(planReturnedRevenueByMonth, shippedMonth, row.returnSum);
    let planMonthSegments = planSegmentsByMonth.get(shippedMonth);
    if (!planMonthSegments) {
      planMonthSegments = new Map<string, MutableBucket>();
      planSegmentsByMonth.set(shippedMonth, planMonthSegments);
    }
    addBucket(planMonthSegments, row.planGroup, row, netRevenue, row.goodsCount);

    if (!isWithinFilter(row.shippedDate, filter)) continue;
    if (statusSet.size > 0 && !statusSet.has(row.state || "Без статусу")) continue;
    if (row.webshopId) {
      shippedInsightDocs += 1;
      if (row.hasReturns || row.returnSum > 0 || row.returnGoodsCodes.length > 0) {
        ordersWithReturns += 1;
        insightReturnedRevenue += row.returnRowSums.length
          ? row.returnRowSums.reduce((sum, value) => sum + value, 0)
          : row.returnSum;
        returnedPositions += row.returnGoodsCodes.length;
        row.returnGoodsCodes.forEach((code, index) => {
          const returned = returnedProducts.get(code) || {
            code,
            name: row.items.find((item) => item.code === code)?.name || "Без назви",
            positions: 0,
            revenue: 0,
          };
          returned.positions += 1;
          returned.revenue += row.returnRowSums[index] || 0;
          returnedProducts.set(code, returned);
        });
      }
      if (row.hasOwnCostData) {
        costCoveredDocs += 1;
        revenueWithCost += row.docsSum - row.returnSum;
        ownCost += row.ownCost;
      }
    }
    returnedRevenue += row.returnSum;
    if (isCanceled(row.state)) canceledDocs += 1;

    shippedDocs += 1;
    shippedGoods += row.goodsCount;
    shippedRevenue += row.docsSum;
    addBucket(shippedSegments, row.planGroup, row, row.docsSum, row.goodsCount);
    if (!firstShippedDate || row.shippedDate < firstShippedDate) firstShippedDate = row.shippedDate;
    if (!lastShippedDate || row.shippedDate > lastShippedDate) lastShippedDate = row.shippedDate;

    addDate(byDate, row.shippedDate, row);
    addMonth(months, shippedMonth, row);
  }

  const monthList = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  const allMonthList = [...allMonths.values()].sort((a, b) => a.month.localeCompare(b.month));
  const segmentList = finishSegmentBuckets(segments);
  const brandList = finishBuckets(brands);
  const categoryList = finishBuckets(categories);
  const productCategories = categoryProductsMode === "all"
    ? categoryList
    : categoryProductsMode === false
      ? []
      : categoryList.filter((category) => category.label === categoryProductsMode);
  const categoryProductList = Object.fromEntries(
    productCategories.map((category) => {
      const products = categoryProducts.get(category.label) || new Map<string, MutableSalesProductSummary>();
      return [category.label, [...products.values()]
        .map((product) => ({
          code: product.code,
          name: product.name,
          url: product.url,
          brand: product.brand,
          category: product.category,
          orders: product.orders,
          qty: product.qty,
          revenue: product.revenue,
        }))
        .sort((a, b) => b.revenue - a.revenue)];
    }),
  );
  const hasProductFilter = productCodeSet.size > 0;
  const planMonthList = hasProductFilter
    ? [...planMonths.values()].sort((a, b) => a.month.localeCompare(b.month))
    : allMonthList;
  const planReturnedRevenue = hasProductFilter ? planReturnedRevenueByMonth : allReturnedRevenueByMonth;
  const planMonthSegments = finishBuckets((hasProductFilter ? planSegmentsByMonth : allSegmentsByMonth).get(planMonth) || new Map<string, MutableBucket>());
  const managerMonthRevenue = managerPlanRevenueByMonth.get(planMonth) || new Map<string, number>();
  const activeManagerNames = [...new Set([...managers.keys(), ...managerMonthRevenue.keys()])]
    .filter((seller) => (
      isDashboardManager(seller)
      && getMonthlyManagerPlan(planMonth, getSellerId(seller)) != null
    ))
    .sort((a, b) => a.localeCompare(b, "uk"));
  const elapsedDays = elapsedDaysForMonth(planMonth);
  const totalDays = daysInMonth(planMonth);
  const managerList: SalesManagerSummary[] = activeManagerNames.map((seller) => {
    const manager = managers.get(seller) || {
      orderedDocs: 0,
      completedDocs: 0,
      completedUnits: 0,
      orderedRevenue: 0,
      completedRevenue: 0,
      states: new Map<string, { state: string; docs: number; revenue: number }>(),
      cancelReasons: new Map<string, MutableCancelReasonSummary>(),
    };
    const planRevenue = managerMonthRevenue.get(seller) || 0;
    const managerPlan = getMonthlyManagerPlan(planMonth, getSellerId(seller));
    const forecastRevenue = planRevenue > 0 ? (planRevenue / elapsedDays) * totalDays : null;
    const averageOrderRevenue = manager.orderedDocs ? manager.orderedRevenue / manager.orderedDocs : null;
    const averageCompletedRevenue = manager.completedDocs ? manager.completedRevenue / manager.completedDocs : null;
    return {
      seller,
      plan: managerPlan,
      planSource: managerPlan != null ? "configured" as const : "missing" as const,
      planRevenue,
      planCompletionPct: managerPlan ? (planRevenue / managerPlan) * 100 : null,
      forecastRevenue,
      forecastCompletionPct: managerPlan && forecastRevenue ? (forecastRevenue / managerPlan) * 100 : null,
      orderedDocs: manager.orderedDocs,
      completedDocs: manager.completedDocs,
      completedUnits: manager.completedUnits,
      unitsPerCheck: manager.completedDocs ? manager.completedUnits / manager.completedDocs : null,
      orderCompletionPct: manager.orderedDocs ? (manager.completedDocs / manager.orderedDocs) * 100 : null,
      orderedRevenue: manager.orderedRevenue,
      completedRevenue: manager.completedRevenue,
      revenueCompletionPct: manager.orderedRevenue ? (manager.completedRevenue / manager.orderedRevenue) * 100 : null,
      averageOrderRevenue,
      averageCompletedRevenue,
      averageRevenueCompletionPct: averageOrderRevenue && averageCompletedRevenue
        ? (averageCompletedRevenue / averageOrderRevenue) * 100
        : null,
      states: [...manager.states.values()].sort((a, b) => b.docs - a.docs),
      cancelReasons: finishCancelReasons(manager.cancelReasons),
    };
  }).sort((a, b) => b.planRevenue - a.planRevenue);

  return {
    source,
    filter: {
      ...filter,
      label: getFilterLabel(filter),
      matchedProductCodes: [...matchedProductCodes].sort((a, b) => a - b),
    },
    rows: filteredRows
      .filter((row) => row.shippedDate)
      .sort((a, b) => (b.shippedDate || "").localeCompare(a.shippedDate || ""))
      .slice(0, 50)
      .map(toPublicRow),
    summary: {
      totalDocs: filteredDocs,
      shippedDocs,
      shippedGoods,
      shippedRevenue,
      canceledDocs,
      returnedRevenue,
      firstShippedDate,
      lastShippedDate,
      selected: {
        docs: filteredDocs,
        goods: selectedGoods,
        revenue: selectedRevenue,
        returnedRevenue: selectedReturnedRevenue,
        canceledDocs: selectedCanceledDocs,
        canceledRevenue: selectedCanceledRevenue,
      },
      plan: buildPlanSummary(planMonthList, planReturnedRevenue, planMonthSegments, planMonth),
      orderInsights: {
        onlineOrders: {
          totalDocs: onlineOrdersTotal,
          webshopDocs,
          webshopRevenue,
          webshopAverageOrderRevenue: webshopDocs ? webshopRevenue / webshopDocs : null,
          webshopSharePct: onlineOrdersTotal ? (webshopDocs / onlineOrdersTotal) * 100 : null,
          marketingDocs,
          marketingRevenue,
          programs: [...marketingPrograms.values()].sort((left, right) => right.docs - left.docs),
        },
        shippedEconomics: {
          shippedDocs: shippedInsightDocs,
          ordersWithReturns,
          returnRatePct: shippedInsightDocs ? (ordersWithReturns / shippedInsightDocs) * 100 : null,
          returnedPositions,
          returnedRevenue: insightReturnedRevenue,
          costCoveredDocs,
          costCoveragePct: shippedInsightDocs ? (costCoveredDocs / shippedInsightDocs) * 100 : null,
          revenueWithCost,
          ownCost,
          estimatedGrossProfit: revenueWithCost - ownCost,
          estimatedGrossMarginPct: revenueWithCost ? ((revenueWithCost - ownCost) / revenueWithCost) * 100 : null,
          returnedProducts: [...returnedProducts.values()]
            .sort((left, right) => right.revenue - left.revenue)
            .slice(0, 10),
        },
      },
      byDate: fillSalesDateSeries([...byDate.values()], filter.from, filter.to),
      ordersByDate: fillOrderDateSeries([...ordersByDate.values()]
        .map((item) => ({
          date: item.date,
          docs: item.docs,
          managers: [...item.managers.entries()]
            .map(([seller, docs]) => ({ seller, docs }))
            .sort((left, right) => right.docs - left.docs),
        })), filter.from, filter.to),
      months: monthList,
      segments: segmentList,
      shippedSegments: finishSegmentBuckets(shippedSegments),
      brands: brandList,
      categories: categoryList,
      categoryProducts: categoryProductList,
      states: [...states.values()].sort((a, b) => b.docs - a.docs),
      availableStates: [...availableStates.values()].sort((a, b) => b.docs - a.docs),
      cancelReasons: finishCancelReasons(cancelReasons),
      documentStatusesBySegment: [...documentStatusesBySegment.entries()].map(([segment, summary]) => ({
        segment,
        states: [...summary.states.values()].sort((a, b) => b.docs - a.docs),
        cancelReasons: finishCancelReasons(summary.cancelReasons),
      })),
      managers: managerList,
    },
  };
}

function buildDimensionProducts(
  rows: ParsedSalesRow[],
  dimension: "category" | "brand",
  value: string,
  dateFilter?: SalesDateFilter,
): SalesProductSummary[] {
  const filter = getEffectiveFilter(dateFilter);
  const productCodeSet = new Set(filter.productCodes);
  const dimensionRevenue = new Map<string, number>();
  const dimensionProducts = new Map<string, Map<string, MutableSalesProductSummary>>();

  for (const sourceRow of rows) {
    const row = scopeSalesRowToProductCodes(sourceRow, productCodeSet);
    if (!row) continue;
    if (!isDimensionOrderInPeriod(row, filter)) continue;
    if (isExcludedAnalyticsOrder(row)) continue;

    for (const item of row.items) {
      if (isDeliverySalesItem(item)) continue;
      const revenue = item.revenue || row.docsSum / row.goodsCount;
      const dimensionValue = item[dimension] || (dimension === "brand" ? "Без бренду" : "Без категорії");
      dimensionRevenue.set(dimensionValue, (dimensionRevenue.get(dimensionValue) || 0) + revenue);
      if (dimensionValue === value) {
        addCategoryProduct(dimensionProducts, item, row, row.docsSum / row.goodsCount, dimensionValue);
      }
    }
  }

  if (!dimensionRevenue.has(value)) return [];

  return [...(dimensionProducts.get(value) || new Map()).values()]
    .map((product) => ({
      code: product.code,
      name: product.name,
      url: product.url,
      brand: product.brand,
      category: product.category,
      orders: product.orders,
      qty: product.qty,
      revenue: product.revenue,
    }))
    .sort((left, right) => right.revenue - left.revenue);
}

async function refreshCachedSalesRows(state: SalesRowsCacheState): Promise<CachedSalesRows> {
  const { bucket, key } = parseS3Url(getSalesS3Url());
  const client = getS3Client();
  const revalidateMs = getSalesS3RevalidateMs();
  let head;
  try {
    head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    // A temporary S3 metadata outage should not take down an already-warm
    // dashboard. Retry shortly and keep the last verified dataset until its
    // normal 06:00 Kyiv refresh boundary.
    if (state.cached && Date.now() < state.cached.expiresAt) {
      state.nextSignatureCheckAt = Date.now() + Math.min(10_000, revalidateMs);
      console.warn("[sales] S3 metadata revalidation failed; serving cached data", error);
      return { rows: state.cached.rows, source: state.cached.source };
    }
    throw error;
  }

  const now = Date.now();
  const signature = `${head.ETag || ""}:${head.LastModified?.toISOString() || ""}:${head.ContentLength || 0}:sales-plan-v2`;
  if (state.cached && state.cached.signature === signature && now < state.cached.expiresAt) {
    state.nextSignatureCheckAt = Math.min(now + revalidateMs, state.cached.expiresAt);
    return { rows: state.cached.rows, source: state.cached.source };
  }

  const [groupNameById, productMetaByCode] = await Promise.all([getGroupNameById(), getProductMetaByCode()]);

  const nextRefresh = getNextKyivSix();
  const source = {
    bucket,
    key,
    size: head.ContentLength ?? null,
    lastModified: head.LastModified?.toISOString() ?? null,
    refreshPolicy: "Дані перечитуються з S3 після 06:00 за Києвом або коли зміниться файл",
    nextRefreshAt: nextRefresh.toISOString(),
  };
  const enrichmentKey = createHash("sha256").update(JSON.stringify([bucket, key, [...groupNameById], [...productMetaByCode]])).digest("hex");
  const saved = await readPersistentResult<{ signature: string; enrichmentKey: string; rows: ParsedSalesRow[] }>("sales-rows-v1", 24 * 60 * 60_000);
  const rows = saved?.value.signature === signature && saved.value.enrichmentKey === enrichmentKey
    ? saved.value.rows
    : await parseSalesRowsBatched(await readS3Text(getSalesS3Url()), groupNameById, productMetaByCode);
  if (rows !== saved?.value.rows) await writePersistentResult("sales-rows-v1", { signature, enrichmentKey, rows });
  state.cached = { signature, rows, source, expiresAt: nextRefresh.getTime() };
  state.nextSignatureCheckAt = Math.min(Date.now() + revalidateMs, nextRefresh.getTime());
  return { rows, source };
}

async function readCachedSalesRows(): Promise<CachedSalesRows> {
  const state = getSalesRowsCacheState();
  const now = Date.now();
  if (state.cached && now < state.cached.expiresAt && now < state.nextSignatureCheckAt) {
    return { rows: state.cached.rows, source: state.cached.source };
  }
  if (state.pending) return state.pending;

  const pending = refreshCachedSalesRows(state);
  state.pending = pending;
  try {
    return await pending;
  } finally {
    if (state.pending === pending) state.pending = undefined;
  }
}

export async function readSalesDataset(
  filter?: SalesDateFilter,
  options?: SalesDatasetOptions,
): Promise<SalesDataset> {
  const { rows, source } = await readCachedSalesRows();
  return buildDataset(rows, source, filter, options);
}

export async function readSalesWebshopOrders(filter?: SalesDateFilter): Promise<SalesWebshopOrdersDataset> {
  const { rows } = await readCachedSalesRows();
  const effective = getEffectiveFilter(filter);
  const productCodeSet = new Set(effective.productCodes);
  const statusSet = new Set(effective.statuses);
  const matched = rows
    .filter((row) => (
      Boolean(row.webshopId)
      && matchesProductCodes(row.goodsCodeNumbers, productCodeSet)
      && (statusSet.size === 0 || statusSet.has(row.state || "Без статусу"))
      && isWithinOptionalFilter(row.createdDate, effective)
      && !isExcludedAnalyticsOrder(row)
    ))
    .sort((left, right) => right.createdDate.localeCompare(left.createdDate) || right.number.localeCompare(left.number));

  return {
    filter: {
      from: effective.from,
      to: effective.to,
      label: getFilterLabel(effective),
      statuses: effective.statuses,
    },
    total: matched.length,
    items: matched.slice(0, 500).map((row) => {
      const returnRevenueByCode = new Map<string, number>();
      row.returnGoodsCodes.forEach((code, index) => {
        returnRevenueByCode.set(code, (returnRevenueByCode.get(code) || 0) + (row.returnRowSums[index] || 0));
      });
      const netRevenue = row.docsSum - row.returnSum;
      const estimatedGrossProfit = row.hasOwnCostData ? netRevenue - row.ownCost : null;
      return {
        number: row.number,
        webshopId: row.webshopId,
        createdDate: row.createdDate,
        shippedDate: row.shippedDate,
        seller: managerLabel(row.seller),
        state: row.state || "Без статусу",
        docsSum: row.docsSum,
        returnSum: row.returnSum,
        marketingProgram: row.marketingProgram,
        stockm: row.stockm,
        ownCost: row.hasOwnCostData ? row.ownCost : null,
        estimatedGrossProfit,
        estimatedGrossMarginPct: estimatedGrossProfit != null && netRevenue
          ? (estimatedGrossProfit / netRevenue) * 100
          : null,
        items: row.items.map((item) => ({
          code: item.code,
          name: item.name,
          brand: item.brand,
          category: item.category,
          qty: item.qty,
          revenue: item.revenue,
          returned: returnRevenueByCode.has(item.code),
          returnRevenue: returnRevenueByCode.get(item.code) || 0,
        })),
      };
    }),
  };
}

export async function readSalesWebshopReturnLookup(): Promise<Map<string, SalesWebshopReturnInfo>> {
  const { rows } = await readCachedSalesRows();
  const returns = new Map<string, SalesWebshopReturnInfo>();

  for (const row of rows) {
    if (!row.webshopId || !(row.hasReturns || row.returnSum > 0 || row.returnGoodsCodes.length > 0)) continue;
    returns.set(row.webshopId, {
      webshopId: row.webshopId,
      docsRef: row.docsRef,
      number: row.number,
      returnSum: row.returnRowSums.length
        ? row.returnRowSums.reduce((sum, value) => sum + value, 0)
        : row.returnSum,
      returnGoodsCodes: row.returnGoodsCodes,
    });
  }

  return returns;
}

export async function readSalesCategoryProducts(
  category: string,
  filter?: SalesDateFilter,
): Promise<SalesProductSummary[]> {
  const { rows } = await readCachedSalesRows();
  return buildDimensionProducts(rows, "category", category, filter);
}

export async function readSalesBrandProducts(
  brand: string,
  filter?: SalesDateFilter,
): Promise<SalesProductSummary[]> {
  const { rows } = await readCachedSalesRows();
  return buildDimensionProducts(rows, "brand", brand, filter);
}

// Product quantities from documents that completed their whole lifecycle
// inside the selected interval: both order creation and full shipment dates
// must be within the range. Reuses the same parsed/cache-backed S3 dataset as
// the sales dashboards, so product web analytics and sales analytics agree.
export async function readCompletedSalesProductQuantities(input: {
  from: string;
  to: string;
}): Promise<Map<number, number>> {
  const { rows } = await readCachedSalesRows();
  const normalizedFrom = normalizeDateFilter(input.from) || input.from;
  const normalizedTo = normalizeDateFilter(input.to) || input.to;
  const rangeFrom = normalizedFrom <= normalizedTo ? normalizedFrom : normalizedTo;
  const rangeTo = normalizedFrom <= normalizedTo ? normalizedTo : normalizedFrom;
  const quantities = new Map<number, number>();

  for (const row of rows) {
    if (!isShipped(row) || !row.shippedDate) continue;
    const createdDate = normalizeShippedDate(row.createdDate);
    if (!createdDate || row.shippedDate < createdDate) continue;
    if (createdDate < rangeFrom || createdDate > rangeTo) continue;
    if (row.shippedDate < rangeFrom || row.shippedDate > rangeTo) continue;
    for (const item of row.items) {
      const code = parseInt(item.code, 10);
      if (!Number.isFinite(code) || code <= 0) continue;
      quantities.set(code, (quantities.get(code) || 0) + item.qty);
    }
  }

  return quantities;
}

// Distinct fully shipped orders containing each product. This is a small
// factual context for web rankings; the ranking itself remains driven by GA4
// add_to_cart sessions.
export async function readCompletedSalesProductOrderRefs(input: {
  from: string;
  to: string;
}): Promise<Map<number, Set<string>>> {
  const { rows } = await readCachedSalesRows();
  const normalizedFrom = normalizeDateFilter(input.from) || input.from;
  const normalizedTo = normalizeDateFilter(input.to) || input.to;
  const rangeFrom = normalizedFrom <= normalizedTo ? normalizedFrom : normalizedTo;
  const rangeTo = normalizedFrom <= normalizedTo ? normalizedTo : normalizedFrom;
  const ordersByCode = new Map<number, Set<string>>();

  for (const row of rows) {
    if (!isShipped(row) || !row.shippedDate || isExcludedAnalyticsOrder(row)) continue;
    const createdDate = normalizeShippedDate(row.createdDate);
    if (!createdDate || row.shippedDate < createdDate) continue;
    if (createdDate < rangeFrom || createdDate > rangeTo) continue;
    if (row.shippedDate < rangeFrom || row.shippedDate > rangeTo) continue;
    const documentKey = row.docsRef || row.number;
    if (!documentKey) continue;
    for (const item of row.items) {
      const code = parseInt(item.code, 10);
      if (!Number.isFinite(code) || code <= 0) continue;
      const orders = ordersByCode.get(code) || new Set<string>();
      orders.add(documentKey);
      ordersByCode.set(code, orders);
    }
  }

  return ordersByCode;
}

export async function readCompletedSalesProductOrderCounts(input: {
  from: string;
  to: string;
}): Promise<Map<number, number>> {
  const ordersByCode = await readCompletedSalesProductOrderRefs(input);
  return new Map([...ordersByCode].map(([code, orders]) => [code, orders.size]));
}

// Product quantities from orders that were created on the website and still
// have the «Сформовано» status. These are the quantities used by web-sales
// rankings; they must not be confused with completed/actual sales.
export async function readFormedSalesProductQuantities(input: {
  from: string;
  to: string;
}): Promise<Map<number, number>> {
  const { rows } = await readCachedSalesRows();
  const normalizedFrom = normalizeDateFilter(input.from) || input.from;
  const normalizedTo = normalizeDateFilter(input.to) || input.to;
  const rangeFrom = normalizedFrom <= normalizedTo ? normalizedFrom : normalizedTo;
  const rangeTo = normalizedFrom <= normalizedTo ? normalizedTo : normalizedFrom;
  const quantities = new Map<number, number>();

  for (const row of rows) {
    if (!row.state.toLocaleLowerCase("uk").includes("сформ")) continue;
    if (isExcludedAnalyticsOrder(row)) continue;
    const createdDate = normalizeShippedDate(row.createdDate);
    if (!createdDate || createdDate < rangeFrom || createdDate > rangeTo) continue;
    for (const item of row.items) {
      const code = parseInt(item.code, 10);
      if (!Number.isFinite(code) || code <= 0) continue;
      quantities.set(code, (quantities.get(code) || 0) + item.qty);
    }
  }

  return quantities;
}

export async function readUniqueSalesDocumentsForProductGroups(input: {
  from: string;
  to: string;
  groups: Array<{ key: string; productCodes: number[] }>;
}): Promise<{ total: number; byKey: Map<string, number> }> {
  const { rows } = await readCachedSalesRows();
  const normalizedFrom = normalizeDateFilter(input.from) || input.from;
  const normalizedTo = normalizeDateFilter(input.to) || input.to;
  const rangeFrom = normalizedFrom <= normalizedTo ? normalizedFrom : normalizedTo;
  const rangeTo = normalizedFrom <= normalizedTo ? normalizedTo : normalizedFrom;
  const groupCodes = new Map(
    input.groups.map((group) => [group.key, new Set(group.productCodes)]),
  );
  const documentsByKey = new Map(
    input.groups.map((group) => [group.key, new Set<string>()]),
  );
  const allDocuments = new Set<string>();

  for (const row of rows) {
    if (!isShipped(row) || !row.shippedDate || isExcludedAnalyticsOrder(row)) continue;
    if (row.shippedDate < rangeFrom || row.shippedDate > rangeTo) continue;
    const documentKey = row.docsRef || row.number;
    if (!documentKey) continue;
    for (const [key, codes] of groupCodes) {
      if (!row.goodsCodeNumbers.some((code) => codes.has(code))) continue;
      documentsByKey.get(key)?.add(documentKey);
      allDocuments.add(documentKey);
    }
  }

  return {
    total: allDocuments.size,
    byKey: new Map(
      [...documentsByKey].map(([key, documents]) => [key, documents.size]),
    ),
  };
}

function canonicalPromotionSalesStatus(value: string): PromotionSalesStatus | null {
  const normalized = value.toLocaleLowerCase("uk").trim();
  if (normalized.includes("повністю відвантаж")) return "Повністю відвантажений";
  if (normalized === "відвантаження дозволено") return "відвантаження дозволено";
  return null;
}

function promotionSalesItemRevenue(item: ParsedSalesItem): number {
  // Promotion analytics must never allocate the whole receipt across its lines:
  // a mixed receipt can contain regular products that must stay outside promo sales.
  return item.revenue;
}

function promotionSalesDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const last = new Date(`${to}T12:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function previousKyivDate(): string {
  const { year, month, day } = getKyivParts();
  return new Date(Date.UTC(year, month - 1, day - 1, 12))
    .toISOString()
    .slice(0, 10);
}

function promotionSalesDataThrough(rows: SalesRow[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    const dates = [normalizeShippedDate(row.createdDate), row.shippedDate];
    for (const date of dates) {
      if (date && (!latest || date > latest)) latest = date;
    }
  }
  if (!latest) return null;
  const completedDay = previousKyivDate();
  return latest < completedDay ? latest : completedDay;
}

function emptyPromotionSalesDay(date: string): PromotionSalesDailySummary {
  return {
    date,
    total: { revenue: 0, qty: 0, docs: 0 },
    tile: { revenue: 0, qty: 0, docs: 0 },
    plumbing: { revenue: 0, qty: 0, docs: 0 },
  };
}

function isWithinPromotionRange(
  date: string,
  promotion: PromotionSalesPromotionInput,
  rangeFrom: string,
  rangeTo: string,
): boolean {
  if (date < rangeFrom || date > rangeTo) return false;
  if (promotion.startDate && date < promotion.startDate) return false;
  if (promotion.endDate && date > promotion.endDate) return false;
  return true;
}

function isCompletedPromotionSale(
  createdDate: string,
  shippedDate: string,
  promotion: PromotionSalesPromotionInput,
  rangeFrom: string,
  rangeTo: string,
): boolean {
  return shippedDate >= createdDate
    && isWithinPromotionRange(createdDate, promotion, rangeFrom, rangeTo)
    && isWithinPromotionRange(shippedDate, promotion, rangeFrom, rangeTo);
}

function isPromotionSaleForStatus(
  status: PromotionSalesStatus,
  createdDate: string,
  shippedDate: string | null,
  promotion: PromotionSalesPromotionInput,
  rangeFrom: string,
  rangeTo: string,
): boolean {
  if (status === "Повністю відвантажений") {
    return Boolean(shippedDate && isCompletedPromotionSale(
      createdDate,
      shippedDate,
      promotion,
      rangeFrom,
      rangeTo,
    ));
  }
  return isWithinPromotionRange(createdDate, promotion, rangeFrom, rangeTo);
}

export async function readPromotionSalesDataset(input: {
  from: string;
  to: string;
  selectedPromotionIdincs?: number[];
  promotions: PromotionSalesPromotionInput[];
  publicPromotionGroups: PromotionSalesPublicGroup[];
  includeProducts?: boolean;
}): Promise<PromotionSalesDataset> {
  const { rows } = await readCachedSalesRows();
  const from = normalizeDateFilter(input.from) || input.from;
  const to = normalizeDateFilter(input.to) || input.to;
  const rangeFrom = from <= to ? from : to;
  const rangeTo = from <= to ? to : from;
  const dataThrough = promotionSalesDataThrough(rows);
  const dailyRangeTo = dataThrough && dataThrough < rangeTo ? dataThrough : rangeTo;
  const requestedPromotionIds = new Set(input.selectedPromotionIdincs ?? []);
  const selectedPromotions = requestedPromotionIds.size
    ? input.promotions.filter((promotion) => requestedPromotionIds.has(promotion.idinc))
    : input.promotions;
  const selectedPromotionIds = new Set(selectedPromotions.map((promotion) => promotion.idinc));
  const selectedCodes = new Set(selectedPromotions.flatMap((promotion) => promotion.productCodes));
  const promotionsByCode = new Map<number, PromotionSalesPromotionInput[]>();
  for (const promotion of input.promotions) {
    for (const code of promotion.productCodes) {
      const memberships = promotionsByCode.get(code) ?? [];
      memberships.push(promotion);
      promotionsByCode.set(code, memberships);
    }
  }
  const promotionSummaries = new Map(input.promotions.map((promotion) => [
    promotion.idinc,
    {
      id: promotion.id,
      idinc: promotion.idinc,
      name: promotion.name,
      startDate: promotion.startDate,
      endDate: promotion.endDate,
      productCount: promotion.productCodes.length,
      docs: 0,
      revenue: 0,
      publicUrl: promotion.publicUrl,
      segmentSet: new Set<"tile" | "plumbing">(),
    },
  ]));
  const brands = new Map<string, { revenue: number; products: Set<string> }>();
  const categories = new Map<string, { revenue: number; products: Set<string> }>();
  const products = new Map<string, PromotionSalesProductSummary & { docRefs: Set<string> }>();
  const daily = new Map<string, PromotionSalesDailySummary>(
    (dailyRangeTo >= rangeFrom ? promotionSalesDateRange(rangeFrom, dailyRangeTo) : [])
      .map((date) => [date, emptyPromotionSalesDay(date)]),
  );
  const states = new Map<PromotionSalesStatus, { docs: number; revenue: number }>(
    PROMOTION_SALES_STATUSES.map((status) => [status, { docs: 0, revenue: 0 }]),
  );
  let salesDocs = 0;
  let salesRevenue = 0;

  const planMonth = rangeFrom.slice(0, 7) === rangeTo.slice(0, 7)
    ? rangeTo.slice(0, 7)
    : getCurrentKyivMonth();
  let planRevenue = 0;
  const planSegmentRevenue = new Map<"Плитка" | "Сантехніка", number>();

  for (const row of rows) {
    const status = canonicalPromotionSalesStatus(row.state);
    if (!status) continue;
    const createdDate = normalizeShippedDate(row.createdDate);
    const shippedDate = row.shippedDate;
    if (!createdDate) continue;
    const saleDate = status === "Повністю відвантажений" ? shippedDate : createdDate;
    if (!saleDate) continue;
    const promotionDocsSeen = new Set<number>();
    let selectedRowRevenue = 0;
    let hasSelectedProduct = false;
    const selectedRowSegments = new Set<"tile" | "plumbing">();

    for (const item of row.items) {
      const code = parseInt(item.code, 10);
      if (!Number.isFinite(code)) continue;
      const itemRevenue = promotionSalesItemRevenue(item);
      const memberships = promotionsByCode.get(code) ?? [];
      const selectedMemberships = memberships.filter((promotion) =>
        selectedPromotionIds.has(promotion.idinc));

      for (const membership of memberships) {
        if (!isPromotionSaleForStatus(
          status,
          createdDate,
          shippedDate,
          membership,
          rangeFrom,
          rangeTo,
        )) continue;
        const promotion = promotionSummaries.get(membership.idinc);
        if (!promotion) continue;
        promotion.revenue += itemRevenue;
        if (!promotionDocsSeen.has(membership.idinc)) {
          promotion.docs += 1;
          promotionDocsSeen.add(membership.idinc);
        }
      }

      const matchesSelectedPromotion = selectedMemberships.some((membership) => (
        isPromotionSaleForStatus(
          status,
          createdDate,
          shippedDate,
          membership,
          rangeFrom,
          rangeTo,
        )
      ));
      if (!matchesSelectedPromotion) continue;

      hasSelectedProduct = true;
      selectedRowRevenue += itemRevenue;
      const saleDay = daily.get(saleDate);
      const itemSegment = businessSegmentFromText(`${item.category} ${item.name}`)
        ?? normalizeSalesPlanSegment(row.planGroup);
      const segmentKey = itemSegment === "Плитка" ? "tile" : itemSegment === "Сантехніка" ? "plumbing" : null;
      if (segmentKey) {
        selectedRowSegments.add(segmentKey);
        for (const membership of selectedMemberships) {
          promotionSummaries.get(membership.idinc)?.segmentSet.add(segmentKey);
        }
      }
      if (saleDay) {
        saleDay.total.revenue += itemRevenue;
        saleDay.total.qty += item.qty;
        if (itemSegment === "Плитка") {
          saleDay.tile.revenue += itemRevenue;
          saleDay.tile.qty += item.qty;
        } else if (itemSegment === "Сантехніка") {
          saleDay.plumbing.revenue += itemRevenue;
          saleDay.plumbing.qty += item.qty;
        }
      }
      const productKeyForBucket = item.code || item.name;
      const addBucket = (map: Map<string, { revenue: number; products: Set<string> }>, label: string) => {
        const key = label || "Без даних";
        const bucket = map.get(key) ?? { revenue: 0, products: new Set<string>() };
        bucket.revenue += itemRevenue;
        bucket.products.add(productKeyForBucket);
        map.set(key, bucket);
      };
      addBucket(brands, item.brand);
      addBucket(categories, item.category);
      if (input.includeProducts !== false) {
        const productKey = `${item.code}\u0000${item.brand}\u0000${item.category}`;
        const product = products.get(productKey) ?? {
          code: item.code,
          name: item.name,
          url: item.url,
          brand: item.brand,
          category: item.category,
          docs: 0,
          qty: 0,
          revenue: 0,
          docRefs: new Set<string>(),
        };
        product.qty += item.qty;
        product.revenue += itemRevenue;
        product.docRefs.add(row.docsRef || row.number);
        product.docs = product.docRefs.size;
        products.set(productKey, product);
      }
      if (createdDate.slice(0, 7) === planMonth && saleDate.slice(0, 7) === planMonth) {
        planRevenue += itemRevenue;
        if (itemSegment === "Плитка" || itemSegment === "Сантехніка") {
          planSegmentRevenue.set(
            itemSegment,
            (planSegmentRevenue.get(itemSegment) ?? 0) + itemRevenue,
          );
        }
      }
    }

    if (!hasSelectedProduct) continue;
    const saleDay = daily.get(saleDate);
    if (saleDay) {
      saleDay.total.docs += 1;
      if (selectedRowSegments.has("tile")) saleDay.tile.docs += 1;
      if (selectedRowSegments.has("plumbing")) saleDay.plumbing.docs += 1;
    }
    const state = states.get(status);
    if (state) {
      state.docs += 1;
      state.revenue += selectedRowRevenue;
    }
    salesDocs += 1;
    salesRevenue += selectedRowRevenue;
  }

  const monthlyPlanConfig = getMonthlySalesPlan(planMonth);
  const monthlyPlan = monthlyPlanConfig?.total ?? null;
  const finishRevenueBuckets = (map: Map<string, { revenue: number; products: Set<string> }>) =>
    [...map.entries()]
      .map(([label, bucket]) => ({ label, revenue: bucket.revenue, productCount: bucket.products.size }))
      .sort((a, b) => b.revenue - a.revenue);

  return {
    filter: {
      from: rangeFrom,
      to: rangeTo,
      selectedPromotionIdincs: selectedPromotions.length === input.promotions.length
        ? []
        : selectedPromotions.map((promotion) => promotion.idinc),
    },
    summary: {
      dataThrough,
      activePromotions: input.promotions.length,
      productCount: selectedCodes.size,
      docs: salesDocs,
      revenue: salesRevenue,
      plan: {
        month: planMonth,
        plan: monthlyPlan,
        revenue: planRevenue,
        completionPct: monthlyPlan ? (planRevenue / monthlyPlan) * 100 : null,
        segments: (["Плитка", "Сантехніка"] as const).map((segment) => {
          const segmentPlan = monthlyPlanConfig?.segments[segment] ?? 0;
          const segmentRevenue = planSegmentRevenue.get(segment) ?? 0;
          return {
            segment,
            plan: segmentPlan,
            revenue: segmentRevenue,
            completionPct: segmentPlan ? (segmentRevenue / segmentPlan) * 100 : null,
          };
        }),
      },
      publicPromotionGroups: input.publicPromotionGroups,
      daily: [...daily.values()],
      promotions: [...promotionSummaries.values()].map(({ segmentSet, ...promotion }) => ({
        ...promotion,
        segments: [...segmentSet],
      })).sort((a, b) => b.revenue - a.revenue),
      brands: finishRevenueBuckets(brands),
      categories: finishRevenueBuckets(categories),
      products: [...products.values()]
        .map((product) => ({
          code: product.code,
          name: product.name,
          url: product.url,
          brand: product.brand,
          category: product.category,
          docs: product.docs,
          qty: product.qty,
          revenue: product.revenue,
        }))
        .sort((a, b) => b.revenue - a.revenue),
      states: PROMOTION_SALES_STATUSES.map((status) => ({
        state: status,
        docs: states.get(status)?.docs ?? 0,
        revenue: states.get(status)?.revenue ?? 0,
      })),
    },
  };
}
