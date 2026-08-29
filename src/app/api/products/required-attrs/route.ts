import { NextResponse } from "next/server";
import { readRequiredAttrs, writeRequiredAttrs } from "@/lib/products-store";
import { isDashboardRequest } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await readRequiredAttrs();
  return NextResponse.json(cfg, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" },
  });
}

export async function POST(req: Request) {
  if (!isDashboardRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
