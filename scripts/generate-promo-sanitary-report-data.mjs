#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "output", "pdf", "promo-sanitary-report-data.json");
const API = process.env.REPORT_API_BASE || "http://localhost:3000";
const PROMO_NAME = "Сантехніка";
const START_DATE = "2026-06-15";
const REPORT_DATE = "2026-06-25";
const PROMO_PLAN = 5_500_000;
const COMPETITOR_ADAPTERS = ["vencon", "teploradost", "drop", "depoint", "vannaja"];

const PROMO_CODES = `
8637 8639 8644 8656 21718 28400 91245 99402 101250 161218 188391 8633
188393 596873 188396 188414 188430 198567 198724 204437 207449 207451
215559 215561 217718 219493 222393 226182 227912 228829 235501 235502
235854 235856 249058 260302 277988 278077 278102 278104 290099 300809
302690 302699 303200 321486 321505 321528 321532 326468 345188 346350
351504 353725 359306 389231 393336 400940 414216 416082 418477 419583
422526 422531 422535 426580 428390 430276 437504 447006 447393 450411
523208 525239 527551 527556 527565 527572 527590 528535 529291 531536
532621 532628 533166 535599 538933 540755 543751 544723 544736 547771
551598 551607 552437 552640 552951 553090 558395 558577 558578 559519
560301 459776 461110 461855 464033 465489 473850 475580 480967 486548
487135 487526 487528 487530 487625 487632 487673 491495 491497 491500
491502 491504 491505 491506 491508 491509 491512 494848 495403 513112
519803 522737 562667 562686 563721 568753 569780 574213 575120 582499
582611 584018 584027 584782 585001 585014 585015 585038 585039 585040
585042 585051 585053 585054 585867 586541 588147 589573 589585 589587
589591 589597 589654 590604 590607 590891 590896 591495 593593 8638
8640 20558 21846 97842 146108 157555 157561 157601 168204 168288 188402
207743 211173 231491 235497 240327 247797 290096 311651 320694 322982
324539 332051 364591 375300 382700 401216 402215 414188 417834 429535
429560 429733 430421 430517 431968 439531 439532 439533 442472 443448
447160 448024 454734 461304 465005 465398 486304 486311 486968 487518
487520 487612 487652 487654 487668 487670 488024 488525 491503 497297
504168 505780 506490 510947 517872 527574 527578 531492 531538 531828
532607 532624 532625 533008 535592 535594 538885 538887 539081 539102
539630 541250 549185 550721 552014 552016 553573 558234 559420 559421
559427 559777 559853 561181 561189 561219 561233 561876 561879 563173
563710 565798 567410 567412 569056 575537 582685 583757 584146 585267
589271 590603
`.trim().split(/\s+/).map(Number);

function loadEnv(file = ".env.local") {
  return readFile(path.join(ROOT, file), "utf8").then((text) => {
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (!m || process.env[m[1]] != null) continue;
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }).catch(() => {});
}

function parseS3Url(value) {
  const match = value.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Bad S3 URL: ${value}`);
  return { bucket: match[1], key: match[2] };
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; }
        else quoted = false;
      } else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { values.push(current); current = ""; }
    else current += ch;
  }
  values.push(current);
  return values;
}

function splitList(value) {
  return String(value || "").split("|").map((x) => x.trim()).filter(Boolean);
}

function num(value) {
  const n = Number(String(value || "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function isFullyShipped(state) {
  return String(state || "").toLocaleLowerCase("uk").includes("повністю відвантаж");
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchSalesDataset(from, to) {
  const res = await fetch(`${API}/api/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, productCodes: PROMO_CODES, statuses: [] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`/api/sales ${from}..${to}: ${data.error || res.status}`);
  return data;
}

async function fetchProducts() {
  const byCode = new Map();
  const notFound = [];
  for (const part of chunk(PROMO_CODES, 80)) {
    const data = await fetchJson(`${API}/api/products?limit=50000&status_ids=-1,1,2,3,4,5&ids_in=${part.join(",")}`);
    for (const item of data.items || []) byCode.set(item.code, item);
    notFound.push(...(data.notFoundIds || []));
  }
  return { products: [...byCode.values()], notFound: [...new Set(notFound)] };
}

async function fetchAgromatPriceAnalytics() {
  const totals = { repricedCount: 0, repricedUpCount: 0, repricedDownCount: 0 };
  for (const part of chunk(PROMO_CODES, 120)) {
    const data = await fetchJson(`${API}/api/products/analytics?from=${REPORT_DATE}&to=${REPORT_DATE}&ids_in=${part.join(",")}`);
    totals.repricedCount += data.repricedCount || 0;
    totals.repricedUpCount += data.repricedUpCount || 0;
    totals.repricedDownCount += data.repricedDownCount || 0;
  }
  return totals;
}

