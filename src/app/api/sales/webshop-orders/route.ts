import { NextResponse } from "next/server";
import { getServerResult } from "@/lib/server-result-cache";
import { readSalesWebshopReturnLookup, type SalesWebshopReturnInfo } from "@/lib/sales-s3";
import { webshopFinalStatus } from "@/lib/sales-webshop-status";

export const dynamic = "force-dynamic";

type ApiOrder = {
  id: number;
  order_num: number | string | null;
  order_doc_id: number | string | null;
  is_synced: boolean;
  date: string;
  doc_date: string | null;
  status: string | null;
  http_status: number | null;
  payment: { status: string | null; type: string | null; system_ref: number | null } | null;
  totals: { cost: number; delivery: number; items_sum: number; weight: number; currency: string };
  customer: {
    client_id: number | null;
    first_name: string | null;
    last_name: string | null;
    patronymic: string | null;
    email: string | null;
    phone: string | null;
    callback: boolean;
    legal_name: string | null;
    legal_code: string | null;
    recipient: { first_name: string | null; last_name: string | null; patronymic: string | null; phone: string | null } | null;
  };
  delivery: {
    type: string | null;
    address: unknown;
    city_ref: string | null;
    department_ref: string | null;
    date: string | null;
    to_floor: number | null;
    elevator: boolean | null;
  } | null;
  comments: string | null;
  source: { utm_source: string | null; utm_campaign: string | null } | null;
  has_items: boolean;
  items: Array<{
    product_id: number | string;
    goods_ref: number | null;
    code: number | string | null;
    sku: string | null;
    name: string;
    url: string | null;
    quantity: number;
    number_pieces: number | null;
    sale_measures_ref: number | null;
    is_set: boolean;
    price: number;
    price_old: number | null;
    line_total: number;
    availability_status: { id: number; name: string } | null;
  }>;
  fulfillment?: {
    current: { id: number; name: string; stage: number } | null;
    history: Array<{ id: number; name: string; stage: number; rolled_back: boolean; started_at: string | null; finished_at: string | null }>;
  } | null;
  analytics_status?: string;
  return_info?: SalesWebshopReturnInfo | null;
};

type ApiResponse = {
  data: ApiOrder[];
  meta: { total: number; page: number; per_page: number; total_pages: number; movements_included: boolean };
};

const DAILY_CACHE_TTL_MS = 26 * 60 * 60 * 1000;
const DETAIL_PAGE_SIZE = 50;

type PaymentFilter = "all" | "cash" | "bank" | "online_full" | "online_parts";

type SummaryAccumulator = {
  orders: number;
  revenue: number;
  deliveryRevenue: number;
  synced: number;
  onlinePaid: number;
  paymentTypes: Map<string, number>;
  paymentStatuses: Map<string, number>;
  deliveryTypes: Map<string, number>;
  statuses: Map<string, number>;
};

function apiConfig() {
  const apiKey = process.env.AGROMAT_API_KEY;
  if (!apiKey) throw new Error("AGROMAT_API_KEY is not configured");
  const baseUrl = (process.env.AGROMAT_API_BASE_URL || "https://www.agromat.ua/api/v1").replace(/\/$/, "");
  return { apiKey, baseUrl };
}

async function fetchOrders(params: URLSearchParams) {
  const { apiKey, baseUrl } = apiConfig();
  // The trailing slash is required: the upstream redirect from /orders drops query parameters.
  const response = await fetch(`${baseUrl}/orders/?${params.toString()}`, {
    headers: { Accept: "application/json", "X-API-Key": apiKey },
    cache: "force-cache",
    next: { revalidate: 24 * 60 * 60 },
  });
  const payload = await response.json().catch(() => null) as ApiResponse | { message?: string; error?: string } | null;
  if (!response.ok || !payload || !("data" in payload)) {
    const message = payload && "message" in payload ? payload.message : payload && "error" in payload ? payload.error : null;
    throw new Error(message || `Orders API returned ${response.status}`);
  }
  return payload;
}

function increment(map: Map<string, number>, value: string | null | undefined) {
  const key = value?.trim() || "unknown";
  map.set(key, (map.get(key) || 0) + 1);
}

