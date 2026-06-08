#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JOB_DIR = path.join(ROOT, "data", "parser-jobs");
const PAGE_SIZE = 1000;
const INSERT_SIZE = 200;

const argv = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  argv.set(a.slice(2), next && !next.startsWith("--") ? next : "true");
  if (next && !next.startsWith("--")) i++;
}

const adapter = argv.get("adapter");
if (!["plitka", "leoceramika"].includes(adapter)) {
  throw new Error("--adapter must be plitka or leoceramika");
}

const ACTION = `prices-${adapter}`;
const LABEL = adapter === "plitka" ? "Plitka.ua" : "LeoCeramika";
const jobId = argv.get("job-id") || `${adapter}-${Date.now().toString(36)}`;
const singleProductId = argv.has("product-id") ? Number(argv.get("product-id")) : null;
const singleUrl = argv.get("url") || null;
const requestedSnapshotDate = argv.get("snapshot-date") || null;
const limit = Number(process.env.SIMPLE_PRICE_LIMIT || argv.get("limit") || "0");
const waitMs = Number(process.env.SIMPLE_PRICE_WAIT_MS || argv.get("wait-ms") || "200");
const timeoutMs = Number(process.env.SIMPLE_PRICE_TIMEOUT_MS || argv.get("timeout-ms") || "25000");
const today = new Date().toISOString().slice(0, 10);
const snapshotDate = requestedSnapshotDate || today;

