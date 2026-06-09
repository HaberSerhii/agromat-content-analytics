import { NextResponse } from "next/server";
import { listSnapshotDates } from "@/lib/products-store";
import { getDailySnapshotStorageStats } from "@/lib/products-daily-snapshots";

export const dynamic = "force-dynamic";

// Returns the list of available daily snapshots (newest first).
// Used by the dashboard's date picker — "view catalog state as of …".
export async function GET() {
  const dates = await listSnapshotDates();
  const storage = getDailySnapshotStorageStats();
  return NextResponse.json({ dates, storage }, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" },
  });
}
