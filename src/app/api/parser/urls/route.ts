import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const URL_ACTIONS = ["competitor_url_add", "competitor_url_edit", "competitor_url_delete"] as const;

interface UrlMutationBody {
  product_id?: number;
  competitor_id?: number;
  url?: string | null;
  snapshot_date?: string | null;
}

function requestIp(request: Request): string {
  return (request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "невідомо")
    .split(",")[0]
    .trim();
}

function deviceName(userAgent: string): string {
  const os = /iphone|ipad/i.test(userAgent)
    ? "iOS"
    : /android/i.test(userAgent)
      ? "Android"
      : /macintosh|mac os/i.test(userAgent)
        ? "macOS"
        : /windows/i.test(userAgent)
          ? "Windows"
          : /linux/i.test(userAgent)
            ? "Linux"
            : "Невідомий пристрій";
  const browser = /edg\//i.test(userAgent)
    ? "Edge"
    : /chrome\//i.test(userAgent)
      ? "Chrome"
      : /safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)
        ? "Safari"
        : /firefox\//i.test(userAgent)
          ? "Firefox"
          : "Браузер";
  return `${os} · ${browser}`;
}

function validHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function mutationContext(productId: number, competitorId: number) {
  const db = getSupabase();
  const [{ data: product, error: productError }, { data: competitor, error: competitorError }, { data: override, error: overrideError }] = await Promise.all([
    db.from("products").select("id, name, url").eq("id", productId).maybeSingle(),
    db.from("competitors").select("id, name").eq("id", competitorId).maybeSingle(),
    db.from("url_overrides").select("id, url").eq("product_id", productId).eq("competitor_id", competitorId).maybeSingle(),
  ]);
  const error = productError || competitorError || overrideError;
  if (error) throw new Error(error.message);
  if (!product || !competitor) throw new Error("product_or_competitor_not_found");
  return { db, product, competitor, override };
}

async function writeAudit(request: Request, input: {
  action: typeof URL_ACTIONS[number];
  productId: number;
  competitorId: number;
  snapshotDate: string;
  oldUrl: string | null;
  newUrl: string | null;
  productName: string;
  productUrl: string | null;
  competitorName: string;
}) {
  const userAgent = request.headers.get("user-agent") || "";
  const { error } = await getSupabase().from("audit_log").insert({
    action: input.action,
    product_id: input.productId,
    competitor_id: input.competitorId,
    snapshot_date: input.snapshotDate,
    old_url: input.oldUrl,
    new_url: input.newUrl,
    ip: requestIp(request),
    meta: {
      device: deviceName(userAgent),
      user_agent: userAgent,
      product_name: input.productName,
      product_url: input.productUrl,
      competitor_name: input.competitorName,
      competitor_url: input.newUrl || input.oldUrl,
    },
  });
  if (error) throw new Error(`audit_log: ${error.message}`);
}

export async function GET(request: Request) {
  if (!isDashboardRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await getSupabase()
    .from("audit_log")
    .select("id, action, product_id, competitor_id, old_url, new_url, ip, created_at, meta")
    .in("action", [...URL_ACTIONS])
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    logs: (data || []).map((row) => {
      const meta = (row.meta || {}) as Record<string, unknown>;
      return {
        id: row.id,
        at: row.created_at,
        action: row.action,
        productId: row.product_id,
        competitorId: row.competitor_id,
        device: String(meta.device || "Невідомий пристрій"),
        ip: row.ip || "невідомо",
        competitor: String(meta.competitor_name || `#${row.competitor_id}`),
        product: String(meta.product_name || `#${row.product_id}`),
        productUrl: typeof meta.product_url === "string" ? meta.product_url : null,
        competitorUrl: typeof meta.competitor_url === "string" ? meta.competitor_url : row.new_url || row.old_url || null,
      };
    }),
  });
}

export async function PUT(request: Request) {
  if (!isDashboardRequest(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as UrlMutationBody;
  const productId = Number(body.product_id);
  const competitorId = Number(body.competitor_id);
  const url = validHttpUrl(String(body.url || ""));
  if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(competitorId) || competitorId <= 0 || !url) {
    return NextResponse.json({ ok: false, error: "invalid_product_competitor_or_url" }, { status: 400 });
  }
  try {
    const { db, product, competitor, override } = await mutationContext(productId, competitorId);
    if (override?.id) {
      const { error } = await db.from("url_overrides").update({ url }).eq("id", override.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("url_overrides").insert({ product_id: productId, competitor_id: competitorId, url });
      if (error) throw new Error(error.message);
    }
    const action = override?.url ? "competitor_url_edit" : "competitor_url_add";
    await writeAudit(request, {
      action,
      productId,
      competitorId,
      snapshotDate: body.snapshot_date || new Date().toISOString().slice(0, 10),
      oldUrl: override?.url || null,
      newUrl: url,
      productName: product.name,
      productUrl: product.url,
      competitorName: competitor.name,
    });
    return NextResponse.json({ ok: true, action, url });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "url_save_failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isDashboardRequest(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as UrlMutationBody;
  const productId = Number(body.product_id);
  const competitorId = Number(body.competitor_id);
  if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(competitorId) || competitorId <= 0) {
    return NextResponse.json({ ok: false, error: "invalid_product_or_competitor" }, { status: 400 });
  }
  try {
    const snapshotDate = body.snapshot_date || new Date().toISOString().slice(0, 10);
    const { db, product, competitor, override } = await mutationContext(productId, competitorId);
    let oldUrl = override?.url || (typeof body.url === "string" ? body.url : null);
    if (!oldUrl) {
      const { data: latest } = await db.from("price_snapshots")
        .select("found_url")
        .eq("product_id", productId)
        .eq("competitor_id", competitorId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      oldUrl = latest?.found_url || null;
    }
    const { error: deleteError } = await db.from("url_overrides")
      .delete()
      .eq("product_id", productId)
      .eq("competitor_id", competitorId);
    if (deleteError) throw new Error(deleteError.message);
    const { error: snapshotError } = await db.from("price_snapshots").insert({
      product_id: productId,
      competitor_id: competitorId,
      price: null,
      status: "Видалено вручну",
      found_url: null,
      snapshot_date: snapshotDate,
      confidence: "none",
      found_brand: null,
      url_approved: false,
    });
    if (snapshotError) throw new Error(snapshotError.message);
    await writeAudit(request, {
      action: "competitor_url_delete",
      productId,
      competitorId,
      snapshotDate,
      oldUrl,
      newUrl: null,
      productName: product.name,
      productUrl: product.url,
      competitorName: competitor.name,
    });
    return NextResponse.json({ ok: true, action: "competitor_url_delete", url: null, price: null });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "url_delete_failed" }, { status: 500 });
  }
}
