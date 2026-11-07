import fs from "node:fs/promises";
import path from "node:path";
import { readDiskSnapshot } from "@/lib/products-disk-cache";
import type { ApiProduct } from "@/lib/products-api";
import { parsePackKg, type GroutProduct } from "@/lib/grout-calculator";

export interface GroutCatalog {
  products: GroutProduct[];
  syncedAt: string;
  source: "api" | "cache" | "snapshot";
  warning?: string;
}
const cachePath = path.join(process.cwd(), "data", "grout-catalog.json");
let memory: GroutCatalog | undefined;
let pending: Promise<GroutCatalog> | undefined;

function fromApi(p: ApiProduct): GroutProduct {
  const attributes = p.attributes.map(a => ({ name: a.attribute_name, values: a.values.map(v => v.name) }));
  return { id: p.id, code: p.code, name: p.name, brand: p.brand, url: p.url,
    price: p.prices?.actual ?? null, currency: p.prices?.currency || "UAH",
    stock: p.stock?.quantity ?? null, status: p.stock?.status?.name || "",
    packKg: parsePackKg(attributes, p.name), attributes, updatedAt: p.updated_at };
}

async function loadCatalog(): Promise<GroutCatalog> {
  try {
    if (!process.env.AGROMAT_API_KEY) throw new Error("No API credentials");
    const products = new Map<number, GroutProduct>();
    // Search is supported by the upstream API; category_id is silently ignored.
    let page = 1, pages = 1;
    do {
      const query = new URLSearchParams({ search: "заповнювач", per_page: "200", page: String(page) });
      const response = await fetch(`${(process.env.AGROMAT_API_BASE_URL || "https://www.agromat.ua/api/v1").replace(/\/$/, "")}/products/?${query}`, {
        headers: { "X-API-Key": process.env.AGROMAT_API_KEY }, cache: "no-store", signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error("Catalog unavailable");
      const payload = await response.json() as { data: ApiProduct[]; meta: { total_pages: number } };
      pages = payload.meta.total_pages;
      if (!Number.isInteger(pages) || pages > 10) throw new Error("Unexpected catalog size");
      for (const p of payload.data) if (!p.deleted && /заповнювачі швів/i.test(p.category.name)) products.set(p.id, fromApi(p));
      page++;
    } while (page <= pages);
    if (!products.size) throw new Error("Empty catalog");
    const catalog: GroutCatalog = { products: [...products.values()], syncedAt: new Date().toISOString(), source: "api" };
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath + ".tmp", JSON.stringify(catalog));
    await fs.rename(cachePath + ".tmp", cachePath);
    return catalog;
  } catch {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf8")) as GroutCatalog;
      if (cached.products?.length) return { ...cached, source: "cache", warning: "API недоступний. Показано збережену копію; ціни та залишки могли змінитися." };
    } catch { /* Use the existing local snapshot when offline. */ }
    const snapshot = await readDiskSnapshot();
    if (!snapshot) throw new Error("Немає доступу до каталогу та локальної копії. Спробуйте оновити базу пізніше.");
    return { syncedAt: snapshot.syncedAt, source: "snapshot", warning: "Історичний знімок каталогу: актуальність цін, залишків і технічних характеристик не підтверджена.",
      products: snapshot.products.filter(p => !p.deleted && /заповнювачі швів/i.test(p.categoryName)).map(p => ({
        id: p.id, code: p.code, name: p.name, brand: p.brand, url: p.url, price: p.price, currency: p.currency,
        stock: p.stockQty, status: p.statusName, packKg: parsePackKg([], p.name), attributes: [], updatedAt: p.updatedAt,
      })) };
  }
}

export async function getGroutCatalog(refresh = false): Promise<GroutCatalog> {
  if (!refresh && memory && Date.now() - Date.parse(memory.syncedAt) < 5 * 60_000) return memory;
  if (pending) return pending;
  pending = loadCatalog();
  try { memory = await pending; return memory; } finally { pending = undefined; }
}
