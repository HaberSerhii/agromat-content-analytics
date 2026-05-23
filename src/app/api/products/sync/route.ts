import { NextResponse } from "next/server";
import { runSync, isSyncRunning } from "@/lib/products-sync";

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
  const cronSecret = process.env.CRON_SECRET;
  const dashSecret = process.env.NEXT_PUBLIC_DASHBOARD_SECRET;
  if (!cronSecret && !dashSecret) {
    return NextResponse.json({ error: "No auth secret configured" }, { status: 500 });
  }
  // Accept either: Vercel cron sends CRON_SECRET; dashboard UI sends DASHBOARD_SECRET
  const auth = request.headers.get("authorization") || "";
  const ok =
    (cronSecret && auth === `Bearer ${cronSecret}`) ||
    (dashSecret && auth === `Bearer ${dashSecret}`);
  if (!ok) {
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
