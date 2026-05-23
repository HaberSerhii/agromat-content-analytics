import { NextResponse } from "next/server";
import { listSnapshotDates } from "@/lib/products-store";

export const dynamic = "force-dynamic";

// Returns the list of available daily snapshots (newest first).
// Used by the dashboard's date picker — "view catalog state as of …".
export async function GET() {
  const dates = await listSnapshotDates();
  return NextResponse.json({ dates });
}
