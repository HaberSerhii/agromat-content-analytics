import { getServerResult } from "@/lib/server-result-cache";
import type { SalesWebshopReturnInfo } from "@/lib/sales-s3";
import type { OrderOrigin } from "@/lib/orders-origin";
import type { MarketingAttribution } from "@/lib/order-marketing-attribution";
import type { OnlinePayment } from "@/lib/online-payments";
import { orderInDateRange, ordersApiEndDate } from "@/lib/orders-date-range";
export type ApiOrder = {
  origin?: OrderOrigin | null;
  marketing?: MarketingAttribution;
  id: number;
  order_num: number | string | null;
  order_doc_id: number | string | null;
  is_synced: boolean;
  date: string;
  doc_date: string | null;
  status: string | null;
  http_status: number | null;
  payment: { status: string | null; type: string | null; system_ref: number | null; order_id?: string; liqpay_order_id?: string } | null;
  online_payments?: OnlinePayment[];
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
    name: string | null;
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
  erp_manager?: string | null;
};

export type ApiResponse = {
  data: ApiOrder[];
  meta: { total: number; page: number; per_page: number; total_pages: number; movements_included: boolean };
};

const DETAIL_PAGE_SIZE = 50;

function apiConfig() {
  const apiKey = process.env.AGROMAT_API_KEY;
  if (!apiKey) throw new Error("AGROMAT_API_KEY is not configured");
  const baseUrl = (process.env.AGROMAT_API_BASE_URL || "https://www.agromat.ua/api/v1").replace(/\/$/, "");
  return { apiKey, baseUrl };
}

export async function fetchOrders(params: URLSearchParams) {
  const { apiKey, baseUrl } = apiConfig();
  // The trailing slash is required: the upstream redirect from /orders drops query parameters.
  const response = await fetch(`${baseUrl}/orders/?${params.toString()}`, {
    headers: { Accept: "application/json", "X-API-Key": apiKey },
    cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as ApiResponse | { message?: string; error?: string } | null;
  if (!response.ok || !payload || !("data" in payload)) {
    const message = payload && "message" in payload ? payload.message : payload && "error" in payload ? payload.error : null;
    throw new Error(message || `Orders API returned ${response.status}`);
  }
  return payload;
}

function applyOrderFilters(params: URLSearchParams, dateFrom: string, dateTo: string, synced: string | null) {
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", ordersApiEndDate(dateTo));
  if (synced === "true" || synced === "false") params.set("synced", synced);
}

export async function fetchCompleteOrders(dateFrom: string, dateTo: string, synced: string | null, withMovements = false) {
  const orders: ApiOrder[] = [];
  const firstParams = new URLSearchParams({ page: "1", per_page: String(DETAIL_PAGE_SIZE), with_movements: String(withMovements) });
  applyOrderFilters(firstParams, dateFrom, dateTo, synced);
  const first = await fetchOrders(firstParams);
  orders.push(...first.data);

  // P2 movements are available only for pages up to 50 rows. Load a few pages
  // concurrently and cache the completed dataset for the refresh interval.
  for (let startPage = 2; startPage <= first.meta.total_pages; startPage += 6) {
    const requests: Array<Promise<ApiResponse>> = [];
    for (let page = startPage; page < Math.min(startPage + 6, first.meta.total_pages + 1); page += 1) {
      const params = new URLSearchParams({ page: String(page), per_page: String(DETAIL_PAGE_SIZE), with_movements: String(withMovements) });
      applyOrderFilters(params, dateFrom, dateTo, synced);
      requests.push(fetchOrders(params));
    }
    const responses = await Promise.all(requests);
    responses.forEach((response) => orders.push(...response.data));
  }

  return orders.filter((order) => orderInDateRange(order.date, dateFrom, dateTo));
}


export async function readBaseOrders(from: string, to: string) {
  return getServerResult({ namespace: "webshop-orders-shared-v1", key: JSON.stringify({ from, to }), ttlMs: 15 * 60_000, staleMs: 60_000, maxEntries: 6,
    load: () => fetchCompleteOrders(from, to, null) });
}
