import { NextResponse } from "next/server";
import { readChanges, type ChangeEvent } from "@/lib/products-store";

export const dynamic = "force-dynamic";

// History "tabs" exposed in the UI. Keep keys stable — the client picks
// tabs by these names.
type Bucket = "price" | "status" | "stock" | "sku" | "attributes" | "images" | "reviews";

function bucketFor(e: ChangeEvent): Bucket {
  switch (e.field) {
    case "price":
    case "priceBase":
    case "discountPct":
      return "price";
    case "status":     return "status";
    case "stock":      return "stock";
    case "sku":        return "sku";
    case "attributes": return "attributes";
    case "images":     return "images";
    case "reviews":    return "reviews";
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const events = await readChanges(id);
  const groups: Record<Bucket, ChangeEvent[]> = {
    price: [], status: [], stock: [], sku: [], attributes: [], images: [], reviews: [],
  };
  for (const e of events) groups[bucketFor(e)].push(e);

  return NextResponse.json(
    { productId: id, total: events.length, groups },
    {
      // Sync writes change events on its hourly cron; cache the response for
      // 1h on the edge so dashboard re-opens of the same card are cheap.
      headers: { "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400" },
    },
  );
}
