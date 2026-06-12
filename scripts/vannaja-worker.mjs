#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JOB_DIR = path.join(ROOT, "data", "parser-jobs");
const ADAPTER = "vannaja";
const ACTION = "prices-vannaja";

const argv = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const next = process.argv[i + 1];
  argv.set(arg.slice(2), next && !next.startsWith("--") ? next : "true");
  if (next && !next.startsWith("--")) i++;
}

const jobId = argv.get("job-id") || `vannaja-${Date.now().toString(36)}`;
const limit = Number(process.env.VANNAJA_LIMIT || argv.get("limit") || "0");
const requestDelayMs = Number(process.env.VANNAJA_REQUEST_DELAY_MS || "500");
const requestTimeoutMs = Number(process.env.VANNAJA_REQUEST_TIMEOUT_MS || "30000");
const snapshotDate = argv.get("snapshot-date") || new Date().toISOString().slice(0, 10);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    label: "Vannaja: старт",
    started_at: Math.floor(Date.now() / 1000),
    finished_at: null,
    error: null,
    result: null,
  };
  try {
    current = JSON.parse(await fs.readFile(jobFile(), "utf8"));
  } catch {
    // First write.
  }
  const next = { ...current, ...patch };
  await fs.writeFile(jobFile(), `${JSON.stringify(next, null, 2)}\n`);
  await fs.writeFile(path.join(JOB_DIR, "vannaja-active.json"), `${JSON.stringify({ job_id: jobId }, null, 2)}\n`);
}

function parseNumber(raw) {
  if (!raw) return null;
  let value = String(raw).replace(/\u00a0/g, "").replace(/\s/g, "").replace(",", ".");
  if (value.split(".").length > 2) value = value.replace(/\./g, "");
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseProduct(html) {
  const pricePatterns = [
    /itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i,
    /content=["']([\d.,]+)["'][^>]*itemprop=["']price["']/i,
    /product:price:amount["'][^>]*content=["']([\d.,]+)["']/i,
  ];
  for (const pattern of pricePatterns) {
    const price = parseNumber(html.match(pattern)?.[1]);
    if (price != null) {
      const unavailable = /немає в наявності|нет в наличии|out-of-stock|outofstock/i.test(html);
      return { price, status: unavailable ? "Немає в наявності" : "Є в наявності" };
    }
  }
  return { price: null, status: "parse_error" };
}

async function fetchTargets(db, competitorId) {
  const activeIds = new Set();
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await db.from("products").select("id").eq("is_active", true).range(from, from + 999);
    if (error) throw new Error(`products: ${error.message}`);
    for (const row of data || []) activeIds.add(row.id);
    if ((data || []).length < 1000) break;
  }

  const targets = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await db
      .from("url_overrides")
      .select("product_id, url")
      .eq("competitor_id", competitorId)
      .order("product_id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`url_overrides: ${error.message}`);
    for (const row of data || []) {
      if (activeIds.has(row.product_id)) targets.push(row);
    }
    if ((data || []).length < 1000) break;
  }
  return limit > 0 ? targets.slice(0, limit) : targets;
}

async function fetchPreviousPrices(db, competitorId, productIds) {
  const wanted = new Set(productIds);
  const previous = new Map();
  for (let from = 0; from < 100000 && previous.size < wanted.size; from += 1000) {
    const { data, error } = await db
      .from("price_snapshots")
      .select("product_id, price")
      .eq("competitor_id", competitorId)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(`price_snapshots history: ${error.message}`);
    for (const row of data || []) {
      if (wanted.has(row.product_id) && !previous.has(row.product_id) && Number.isFinite(row.price)) {
        previous.set(row.product_id, Number(row.price));
      }
    }
    if ((data || []).length < 1000) break;
  }
  return previous;
}

async function insertRows(db, rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("price_snapshots").insert(rows.slice(i, i + 200));
    if (error) throw new Error(`price_snapshots insert: ${error.message}`);
  }
}

async function main() {
  const db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_KEY"), { auth: { persistSession: false } });
  const { data: competitor, error: competitorError } = await db
    .from("competitors")
    .select("id")
    .eq("adapter_name", ADAPTER)
    .single();
  if (competitorError || !competitor) throw new Error(`competitor not found: ${competitorError?.message || ADAPTER}`);

  const targets = await fetchTargets(db, competitor.id);
  const previousPrices = await fetchPreviousPrices(db, competitor.id, targets.map((target) => target.product_id));
  let found = 0;
  let newFinds = 0;
  let priceChanges = 0;
  let errors = 0;
  const rows = [];

  await writeJob({
    status: "running",
    total: targets.length,
    label: `Vannaja: 0/${targets.length}`,
    result: { total: targets.length, found, new_finds: newFinds, price_changes: priceChanges, errors, blocked: 0 },
  });

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    await writeJob({
      current: i,
      label: `Vannaja: ${i}/${targets.length} · товар ${target.product_id}`,
      result: { total: targets.length, found, new_finds: newFinds, price_changes: priceChanges, errors, blocked: 0 },
    });
    try {
      const response = await fetch(target.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
          "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const parsed = parseProduct(await response.text());
      if (parsed.price == null) {
        errors++;
      } else {
        found++;
        const previousPrice = previousPrices.get(target.product_id);
        if (previousPrice == null) newFinds++;
        else if (previousPrice !== parsed.price) priceChanges++;
      }
      rows.push({
        product_id: target.product_id,
        competitor_id: competitor.id,
        price: parsed.price,
        status: parsed.status,
        found_url: response.url || target.url,
        snapshot_date: snapshotDate,
        confidence: parsed.price == null ? "none" : "exact",
        found_brand: null,
        url_approved: false,
      });
    } catch (error) {
      errors++;
      rows.push({
        product_id: target.product_id,
        competitor_id: competitor.id,
        price: null,
        status: `error:${String(error?.message || error).slice(0, 80)}`,
        found_url: target.url,
        snapshot_date: snapshotDate,
        confidence: "none",
        found_brand: null,
        url_approved: false,
      });
    }
    if (rows.length >= 100) await insertRows(db, rows.splice(0, rows.length));
    if (requestDelayMs > 0 && i + 1 < targets.length) await sleep(requestDelayMs);
  }

  await insertRows(db, rows);
  await writeJob({
    status: "done",
    current: targets.length,
    total: targets.length,
    label: `Vannaja: готово · знайдено ${found}/${targets.length}`,
    finished_at: Math.floor(Date.now() / 1000),
    result: { total: targets.length, found, new_finds: newFinds, price_changes: priceChanges, errors, blocked: 0 },
  });
}

main().catch(async (error) => {
  await writeJob({
    status: "error",
    finished_at: Math.floor(Date.now() / 1000),
    label: "Vannaja: помилка",
    error: String(error?.message || error),
  }).catch(() => {});
  process.exitCode = 1;
});
