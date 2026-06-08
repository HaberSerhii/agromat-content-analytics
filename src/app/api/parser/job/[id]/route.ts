import { NextResponse } from "next/server";
import { isSantechsharaJobId, readSantechsharaJob } from "@/lib/parser-jobs/santechshara";
import { isSimplePriceJobId, readSimplePriceJob } from "@/lib/parser-jobs/simple-price";

export const dynamic = "force-dynamic";

// Polls a Flask parser job by id. Forwards 1:1 to /api/job/<id>; the only
// thing this proxy adds is keeping the Flask hostname off the public iframe-
// less dashboard so we can later move the parser without touching the UI.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(id)) {
    return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  }

  if (isSantechsharaJobId(id)) {
    const job = await readSantechsharaJob(id);
    if (!job) return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
    return NextResponse.json(job);
  }

  if (isSimplePriceJobId(id)) {
    const job = await readSimplePriceJob(id);
    if (!job) return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
    return NextResponse.json(job);
  }

  const base = process.env.PARCER_INTERNAL_URL || "http://127.0.0.1:8080";
  try {
    const resp = await fetch(`${base}/api/job/${id}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const json = await resp.json().catch(() => ({ ok: false, error: "bad_upstream_response" }));
    return NextResponse.json(json, { status: resp.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ ok: false, error: `proxy:${msg.slice(0, 120)}` }, { status: 502 });
  }
}
