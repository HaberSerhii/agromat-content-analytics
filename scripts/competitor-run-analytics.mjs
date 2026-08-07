#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  brandsMatch,
  matchConfidence,
  priceForSnapshot,
} from "./lib/competitor-price-quality.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(ROOT, "data", "competitor-run-analytics");
const PAGE_SIZE = 1000;

const argv = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (!argument.startsWith("--")) continue;
  const next = process.argv[index + 1];
  argv.set(argument.slice(2), next && !next.startsWith("--") ? next : "true");
  if (next && !next.startsWith("--")) index += 1;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function safeTimestamp(value) {
  return value.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isOutOfStock(status) {
  const value = String(status || "");
  if (/ціна\s+(?:відсутня|не\s+вказана)|цена\s+(?:отсутствует|не\s+указана)/i.test(value)) return false;
  return /out\s*of\s*stock|outofstock|немає|нет\s+в\s+наличии|відсут|закінчив/i.test(value);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function fetchAll(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) break;
  }
  return rows;
}

async function latestSnapshotDate(db, competitorId, cutoff) {
  let query = db
    .from("price_snapshots")
    .select("snapshot_date, created_at")
    .eq("competitor_id", competitorId)
    .order("snapshot_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (cutoff) query = query.lt("created_at", cutoff);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data?.[0]?.snapshot_date || null;
}

async function snapshotRows(db, competitorId, snapshotDate, cutoff = null) {
  if (!snapshotDate) return [];
  const rows = await fetchAll(() => {
    let query = db
      .from("price_snapshots")
      .select("id, product_id, competitor_id, price, status, found_url, confidence, found_brand, url_approved, snapshot_date, created_at")
      .eq("competitor_id", competitorId)
      .eq("snapshot_date", snapshotDate)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (cutoff) query = query.lt("created_at", cutoff);
    return query;
  });
  const latest = new Map();
  for (const row of rows) latest.set(Number(row.product_id), row);
  return [...latest.values()];
}

async function rowsWrittenAfter(db, competitorId, cutoff) {
  const rows = await fetchAll(() => db
    .from("price_snapshots")
    .select("id, product_id, competitor_id, price, status, found_url, confidence, found_brand, url_approved, snapshot_date, created_at")
    .eq("competitor_id", competitorId)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true }));
  const latest = new Map();
  for (const row of rows) latest.set(Number(row.product_id), row);
  return [...latest.values()];
}

async function loadCatalog(db) {
  const [products, competitors] = await Promise.all([
    fetchAll(() => db
      .from("products")
      .select("id, code, goods_ref, sku, name, brand, category")
      .eq("is_active", true)
      .order("id", { ascending: true })),
    fetchAll(() => db
      .from("competitors")
      .select("id, name, adapter_name")
      .order("id", { ascending: true })),
  ]);
  return { products, competitors };
}

async function capture(db) {
  const capturedAt = new Date().toISOString();
  const cutoff = argv.get("cutoff") || capturedAt;
  if (Number.isNaN(Date.parse(cutoff))) throw new Error(`Invalid --cutoff: ${cutoff}`);
  const name = argv.get("name") || `baseline-${safeTimestamp(cutoff)}`;
  const { products, competitors } = await loadCatalog(db);
  const states = [];

  for (const competitor of competitors) {
    const snapshotDate = await latestSnapshotDate(db, competitor.id, cutoff);
    const rows = await snapshotRows(db, competitor.id, snapshotDate, cutoff);
    states.push({
      competitor_id: competitor.id,
      competitor_name: competitor.name,
      adapter_name: competitor.adapter_name,
      snapshot_date: snapshotDate,
      rows,
    });
    process.stdout.write(`${competitor.adapter_name}: ${rows.length} rows (${snapshotDate || "no snapshot"})\n`);
  }

  const payload = {
    version: 1,
    name,
    cutoff,
    captured_at: capturedAt,
    product_count: products.length,
    products,
    competitors: states,
  };
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const output = path.join(OUTPUT_DIR, `${name}.json`);
  await fs.writeFile(output, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`BASELINE_FILE=${output}\n`);
}

