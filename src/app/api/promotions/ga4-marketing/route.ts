import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { Ga4ConnectionError, readGa4Marketing } from "@/lib/ga4-marketing";
import { validateGa4Dates } from "@/lib/ga4-marketing-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isDashboardRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  try { validateGa4Dates(from, to); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  try {
    return NextResponse.json(await readGa4Marketing(from, to), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Ga4ConnectionError ? error.message : "Не вдалося отримати дані GA4" }, { status: error instanceof Ga4ConnectionError ? error.status : 502 });
  }
}
