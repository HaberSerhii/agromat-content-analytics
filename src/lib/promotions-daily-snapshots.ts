// Disk-backed daily snapshots for the promotions catalog.
//
// Promotion history is intentionally kept on the VPS rather than in Supabase:
// one compressed snapshot is small, reads are local, and a 30-day retention
// window does not consume database storage or query capacity.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { isBundlePromotion, type ApiPromotion } from "@/lib/products-api";

const DEFAULT_PARENT_DIR = process.env.PRODUCT_SNAPSHOTS_DIR
  ? path.dirname(process.env.PRODUCT_SNAPSHOTS_DIR)
  : path.join(process.cwd(), "data");
const SNAPSHOT_DIR = process.env.PROMOTIONS_SNAPSHOT_DIR
  || path.join(DEFAULT_PARENT_DIR, "promotion-snapshots");
const MANIFEST_FILE = path.join(SNAPSHOT_DIR, "manifest.json");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PROMOTIONS_SNAPSHOT_KEEP_DAYS = 30;

export interface PromotionsDailySnapshot {
  date: string;
  capturedAt: string;
  promotions: ApiPromotion[];
}

function appliesOnDate(promotion: ApiPromotion, date: string): boolean {
  if (promotion.is_unlimited) return true;
  return (!promotion.start_date || promotion.start_date <= date)
    && (!promotion.end_date || promotion.end_date >= date);
}

// The upstream endpoint returns more than a thousand legacy promotions. A
// historical day only needs pricing promotions and public/related promotions
// that apply on that day. Do not use the current `active` flag here: P2 turns
// it off after a campaign ends, while the URL relation still belongs to the
// historical period captured by this snapshot.
export function selectPromotionsForDailySnapshot(
  promotions: ApiPromotion[],
  date: string,
): ApiPromotion[] {
  return promotions.filter((promotion) => {
    if (isBundlePromotion(promotion)) return false;
    if (promotion.has_related) return Boolean(promotion.url) && appliesOnDate(promotion, date);
    return appliesOnDate(promotion, date);
  });
}

interface ManifestEntry {
  date: string;
  capturedAt: string;
  promotionCount: number;
  productCount: number;
  sizeBytes: number;
  writtenAt: string;
}

interface Manifest {
  version: 1;
  snapshots: ManifestEntry[];
}

function ensureDir(): void {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function snapshotFile(date: string): string {
  if (!DATE_RE.test(date)) throw new Error(`Invalid promotions snapshot date: ${date}`);
  return path.join(SNAPSHOT_DIR, `${date}.json.gz`);
}

function readManifest(): Manifest {
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf-8")) as Manifest;
    if (parsed?.version !== 1 || !Array.isArray(parsed.snapshots)) {
      return { version: 1, snapshots: [] };
    }
    return {
      version: 1,
      snapshots: parsed.snapshots.filter((entry) => DATE_RE.test(entry.date)),
    };
  } catch {
    return { version: 1, snapshots: [] };
  }
}

function writeManifest(manifest: Manifest): void {
  ensureDir();
  const snapshots = [...manifest.snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const temporary = `${MANIFEST_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, snapshots }, null, 2));
  fs.renameSync(temporary, MANIFEST_FILE);
}

export function writePromotionsDailySnapshot(
  date: string,
  promotions: ApiPromotion[],
  capturedAt: string,
  keep = PROMOTIONS_SNAPSHOT_KEEP_DAYS,
): void {
  ensureDir();
  const payload: PromotionsDailySnapshot = { date, capturedAt, promotions };
  const compressed = zlib.gzipSync(JSON.stringify(payload), { level: 9 });
  const file = snapshotFile(date);
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, compressed);
  fs.renameSync(temporary, file);

  const manifest = readManifest();
  const snapshots = manifest.snapshots.filter((entry) => entry.date !== date);
  snapshots.push({
    date,
    capturedAt,
    promotionCount: promotions.length,
    productCount: promotions.reduce((sum, promotion) => sum + promotion.products.length, 0),
    sizeBytes: compressed.length,
    writtenAt: new Date().toISOString(),
  });
  snapshots.sort((a, b) => a.date.localeCompare(b.date));

  const toDrop = snapshots.slice(0, Math.max(0, snapshots.length - keep));
  for (const entry of toDrop) {
    try {
      fs.unlinkSync(snapshotFile(entry.date));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const dropped = new Set(toDrop.map((entry) => entry.date));
  writeManifest({ version: 1, snapshots: snapshots.filter((entry) => !dropped.has(entry.date)) });
}

export function readPromotionsDailySnapshot(date: string): PromotionsDailySnapshot | null {
  try {
    const compressed = fs.readFileSync(snapshotFile(date));
    const parsed = JSON.parse(zlib.gunzipSync(compressed).toString("utf-8")) as PromotionsDailySnapshot;
    if (!DATE_RE.test(parsed.date) || !Array.isArray(parsed.promotions)) return null;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[promotions-daily-snapshots] read failed:", error);
    }
    return null;
  }
}

export function listPromotionsSnapshotDates(): string[] {
  return readManifest().snapshots
    .filter((entry) => fs.existsSync(snapshotFile(entry.date)))
    .map((entry) => entry.date)
    .sort((a, b) => a.localeCompare(b));
}

export function getPromotionsSnapshotStorageStats() {
  const snapshots = readManifest().snapshots
    .filter((entry) => fs.existsSync(snapshotFile(entry.date)))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    dir: SNAPSHOT_DIR,
    count: snapshots.length,
    totalSizeBytes: snapshots.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    oldestDate: snapshots[0]?.date ?? null,
    newestDate: snapshots[snapshots.length - 1]?.date ?? null,
    snapshots,
  };
}
