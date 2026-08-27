#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  isOutOfStockStatus,
  matchConfidence,
  priceForSnapshot,
  snapshotQualityIssue,
} from "./lib/competitor-price-quality.mjs";
import {
  PRICE_UNAVAILABLE_STATUS,
  parseLeoceramika,
  parsePlitka,
} from "./lib/simple-product-parser.mjs";

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
const dryRun = argv.has("dry-run");
const skipIfPublishedToday = argv.has("skip-if-published-today");
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

async function withDatabaseRetry(label, operation, retries = 4) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!/statement timeout|57014/i.test(message) || attempt === retries - 1) throw error;
      const delayMs = Math.min(2 ** attempt * 1000, 8000);
      console.warn(`${label}: Supabase timeout, retry ${attempt + 2}/${retries} in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
  throw lastError;
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

async function fetchActiveProducts(db) {
  const activeProducts = new Map();
  let from = 0;
  for (let i = 0; i < 100; i++) {
    const { data, error } = await db
      .from("products")
      .select("id, brand")
      .eq("is_active", true)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`products: ${error.message}`);
    const rows = data || [];
    for (const r of rows) activeProducts.set(r.id, r);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return activeProducts;
}

async function fetchTargets(db, competitorId) {
  if (singleProductId && singleUrl) {
    return [{ product_id: singleProductId, url: singleUrl }];
  }

  const activeProducts = await fetchActiveProducts(db);
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
      const product = activeProducts.get(r.product_id);
      if (product) out.push({ product_id: r.product_id, url: r.url, brand: product.brand || null });
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return limit > 0 ? out.slice(0, limit) : out;
}

async function fetchLatestPublishedDate(db, competitorId, beforeDate = null) {
  let auditQuery = db
    .from("audit_log")
    .select("snapshot_date")
    .eq("action", "parser_run")
    .eq("competitor_id", competitorId)
    .not("snapshot_date", "is", null)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (beforeDate) auditQuery = auditQuery.lt("snapshot_date", beforeDate);
  const { data: auditRows, error: auditError } = await auditQuery;
  if (auditError) throw new Error(`latest audit_log: ${auditError.message}`);
  if (auditRows?.[0]?.snapshot_date) return auditRows[0].snapshot_date;

  // Compatibility fallback for snapshots created before publish markers were
  // introduced. This only asks PostgREST for one date instead of scanning the
  // competitor's complete price history.
  let snapshotQuery = db
    .from("price_snapshots")
    .select("snapshot_date")
    .eq("competitor_id", competitorId)
    .not("price", "is", null)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (beforeDate) snapshotQuery = snapshotQuery.lt("snapshot_date", beforeDate);
  const { data: snapshotRows, error: snapshotError } = await snapshotQuery;
  if (snapshotError) throw new Error(`latest snapshot date: ${snapshotError.message}`);
  return snapshotRows?.[0]?.snapshot_date || null;
}

async function fetchPublishedSnapshot(db, competitorId, beforeDate = null) {
  const out = new Map();
  const date = await fetchLatestPublishedDate(db, competitorId, beforeDate);
  if (!date) return out;

  let from = 0;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await db
      .from("price_snapshots")
      .select("product_id,price,status,found_url,confidence,found_brand,url_approved,snapshot_date")
      .eq("competitor_id", competitorId)
      .eq("snapshot_date", date)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`snapshot ${date}: ${error.message}`);
    const rows = data || [];
    for (const row of rows) if (!out.has(row.product_id)) out.set(row.product_id, row);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

async function insertRows(db, rows) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += INSERT_SIZE) {
    const { error } = await db.from("price_snapshots").insert(rows.slice(i, i + INSERT_SIZE));
    if (error) throw new Error(`price_snapshots insert: ${error.message}`);
  }
}

async function appendSnapshotRows(db, rows) {
  // Snapshot reads already prefer the newest created_at for each
  // product/competitor pair. Appending makes publication atomic from the
  // dashboard's perspective and avoids a table-wide DELETE timing out before
  // a new snapshot can be saved. A same-day retry may leave older duplicates,
  // but they are ignored by readers and are safer than deleting live data.
  await insertRows(db, rows);
}

async function hasPublishedSnapshot(db, competitorId) {
  const { data, error } = await db
    .from("audit_log")
    .select("job_id")
    .eq("action", "parser_run")
    .eq("competitor_id", competitorId)
    .eq("snapshot_date", snapshotDate)
    .limit(1);
  if (error) throw new Error(`published snapshot check: ${error.message}`);
  return Boolean(data?.length);
}

async function publishSnapshot(db, competitorId, result) {
  const { error } = await db.from("audit_log").insert({
    action: "parser_run",
    competitor_id: competitorId,
    snapshot_date: snapshotDate,
    job_id: randomUUID(),
    meta: {
      mode: "urls_only",
      category: null,
      competitor_filter: adapter,
      source: "simple-price-worker",
      worker_job_id: jobId,
      ...result,
    },
  });
  if (error) throw new Error(`publish marker: ${error.message}`);
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

  if (skipIfPublishedToday && await hasPublishedSnapshot(db, competitor.id)) {
    const result = { total: 0, found: 0, new_finds: 0, price_changes: 0, errors: 0, blocked: 0, skipped: true };
    await writeJob({
      status: "done",
      current: 0,
      total: 0,
      label: `${LABEL}: знімок ${snapshotDate} вже опубліковано`,
      finished_at: Math.floor(Date.now() / 1000),
      result,
    });
    return;
  }

  await writeJob({ label: `${LABEL}: читаю URL-и з БД` });
  // Fetch the large historical snapshot only once for the normal daily run.
  // Running two identical scans concurrently pushed Supabase over its statement
  // timeout and prevented both tile competitors from starting.
  const targets = await fetchTargets(db, competitor.id);
  const previousRows = await withDatabaseRetry(
    `${LABEL}: previous snapshot`,
    () => fetchPublishedSnapshot(db, competitor.id, snapshotDate),
  );
  const qualityBaselineRows = requestedSnapshotDate
    ? await withDatabaseRetry(
      `${LABEL}: quality baseline`,
      () => fetchPublishedSnapshot(db, competitor.id),
    )
    : previousRows;
  const previousSuccessful = new Map(
    [...previousRows].filter(([, row]) => row.price != null),
  );
  await writeJob({
    status: "running",
    total: targets.length,
    current: 0,
    label: `${LABEL}: 0/${targets.length}`,
    result: { total: targets.length, found: 0, errors: 0, blocked: 0 },
  });

  let found = 0;
  let errors = 0;
  let priceChanges = 0;
  let priceUnavailable = 0;
  const rows = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    await writeJob({
      current: i,
      label: `${LABEL}: ${i}/${targets.length} · товар ${target.product_id}`,
      result: { total: targets.length, found, price_changes: priceChanges, errors, blocked: 0 },
    });

    try {
      const fetched = await fetchHtml(target.url);
      const parsed = fetched.status >= 200 && fetched.status < 300 ? parseProduct(fetched.html) : null;
      const isAuthoritativeNoPrice = parsed?.status === PRICE_UNAVAILABLE_STATUS;
      if (parsed?.price || isOutOfStockStatus(parsed?.status) || isAuthoritativeNoPrice) {
        const confidence = matchConfidence(target.brand, parsed.foundBrand, "exact", fetched.url || target.url);
        const price = priceForSnapshot(parsed.price, parsed.status);
        if (isAuthoritativeNoPrice) priceUnavailable++;
        if (price != null && confidence === "exact") found++;
        const previousPrice = previousSuccessful.get(target.product_id)?.price;
        if (price != null && previousPrice != null && Number(previousPrice) !== price) priceChanges++;
        rows.push({
          product_id: target.product_id,
          competitor_id: competitor.id,
          price,
          status: parsed.status,
          found_url: fetched.url || target.url,
          snapshot_date: snapshotDate,
          confidence,
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

  await writeJob({ label: `${LABEL}: зберігаю знімок ${snapshotDate}` });
  const qualityIssue = snapshotQualityIssue([...qualityBaselineRows.values()], rows);
  const outOfStock = rows.filter((row) => isOutOfStockStatus(row.status)).length;
  const authoritativeRows = rows.filter((row) => (
    row.price != null || isOutOfStockStatus(row.status)
    || row.status === PRICE_UNAVAILABLE_STATUS || row.confidence === "rejected"
  ));
  const result = {
    total: targets.length,
    found,
    new_finds: 0,
    price_changes: priceChanges,
    errors,
    blocked: qualityIssue ? 1 : 0,
    out_of_stock: outOfStock,
    price_unavailable: priceUnavailable,
    preserved_previous: rows.length - authoritativeRows.length,
    quality: qualityIssue ? "blocked" : "passed",
  };
  if (qualityIssue) throw new Error(`quality_guard:${qualityIssue}`);
  if (!dryRun) {
    await appendSnapshotRows(db, authoritativeRows);
    if (!singleProductId && limit <= 0) await publishSnapshot(db, competitor.id, result);
  }
  await writeJob({
    status: "done",
    current: targets.length,
    total: targets.length,
    label: `${LABEL}: ${dryRun ? "dry-run готово" : "готово"} · знайдено ${found}/${targets.length}`,
    finished_at: Math.floor(Date.now() / 1000),
    result,
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
