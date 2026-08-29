import { NextResponse } from "next/server";
import { runSync, isSyncRunning } from "@/lib/products-sync";
import { hasServerBearer, isDashboardRequest } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — full sync over 157 pages takes ~3-4 min

/**
 * Triggers a full sync from Agromat API → Redis snapshot.
 * Protected by CRON_SECRET (Vercel cron sends it automatically as Bearer).
 *
 * Manual trigger:
 *   curl -X POST https://your-domain.com/api/products/sync \
 *     -H "Authorization: Bearer <CRON_SECRET>"
 */
async function handle(request: Request) {
  // Cron authenticates with its server-only token. Interactive dashboard
  // requests are marked by nginx after successful Basic Auth.
  if (!hasServerBearer(request, "CRON_SECRET") && !isDashboardRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (await isSyncRunning()) {
    return NextResponse.json({ ok: false, message: "Sync already running" }, { status: 409 });
  }

  const result = await runSync();
  return NextResponse.json({ ok: result.state === "ok", result });
}

export const GET = handle;
export const POST = handle;