function createSummaryAccumulator(): SummaryAccumulator {
  return {
    orders: 0,
    revenue: 0,
    deliveryRevenue: 0,
    synced: 0,
    onlinePaid: 0,
    paymentTypes: new Map(),
    paymentStatuses: new Map(),
    deliveryTypes: new Map(),
    statuses: new Map(),
  };
}

function addToSummary(summary: SummaryAccumulator, orders: ApiOrder[]) {
  for (const order of orders) {
    summary.orders += 1;
    summary.revenue += Number(order.totals?.cost) || 0;
    summary.deliveryRevenue += Number(order.totals?.delivery) || 0;
    if (order.is_synced) summary.synced += 1;
    if (order.payment?.type === "online") summary.onlinePaid += 1;
    increment(summary.paymentTypes, paymentCategory(order));
    increment(summary.paymentStatuses, order.payment?.status);
    increment(summary.deliveryTypes, order.delivery?.type);
    increment(summary.statuses, fulfillmentStatus(order));
  }
}

function fulfillmentStatus(order: ApiOrder) {
  return order.analytics_status || order.fulfillment?.current?.name?.trim() || order.status?.trim() || "unknown";
}

function enrichOrder(
  order: ApiOrder,
  returnLookup: ReadonlyMap<string, SalesWebshopReturnInfo>,
  returnedWebshopIds: ReadonlySet<string>,
): ApiOrder {
  return {
    ...order,
    analytics_status: webshopFinalStatus(order, returnedWebshopIds),
    return_info: returnLookup.get(String(order.id)) || null,
  };
}

function paymentCategory(order: ApiOrder): Exclude<PaymentFilter, "all"> | "unknown" {
  const type = order.payment?.type;
  if (type === "online") {
    return order.payment?.status === "paymet_parts" ? "online_parts" : "online_full";
  }
  if (type === "cash" || type === "bank") return type;
  return "unknown";
}

function finalizeSummary(summary: SummaryAccumulator, total: number) {
  const distributions = (map: Map<string, number>) => [...map.entries()]
    .map(([key, docs]) => ({ key, docs }))
    .sort((left, right) => right.docs - left.docs);
  return {
    basedOn: summary.orders,
    partial: false,
    total,
    revenue: summary.revenue,
    averageOrder: summary.orders ? summary.revenue / summary.orders : 0,
    deliveryRevenue: summary.deliveryRevenue,
    synced: summary.synced,
    syncedPct: summary.orders ? (summary.synced / summary.orders) * 100 : 0,
    onlinePaid: summary.onlinePaid,
    onlinePaidPct: summary.orders ? (summary.onlinePaid / summary.orders) * 100 : 0,
    paymentTypes: distributions(summary.paymentTypes),
    paymentStatuses: distributions(summary.paymentStatuses),
    deliveryTypes: distributions(summary.deliveryTypes),
    statuses: distributions(summary.statuses),
    statusesTotal: total,
  };
}

function cacheDayInKyiv() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function applyOrderFilters(params: URLSearchParams, dateFrom: string, dateTo: string, synced: string | null) {
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
  if (synced === "true" || synced === "false") params.set("synced", synced);
}

async function fetchCompleteOrders(dateFrom: string, dateTo: string, synced: string | null) {
  const orders: ApiOrder[] = [];
  const firstParams = new URLSearchParams({ page: "1", per_page: String(DETAIL_PAGE_SIZE), with_movements: "true" });
  applyOrderFilters(firstParams, dateFrom, dateTo, synced);
  const first = await fetchOrders(firstParams);
  orders.push(...first.data);

  // P2 movements are available only for pages up to 50 rows. Load a few pages
  // concurrently and cache the completed dataset for the whole Kyiv day.
  for (let startPage = 2; startPage <= first.meta.total_pages; startPage += 6) {
    const requests: Array<Promise<ApiResponse>> = [];
    for (let page = startPage; page < Math.min(startPage + 6, first.meta.total_pages + 1); page += 1) {
      const params = new URLSearchParams({ page: String(page), per_page: String(DETAIL_PAGE_SIZE), with_movements: "true" });
      applyOrderFilters(params, dateFrom, dateTo, synced);
      requests.push(fetchOrders(params));
    }
    const responses = await Promise.all(requests);
    responses.forEach((response) => orders.push(...response.data));
  }

  return orders;
}

function summarizeOrders(orders: ApiOrder[]) {
  const summary = createSummaryAccumulator();
  addToSummary(summary, orders);
  return finalizeSummary(summary, orders.length);
}

