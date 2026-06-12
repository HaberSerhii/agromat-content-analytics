#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JOB_DIR = path.join(ROOT, "data", "parser-jobs");
const COMPETITOR_ADAPTER = "santechshara";
const ACTION = "prices-santechshara";

const argv = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  argv.set(a.slice(2), next && !next.startsWith("--") ? next : "true");
  if (next && !next.startsWith("--")) i++;
}

const jobId = argv.get("job-id") || `santechshara-${Date.now().toString(36)}`;
const singleProductId = argv.has("product-id") ? Number(argv.get("product-id")) : null;
const singleUrl = argv.get("url") || null;
const requestedSnapshotDate = argv.get("snapshot-date") || null;
const limit = Number(process.env.SANTECHSHARA_LIMIT || argv.get("limit") || "0");
const headless = (process.env.SANTECHSHARA_HEADLESS || "true") !== "false";
const profileDir = process.env.SANTECHSHARA_PROFILE_DIR
  || path.join(ROOT, "data", "browser-profiles", "santechshara");
const firstWaitMs = Number(process.env.SANTECHSHARA_FIRST_WAIT_MS || "12000");
const waitMinMs = Number(process.env.SANTECHSHARA_WAIT_MIN_MS || "4500");
const waitMaxMs = Number(process.env.SANTECHSHARA_WAIT_MAX_MS || "12000");
const navTimeoutMs = Number(process.env.SANTECHSHARA_NAV_TIMEOUT_MS || "45000");
const manualChallengeWaitMs = Number(process.env.SANTECHSHARA_MANUAL_CHALLENGE_WAIT_MS || "600000");
const today = new Date().toISOString().slice(0, 10);
const snapshotDate = requestedSnapshotDate || today;

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
    label: "Сантехшара: старт",
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
  await fs.writeFile(path.join(JOB_DIR, "santechshara-active.json"), `${JSON.stringify({ job_id: jobId }, null, 2)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter() {
  return waitMinMs + Math.floor(Math.random() * Math.max(1, waitMaxMs - waitMinMs));
}

function normalizePrice(text) {
  if (!text) return null;
  const candidates = text
    .replace(/\u00a0/g, " ")
    .match(/(?:\d[\d\s.,]{1,12})\s*(?:грн|₴|uah)/ig);
  const raw = candidates?.[0] || text.match(/\d[\d\s.,]{2,12}/)?.[0] || "";
  const cleaned = raw
    .replace(/грн|₴|uah/ig, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function normalizeStatus(text) {
  const s = (text || "").toLowerCase();
  if (/немає|нет\s+в\s+наличии|відсут|out\s+of\s+stock/.test(s)) return "Немає в наявності";
  if (/очіку|ожида|предзаказ|під\s*замов|под\s*заказ/.test(s)) return "Під замовлення";
  if (/наяв|налич|купити|купить|в\s+корзин/.test(s)) return "Є в наявності";
  return "unknown";
}

function isBlockedText(text) {
  return /just a moment|cloudflare|cf-chl|enable javascript and cookies|checking your browser|captcha|refresh (?:the )?page|оновіть сторінку|обновите страницу/i.test(text || "");
}

function isClosedBrowserError(error) {
  return /target page, context or browser has been closed|browser has been closed|page has been closed/i.test(String(error?.message || error));
}

function normalizeSantechsharaUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname === "santechshara.ua" || url.hostname === "www.santechshara.ua") {
      url.hostname = "www.santechshara.ua";
      url.pathname = url.pathname.replace(/^\/ua(?=\/|$)/, "") || "/";
    }
    return url.toString();
  } catch {
    return value;
  }
}

async function extractProduct(page) {
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const title = await page.title().catch(() => "");
  if (isBlockedText(`${title}\n${text}`)) {
    return { blocked: true, price: null, status: "blocked", foundBrand: null };
  }

  const jsonLd = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) =>
    nodes.map((n) => n.textContent || ""),
  ).catch(() => []);
  for (const raw of jsonLd) {
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const offer = item?.offers || item?.["@graph"]?.find?.((x) => x?.offers)?.offers;
        const price = normalizePrice(String(offer?.price || offer?.lowPrice || ""));
        if (price) {
          const availability = String(offer?.availability || "");
          const status = /OutOfStock/i.test(availability) ? "Немає в наявності" : "Є в наявності";
          return { blocked: false, price, status, foundBrand: item?.brand?.name || item?.brand || null };
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }

  const selectorTexts = await page.locator([
    "[class*=price]",
    "[id*=price]",
    "[data-price]",
    ".product-price",
    ".price",
    ".prices",
    ".availability",
    ".stock",
    "button",
  ].join(",")).evaluateAll((nodes) => nodes.slice(0, 80).map((n) => n.textContent || "")).catch(() => []);

  const combined = `${selectorTexts.join("\n")}\n${text}`;
  return {
    blocked: false,
    price: normalizePrice(combined),
    status: normalizeStatus(combined),
    foundBrand: null,
  };
}

async function waitForManualChallenge(page, target, progress) {
  const deadline = Date.now() + manualChallengeWaitMs;
  console.log(`Cloudflare/CAPTCHA detected for product ${target.product_id}. Waiting up to ${Math.round(manualChallengeWaitMs / 60000)} minutes for manual completion...`);
  await writeJob({
    status: "blocked",
    label: "Сантехшара: пройдіть Cloudflare/CAPTCHA у відкритому Chrome",
    error: "santechshara_waiting_for_manual_challenge",
    result: progress,
  });

  while (Date.now() < deadline) {
    await sleep(3000);
    const parsed = await extractProduct(page);
    if (!parsed.blocked) {
      console.log(`Cloudflare/CAPTCHA passed. Continuing with product ${target.product_id}.`);
      await writeJob({
        status: "running",
        label: `Сантехшара: перевірку пройдено · товар ${target.product_id}`,
        error: null,
        result: progress,
      });
      return parsed;
    }
  }
  return null;
}

async function connectToRegularChrome() {
  const chromeBin = process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : "google-chrome";
  const port = 9222 + Math.floor(Math.random() * 700);
  const chrome = spawn(chromeBin, [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "about:blank",
  ], { stdio: "ignore" });

  const endpoint = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    if (chrome.exitCode != null) throw new Error(`regular Chrome exited with code ${chrome.exitCode}`);
    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const browser = await chromium.connectOverCDP(endpoint);
        const context = browser.contexts()[0];
        if (!context) throw new Error("regular Chrome context is unavailable");
        return {
          context,
          close: async () => {
            await browser.close().catch(() => {});
            if (chrome.exitCode == null) chrome.kill("SIGTERM");
          },
        };
      }
    } catch {
      // Chrome is still starting.
    }
    await sleep(250);
  }
  if (chrome.exitCode == null) chrome.kill("SIGTERM");
  throw new Error("regular Chrome debugging endpoint did not start");
}

async function fetchTargets(db, competitorId) {
  if (singleProductId && singleUrl) {
    return [{ product_id: singleProductId, url: normalizeSantechsharaUrl(singleUrl) }];
  }

  const activeIds = new Set();
  let activeFrom = 0;
  const activePageSize = 1000;
  for (let i = 0; i < 100; i++) {
    const { data, error } = await db
      .from("products")
      .select("id")
      .eq("is_active", true)
      .range(activeFrom, activeFrom + activePageSize - 1);
    if (error) throw new Error(`products: ${error.message}`);
    const rows = data || [];
    for (const r of rows) activeIds.add(r.id);
    if (rows.length < activePageSize) break;
    activeFrom += activePageSize;
  }

  const out = [];
  let from = 0;
  const pageSize = 1000;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await db
      .from("url_overrides")
      .select("product_id, url")
      .eq("competitor_id", competitorId)
      .range(from, from + pageSize - 1)
      .order("product_id", { ascending: true });
    if (error) throw new Error(`url_overrides: ${error.message}`);
    const rows = data || [];
    for (const r of rows) {
      if (activeIds.has(r.product_id)) out.push({ product_id: r.product_id, url: normalizeSantechsharaUrl(r.url) });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return limit > 0 ? out.slice(0, limit) : out;
}

async function insertRows(db, rows) {
  if (rows.length === 0) return;
  const size = 200;
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await db.from("price_snapshots").insert(rows.slice(i, i + size));
    if (error) throw new Error(`price_snapshots insert: ${error.message}`);
  }
}

async function fetchPreviousPrices(db, competitorId, productIds) {
  const wanted = new Set(productIds);
  const previous = new Map();
  let from = 0;
  const pageSize = 1000;
  for (let i = 0; i < 100 && previous.size < wanted.size; i++) {
    const { data, error } = await db
      .from("price_snapshots")
      .select("product_id, price")
      .eq("competitor_id", competitorId)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`price_snapshots history: ${error.message}`);
    const rows = data || [];
    for (const row of rows) {
      if (wanted.has(row.product_id) && !previous.has(row.product_id) && Number.isFinite(row.price)) {
        previous.set(row.product_id, row.price);
      }
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return previous;
}

// This worker only does REST (.select()/.insert()) — it never opens a realtime
// channel. But @supabase/supabase-js eagerly builds a RealtimeClient inside
// createClient, and on Node < 22 (the VPS runs Node 20) that constructor calls
// getWebSocketConstructor() and throws "Node.js 20 detected without native
// WebSocket support" before main() can do anything. Passing a stub `transport`
// short-circuits that lookup. It's never instantiated because we never subscribe.
class UnusedRealtimeTransport {}

async function main() {
  const db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_KEY"), {
    auth: { persistSession: false },
    realtime: { transport: UnusedRealtimeTransport },
  });

  await writeJob({ status: "starting", label: "Сантехшара: читаю URL-и з БД" });
  const { data: competitor, error: compErr } = await db
    .from("competitors")
    .select("id")
    .eq("adapter_name", COMPETITOR_ADAPTER)
    .single();
  if (compErr || !competitor) throw new Error(`competitor not found: ${compErr?.message || COMPETITOR_ADAPTER}`);

  const targets = await fetchTargets(db, competitor.id);
  const previousPrices = await fetchPreviousPrices(db, competitor.id, targets.map((target) => target.product_id));
  await writeJob({
    status: "running",
    total: targets.length,
    current: 0,
    label: `Сантехшара: 0/${targets.length}`,
    result: { total: targets.length, found: 0, new_finds: 0, price_changes: 0, errors: 0, blocked: 0 },
  });

  if (targets.length === 0) {
    await writeJob({
      status: "done",
      finished_at: Math.floor(Date.now() / 1000),
      label: "Сантехшара: немає URL для обходу",
      result: { total: 0, found: 0, errors: 0, blocked: 0 },
    });
    return;
  }

  await fs.mkdir(profileDir, { recursive: true });
  let context;
  let closeBrowser;
  if (headless) {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      channel: "chrome",
      viewport: { width: 1365, height: 900 },
      locale: "uk-UA",
      timezoneId: "Europe/Kyiv",
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });
    closeBrowser = () => context.close();
  } else {
    const attached = await connectToRegularChrome();
    context = attached.context;
    closeBrowser = attached.close;
  }
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(navTimeoutMs);

  let found = 0;
  let newFinds = 0;
  let priceChanges = 0;
  let errors = 0;
  let blocked = 0;
  const rows = [];

  try {
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      await writeJob({
        current: i,
        label: `Сантехшара: ${i}/${targets.length} · товар ${target.product_id}`,
        result: { total: targets.length, found, new_finds: newFinds, price_changes: priceChanges, errors, blocked },
      });

      try {
        await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: navTimeoutMs });
        if (i === 0) await sleep(firstWaitMs);
        else await sleep(jitter());
        let parsed = await extractProduct(page);
        if (parsed.blocked) {
          blocked++;
          if (!headless) {
            const afterChallenge = await waitForManualChallenge(page, target, { total: targets.length, found, new_finds: newFinds, price_changes: priceChanges, errors, blocked });
            if (afterChallenge) {
              parsed = afterChallenge;
            } else {
              await writeJob({
                status: "blocked",
                current: i,
                total: targets.length,
                label: "Сантехшара: час очікування Cloudflare/CAPTCHA вичерпано",
                error: "santechshara_manual_challenge_timeout",
                result: { total: targets.length, found, new_finds: newFinds, price_changes: priceChanges, errors, blocked },
              });
              return;
            }
          } else {
            await writeJob({
              status: "blocked",
              current: i,
              total: targets.length,
              label: "Сантехшара: Cloudflare/CAPTCHA, потрібна ручна сесія браузера",
              error: "santechshara_blocked_by_cloudflare",
              result: { total: targets.length, found, new_finds: newFinds, price_changes: priceChanges, errors, blocked },
            });
            return;
          }
        }
        if (parsed.price) {
          found++;
          const previousPrice = previousPrices.get(target.product_id);
          if (previousPrice == null) newFinds++;
          else if (previousPrice !== parsed.price) priceChanges++;
          rows.push({
            product_id: target.product_id,
            competitor_id: competitor.id,
            price: parsed.price,
            status: parsed.status,
            found_url: page.url() || target.url,
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
            status: "parse_error",
            found_url: page.url() || target.url,
            snapshot_date: snapshotDate,
            confidence: "none",
            found_brand: null,
            url_approved: false,
          });
        }

        if (rows.length >= 100) {
          await insertRows(db, rows.splice(0, rows.length));
        }
      } catch (e) {
        if (isClosedBrowserError(e)) {
          await insertRows(db, rows);
          await writeJob({
            status: "error",
            current: i,
            total: targets.length,
            label: "Сантехшара: Chrome закрито, обхід зупинено",
            finished_at: Math.floor(Date.now() / 1000),
            error: "santechshara_browser_closed",
            result: { total: targets.length, found, new_finds: newFinds, price_changes: priceChanges, errors, blocked },
          });
          return;
        }
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
      label: `Сантехшара: готово · знайдено ${found}/${targets.length}`,
      finished_at: Math.floor(Date.now() / 1000),
      result: { total: targets.length, found, new_finds: newFinds, price_changes: priceChanges, errors, blocked },
    });
  } finally {
    await closeBrowser().catch(() => {});
  }
}

main().catch(async (e) => {
  await writeJob({
    status: "error",
    finished_at: Math.floor(Date.now() / 1000),
    error: String(e?.message || e),
    label: "Сантехшара: помилка",
  }).catch(() => {});
  process.exitCode = 1;
});
