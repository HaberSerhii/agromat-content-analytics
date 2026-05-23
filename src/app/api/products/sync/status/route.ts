import { NextResponse } from "next/server";
import { readSyncState, readLiteSyncedAt } from "@/lib/products-store";

export const dynamic = "force-dynamic";

// Lightweight polling endpoint for the dashboard's progress bar.
// Read-only — returns the current syncState + the last successful sync timestamp.
export async function GET() {
  const [state, syncedAt] = await Promise.all([readSyncState(), readLiteSyncedAt()]);
  return NextResponse.json({ ...state, syncedAt });
}
