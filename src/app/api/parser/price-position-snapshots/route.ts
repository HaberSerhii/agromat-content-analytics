import { NextResponse } from "next/server";
import { readCurrentPricePositionGroups } from "@/lib/promotion-price-position";
import {
  getPricePositionSnapshotStorageStats,
  readPricePositionDailySnapshot,
  writePricePositionDailySnapshot,
} from "@/lib/price-position-daily-snapshots";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (!date) return NextResponse.json({ storage: getPricePositionSnapshotStorageStats() });
  const snapshot = readPricePositionDailySnapshot(date);
  return snapshot
    ? NextResponse.json({ snapshot })
    : NextResponse.json({ error: "Snapshot not found", date }, { status: 404 });
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const groups = await readCurrentPricePositionGroups();
    const snapshot = writePricePositionDailySnapshot(groups);
    return NextResponse.json({
      ok: true,
      date: snapshot.snapshotDate,
      betterCount: snapshot.betterCodes.length,
      worseCount: snapshot.worseCodes.length,
      storage: getPricePositionSnapshotStorageStats(),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "snapshot_failed" }, { status: 500 });
  }
}
