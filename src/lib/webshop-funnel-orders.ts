import { orderInDateRange, ordersApiEndDate } from "@/lib/orders-date-range";
import { orderOriginSource, type OrderOrigin } from "@/lib/orders-origin";
import { SALES_AUTO_REFRESH_MS } from "@/lib/sales-refresh";
import { getServerResult } from "@/lib/server-result-cache";

type FunnelOrder = { id: number | string; date: string; origin?: OrderOrigin | null };
type OrderPage = {
  data: FunnelOrder[];
  meta: { total: number; page: number; per_page: number; total_pages: number };
};

const PAGE_SIZE = 50;

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Created site orders, including unpaid/cancelled orders, deduplicated by internal ID. */
export async function readWebshopFunnelOrders(input: { from: string; to: string }): Promise<number> {
  const { from, to } = input;
  if (!validDate(from) || !validDate(to) || from > to) throw new Error("WEB SHOP: некоректний період");
  const apiKey = process.env.AGROMAT_API_KEY;
  if (!apiKey) throw new Error("WEB SHOP: AGROMAT_API_KEY не налаштовано");
  const headers = { Accept: "application/json", "X-API-Key": apiKey };
  const base = (process.env.AGROMAT_API_BASE_URL || "https://www.agromat.ua/api/v1").replace(/\/+$/, "");
  const result = await getServerResult({
    namespace: "webshop-funnel-created-site-orders-v1",
    key: JSON.stringify([base, from, to]),
    ttlMs: SALES_AUTO_REFRESH_MS,
    maxEntries: 24,
    load: async () => {
      async function readPage(page: number): Promise<OrderPage> {
        const params = new URLSearchParams({
          page: String(page), per_page: String(PAGE_SIZE), with_movements: "false",
          date_from: from, date_to: ordersApiEndDate(to),
        });
        const response = await fetch(`${base}/orders/?${params}`, {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`WEB SHOP: Orders API повернув ${response.status}`);
        const payload = await response.json().catch(() => null) as OrderPage | null;
        const meta = payload?.meta;
        if (!Array.isArray(payload?.data) || !meta
          || !Number.isInteger(meta.total) || meta.total < 0
          || meta.page !== page || meta.per_page !== PAGE_SIZE
          || !Number.isInteger(meta.total_pages) || meta.total_pages < 0
          || (meta.total > 0 && meta.total_pages !== Math.ceil(meta.total / PAGE_SIZE))
          || (meta.total === 0 && meta.total_pages > 1)
          || payload.data.some((order) => !order || !/^[1-9]\d*$/.test(String(order.id))
            || !Number.isSafeInteger(Number(order.id)) || typeof order.date !== "string"
            || !Number.isFinite(Date.parse(order.date)))) {
          throw new Error("WEB SHOP: Orders API повернув некоректні дані або пагінацію");
        }
        const expected = Math.min(PAGE_SIZE, Math.max(0, meta.total - (page - 1) * PAGE_SIZE));
        if (payload.data.length !== expected) throw new Error("WEB SHOP: Orders API повернув неповну сторінку замовлень");
        return payload;
      }

      const first = await readPage(1);
      const ids = new Set<string>();
      const addPage = (page: OrderPage) => {
        if (page.meta.total !== first.meta.total || page.meta.total_pages !== first.meta.total_pages) {
          throw new Error("WEB SHOP: список замовлень змінився під час завантаження; повторіть запит");
        }
        for (const order of page.data) {
          const origin = orderOriginSource(order);
          if ((origin === "site" || origin === "webshop") && orderInDateRange(order.date, from, to)) {
            ids.add(String(Number(order.id)));
          }
        }
      };
      addPage(first);
      for (let start = 2; start <= first.meta.total_pages; start += 6) {
        const pages = await Promise.all(Array.from(
          { length: Math.min(6, first.meta.total_pages - start + 1) },
          (_, index) => readPage(start + index),
        ));
        pages.forEach(addPage);
      }
      return ids.size;
    },
  });
  return result.value;
}
