#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const profileDir = process.env.SANTECHSHARA_PROFILE_DIR
  || path.join(ROOT, "data", "browser-profiles", "santechshara");
const url = process.argv[2] || "https://www.santechshara.ua/";
const resetProfile = process.env.SANTECHSHARA_RESET_PROFILE === "true";

if (resetProfile) {
  const archivedProfile = `${profileDir}-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    await fs.rename(profileDir, archivedProfile);
    console.log(`Previous profile archived: ${archivedProfile}`);
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
  }
}
await fs.mkdir(profileDir, { recursive: true });

const chromeBin = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "google-chrome";
const chrome = spawn(chromeBin, [`--user-data-dir=${profileDir}`, "--no-first-run", url], {
  stdio: "ignore",
});
chrome.on("error", (e) => {
  console.error(`Could not start Google Chrome: ${String(e?.message || e)}`);
  process.exitCode = 1;
});

console.log("");
console.log("Santechshara profile is open in regular Google Chrome (without Playwright).");
console.log(`Profile: ${profileDir}`);
console.log("Pass Cloudflare/CAPTCHA manually and wait until a normal product page opens.");
console.log("Then press Enter here. This special Chrome process will close and save the session.");

await new Promise((resolve) => process.stdin.once("data", resolve));
if (chrome.exitCode == null) {
  chrome.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5000);
    chrome.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
