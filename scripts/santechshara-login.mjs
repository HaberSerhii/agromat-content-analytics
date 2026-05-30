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
  viewport: { width: 1365, height: 900 },
  locale: "uk-UA",
  timezoneId: "Europe/Kyiv",
});
const page = context.pages()[0] || await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

console.log("");
console.log("Santechshara browser profile is open.");
console.log(`Profile: ${profileDir}`);
console.log("Pass Cloudflare/CAPTCHA manually, then press Enter here to close and save the session.");

await new Promise((resolve) => process.stdin.once("data", resolve));
await context.close();
