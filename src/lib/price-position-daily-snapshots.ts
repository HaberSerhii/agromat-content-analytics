import fs from "fs";
import path from "path";
import zlib from "zlib";
import type { DailyPricePositionGroups } from "@/lib/promotion-price-position";

const SNAPSHOT_DIR = process.env.PRICE_POSITION_SNAPSHOT_DIR
  || path.join(process.cwd(), "data", "price-position-snapshots");
const MANIFEST_FILE = path.join(SNAPSHOT_DIR, "manifest.json");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PRICE_POSITION_SNAPSHOT_KEEP_DAYS = 365;

export type PricePositionDailySnapshot = DailyPricePositionGroups & {
  capturedAt: string;
};

type ManifestEntry = {
  date: string;
  capturedAt: string;
  betterCount: number;
  worseCount: number;
  sizeBytes: number;
};

type Manifest = { version: 1; snapshots: ManifestEntry[] };

function ensureDir() {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function snapshotFile(date: string) {
  if (!DATE_RE.test(date)) throw new Error(`Invalid price-position snapshot date: ${date}`);
  return path.join(SNAPSHOT_DIR, `${date}.json.gz`);
}

function readManifest(): Manifest {
  try {
    const value = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8")) as Manifest;
    return value?.version === 1 && Array.isArray(value.snapshots)
      ? { version: 1, snapshots: value.snapshots.filter((item) => DATE_RE.test(item.date)) }
      : { version: 1, snapshots: [] };
  } catch {
    return { version: 1, snapshots: [] };
  }
}

function writeManifest(value: Manifest) {
  ensureDir();
  const temporary = `${MANIFEST_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, MANIFEST_FILE);
}

export function writePricePositionDailySnapshot(
  groups: DailyPricePositionGroups,
  capturedAt = new Date().toISOString(),
  keepDays = PRICE_POSITION_SNAPSHOT_KEEP_DAYS,
) {
  ensureDir();
  const snapshot: PricePositionDailySnapshot = { ...groups, capturedAt };
  const compressed = zlib.gzipSync(JSON.stringify(snapshot), { level: 9 });
  const temporary = `${snapshotFile(groups.snapshotDate)}.tmp`;
  fs.writeFileSync(temporary, compressed);
  fs.renameSync(temporary, snapshotFile(groups.snapshotDate));

  const entries = readManifest().snapshots.filter((item) => item.date !== groups.snapshotDate);
  entries.push({
    date: groups.snapshotDate,
    capturedAt,
    betterCount: groups.betterCodes.length,
    worseCount: groups.worseCodes.length,
    sizeBytes: compressed.length,
  });
  entries.sort((left, right) => left.date.localeCompare(right.date));
  const dropped = entries.slice(0, Math.max(0, entries.length - keepDays));
  for (const entry of dropped) {
    try { fs.unlinkSync(snapshotFile(entry.date)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const droppedDates = new Set(dropped.map((entry) => entry.date));
  writeManifest({ version: 1, snapshots: entries.filter((entry) => !droppedDates.has(entry.date)) });
  return snapshot;
}

export function readPricePositionDailySnapshot(date: string): PricePositionDailySnapshot | null {
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(snapshotFile(date))).toString("utf8")) as PricePositionDailySnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("[price-position-snapshots] read failed", error);
    return null;
  }
}

export function getPricePositionSnapshotStorageStats() {
  const snapshots = readManifest().snapshots.filter((item) => fs.existsSync(snapshotFile(item.date)));
  return {
    dir: SNAPSHOT_DIR,
    count: snapshots.length,
    totalSizeBytes: snapshots.reduce((sum, item) => sum + item.sizeBytes, 0),
    oldestDate: snapshots[0]?.date ?? null,
    newestDate: snapshots.at(-1)?.date ?? null,
    snapshots,
  };
}
