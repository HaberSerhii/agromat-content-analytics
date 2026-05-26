import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Whitelist of actions we expose. Flask accepts more, but only these are
// triggered from this dashboard's UI today. Adding others is cheap — extend
// the set and they become callable.
const ALLOWED_ACTIONS = new Set([
  "prices-vencon",
  "prices-teploradost",
  "prices-santechshara",
]);

// Forwards a "start background job" request to the legacy Flask parser
// (`/api/run/<action>`). Flask requires a password field in the body — we
// inject it from PARCER_RUN_PASSWORD so the dashboard's user doesn't need
// to know it. Returns Flask's response verbatim, including the `job_id`
// the client must use to poll status via /api/parser/job/<id>.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, error: "action_not_allowed" }, { status: 400 });
  }

  const base = process.env.PARCER_INTERNAL_URL || "http://127.0.0.1:8080";
  const password = process.env.PARCER_RUN_PASSWORD || "Agromat2026";

  try {
    const resp = await fetch(`${base}/api/run/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await resp.json().catch(() => ({ ok: false, error: "bad_upstream_response" }));
    return NextResponse.json(json, { status: resp.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ ok: false, error: `proxy:${msg.slice(0, 120)}` }, { status: 502 });
  }
}
