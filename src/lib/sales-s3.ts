import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getMonthlySalesPlan, normalizeSalesPlanSegment, SALES_PLAN_SEGMENTS } from "@/lib/sales-plan";
import { readAllLite } from "@/lib/products-store";

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

export type SalesDateSummary = {
  date: string;
  docs: number;
  goods: number;
  revenue: number;
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
    byDate: SalesDateSummary[];
    months: SalesMonthSummary[];
    segments: SalesBucketSummary[];
    brands: SalesBucketSummary[];
    categories: SalesBucketSummary[];
    states: Array<{ state: string; docs: number; revenue: number }>;
    availableStates: Array<{ state: string; docs: number; revenue: number }>;
  };
};

type MutableBucket = SalesBucketSummary & {
  marginSum: number;
  marginCount: number;
};

type ParsedSalesItem = {
  brand: string;
  category: string;
  revenue: number;
};

type ParsedSalesRow = SalesRow & {
  items: ParsedSalesItem[];
};

type CacheEntry = {
  signature: string;
  rows: ParsedSalesRow[];
  source: SalesDataset["source"];
  expiresAt: number;
};

let cached: CacheEntry | null = null;
let categoryByCodeCache: Map<string, string> | null = null;
let groupNameByIdCache: Map<string, string> | null = null;

export type SalesDateFilter = {
  from?: string;
  to?: string;
  productCodes?: string | number[];
  statuses?: string | string[];
};

function getSalesS3Url() {
  return process.env.SALES_S3_URL || "s3://dataset4bq/analysebillsofparsel.csv";
}

function getSalesGroupsS3Url() {
  return process.env.SALES_GROUPS_S3_URL || "s3://dataset4bq/inventorygroups.csv";
}

