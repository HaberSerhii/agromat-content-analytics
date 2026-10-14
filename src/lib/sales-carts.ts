import { createHash } from "node:crypto";
import { readAllLite } from "@/lib/products-store";
import { getServerResult } from "@/lib/server-result-cache";
import type { ApiCart } from "@/lib/cart-types";

function configuration() {
  const apiKey = process.env.AGROMAT_API_KEY;
  if (!apiKey) throw new Error("Agromat API не налаштовано");
  const base = (process.env.AGROMAT_API_BASE_URL || "https://www.agromat.ua/api/v1").replace(/\/$/, "");
  const scope = createHash("sha256").update(`${base}|${apiKey}`).digest("hex");
  return { base, scope, headers: { "X-API-Key": apiKey, Accept: "application/json" } };
}

export async function loadCartSnapshot(refresh = false) {
  const { base, scope, headers } = configuration();
  return (await getServerResult({
    namespace: "sales-carts", key: scope, ttlMs: 30_000, maxEntries: 2, refresh,
    load: async () => {
      // A shared load must survive an individual browser request being cancelled.
      const signal = AbortSignal.timeout(45_000);
      const pageData = async (page: number) => {
        const response = await fetch(`${base}/carts/?page=${page}&per_page=50`, {
          headers, cache: "no-store", signal,
        });
        if (!response.ok) throw new Error(`Carts API: HTTP ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload.data) || !Number.isInteger(payload.meta?.total_pages) || payload.meta.total_pages < 0)
          throw new Error("Некоректна відповідь Carts API");
        if (payload.meta.total_pages > 100)
          throw new Error("Обсяг кошиків перевищує ліміт повного завантаження. Потрібна серверна синхронізація.");
        return { data: payload.data as ApiCart[], totalPages: payload.meta.total_pages as number };
      };
      const first = await pageData(1);
      const collected = new Map(first.data.map(cart => [cart.id, cart]));
      let totalPages = first.totalPages;
      for (let page = 2; page <= totalPages;) {
        const count = Math.min(4, totalPages - page + 1);
        const pages = await Promise.all(Array.from({ length: count }, (_, index) => pageData(page + index)));
        for (const result of pages) {
          totalPages = Math.max(totalPages, result.totalPages);
          for (const cart of result.data) collected.set(cart.id, cart);
        }
        page += count;
      }
      return {
        data: [...collected.values()].map(cart => ({ ...cart, items: cart.items.map(item => ({ ...item, url: trustedProductUrl(item.url) })) })),
        fetched_at: new Date().toISOString(),
      };
    },
  })).value;
}

function trustedProductUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value, "https://www.agromat.ua");
    return url.protocol === "https:" && ["agromat.ua", "www.agromat.ua"].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

/** Only enrich the opened cart; product lookups never block the dashboard list. */
export async function cartWithProductLinks(cart: ApiCart): Promise<ApiCart> {
  const { base, scope, headers } = configuration();
  const catalog = await readAllLite().catch(() => []);
  const byId = new Map(catalog.map(product => [product.id, product]));
  const bySku = new Map(catalog.filter(product => product.sku).map(product => [product.sku!, product]));
  const byCode = new Map(catalog.map(product => [String(product.code), product]));
  const items = cart.items.map(item => ({ ...item, url: null as string | null }));
  for (let start = 0; start < items.length; start += 4) {
    await Promise.all(items.slice(start, start + 4).map(async item => {
      if (item.type !== "product") return;
      const product = byCode.get(item.sku) || bySku.get(item.sku) || byId.get(item.id);
      if (product?.url) { item.url = trustedProductUrl(product.url); return; }
      if (!item.sku) return;
      try {
        const result = await getServerResult({
          namespace: "sales-cart-product-links", key: `${scope}|${item.id}|${item.sku}`,
          ttlMs: 60_000, maxEntries: 1000,
          load: async () => {
            const response = await fetch(`${base}/products/?${new URLSearchParams({ search: item.sku, per_page: "5" })}`, {
              headers, cache: "no-store", signal: AbortSignal.timeout(10_000),
            });
            if (!response.ok) throw new Error(`Products API: HTTP ${response.status}`);
            const payload = await response.json();
            const match = payload.data?.find((candidate: { sku: string; code: number }) => candidate.sku === item.sku || String(candidate.code) === item.sku);
            return trustedProductUrl(match?.url);
          },
        });
        item.url = result.value;
      } catch { /* Product links are optional; keep the cart details usable. */ }
    }));
  }
  return { ...cart, items };
}
