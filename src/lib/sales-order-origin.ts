import { getServerResult } from "@/lib/server-result-cache";
import { SALES_AUTO_REFRESH_MS } from "@/lib/sales-refresh";
import { orderOriginSource, type OrderOrigin } from "@/lib/orders-origin";

export type SalesChannel = "all" | "monomarket" | "rozetka";

export function normalizeSalesChannel(value: unknown): SalesChannel {
  return value === "monomarket" || value === "rozetka" ? value : "all";
}

type OriginApiOrder = { id: string | number; origin?: OrderOrigin | null };
type OriginPage = { data: OriginApiOrder[]; meta: { total_pages: number } };

// ERP shipment dates can differ from webshop creation dates. Keep the lookup
// independent of the selected reporting period, then apply ERP date rules.
export async function readRozetkaOrderIds(): Promise<ReadonlySet<string>> {
  const result = await getServerResult({
    namespace: "sales-rozetka-order-ids-v1",
    key: "all",
    ttlMs: SALES_AUTO_REFRESH_MS,
    maxEntries: 1,
    load: async () => {
      const apiKey = process.env.AGROMAT_API_KEY;
      if (!apiKey) throw new Error("AGROMAT_API_KEY is not configured");
      const base = (process.env.AGROMAT_API_BASE_URL || "https://www.agromat.ua/api/v1").replace(/\/$/, "");
      const headers = { Accept: "application/json", "X-API-Key": apiKey };
      async function page(number: number): Promise<OriginPage> {
        const params = new URLSearchParams({ page: String(number), per_page: "100", with_movements: "false" });
        const response = await fetch(`${base}/orders/?${params}`, {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`Orders API returned ${response.status}`);
        const payload = await response.json() as OriginPage;
        if (!Array.isArray(payload.data) || !Number.isInteger(payload.meta?.total_pages) || payload.meta.total_pages < 0) {
          throw new Error("Orders API returned invalid origin data");
        }
        return payload;
      }
      const ids = new Set<string>();
      const add = (payload: OriginPage) => {
        for (const order of payload.data) {
          if (orderOriginSource(order) === "rozetka") ids.add(String(order.id));
        }
      };
      const first = await page(1);
      add(first);
      for (let start = 2; start <= first.meta.total_pages; start += 6) {
        const pages = await Promise.all(Array.from(
          { length: Math.min(6, first.meta.total_pages - start + 1) },
          (_, index) => page(start + index),
        ));
        pages.forEach(add);
      }
      return [...ids];
    },
  });
  return new Set(result.value);
}

export function filterRozetkaSalesRows<T extends { webshopId: string }>(rows: T[], ids: ReadonlySet<string>): T[] {
  return rows.filter((row) => Boolean(row.webshopId) && ids.has(row.webshopId));
}