async function readSalesCsv() {
  const { bucket, key } = parseS3Url(process.env.SALES_S3_URL || "s3://dataset4bq/analysebillsofparsel.csv");
  const client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return object.Body.transformToString();
}

function buildTopProducts(csvText, productsByCode) {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] || "");
  const idx = new Map(headers.map((header, index) => [header, index]));
  const get = (values, key) => values[idx.get(key) ?? -1] || "";
  const promo = new Set(PROMO_CODES);
  const top = new Map();

  for (const line of lines.slice(1)) {
    const v = parseCsvLine(line);
    const created = get(v, "datecreation").slice(0, 10);
    const shipped = get(v, "fullyshipped_datetime").slice(0, 10);
    const analysisDate = shipped || created;
    const codes = splitList(get(v, "goods_codes")).map((x) => parseInt(x, 10));
    const names = splitList(get(v, "goods_names"));
    const sums = splitList(get(v, "rows_sums")).map(num);
    const n = Math.max(codes.length, sums.length, names.length);

    for (let i = 0; i < n; i += 1) {
      const code = codes[i];
      if (!promo.has(code)) continue;
      const revenue = sums[i] || 0;
      const name = names[i] || productsByCode.get(code)?.name || "Без назви";

      if (analysisDate >= START_DATE && analysisDate <= REPORT_DATE) {
        const item = top.get(code) || { code, name, revenue: 0, qty: 0 };
        item.revenue += revenue;
        item.qty += 1;
        top.set(code, item);
      }
    }
  }

  return [...top.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
}

function buildSales(periodSales, yesterdaySales, topProducts) {
  const period = periodSales.summary;
  const yesterday = yesterdaySales.summary;
  const sanitaryPlan = period.plan.segments.find((segment) => segment.segment === "Сантехніка") || null;

  return {
    yesterdayRevenue: yesterday.selected.revenue,
    yesterdayDocs: yesterday.selected.docs,
    yesterdayGoods: yesterday.selected.goods,
    yesterdayShippedRevenue: yesterday.shippedRevenue,
    yesterdayShippedDocs: yesterday.shippedDocs,
    sinceCreatedRevenue: period.selected.revenue,
    sinceCreatedDocs: period.selected.docs,
    sinceGoods: period.selected.goods,
    sinceShippedRevenue: period.shippedRevenue,
    sinceShippedDocs: period.shippedDocs,
    sinceShippedGoods: period.shippedGoods,
    returnedRevenue: period.selected.returnedRevenue,
    canceledDocs: period.selected.canceledDocs,
    canceledRevenue: period.selected.canceledRevenue,
    plan: period.plan.plan || PROMO_PLAN,
    planRevenue: period.plan.revenue,
    completionPct: period.plan.completionPct,
    sanitaryPlan,
    byDate: period.byDate,
    categories: period.categories,
    states: period.states,
    matchedProductCodes: periodSales.filter.matchedProductCodes,
    topProducts,
  };
}

