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
    return NextResponse.json(await readAvailabilityReport(monthlyPeriods(to, count).map(period => period.from.slice(0, 7)), filter, analysis === "daily"), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Не вдалося завантажити аналіз наявності" }, { status: 502 });
  }
}
