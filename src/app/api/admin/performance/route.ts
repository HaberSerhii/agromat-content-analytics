import { NextResponse } from "next/server";
import { isDashboardRequest, hasServerBearer } from "@/lib/dashboard-auth";
import { dashboardPerformance } from "@/lib/dashboard-performance";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  if (!isDashboardRequest(request) && !hasServerBearer(request, "CRON_SECRET")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(dashboardPerformance(), { headers: { "Cache-Control": "private, no-store" } });
}
