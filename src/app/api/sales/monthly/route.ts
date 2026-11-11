import { NextResponse } from "next/server";
import { monthlyPeriods, priorYearDate } from "@/lib/sales-monthly";
import { readSalesMonthlyBuckets, readSalesProductDimensionLookup } from "@/lib/sales-s3";
import { readBaseOrders } from "@/lib/webshop-orders-api";
import { readAllLite, readLiteSyncedAt } from "@/lib/products-store";
import { receivedSales } from "@/lib/received-sales";
import { readDashboardReport } from "@/lib/dashboard-report-cache";
import { normalizeSalesChannel } from "@/lib/sales-order-origin";
import { validateGa4Dates } from "@/lib/ga4-marketing-report";
export const dynamic = "force-dynamic";
const kyivDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" });
export async function GET(request: Request) {
  const start = performance.now(), params = new URL(request.url).searchParams;
  const to = params.get("to") || "", count = Number(params.get("count"));
  try { validateGa4Dates(to, to); } catch { return NextResponse.json({ error: "Некоректна дата" }, { status: 400 }); }
  if (![1,2,3,4,5,6,7,8,9,10,11,12].includes(count)) return NextResponse.json({ error: "Некоректний період" }, { status: 400 });
  const periods = monthlyPeriods(to, count), compare = params.get("compare") === "1";
  const prior = compare ? periods.map(p => ({ from: priorYearDate(p.from), to: priorYearDate(p.to) })) : [];
  const channel = normalizeSalesChannel(params.get("channel")), segment = params.get("segment") || "Усі";
  const dimension = params.get("dimension") === "categories" ? "categories" : "brands";
  const search = (params.get("search") || "").trim();
  const all = [...periods, ...prior];
  try {
    const result = params.get("measure") !== "received"
      ? await readSalesMonthlyBuckets(all, { channel, search, businessSegment: segment, statuses: params.getAll("status") }, dimension)
      : await readDashboardReport("received-monthly-v2", JSON.stringify({ to, count, compare, channel, segment, search, syncedAt: await readLiteSyncedAt() }), 15 * 60_000, async () => {
        const [products, dimensions] = await Promise.all([readAllLite(), readSalesProductDimensionLookup()]);
        const result = [];
        // Two contiguous source reads, not one upstream pagination job per month.
        for (const range of [periods, prior]) {
          if (!range.length) continue;
          const { value: orders } = await readBaseOrders(range[0].from, range.at(-1)!.to);
          const byMonth = new Map<string, typeof orders>();
          for (const order of orders) {
            const month = kyivDay.format(new Date(order.date)).slice(0, 7);
            const list = byMonth.get(month) || []; list.push(order); byMonth.set(month, list);
          }
          for (const period of range) {
            const monthOrders = (byMonth.get(period.from.slice(0,7)) || []).filter(order => kyivDay.format(new Date(order.date)) <= period.to);
            const summary = receivedSales(monthOrders, products, dimensions, channel, { segment, search, details: false });
            result.push({ ...period, brands: summary.brands.items, categories: summary.categories.items });
          }
        }
        return result;
      }).then(result => ({ ...result, value: result.value.map(period => ({ from: period.from, to: period.to, items: period[dimension] })) }));
    const months = periods.map((p, i) => ({ ...p, current: result.value[i].items, previous: compare ? result.value[i + periods.length].items : [] }));
    return NextResponse.json(months, { headers: { "Cache-Control": "private, no-store", "X-Agromat-Cache": result.status, "Server-Timing": `monthly;dur=${(performance.now()-start).toFixed(1)}` } });
  } catch { return NextResponse.json({ error: "Не вдалося завантажити помісячні продажі" }, { status: 502 }); }
}