function baselineStateIndex(baseline) {
  const index = new Map();
  for (const competitor of baseline.competitors || []) {
    for (const row of competitor.rows || []) {
      index.set(`${competitor.competitor_id}:${row.product_id}`, row);
    }
  }
  return index;
}

function validPrice(row, expectedBrand) {
  if (!row) return null;
  const observed = numberOrNull(row.price);
  const confidence = matchConfidence(
    expectedBrand,
    row.found_brand,
    row.confidence || "exact",
    row.found_url || "",
  );
  return confidence === "exact" ? priceForSnapshot(observed, row.status) : null;
}

async function compare(db) {
  const baselineFile = argv.get("baseline");
  if (!baselineFile) throw new Error("compare requires --baseline /absolute/path/to/baseline.json");
  const baseline = JSON.parse(await fs.readFile(path.resolve(baselineFile), "utf8"));
  const comparedAt = new Date().toISOString();
  const products = new Map((baseline.products || []).map((product) => [Number(product.id), product]));
  const beforeByKey = baselineStateIndex(baseline);
  const reportRows = [];

  for (const competitor of baseline.competitors || []) {
    const refreshed = await rowsWrittenAfter(db, competitor.competitor_id, baseline.cutoff);
    const groups = new Map();
    for (const after of refreshed) {
      const product = products.get(Number(after.product_id));
      if (!product) continue;
      const brand = String(product.brand || "Без бренду").trim() || "Без бренду";
      const key = `${competitor.competitor_id}:${after.product_id}`;
      const before = beforeByKey.get(key) || null;
      const beforePrice = validPrice(before, product.brand);
      const beforeObservedPrice = numberOrNull(before?.price);
      const afterPrice = validPrice(after, product.brand);
      const foundBrand = String(after.found_brand || "").trim();
      const confidence = matchConfidence(
        product.brand,
        foundBrand,
        after.confidence || "exact",
        after.found_url || "",
      );
      const brandMismatch = confidence === "rejected"
        || Boolean(product.brand && foundBrand && !brandsMatch(product.brand, foundBrand));
      const brandMissingOrUnverified = Boolean(product.brand) && !foundBrand && confidence !== "exact";
      const currentOutOfStock = isOutOfStock(after.status);
      const clearedOutOfStock = beforeObservedPrice != null && afterPrice == null && isOutOfStock(after.status);
      const priceChanged = beforePrice != null && afterPrice != null && Math.abs(beforePrice - afterPrice) > 0.005;
      const quarantinedPartialPrice = numberOrNull(after.price) != null
        && !currentOutOfStock
        && confidence === "partial"
        && !brandMismatch
        && !brandMissingOrUnverified;
      const current = groups.get(brand) || {
        competitor: competitor.competitor_name,
        adapter: competitor.adapter_name,
        brand,
        processed: 0,
        actual_price_updated: 0,
        numeric_price_changed: 0,
        price_cleared_out_of_stock: 0,
        current_out_of_stock: 0,
        brand_mismatch: 0,
        brand_missing_or_unverified: 0,
        quarantined_partial_price: 0,
        parse_or_availability_error: 0,
      };
      current.processed += 1;
      if (afterPrice != null) current.actual_price_updated += 1;
      if (priceChanged) current.numeric_price_changed += 1;
      if (clearedOutOfStock) current.price_cleared_out_of_stock += 1;
      if (currentOutOfStock) current.current_out_of_stock += 1;
      if (brandMismatch) current.brand_mismatch += 1;
      if (brandMissingOrUnverified) current.brand_missing_or_unverified += 1;
      if (quarantinedPartialPrice) current.quarantined_partial_price += 1;
      if (afterPrice == null && !currentOutOfStock && !brandMismatch && !brandMissingOrUnverified && !quarantinedPartialPrice) {
        current.parse_or_availability_error += 1;
      }
      groups.set(brand, current);
    }
    reportRows.push(...groups.values());
  }

  reportRows.sort((a, b) => a.competitor.localeCompare(b.competitor, "uk") || a.brand.localeCompare(b.brand, "uk"));
  const brandTotalsMap = new Map();
  for (const row of reportRows) {
    const total = brandTotalsMap.get(row.brand) || {
      brand: row.brand,
      processed: 0,
      actual_price_updated: 0,
      numeric_price_changed: 0,
      price_cleared_out_of_stock: 0,
      current_out_of_stock: 0,
      brand_mismatch: 0,
      brand_missing_or_unverified: 0,
      quarantined_partial_price: 0,
      parse_or_availability_error: 0,
    };
    for (const key of Object.keys(total)) {
      if (key !== "brand") total[key] += row[key] || 0;
    }
    brandTotalsMap.set(row.brand, total);
  }
  const brandTotals = [...brandTotalsMap.values()].sort((a, b) => a.brand.localeCompare(b.brand, "uk"));

  const report = {
    version: 2,
    baseline_file: path.resolve(baselineFile),
    baseline_cutoff: baseline.cutoff,
    compared_at: comparedAt,
    definitions: {
      actual_price_updated: "Run wrote an explicitly in-stock, exact-brand row with a positive price.",
      numeric_price_changed: "The valid numeric price differs from the baseline.",
      price_cleared_out_of_stock: "The baseline had an observed price and the run wrote an out-of-stock row without an effective price.",
      current_out_of_stock: "The run observed the competitor product as explicitly out of stock. This can overlap with brand mismatch.",
      brand_mismatch: "The run rejected the row because the found brand does not match the Agromat brand.",
      brand_missing_or_unverified: "The competitor page did not expose enough brand evidence to approve the price.",
      quarantined_partial_price: "The run found an in-stock numeric price, but held it from comparison because the match or price-change confidence is partial.",
      parse_or_availability_error: "The run wrote neither a safe price nor an explicit out-of-stock, brand, or partial-match result.",
    },
    brand_totals: brandTotals,
    competitor_brand_rows: reportRows,
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const stem = `comparison-${safeTimestamp(comparedAt)}`;
  const jsonPath = path.join(OUTPUT_DIR, `${stem}.json`);
  const brandCsvPath = path.join(OUTPUT_DIR, `${stem}-by-brand.csv`);
  const detailCsvPath = path.join(OUTPUT_DIR, `${stem}-by-competitor-brand.csv`);
  const brandHeaders = [
    "brand", "processed", "actual_price_updated", "numeric_price_changed",
    "price_cleared_out_of_stock", "current_out_of_stock", "brand_mismatch",
    "brand_missing_or_unverified", "quarantined_partial_price", "parse_or_availability_error",
  ];
  const detailHeaders = [
    "competitor", "adapter", "brand", "processed", "actual_price_updated",
    "numeric_price_changed", "price_cleared_out_of_stock", "current_out_of_stock",
    "brand_mismatch", "brand_missing_or_unverified", "quarantined_partial_price",
    "parse_or_availability_error",
  ];
  const brandCsv = [
    brandHeaders.join(","),
    ...brandTotals.map((row) => brandHeaders.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
  const detailCsv = [
    detailHeaders.join(","),
    ...reportRows.map((row) => detailHeaders.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
  await Promise.all([
    fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(brandCsvPath, `${brandCsv}\n`),
    fs.writeFile(detailCsvPath, `${detailCsv}\n`),
  ]);
  process.stdout.write(
    `REPORT_JSON=${jsonPath}\nREPORT_BRANDS_CSV=${brandCsvPath}\nREPORT_DETAIL_CSV=${detailCsvPath}\n`,
  );
}

async function main() {
  const command = process.argv[2];
  if (!command || command.startsWith("--") || !["capture", "compare"].includes(command)) {
    throw new Error("Usage: competitor-run-analytics.mjs capture [--cutoff ISO] [--name NAME] | compare --baseline FILE");
  }
  const db = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_KEY"), {
    auth: { persistSession: false },
  });
  if (command === "capture") await capture(db);
  else await compare(db);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
