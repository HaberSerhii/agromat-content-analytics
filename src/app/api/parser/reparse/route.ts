import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// Reparse can hit Cloudflare-protected sites; allow up to 30s before timeout.
export const maxDuration = 30;

// Forwards a "refresh this product's price on this competitor" request to the
// legacy Flask parser (Agromat_Parcer), which owns the curl_cffi scrapers.
// Same JSON contract as Flask's POST /api/reparse — see app.py line ~575.
export async function POST(request: Request) {
  const base = process.env.PARCER_INTERNAL_URL || "http://127.0.0.1:8080";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const resp = await fetch(`${base}/api/reparse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Flask + curl_cffi can take 10–20s per Cloudflare site.
      signal: AbortSignal.timeout(28_000),
    });
    const json = await resp.json().catch(() => ({ ok: false, error: "bad_upstream_response" }));
    return NextResponse.json(json, { status: resp.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ ok: false, error: `proxy:${msg.slice(0, 120)}` }, { status: 502 });
  }
}
