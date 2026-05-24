// Local disk cache for the lite snapshot. Mirrors the canonical copy in Upstash
// Redis so the dashboard cold-loads in ~200ms instead of ~6s (the time it takes
// to pull 31 shards × ~250KB JSON over the internet).
//
// Lifecycle:
//   • writeAllLite() — also writes this file atomically after Redis succeeds.
//   • readAllLite()  — checks the file before falling back to Redis pipeline;
//                      uses Redis's syncedAt as a freshness probe (the file
//                      embeds its own syncedAt, must match).
//   • instrumentation.ts boot hook — calls readAllLite() once so the in-memory
//                                    cache is warm before the first user request.
//
// Format: a single gzipped JSON blob at <cwd>/data/products-lite.json.gz.
// Gzip cuts ~7.5MB raw to ~1.2MB on disk and makes the write atomic-friendly.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import type { ProductLite } from "./products-store";

const CACHE_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(CACHE_DIR, "products-lite.json.gz");

interface DiskSnapshot {
  syncedAt: string;
  count: number;
  products: ProductLite[];
}

export function readDiskSnapshot(): DiskSnapshot | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const gz = fs.readFileSync(CACHE_FILE);
    const json = zlib.gunzipSync(gz).toString("utf-8");
    const snap = JSON.parse(json) as DiskSnapshot;
    if (!snap?.products || !Array.isArray(snap.products)) return null;
    return snap;
  } catch (e) {
    // Corrupt file → ignore, fall back to Redis. Don't bubble up.
    console.error("[products-disk-cache] read failed:", e);
    return null;
  }
}

export function writeDiskSnapshot(products: ProductLite[], syncedAt: string): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const payload: DiskSnapshot = { syncedAt, count: products.length, products };
    const gz = zlib.gzipSync(JSON.stringify(payload));
    // Atomic: write to .tmp then rename so a partial write can never be read.
    const tmp = CACHE_FILE + ".tmp";
    fs.writeFileSync(tmp, gz);
    fs.renameSync(tmp, CACHE_FILE);
  } catch (e) {
    // Non-fatal — Redis is the canonical store. Log and move on.
    console.error("[products-disk-cache] write failed:", e);
  }
}
