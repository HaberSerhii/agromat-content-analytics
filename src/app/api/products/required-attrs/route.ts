import { NextResponse } from "next/server";
import { readRequiredAttrs, writeRequiredAttrs } from "@/lib/products-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await readRequiredAttrs();
  return NextResponse.json(cfg);
}

export async function POST(req: Request) {
  // Dashboard-only mutation — gate behind NEXT_PUBLIC_DASHBOARD_SECRET
  const dashboardSecret = process.env.NEXT_PUBLIC_DASHBOARD_SECRET;
  if (dashboardSecret) {
    const incoming = req.headers.get("x-dashboard-secret");
    if (incoming !== dashboardSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be { [categoryId]: number[] }" }, { status: 400 });
  }
  const out: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const catId = parseInt(k, 10);
    if (!Number.isFinite(catId)) continue;
    if (!Array.isArray(v)) continue;
    const ids = v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    out[String(catId)] = ids;
  }
  await writeRequiredAttrs(out);
  return NextResponse.json({ ok: true, config: out });
}
