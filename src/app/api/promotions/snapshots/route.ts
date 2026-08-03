import { NextResponse } from "next/server";
import {
  getPromotionsSnapshotStorageStats,
  listPromotionsSnapshotDates,
} from "@/lib/promotions-daily-snapshots";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    dates: listPromotionsSnapshotDates(),
    storage: getPromotionsSnapshotStorageStats(),
  }, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" },
  });
}
