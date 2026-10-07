import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { readAllLite } from "@/lib/products-store";
import type { ApiCart } from "@/lib/cart-types";

export const dynamic = "force-dynamic";
const kyivDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" });
export async function GET(request: Request) {
  if (!isDashboardRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  if ([from, to].some(date => date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))) || (from && to && from > to)) {
    return NextResponse.json({ error: "Некоректний період" }, { status: 400 });
  }
  try {
    const apiKey = process.env.AGROMAT_API_KEY;
    if (!apiKey) throw new Error("Agromat API не налаштовано");
    const base = (process.env.AGROMAT_API_BASE_URL || "https://www.agromat.ua/api/v1").replace(/\/$/, "");
    const collected = new Map<number, ApiCart>();
    let totalPages = 1;
    for (let page = 1; page <= totalPages; page++) {
      const response = await fetch(`${base}/carts/?page=${page}&per_page=50`, { headers: { "X-API-Key": apiKey, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]) });
      if (!response.ok) throw new Error(`Carts API: HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.data) || !Number.isInteger(payload.meta?.total_pages) || payload.meta.total_pages < 0) throw new Error("Некоректна відповідь Carts API");
      totalPages = payload.meta.total_pages;
      if (totalPages > 100) throw new Error("Обсяг кошиків перевищує ліміт повного завантаження. Потрібна серверна синхронізація.");
      for (const cart of payload.data as ApiCart[]) collected.set(cart.id, cart);
    }
    const data = [...collected.values()].filter(cart => {
      const date = kyivDate.format(new Date(cart.created_at));
      return (!from || date >= from) && (!to || date <= to);
    });
    if (data.some(cart => cart.currency !== "UAH")) throw new Error("У вибірці є інша валюта; сумування потребує окремого розрахунку.");
    const catalog = await readAllLite().catch(() => []);
    const byId = new Map(catalog.map(product => [product.id, product]));
    const bySku = new Map(catalog.filter(product => product.sku).map(product => [product.sku!, product]));
    const byCode = new Map(catalog.map(product => [String(product.code), product]));
    const missingIds = [...new Set(data.flatMap(cart => cart.items).filter(item => item.type === "product" && !byCode.has(item.sku) && !bySku.has(item.sku) && !byId.has(item.id)).map(item => item.id))];
    const fallbackUrls = new Map<number, string>();
    for (let start = 0; start < missingIds.length; start += 4) {
      const ids = missingIds.slice(start, start + 4);
      const results = await Promise.allSettled(ids.map(async id => {
        const item = data.flatMap(cart => cart.items).find(item => item.id === id)!;
        const response = await fetch(`${base}/products/?${new URLSearchParams({search: item.sku, per_page: "5"})}`, {headers: {"X-API-Key": apiKey, Accept: "application/json"}, cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)])});
        if (!response.ok) return null;
        const payload = await response.json();
        return payload.data?.find((product: {sku: string; code: number}) => product.sku === item.sku || String(product.code) === item.sku) as {url: string} | undefined;
      }));
      results.forEach((result, index) => { if (result.status === "fulfilled" && result.value?.url) fallbackUrls.set(ids[index], result.value.url); });
    }
    for (const cart of data) for (const item of cart.items) {
      const product = item.type === "product" ? byCode.get(item.sku) || bySku.get(item.sku) || byId.get(item.id) : undefined;
      const productUrl = product?.url || fallbackUrls.get(item.id);
      if (!productUrl) { item.url = null; continue; }
      try {
        const url = new URL(productUrl, "https://www.agromat.ua");
        item.url = url.protocol === "https:" && ["agromat.ua", "www.agromat.ua"].includes(url.hostname) ? url.href : null;
      } catch { item.url = null; }
    }
    return NextResponse.json({ data, fetched_at: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не вдалося завантажити кошики" }, { status: 502 });
  }
}
