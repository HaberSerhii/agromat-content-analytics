import { NextResponse } from "next/server";
import { readSalesWebMetrics } from "@/lib/sales-web-metrics";

export const dynamic = "force-dynamic";

function currentKyivDate() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const today = currentKyivDate();
    const from = url.searchParams.get("from") || `${today.slice(0, 4)}-01-01`;
    const to = url.searchParams.get("to") || today;
    const dataset = await readSalesWebMetrics({ from, to });
    return NextResponse.json(dataset, {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не вдалося завантажити вебаналітику";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
