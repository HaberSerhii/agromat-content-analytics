#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JOB_DIR = path.join(ROOT, "data", "parser-jobs");
const REPORT_DIR = path.join(ROOT, "outputs", "santechshara-category");
const BASE_URL = "https://www.santechshara.ua";
const COMPETITOR_ADAPTER = "santechshara";

const argv = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const next = process.argv[i + 1];
  argv.set(arg.slice(2), next && !next.startsWith("--") ? next : "true");
  if (next && !next.startsWith("--")) i++;
}

const jobId = argv.get("job-id") || `santechshara-category-${Date.now().toString(36)}`;
const rootCategory = normalizeCategoryPath(argv.get("category") || process.env.SANTECHSHARA_CATEGORY_ROOT || "/santehnika/");
const pageLimit = Number(argv.get("page-limit") || process.env.SANTECHSHARA_CATEGORY_PAGE_LIMIT || "0");
const waitMs = Number(process.env.SANTECHSHARA_CATEGORY_WAIT_MS || "1500");
const timeoutMs = Number(process.env.SANTECHSHARA_CATEGORY_TIMEOUT_MS || "45000");
const retries = Number(process.env.SANTECHSHARA_CATEGORY_RETRIES || "4");
const today = new Date().toISOString().slice(0, 10);

class UnusedRealtimeTransport {}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCategoryPath(value) {
  const url = new URL(value, BASE_URL);
  let pathname = url.pathname.replace(/\/page-\d+\/?$/, "/");
  if (!pathname.endsWith("/")) pathname += "/";
  return pathname;
}

function absoluteUrl(value) {
  return new URL(value, BASE_URL).toString();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return decodeHtml(value).toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/giu, "");
}

function normalizePrice(value) {
  const match = decodeHtml(value).match(/\d[\d\s.,]*/)?.[0] || "";
  const number = Number.parseFloat(match.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function normalizeStatus(value) {
  const text = decodeHtml(value).toLowerCase();
  if (/нет в наличии|немає|відсут|закончился/.test(text)) return "Немає в наявності";
  if (/под заказ|під замовлення|ожида|очіку/.test(text)) return "Під замовлення";
  if (/есть в наличии|є в наявності|купить|купити/.test(text)) return "Є в наявності";
  return "unknown";
}

function extractFirst(html, pattern) {
  return pattern.exec(html)?.[1] || "";
}

function parseProducts(html, category) {
  const chunks = html.split(/<div\s+class="selected__item[^"]*"/i).slice(1);
  const products = [];
  for (const chunk of chunks) {
    const sku = decodeHtml(extractFirst(chunk, /class="selected__code"[^>]*>\s*Артикул:\s*([\s\S]*?)<\/p>/i));
    if (!sku) continue;
    const url = extractFirst(chunk, /href="([^"]+)"[^>]*class="selected__name"/i);
    const name = decodeHtml(extractFirst(chunk, /class="selected__name"[^>]*>([\s\S]*?)<\/a>/i));
    const brand = decodeHtml(extractFirst(chunk, /class="selected__prod"[^>]*>\s*Производитель:\s*([\s\S]*?)<\/p>/i));
    const shopCode = decodeHtml(extractFirst(chunk, /class="selected__prod"[^>]*>\s*Код товара:\s*([\s\S]*?)<\/p>/i));
    const priceHtml = extractFirst(chunk, /class="selected__price"[^>]*>([\s\S]*?)<\/p>/i);
    const currentPrice = extractFirst(priceHtml, /class="current_price"[^>]*>([\s\S]*?)<\/span>/i) || priceHtml;
    products.push({
      category,
      sku,
      brand,
      name,
      shop_code: shopCode,
      price: normalizePrice(currentPrice),
      status: normalizeStatus(chunk),
      url: absoluteUrl(url),
    });
  }
  return products;
}

function parseChildCategories(html) {
  const categoryGridAt = html.search(/class="catalog__content\s+category\b/i);
  if (categoryGridAt < 0) return [];
  const categoryGrid = html.slice(categoryGridAt);
  const out = new Set();
  const pattern = /href=["']([^"'#?]+)["']/gi;
  let match;
  while ((match = pattern.exec(categoryGrid))) {
    const pathname = normalizeCategoryPath(match[1]);
    if (
      pathname !== rootCategory
      && pathname.startsWith(rootCategory)
      && !/\/page-\d+\/?$/.test(match[1])
      && !/[=,]/.test(match[1])
      && !/\/santehnika-v-chernom-tsvete\/$/.test(pathname)
    ) out.add(pathname);
  }
  return [...out];
}

function parseLastPage(html) {
  let last = 1;
  const pattern = /href="[^"]*\/page-(\d+)\/"/gi;
  let match;
  while ((match = pattern.exec(html))) last = Math.max(last, Number(match[1]));
  return pageLimit > 0 ? Math.min(last, pageLimit) : last;
}

async function fetchHtml(pathname) {
  const url = absoluteUrl(pathname);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/149 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "uk-UA,uk;q=0.9,ru;q=0.8",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const html = await response.text();
      if (response.ok && /selected__item|catalog__content/i.test(html)) return html;
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt === retries) throw error;
      await sleep(attempt * 5000);
    }
  }
  return "";
}

