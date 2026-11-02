import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { validateGa4Dates } from "@/lib/ga4-marketing-report";
import { readReviewPeriodSales } from "@/lib/sales-s3";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!isDashboardRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const productCodes = (params.get("sales_codes") || "").split(",").map(Number);
  try {
    validateGa4Dates(from, to);
    if (!productCodes.length || productCodes.some(code => !Number.isSafeInteger(code) || code <= 0)) throw new Error("Некоректні коди товарів");
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  try {
    return NextResponse.json(await readReviewPeriodSales({ from, to, productCodes }), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Не вдалося завантажити продажі з облікової системи" }, { status: 502 });
  }
}
