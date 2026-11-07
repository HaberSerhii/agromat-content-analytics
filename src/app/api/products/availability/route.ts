import { readDailyAvailabilitySnapshot } from "@/lib/product-availability-daily-store";
import { buildDailyAvailabilitySnapshot } from "@/lib/product-availability-daily";
import { readDailySnapshot, readAllLite, readLiteSyncedAt } from "@/lib/products-store";
import { availabilityMembers, availabilityChanges } from "@/lib/product-availability-selection";
import { NextResponse } from "next/server";
import { monthlyPeriods } from "@/lib/sales-monthly";
import { availabilityDate, type AvailabilityFilter } from "@/lib/product-availability";
import { readAvailabilityReport } from "@/lib/product-availability-report";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некоректні параметри" }, { status: 400 }); }
  const today = availabilityDate(new Date().toISOString());
  const end = body?.month || today.slice(0, 7), count = body?.count ?? 6;
  if (typeof end !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(end) || end > today.slice(0, 7) || end < "2000-01" || ![3, 6, 12].includes(count)) return NextResponse.json({ error: "Некоректний період" }, { status: 400 });
  const analysis = body?.analysis ?? "monthly";
  if (!["monthly", "daily"].includes(analysis)) return NextResponse.json({ error: "Некоректний формат аналізу" }, { status: 400 });
  const promotion = body?.promotion ?? "all";
  if (!["all", "promo", "regular"].includes(promotion)) return NextResponse.json({ error: "Некоректний фільтр акцій" }, { status: 400 });
  const validSelection = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 2000 && value.every(item => typeof item === "string" && item.length <= 300);
  const categories = body?.categories ?? [], brands = body?.brands ?? [];
  if (!validSelection(categories) || !validSelection(brands)) return NextResponse.json({ error: "Некоректні категорії або бренди" }, { status: 400 });
  const to = end === today.slice(0, 7) ? today : new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const filter: AvailabilityFilter = { categories: [...new Set(categories)], brands: [...new Set(brands)], promotion };
  try {
    const months = monthlyPeriods(to, count).map(period => period.from.slice(0, 7));
    const yearMonths = analysis === "monthly" && !body.selection ? months.map(month => `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`) : [];
    const loaded = await readAvailabilityReport([...new Set([...months, ...yearMonths])], filter, analysis === "daily");
    const report = { ...loaded, months: loaded.months.filter(item => months.includes(item.month)), previousYear: loaded.months.filter(item => yearMonths.includes(item.month)) };
    if (body.selection) {
      const { status, period, mode } = body.selection;
      if (!["active", "inactive"].includes(status) || !["current", "previous"].includes(period) || !["total", "changes"].includes(mode)) return NextResponse.json({ error: "Некоректна вибірка" }, { status: 400 });
      const previousMonth = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
      async function members(month: string) {
        const entry = report.months.find(item => item.month === month);
        if (!entry?.date) throw new Error("Немає знімка за вибраний місяць");
        let snapshot = await readDailyAvailabilitySnapshot(entry.date);
        if (snapshot?.syncedAt !== entry.syncedAt) {
          const full = await readDailySnapshot(entry.date, false);
          if (full?.syncedAt === entry.syncedAt) snapshot = buildDailyAvailabilitySnapshot(full.products, full.syncedAt!);
          else if (await readLiteSyncedAt() === entry.syncedAt) {
            const products = await readAllLite();
            if (await readLiteSyncedAt() === entry.syncedAt) snapshot = buildDailyAvailabilitySnapshot(products, entry.syncedAt!);
          }
        }
        if (!snapshot || snapshot.syncedAt !== entry.syncedAt) throw new Error("Детальний знімок за цей місяць недоступний");
        return availabilityMembers(snapshot, filter, status);
      }
      try {
        const selected = await members(period === "current" ? end : previousMonth);
        const rows: Array<{ id: number; category: string; brand: string; change: string }> = mode === "changes" ? [] : [...selected.values()].map(product => ({ ...product, change: "" }));
        if (mode === "changes") {
          const changes = availabilityChanges(selected, await members(previousMonth));
          rows.push(...changes.added.map(product => ({ ...product, change: "+" })), ...changes.removed.map(product => ({ ...product, change: "−" })));
        }
        const catalogue = new Map((await readAllLite()).map(product => [product.id, product]));
        return NextResponse.json({ products: rows.map(row => ({ ...row, name: catalogue.get(row.id)?.name || `Товар #${row.id}`, sku: catalogue.get(row.id)?.sku || "", url: catalogue.get(row.id)?.url || "" })) }, { headers: { "Cache-Control": "private, no-store" } });
      } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Не вдалося завантажити товари" }, { status: 409 }); }
    }
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Не вдалося завантажити аналіз наявності" }, { status: 502 });
  }
}
