import { NextResponse } from "next/server";
import { readSalesDataset } from "@/lib/sales-s3";

export const dynamic = "force-dynamic";

async function salesResponse(filter: {
  from?: string;
  to?: string;
  productCodes?: string | number[];
  statuses?: string | string[];
}) {
  try {
    const dataset = await readSalesDataset(filter);
    return NextResponse.json(dataset, {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load sales data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  return salesResponse({
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    productCodes: url.searchParams.get("product_codes") || undefined,
    statuses: url.searchParams.getAll("status"),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return salesResponse({
    from: typeof body?.from === "string" ? body.from : undefined,
    to: typeof body?.to === "string" ? body.to : undefined,
    productCodes: Array.isArray(body?.productCodes) || typeof body?.productCodes === "string" ? body.productCodes : undefined,
    statuses: Array.isArray(body?.statuses) || typeof body?.statuses === "string" ? body.statuses : undefined,
  });
}