function isPaymentFilter(value: string | null): value is PaymentFilter {
  return value === "cash" || value === "bank" || value === "online_full" || value === "online_parts";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const dateFrom = url.searchParams.get("from") || "";
    const dateTo = url.searchParams.get("to") || "";
    const synced = url.searchParams.get("synced");
    const orderId = url.searchParams.get("order_id");

    if (orderId && /^\d+$/.test(orderId)) {
      const params = new URLSearchParams({ search: orderId, per_page: "50", with_movements: "true" });
      const detailResult = await getServerResult({
        namespace: "webshop-order-detail-daily",
        key: `${cacheDayInKyiv()}|${orderId}`,
        ttlMs: DAILY_CACHE_TTL_MS,
        maxEntries: 256,
        load: () => fetchOrders(params),
      });
      const rawOrder = detailResult.value.data.find((item) => String(item.id) === orderId);
      const returnLookup = await readSalesWebshopReturnLookup();
      const returnedWebshopIds = new Set(returnLookup.keys());
      const order = rawOrder ? enrichOrder(rawOrder, returnLookup, returnedWebshopIds) : null;
      if (!order) return NextResponse.json({ error: "Замовлення не знайдено" }, { status: 404 });
      return NextResponse.json({ data: order }, {
        headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=3600", "X-Agromat-Cache": detailResult.status },
      });
    }

    const requestedPayment = url.searchParams.get("payment");
    const payment: PaymentFilter = isPaymentFilter(requestedPayment) ? requestedPayment : "all";
    const delivery = url.searchParams.get("delivery") || "all";
    const orderStatus = url.searchParams.get("order_status") || "all";

    const scopeKey = `${cacheDayInKyiv()}|${dateFrom || "all"}|${dateTo || "all"}|${synced || "all"}`;
    const ordersResult = await getServerResult({
      namespace: "webshop-orders-dataset-with-p2-daily-v1",
      key: scopeKey,
      ttlMs: DAILY_CACHE_TTL_MS,
      maxEntries: 16,
      load: () => fetchCompleteOrders(dateFrom, dateTo, synced),
    });
    const returnLookup = await readSalesWebshopReturnLookup();
    const returnedWebshopIds = new Set(returnLookup.keys());
    const enrichedOrders = ordersResult.value.map((order) => enrichOrder(order, returnLookup, returnedWebshopIds));
    const filteredOrders = enrichedOrders.filter((order) => (
      (payment === "all" || paymentCategory(order) === payment)
      && (delivery === "all" || order.delivery?.type === delivery)
      && (orderStatus === "all" || fulfillmentStatus(order) === orderStatus)
    ));
    const paymentFacet = enrichedOrders.filter((order) => (
      (delivery === "all" || order.delivery?.type === delivery)
      && (orderStatus === "all" || fulfillmentStatus(order) === orderStatus)
    ));
    const deliveryFacet = enrichedOrders.filter((order) => (
      (payment === "all" || paymentCategory(order) === payment)
      && (orderStatus === "all" || fulfillmentStatus(order) === orderStatus)
    ));
    const statusFacet = enrichedOrders.filter((order) => (
      (payment === "all" || paymentCategory(order) === payment)
      && (delivery === "all" || order.delivery?.type === delivery)
    ));
    const summary = summarizeOrders(filteredOrders);
    summary.paymentTypes = summarizeOrders(paymentFacet).paymentTypes;
    summary.deliveryTypes = summarizeOrders(deliveryFacet).deliveryTypes;
    summary.statuses = summarizeOrders(statusFacet).statuses;
    summary.statusesTotal = statusFacet.length;
    const totalPages = Math.max(1, Math.ceil(filteredOrders.length / DETAIL_PAGE_SIZE));
    const effectivePage = Math.min(page, totalPages);
    const start = (effectivePage - 1) * DETAIL_PAGE_SIZE;

    return NextResponse.json({
      data: filteredOrders.slice(start, start + DETAIL_PAGE_SIZE),
      meta: { total: filteredOrders.length, page: effectivePage, per_page: DETAIL_PAGE_SIZE, total_pages: totalPages, movements_included: true },
      summary,
    }, {
      headers: {
        "Cache-Control": "private, max-age=300, stale-while-revalidate=3600",
        "X-Agromat-Cache": ordersResult.status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load webshop orders";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
