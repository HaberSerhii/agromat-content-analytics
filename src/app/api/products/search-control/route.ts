import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { buildSearchControlDataset } from "@/lib/search-control";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDashboardRequest(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await buildSearchControlDataset(), {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "search_control_failed" },
      { status: 500 },
    );
  }
}
