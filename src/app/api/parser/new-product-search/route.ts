import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface SearchBody {
  product_id?: number;
  state?: "failed" | "completed";
  error?: string | null;
}

function validProductId(value: unknown): number | null {
  const productId = Number(value);
  return Number.isSafeInteger(productId) && productId > 0 ? productId : null;
}

export async function POST(request: Request) {
  if (!isDashboardRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as SearchBody;
  const productId = validProductId(body.product_id);
  if (!productId) {
    return NextResponse.json({ ok: false, error: "invalid_product_id" }, { status: 400 });
  }

  const password = process.env.PARCER_RUN_PASSWORD;
  if (!password) {
    return NextResponse.json({ ok: false, error: "parser_password_not_configured" }, { status: 503 });
  }

  const db = getSupabase();
  const { data: queueItem, error: queueError } = await db
    .from("new_product_search_queue")
    .select("product_id, completed_at")
    .eq("product_id", productId)
    .maybeSingle();
  if (queueError) return NextResponse.json({ ok: false, error: queueError.message }, { status: 500 });
  if (!queueItem || queueItem.completed_at) {
    return NextResponse.json({ ok: false, error: "product_not_in_open_queue" }, { status: 409 });
  }

  const base = process.env.PARCER_INTERNAL_URL || "http://127.0.0.1:8080";
  try {
    const response = await fetch(`${base}/api/run/product-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, product_id: productId }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json().catch(() => ({ ok: false, error: "bad_upstream_response" })) as {
      ok?: boolean;
      job_id?: string;
      error?: string;
      active_job_id?: string;
    };
    if (!response.ok || !result.ok || !result.job_id) {
      return NextResponse.json(result, { status: response.status });
    }
    const { error } = await db.from("new_product_search_queue").update({
      status: "searching",
      started_at: new Date().toISOString(),
      search_job_id: result.job_id,
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("product_id", productId).is("completed_at", null);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ...result, action: "product-search", product_id: productId, status: "starting" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ ok: false, error: `proxy:${message.slice(0, 120)}` }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  if (!isDashboardRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as SearchBody;
  const productId = validProductId(body.product_id);
  if (!productId || !body.state || !["failed", "completed"].includes(body.state)) {
    return NextResponse.json({ ok: false, error: "invalid_product_id_or_state" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const patch = body.state === "completed"
    ? { status: "completed", completed_at: now, last_error: null, updated_at: now }
    : { status: "failed", completed_at: null, last_error: String(body.error || "search_failed").slice(0, 400), updated_at: now };
  const { error } = await getSupabase()
    .from("new_product_search_queue")
    .update(patch)
    .eq("product_id", productId)
    .is("completed_at", null);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, product_id: productId, state: body.state });
}
