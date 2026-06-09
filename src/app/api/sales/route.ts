import { NextResponse } from "next/server";
import { readSalesDataset } from "@/lib/sales-s3";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || undefined;
    const to = url.searchParams.get("to") || undefined;
    const productCodes = url.searchParams.get("product_codes") || undefined;
    const statuses = url.searchParams.getAll("status");
    const dataset = await readSalesDataset({ from, to, productCodes, statuses });
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