function buildContent(products) {
  const statuses = new Map();
  const categories = new Map();
  for (const p of products) {
    statuses.set(p.statusName || "Без статусу", (statuses.get(p.statusName || "Без статусу") || 0) + 1);
    const key = p.categoryName || "Без категорії";
    const c = categories.get(key) || {
      category: key, total: 0, inStock: 0, others: 0, lowPhotos: 0, lowAttrs: 0, noReviews: 0, refAfterBase: null,
    };
    c.total += 1;
    if (p.statusName === "В наявності") c.inStock += 1;
    else c.others += 1;
    if ((p.imagesCount || 0) < 2) c.lowPhotos += 1;
    if ((p.attributesCount || 0) < 5) c.lowAttrs += 1;
    if ((p.reviewsCount || 0) === 0) c.noReviews += 1;
    categories.set(key, c);
  }
  return {
    total: products.length,
    inStock: products.filter((p) => p.statusName === "В наявності").length,
    others: products.filter((p) => p.statusName !== "В наявності").length,
    lowPhotos: products.filter((p) => (p.imagesCount || 0) < 2).length,
    lowAttrs: products.filter((p) => (p.attributesCount || 0) < 5).length,
    noReviews: products.filter((p) => (p.reviewsCount || 0) === 0).length,
    statuses: [...statuses.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    categories: [...categories.values()].sort((a, b) => b.total - a.total).slice(0, 14),
  };
}

async function fetchRowsByProduct(db, table, select, productIds, extra = (q) => q) {
  const rows = [];
  for (const ids of chunk(productIds, 250)) {
    let q = db.from(table).select(select).in("product_id", ids);
    q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
  }
  return rows;
}

async function fetchSnapshotMap(db, competitorId, date, productIds) {
  const rows = await fetchRowsByProduct(
    db,
    "price_snapshots",
    "product_id, price, snapshot_date, created_at",
    productIds,
    (q) => q.eq("competitor_id", competitorId).eq("snapshot_date", date).order("created_at", { ascending: false }).limit(1000),
  );
  const map = new Map();
  for (const row of rows) if (!map.has(row.product_id)) map.set(row.product_id, row.price == null ? null : Number(row.price));
  return map;
}

async function buildCompetitors(products) {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  const productIds = products.map((p) => p.id);
  const priceByProduct = new Map(products.map((p) => [p.id, p.price == null ? null : Number(p.price)]));
  const { data: comps, error } = await db.from("competitors").select("id,name,adapter_name").in("adapter_name", COMPETITOR_ADAPTERS);
  if (error) throw error;
  const out = [];

  for (const comp of comps.sort((a, b) => COMPETITOR_ADAPTERS.indexOf(a.adapter_name) - COMPETITOR_ADAPTERS.indexOf(b.adapter_name))) {
    const targets = await fetchRowsByProduct(db, "url_overrides", "product_id", productIds, (q) => q.eq("competitor_id", comp.id).limit(1000));
    const targetIds = [...new Set(targets.map((r) => r.product_id))];
    const { data: latestRows, error: latestError } = await db
      .from("price_snapshots")
      .select("snapshot_date")
      .eq("competitor_id", comp.id)
      .order("snapshot_date", { ascending: false })
      .limit(1);
    if (latestError) throw latestError;
    const latestDate = latestRows?.[0]?.snapshot_date || null;
    const { data: prevRows, error: prevError } = latestDate
      ? await db.from("price_snapshots").select("snapshot_date").eq("competitor_id", comp.id).lt("snapshot_date", latestDate).order("snapshot_date", { ascending: false }).limit(1)
      : { data: [], error: null };
    if (prevError) throw prevError;
    const prevDate = prevRows?.[0]?.snapshot_date || null;
    const current = latestDate ? await fetchSnapshotMap(db, comp.id, latestDate, targetIds) : new Map();
    const previous = prevDate ? await fetchSnapshotMap(db, comp.id, prevDate, targetIds) : new Map();

    let parsed = 0, violations = 0, noViolations = 0, ourCheaper = 0, cheaperPctSum = 0;
    let changed = 0, up = 0, down = 0, same = 0;
    for (const id of targetIds) {
      const our = priceByProduct.get(id);
      const cur = current.get(id);
      if (cur == null) continue;
      parsed += 1;
      if (our != null && cur < our * 0.95) violations += 1;
      else noViolations += 1;
      if (our != null && our < cur) {
        ourCheaper += 1;
        cheaperPctSum += ((cur - our) / cur) * 100;
      }
      const prev = previous.get(id);
      if (prev == null) continue;
      if (cur > prev) { changed += 1; up += 1; }
      else if (cur < prev) { changed += 1; down += 1; }
      else same += 1;
    }
    out.push({
      name: comp.name,
      adapter: comp.adapter_name,
      targetCount: targetIds.length,
      parsedCount: parsed,
      violations,
      noViolations,
      ourCheaper,
      avgOurCheaperPct: ourCheaper ? cheaperPctSum / ourCheaper : null,
      latestDate,
      previousDate: prevDate,
      priceChanges: { changed, up, down, same },
    });
  }
  return out;
}

async function main() {
  await loadEnv();
  const { products, notFound } = await fetchProducts();
  const productsByCode = new Map(products.map((p) => [p.code, p]));
  const [csvText, periodSales, yesterdaySales, agromatPrices, competitors] = await Promise.all([
    readSalesCsv(),
    fetchSalesDataset(START_DATE, REPORT_DATE),
    fetchSalesDataset(REPORT_DATE, REPORT_DATE),
    fetchAgromatPriceAnalytics(),
    buildCompetitors(products),
  ]);
  const data = {
    meta: {
      promoName: PROMO_NAME,
      startDate: START_DATE,
      reportDate: REPORT_DATE,
      plan: PROMO_PLAN,
      sourceGeneratedAt: new Date().toISOString(),
      requestedCodes: PROMO_CODES.length,
      foundProducts: products.length,
      foundInSales: periodSales.filter.matchedProductCodes.length,
      notFoundCodes: notFound,
      language: "uk",
      notes: [
        "Блок продажів бере ті самі значення з /api/sales, що й дашборд продажів.",
        "Топ товарів порахований по товарних рядках у S3, бо суму документа не можна коректно розподілити між товарами без rows_sums.",
        "Колонка про референс потребує правила класифікації фото: у поточних даних є лише main/sort/url.",
      ],
    },
    sales: buildSales(periodSales, yesterdaySales, buildTopProducts(csvText, productsByCode)),
    content: buildContent(products),
    agromatPrices: {
      ...agromatPrices,
      unchangedCount: Math.max(0, products.length - agromatPrices.repricedCount),
    },
    competitors,
  };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(data, null, 2)}\n`);
  console.log(OUT);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