const COMPETITOR_ALIASES = {
  plitka: ["plitka", "plitka.ua"],
  leoceramika: ["leoceramika", "leo-ceramika", "leoceramika.com"],
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

function jobFile() {
  return path.join(JOB_DIR, `${jobId}.json`);
}

async function writeJob(patch) {
  await fs.mkdir(JOB_DIR, { recursive: true });
  let current = {
    ok: true,
    job_id: jobId,
    action: ACTION,
    status: "starting",
    current: 0,
    total: 0,
    label: `${LABEL}: старт`,
    started_at: Math.floor(Date.now() / 1000),
    finished_at: null,
    error: null,
    result: null,
  };
  try {
    current = JSON.parse(await fs.readFile(jobFile(), "utf8"));
  } catch {
    // first write
  }
  const next = { ...current, ...patch };
  await fs.writeFile(jobFile(), `${JSON.stringify(next, null, 2)}\n`);
  await fs.writeFile(path.join(JOB_DIR, `${adapter}-active.json`), `${JSON.stringify({ job_id: jobId }, null, 2)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(s) {
  return decodeHtml(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizePrice(value) {
  if (value == null) return null;
  const text = stripTags(String(value));
  const raw = text.match(/\d[\d\s.,]{0,14}/)?.[0] || "";
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeStatus(value) {
  const s = String(value || "").toLowerCase();
  if (/outofstock|немає|нет\s+в\s+наличии|відсут|закінчив/.test(s)) return "Немає в наявності";
  if (/preorder|очіку|ожида|під\s*замов|под\s*заказ/.test(s)) return "Під замовлення";
  if (/instock|наяв|налич|купити|купить|в\s+корзин/.test(s)) return "Є в наявності";
  return "unknown";
}

function collectJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = decodeHtml(m[1]).trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      out.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // ignore malformed analytics/LD chunks
    }
  }
  return out;
}

function flattenLd(item) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x);
      return;
    }
    out.push(node);
    if (Array.isArray(node["@graph"])) visit(node["@graph"]);
    if (Array.isArray(node.offers)) visit(node.offers);
  };
  visit(item);
  return out;
}

function parseFromJsonLd(html) {
  for (const item of collectJsonLd(html)) {
    for (const node of flattenLd(item)) {
      const type = Array.isArray(node["@type"]) ? node["@type"].join(" ") : String(node["@type"] || "");
      const offer = node.offers && !Array.isArray(node.offers) ? node.offers : node;
      const price = normalizePrice(offer.price ?? offer.lowPrice ?? offer.highPrice);
      if (!price) continue;
      const availability = String(offer.availability || node.availability || "");
      const foundBrand = typeof node.brand === "object" ? node.brand?.name : node.brand;
      return {
        price,
        status: normalizeStatus(availability || type),
        foundBrand: foundBrand || null,
      };
    }
  }
  return null;
}

function parsePlitka(html) {
  const jsonLd = parseFromJsonLd(html);
  if (jsonLd) return jsonLd;

  const m = html.match(/class=["'][^"']*(?:now-price|one-prod-list-price)[^"']*["'][^>]*>([\s\S]{0,180}?)<\/[^>]+>/i);
  const price = normalizePrice(m?.[1]);
  return price ? { price, status: normalizeStatus(html), foundBrand: null } : null;
}

function parseLeoceramika(html) {
  const meta = html.match(/<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  const sitePrice = html.match(/id=["']site_price["'][^>]*>([\s\S]{0,80}?)<\/span>/i);
  const jsonLd = parseFromJsonLd(html);
  const price = normalizePrice(meta?.[1]) || normalizePrice(sitePrice?.[1]) || jsonLd?.price || null;
  return price ? { price, status: jsonLd?.status || normalizeStatus(html), foundBrand: jsonLd?.foundBrand || null } : null;
}

function parseProduct(html) {
  return adapter === "plitka" ? parsePlitka(html) : parseLeoceramika(html);
}

async function fetchHtml(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const html = await resp.text();
  return { status: resp.status, url: resp.url, html };
}

async function fetchActiveProductIds(db) {
  const activeIds = new Set();
  let from = 0;
  for (let i = 0; i < 100; i++) {
    const { data, error } = await db
      .from("products")
      .select("id")
      .eq("is_active", true)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`products: ${error.message}`);
    const rows = data || [];
    for (const r of rows) activeIds.add(r.id);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return activeIds;
}

async function fetchTargets(db, competitorId) {
  if (singleProductId && singleUrl) {
    return [{ product_id: singleProductId, url: singleUrl }];
  }

  const activeIds = await fetchActiveProductIds(db);
  const out = [];
  let from = 0;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await db
      .from("url_overrides")
      .select("product_id, url")
      .eq("competitor_id", competitorId)
      .range(from, from + PAGE_SIZE - 1)
      .order("product_id", { ascending: true });
    if (error) throw new Error(`url_overrides: ${error.message}`);
    const rows = data || [];
    for (const r of rows) {
      if (activeIds.has(r.product_id)) out.push({ product_id: r.product_id, url: r.url });
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return limit > 0 ? out.slice(0, limit) : out;
}

async function insertRows(db, rows) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += INSERT_SIZE) {
    const { error } = await db.from("price_snapshots").insert(rows.slice(i, i + INSERT_SIZE));
    if (error) throw new Error(`price_snapshots insert: ${error.message}`);
  }
}

class UnusedRealtimeTransport {}

async function main() {
  const db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_KEY"), {
    auth: { persistSession: false },
    realtime: { transport: UnusedRealtimeTransport },
  });

  await writeJob({ status: "starting", label: `${LABEL}: шукаю конкурента в БД` });
  const { data: competitors, error: compErr } = await db
    .from("competitors")
    .select("id, adapter_name")
    .in("adapter_name", COMPETITOR_ALIASES[adapter])
    .limit(1);
  const competitor = competitors?.[0];
  if (compErr || !competitor) throw new Error(`competitor not found: ${compErr?.message || adapter}`);

  await writeJob({ label: `${LABEL}: читаю URL-и з БД` });
  const targets = await fetchTargets(db, competitor.id);
  await writeJob({
    status: "running",
    total: targets.length,
    current: 0,
    label: `${LABEL}: 0/${targets.length}`,
    result: { total: targets.length, found: 0, errors: 0, blocked: 0 },
  });

  let found = 0;
  let errors = 0;
  const rows = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    await writeJob({
      current: i,
      label: `${LABEL}: ${i}/${targets.length} · товар ${target.product_id}`,
      result: { total: targets.length, found, errors, blocked: 0 },
    });

    try {
      const fetched = await fetchHtml(target.url);
      const parsed = fetched.status >= 200 && fetched.status < 300 ? parseProduct(fetched.html) : null;
      if (parsed?.price) {
        found++;
        rows.push({
          product_id: target.product_id,
          competitor_id: competitor.id,
          price: parsed.price,
          status: parsed.status,
          found_url: fetched.url || target.url,
          snapshot_date: snapshotDate,
          confidence: "exact",
          found_brand: parsed.foundBrand,
          url_approved: false,
        });
      } else {
        errors++;
        rows.push({
          product_id: target.product_id,
          competitor_id: competitor.id,
          price: null,
          status: fetched.status >= 200 && fetched.status < 300 ? "parse_error" : `http_${fetched.status}`,
          found_url: fetched.url || target.url,
          snapshot_date: snapshotDate,
          confidence: "none",
          found_brand: null,
          url_approved: false,
        });
      }

      if (rows.length >= INSERT_SIZE) {
        await insertRows(db, rows.splice(0, rows.length));
      }
      if (waitMs > 0) await sleep(waitMs);
    } catch (e) {
      errors++;
      rows.push({
        product_id: target.product_id,
        competitor_id: competitor.id,
        price: null,
        status: `error:${String(e?.message || e).slice(0, 80)}`,
        found_url: target.url,
        snapshot_date: snapshotDate,
        confidence: "none",
        found_brand: null,
        url_approved: false,
      });
    }
  }

  await insertRows(db, rows);
  await writeJob({
    status: "done",
    current: targets.length,
    total: targets.length,
    label: `${LABEL}: готово · знайдено ${found}/${targets.length}`,
    finished_at: Math.floor(Date.now() / 1000),
    result: { total: targets.length, found, new_finds: 0, price_changes: 0, errors, blocked: 0 },
  });
}

main().catch(async (e) => {
  await writeJob({
    status: "error",
    finished_at: Math.floor(Date.now() / 1000),
    error: String(e?.message || e),
    label: `${LABEL}: помилка`,
  }).catch(() => {});
  process.exitCode = 1;
});
