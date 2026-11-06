import { NextResponse } from "next/server";
import { validateGa4Dates } from "@/lib/ga4-marketing-report";
import { readBaseOrders } from "@/lib/webshop-orders-api";
import { readAllLite } from "@/lib/products-store";
import { readSalesProductDimensionLookup } from "@/lib/sales-s3";
import { normalizeSalesChannel } from "@/lib/sales-order-origin";
import { receivedSales } from "@/lib/received-sales";
import { getServerResult } from "@/lib/server-result-cache";
import { SALES_AUTO_REFRESH_MS } from "@/lib/sales-refresh";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const from = params.get("from") || "", to = params.get("to") || "";
  try { validateGa4Dates(from, to); } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const channel = normalizeSalesChannel(params.get("channel"));
  const segment = params.get("segment") || "";
  const categories = params.getAll("sales_category");
  try {
    const started = performance.now();
    const { value, status } = await getServerResult({ namespace: "received-sales-v3", key: JSON.stringify({ from, to, channel, segment, categories }), ttlMs: SALES_AUTO_REFRESH_MS, maxEntries: 16, load: async () => {
      const [orders, products, dimensions] = await Promise.all([readBaseOrders(from, to).then(result => result.value), readAllLite(), readSalesProductDimensionLookup()]);
      return receivedSales(orders, products, dimensions, channel, { from, to, segment, categories });
    } });
    return NextResponse.json(value, { headers: { "Cache-Control": "private, no-store", "X-Agromat-Cache": status, "Server-Timing": `received;dur=${(performance.now() - started).toFixed(1)}` } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Не вдалося завантажити замовлення" }, { status: 500 }); }
}
