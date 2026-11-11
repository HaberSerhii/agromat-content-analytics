import { NextResponse } from "next/server";
import { validateGa4Dates } from "@/lib/ga4-marketing-report";
import { normalizeSalesChannel } from "@/lib/sales-order-origin";
import { readSalesDataset, type SalesProductSummary } from "@/lib/sales-s3";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || "", to = params.get("to") || "";
  try { validateGa4Dates(from, to); }
  catch { return NextResponse.json({ error: "Некоректна дата" }, { status: 400 }); }
  const search = (params.get("search") || "").trim();
  if (!search) return NextResponse.json({ error: "Введіть пошуковий запит" }, { status: 400 });
  try {
    const data = await readSalesDataset({ from, to, search, channel: normalizeSalesChannel(params.get("channel")), statuses: params.getAll("status") });
    const products: Record<string, SalesProductSummary[]> = {};
    for (const product of Object.values(data.summary.categoryProducts).flat()) {
      const label = product.brand || "Без бренда";
      (products[label] ||= []).push(product);
    }
    return NextResponse.json({
      brands: { items: data.summary.brands, products },
      categories: { items: data.summary.categories, products: data.summary.categoryProducts },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Не вдалося знайти продажі" }, { status: 502 });
  }
}
