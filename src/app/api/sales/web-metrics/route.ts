import { NextResponse } from "next/server";
import { buildDemoSalesWebMetrics, readSalesWebMetrics } from "@/lib/sales-web-metrics";

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
  const url = new URL(req.url);
  const today = currentKyivDate();
  const from = url.searchParams.get("from") || `${today.slice(0, 4)}-01-01`;
  const to = url.searchParams.get("to") || today;
  try {
    const dataset = await readSalesWebMetrics({ from, to });
    return NextResponse.json(dataset, {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      console.error("[sales-web-metrics] live source unavailable", error);
      return NextResponse.json({ error: "Не вдалося завантажити production-вебаналітику. Спробуйте пізніше." }, { status: 503 });
    }
    console.warn("[sales-web-metrics] live source unavailable; serving demo data", error);
    try {
      return NextResponse.json(buildDemoSalesWebMetrics({ from, to }), {
        headers: {
          "Cache-Control": "no-store",
          "X-Agromat-Data-Mode": "demo",
        },
      });
    } catch (rangeError) {
      const message = rangeError instanceof Error ? rangeError.message : "Некоректний період";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }
}