export function parseS3Url(value: string) {
  const match = value.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Bad SALES_S3_URL: ${value}`);
  return { bucket: match[1], key: match[2] };
}

function getS3Client() {
  return new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
  });
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

function matchesProductCodes(goodsCodes: string[], productCodeSet: Set<number>) {
  if (productCodeSet.size === 0) return true;
  return goodsCodes.some((code) => productCodeSet.has(parseInt(code, 10)));
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

function isShipped(row: SalesRow) {
  return Boolean(row.shippedDate) && row.state.toLocaleLowerCase("uk").includes("повністю відвантаж");
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

function topBuckets(map: Map<string, MutableBucket>, limit: number) {
  return finishBuckets(map).slice(0, limit);
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

function addState(map: Map<string, { state: string; docs: number; revenue: number }>, state: string, revenue: number) {
  const label = state || "Без статусу";
  const item = map.get(label) || { state: label, docs: 0, revenue: 0 };
  item.docs += 1;
  item.revenue += revenue;
  map.set(label, item);
}

function addMonth(map: Map<string, SalesMonthSummary>, month: string, row: SalesRow) {
  const item = map.get(month) || { month, docs: 0, goods: 0, revenue: 0 };
  item.docs += 1;
  item.goods += row.goodsCount;
  item.revenue += row.docsSum;
  map.set(month, item);
}

function buildPlanSummary(months: SalesMonthSummary[], currentMonthSegments: SalesBucketSummary[], currentMonth: string): SalesPlanSummary {
  const monthlyPlan = getMonthlySalesPlan(currentMonth);
  const plan = monthlyPlan?.total ?? null;
  const current = months.find((month) => month.month === currentMonth);
  const previousMonth = (() => {
    const [year, month] = currentMonth.split("-").map(Number);
    const previous = new Date(Date.UTC(year, month - 2, 1));
    return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
  })();
  const previous = months.find((month) => month.month === previousMonth);
  const revenue = current?.revenue || 0;
  const previousRevenue = previous?.revenue || 0;
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

async function getCategoryByCode() {
  if (categoryByCodeCache) return categoryByCodeCache;
  try {
    const products = await readAllLite();
    categoryByCodeCache = new Map(products.map((product) => [String(product.code), product.categoryName || product.categoryPath || String(product.categoryId)]));
  } catch {
    categoryByCodeCache = new Map();
  }
  return categoryByCodeCache;
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

function parseSalesRows(
  csvText: string,
  categoryByCode: Map<string, string>,
  groupNameById: Map<string, string>,
): ParsedSalesRow[] {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] || "");
  const idx = new Map(headers.map((header, index) => [header, index]));

  const get = (values: string[], key: string) => values[idx.get(key) ?? -1] || "";
  const rows: ParsedSalesRow[] = [];

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const goodsCodes = splitList(get(values, "goods_codes"));
    const brandsList = splitList(get(values, "trademarks_names"));
    const categoriesList = splitList(get(values, "groups_refs"));
    const goodsNamesList = splitList(get(values, "goods_names"));
    const rowSums = splitList(get(values, "rows_sums")).map(parseNumber);
    const goodsCount = Math.max(goodsCodes.length, brandsList.length, categoriesList.length, rowSums.length, 1);
    const state = get(values, "state");
    const categoryNames = Array.from({ length: goodsCount }, (_, i) => (
      groupNameById.get(categoriesList[i]) || categoryByCode.get(goodsCodes[i]) || formatCategoryFallback(categoriesList[i])
    ));
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
        brand: brandsList[i] || "Без бренда",
        category: categoryNames[i],
        revenue: rowSums[i] || 0,
      })),
    };

    rows.push(row);
  }

  return rows;
}

function buildDataset(
  rows: ParsedSalesRow[],
  source: SalesDataset["source"],
  dateFilter?: SalesDateFilter,
): SalesDataset {
  const filter = getEffectiveFilter(dateFilter);
  const productCodeSet = new Set(filter.productCodes);
  const statusSet = new Set(filter.statuses);
  const matchedProductCodes = new Set<number>();
  const filteredRows: ParsedSalesRow[] = [];
  const byDate = new Map<string, SalesDateSummary>();
  const months = new Map<string, SalesMonthSummary>();
  const allMonths = new Map<string, SalesMonthSummary>();
  const segments = new Map<string, MutableBucket>();
  const allSegmentsByMonth = new Map<string, Map<string, MutableBucket>>();
  const brands = new Map<string, MutableBucket>();
  const categories = new Map<string, MutableBucket>();
  const states = new Map<string, { state: string; docs: number; revenue: number }>();
  const availableStates = new Map<string, { state: string; docs: number; revenue: number }>();
  const planMonths = new Map<string, SalesMonthSummary>();
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

  for (const row of rows) {
    const goodsCodes = splitList(row.goodsCodes);
    if (matchesProductCodes(goodsCodes, productCodeSet)) {
      const statusDate = row.shippedDate || row.createdDate;
      if (isWithinOptionalFilter(statusDate, filter)) addState(availableStates, row.state, row.docsSum);
      if (isWithinOptionalFilter(statusDate, filter)) addState(states, row.state, row.docsSum);
    }

    const analysisDate = row.shippedDate || row.createdDate;
    if (
      matchesProductCodes(goodsCodes, productCodeSet)
      && isWithinOptionalFilter(analysisDate, filter)
      && (statusSet.size === 0 || statusSet.has(row.state || "Без статусу"))
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
      for (const item of row.items) {
        addBucket(brands, item.brand, row, item.revenue || row.docsSum / row.goodsCount);
        addBucket(categories, item.category, row, item.revenue || row.docsSum / row.goodsCount);
      }
    }

    if (!isShipped(row) || !row.shippedDate) continue;

    const shippedMonth = row.shippedDate.slice(0, 7);
    addMonth(allMonths, shippedMonth, row);
    let allMonthSegments = allSegmentsByMonth.get(shippedMonth);
    if (!allMonthSegments) {
      allMonthSegments = new Map<string, MutableBucket>();
      allSegmentsByMonth.set(shippedMonth, allMonthSegments);
    }
    addBucket(allMonthSegments, row.planGroup, row, row.docsSum, row.goodsCount);

    if (!matchesProductCodes(goodsCodes, productCodeSet)) continue;
    for (const code of goodsCodes) {
      const n = parseInt(code, 10);
      if (productCodeSet.has(n)) matchedProductCodes.add(n);
    }

    addMonth(planMonths, shippedMonth, row);
    let planMonthSegments = planSegmentsByMonth.get(shippedMonth);
    if (!planMonthSegments) {
      planMonthSegments = new Map<string, MutableBucket>();
      planSegmentsByMonth.set(shippedMonth, planMonthSegments);
    }
    addBucket(planMonthSegments, row.planGroup, row, row.docsSum, row.goodsCount);

    if (!isWithinFilter(row.shippedDate, filter)) continue;
    if (statusSet.size > 0 && !statusSet.has(row.state || "Без статусу")) continue;
    returnedRevenue += row.returnSum;
    if (isCanceled(row.state)) canceledDocs += 1;

    shippedDocs += 1;
    shippedGoods += row.goodsCount;
    shippedRevenue += row.docsSum;
    if (!firstShippedDate || row.shippedDate < firstShippedDate) firstShippedDate = row.shippedDate;
    if (!lastShippedDate || row.shippedDate > lastShippedDate) lastShippedDate = row.shippedDate;

    addDate(byDate, row.shippedDate, row);
    addMonth(months, shippedMonth, row);
  }

  const monthList = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  const allMonthList = [...allMonths.values()].sort((a, b) => a.month.localeCompare(b.month));
  const segmentList = finishSegmentBuckets(segments);
  const planMonth = getPlanMonthForFilter(filter);
  const hasProductFilter = productCodeSet.size > 0;
  const planMonthList = hasProductFilter
    ? [...planMonths.values()].sort((a, b) => a.month.localeCompare(b.month))
    : allMonthList;
  const planMonthSegments = finishBuckets((hasProductFilter ? planSegmentsByMonth : allSegmentsByMonth).get(planMonth) || new Map<string, MutableBucket>());

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
      plan: buildPlanSummary(planMonthList, planMonthSegments, planMonth),
      byDate: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
      months: monthList,
      segments: segmentList,
      brands: topBuckets(brands, 25),
      categories: topBuckets(categories, 25),
      states: [...states.values()].sort((a, b) => b.docs - a.docs),
      availableStates: [...availableStates.values()].sort((a, b) => b.docs - a.docs),
    },
  };
}

export async function readSalesDataset(filter?: SalesDateFilter): Promise<SalesDataset> {
  const { bucket, key } = parseS3Url(getSalesS3Url());
  const client = getS3Client();
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const signature = `${head.ETag || ""}:${head.LastModified?.toISOString() || ""}:${head.ContentLength || 0}:sales-plan-v2`;
  const [categoryByCode, groupNameById] = await Promise.all([getCategoryByCode(), getGroupNameById()]);

  if (cached && cached.signature === signature && Date.now() < cached.expiresAt) {
    return buildDataset(cached.rows, cached.source, filter);
  }

  const csvText = await readS3Text(getSalesS3Url());

  const nextRefresh = getNextKyivSix();
  const source = {
    bucket,
    key,
    size: head.ContentLength ?? null,
    lastModified: head.LastModified?.toISOString() ?? null,
    refreshPolicy: "Дані перечитуються з S3 після 06:00 за Києвом або коли зміниться файл",
    nextRefreshAt: nextRefresh.toISOString(),
  };
  const rows = parseSalesRows(csvText, categoryByCode, groupNameById);
  cached = { signature, rows, source, expiresAt: nextRefresh.getTime() };
  return buildDataset(rows, source, filter);
}