async function writeJob(patch) {
  await fs.mkdir(JOB_DIR, { recursive: true });
  const file = path.join(JOB_DIR, `${jobId}.json`);
  let current = { job_id: jobId, action: "prices-santechshara-category", status: "starting", current: 0, total: 0 };
  try {
    current = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    // First write.
  }
  await fs.writeFile(file, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`);
  await fs.writeFile(path.join(JOB_DIR, "santechshara-category-active.json"), `${JSON.stringify({ job_id: jobId }, null, 2)}\n`);
}

async function fetchProducts(db) {
  const products = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("products")
      .select("id, sku, brand, name, category")
      .eq("is_active", true)
      .not("sku", "is", null)
      .range(from, from + 999);
    if (error) throw new Error(`products: ${error.message}`);
    products.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return products;
}

function buildProductIndex(products) {
  const bySku = new Map();
  for (const product of products) {
    const key = normalizeKey(product.sku);
    if (!key) continue;
    const list = bySku.get(key) || [];
    list.push(product);
    bySku.set(key, list);
  }
  return bySku;
}

function matchProduct(item, bySku) {
  const candidates = bySku.get(normalizeKey(item.sku)) || [];
  if (candidates.length === 1) return { product: candidates[0], confidence: "sku" };
  if (candidates.length === 0) return { product: null, confidence: "none" };
  const itemBrand = normalizeKey(item.brand);
  const exactBrand = candidates.filter((candidate) => {
    const brand = normalizeKey(candidate.brand);
    return brand && itemBrand && (brand.includes(itemBrand) || itemBrand.includes(brand));
  });
  return exactBrand.length === 1
    ? { product: exactBrand[0], confidence: "sku_brand" }
    : { product: null, confidence: "ambiguous_sku" };
}

async function insertRows(db, rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("price_snapshots").insert(rows.slice(i, i + 200));
    if (error) throw new Error(`price_snapshots: ${error.message}`);
  }
}

async function main() {
  const db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_KEY"), {
    auth: { persistSession: false },
    realtime: { transport: UnusedRealtimeTransport },
  });
  await writeJob({ status: "starting", label: "Сантехшара категорії: завантаження товарів Agromat", started_at: Math.floor(Date.now() / 1000) });
  const [{ data: competitor, error: competitorError }, products] = await Promise.all([
    db.from("competitors").select("id").eq("adapter_name", COMPETITOR_ADAPTER).single(),
    fetchProducts(db),
  ]);
  if (competitorError || !competitor) throw new Error(`competitor: ${competitorError?.message || "not found"}`);
  const bySku = buildProductIndex(products);

  const queue = [rootCategory];
  const discovered = new Set(queue);
  const visited = new Set();
  const catalog = new Map();
  let pages = 0;
  let errors = 0;

  while (queue.length) {
    const category = queue.shift();
    if (visited.has(category)) continue;
    visited.add(category);
    await writeJob({
      status: "running",
      current: pages,
      total: visited.size + queue.length,
      label: `Сантехшара категорії: ${category}`,
      result: { categories: visited.size, queued: queue.length, pages, catalog_items: catalog.size, errors },
    });

    try {
      const firstHtml = await fetchHtml(category);
      pages++;
      for (const child of parseChildCategories(firstHtml)) {
        if (!discovered.has(child)) {
          discovered.add(child);
          queue.push(child);
        }
      }
      const lastPage = parseLastPage(firstHtml);
      const pageProducts = parseProducts(firstHtml, category);
      for (const item of pageProducts) catalog.set(`${normalizeKey(item.sku)}:${normalizeKey(item.brand)}`, item);

      for (let page = 2; page <= lastPage; page++) {
        await sleep(waitMs);
        const html = await fetchHtml(`${category}page-${page}/`);
        pages++;
        for (const item of parseProducts(html, category)) catalog.set(`${normalizeKey(item.sku)}:${normalizeKey(item.brand)}`, item);
        await writeJob({
          status: "running",
          current: pages,
          total: visited.size + queue.length,
          label: `Сантехшара категорії: ${category} · сторінка ${page}/${lastPage}`,
          result: { categories: visited.size, queued: queue.length, pages, catalog_items: catalog.size, errors },
        });
      }
    } catch (error) {
      errors++;
      console.error(`${category}: ${String(error?.message || error)}`);
    }
    await sleep(waitMs);
  }

  const matched = [];
  const unmatched = [];
  const ambiguous = [];
  const rows = [];
  for (const item of catalog.values()) {
    const match = matchProduct(item, bySku);
    const reportItem = { ...item, match_confidence: match.confidence, product_id: match.product?.id || null, agromat_name: match.product?.name || null };
    if (!match.product) {
      if (match.confidence === "ambiguous_sku") ambiguous.push(reportItem);
      else unmatched.push(reportItem);
      continue;
    }
    matched.push(reportItem);
    rows.push({
      product_id: match.product.id,
      competitor_id: competitor.id,
      price: item.price,
      status: item.price ? item.status : "parse_error",
      found_url: item.url,
      snapshot_date: today,
      confidence: match.confidence === "sku_brand" ? "exact" : "sku",
      found_brand: item.brand || null,
      url_approved: false,
    });
  }
  await insertRows(db, rows);

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `${today}-${jobId}.json`);
  const report = { root_category: rootCategory, categories: visited.size, pages, catalog_items: catalog.size, matched: matched.length, unmatched: unmatched.length, ambiguous: ambiguous.length, errors, matched_items: matched, new_items: unmatched, ambiguous_items: ambiguous };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeJob({
    status: "done",
    current: pages,
    total: pages,
    finished_at: Math.floor(Date.now() / 1000),
    label: `Сантехшара категорії: готово · ${matched.length} збігів, ${unmatched.length} нових`,
    error: null,
    result: { categories: visited.size, pages, catalog_items: catalog.size, matched: matched.length, unmatched: unmatched.length, ambiguous: ambiguous.length, errors, report: reportPath },
  });
}

main().catch(async (error) => {
  await writeJob({
    status: "error",
    finished_at: Math.floor(Date.now() / 1000),
    label: "Сантехшара категорії: помилка",
    error: String(error?.message || error),
  }).catch(() => {});
  process.exitCode = 1;
});
