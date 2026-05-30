#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const profileDir = process.env.SANTECHSHARA_PROFILE_DIR
  || path.join(ROOT, "data", "browser-profiles", "santechshara");
const url = process.argv[2] || "https://www.santechshara.ua/ua/";

await fs.mkdir(profileDir, { recursive: true });
const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  channel: "chrome",
  viewport: { width: 1365, height: 900 },
  locale: "uk-UA",
  timezoneId: "Europe/Kyiv",
  // Hide automation fingerprints so Cloudflare Turnstile doesn't loop the
  // challenge. Must match the worker exactly (same UA = default Chromium UA,
  // same flags) or the warmed cf_clearance cookie won't be honoured there.
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
});
const page = context.pages()[0] || await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

console.log("");
console.log("Santechshara browser profile is open.");
console.log(`Profile: ${profileDir}`);
console.log("Pass Cloudflare/CAPTCHA manually, then press Enter here to close and save the session.");

await new Promise((resolve) => process.stdin.once("data", resolve));
await context.close();
