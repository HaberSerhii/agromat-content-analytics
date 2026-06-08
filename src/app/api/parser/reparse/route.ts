import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
// Reparse can hit Cloudflare-protected sites; allow up to 30s before timeout.
export const maxDuration = 30;

interface ReparseBody {
  product_id?: number;
  competitor_id?: number;
  snapshot_date?: string | null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(s: string): string {
  return decodeHtml(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizePrice(value: unknown): number | null {
  if (value == null) return null;
  const raw = stripTags(String(value)).match(/\d[\d\s.,]{0,14}/)?.[0] || "";
  const n = Number.parseFloat(raw.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeStatus(value: unknown): string {
  const s = String(value || "").toLowerCase();
  if (/outofstock|немає|нет\s+в\s+наличии|відсут|закінчив/.test(s)) return "Немає в наявності";
  if (/preorder|очіку|ожида|під\s*замов|под\s*заказ/.test(s)) return "Під замовлення";
  if (/instock|наяв|налич|купити|купить|в\s+корзин/.test(s)) return "Є в наявності";
  return "unknown";
}

function parseJsonLd(html: string): { price: number; status: string; foundBrand: string | null } | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(decodeHtml(m[1]).trim());
      const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length) {
        const item = stack.shift();
        if (!item || typeof item !== "object") continue;
        const node = item as Record<string, unknown>;
        if (Array.isArray(node["@graph"])) stack.push(...node["@graph"]);
        if (Array.isArray(node.offers)) stack.push(...node.offers);
        const offer = node.offers && !Array.isArray(node.offers) ? node.offers as Record<string, unknown> : node;
        const price = normalizePrice(offer.price ?? offer.lowPrice ?? offer.highPrice);
        if (!price) continue;
        const brand = node.brand as { name?: string } | string | undefined;
        return {
          price,
          status: normalizeStatus(offer.availability ?? node.availability),
          foundBrand: typeof brand === "string" ? brand : brand?.name ?? null,
        };
      }
    } catch {
      // ignore malformed chunks
    }
  }
  return null;
}

function parseSimplePrice(adapter: string, html: string): { price: number; status: string; foundBrand: string | null } | null {
  if (adapter === "plitka") {
    const jsonLd = parseJsonLd(html);
    if (jsonLd) return jsonLd;
    const m = html.match(/class=["'][^"']*(?:now-price|one-prod-list-price)[^"']*["'][^>]*>([\s\S]{0,180}?)<\/[^>]+>/i);
    const price = normalizePrice(m?.[1]);
    return price ? { price, status: normalizeStatus(html), foundBrand: null } : null;
  }
  if (adapter === "leoceramika") {
    const jsonLd = parseJsonLd(html);
    const meta = html.match(/<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["'][^>]*>/i);
    const sitePrice = html.match(/id=["']site_price["'][^>]*>([\s\S]{0,80}?)<\/span>/i);
    const price = normalizePrice(meta?.[1]) || normalizePrice(sitePrice?.[1]) || jsonLd?.price || null;
    return price ? { price, status: jsonLd?.status || normalizeStatus(html), foundBrand: jsonLd?.foundBrand || null } : null;
  }
  return null;
}

function canonicalSimpleAdapter(adapter: string | undefined): "plitka" | "leoceramika" | null {
  if (adapter === "plitka" || adapter === "plitka.ua") return "plitka";
  if (adapter === "leoceramika" || adapter === "leo-ceramika" || adapter === "leoceramika.com") return "leoceramika";
  return null;
}

async function reparseSimple(body: ReparseBody, adapter: string) {
  if (!body.product_id || !body.competitor_id) {
    return NextResponse.json({ ok: false, error: "missing_product_or_competitor" }, { status: 400 });
  }

  const db = getSupabase();
  const { data: override, error: urlErr } = await db
    .from("url_overrides")
    .select("url")
    .eq("product_id", body.product_id)
    .eq("competitor_id", body.competitor_id)
    .maybeSingle();
  if (urlErr) return NextResponse.json({ ok: false, error: urlErr.message }, { status: 500 });
  if (!override?.url) return NextResponse.json({ ok: false, error: "url_not_found" }, { status: 404 });

  const resp = await fetch(override.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(25_000),
  });
  const html = await resp.text();
  const parsed = resp.ok ? parseSimplePrice(adapter, html) : null;
  const snapshotDate = body.snapshot_date || new Date().toISOString().slice(0, 10);

  const row = {
    product_id: body.product_id,
    competitor_id: body.competitor_id,
    price: parsed?.price ?? null,
    status: parsed?.status ?? (resp.ok ? "parse_error" : `http_${resp.status}`),
    found_url: resp.url || override.url,
    snapshot_date: snapshotDate,
    confidence: parsed?.price ? "exact" : "none",
    found_brand: parsed?.foundBrand ?? null,
    url_approved: false,
  };

  const { error } = await db.from("price_snapshots").insert(row);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    price: row.price,
    status: row.status,
    found_url: row.found_url,
  });
}

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

  const reparseBody = body as ReparseBody;
  if (reparseBody.competitor_id) {
    const db = getSupabase();
    const { data: competitor } = await db
      .from("competitors")
      .select("adapter_name")
      .eq("id", reparseBody.competitor_id)
      .maybeSingle();
    const adapter = canonicalSimpleAdapter(competitor?.adapter_name as string | undefined);
    if (adapter) {
      try {
        return await reparseSimple(reparseBody, adapter);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        return NextResponse.json({ ok: false, error: `simple:${msg.slice(0, 120)}` }, { status: 502 });
      }
    }
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
