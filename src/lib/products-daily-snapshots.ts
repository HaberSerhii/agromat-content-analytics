// Disk-backed daily snapshots for the "state as of day X" picker.
//
// These snapshots are intentionally stored outside Redis: 30 days × 20-30MB/day
// fits comfortably on VPS disk, but would waste Redis RAM. Each snapshot is a
// gzipped JSON blob plus a small manifest used to list dates without inflating
// every file.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import type { ProductLite } from "./products-store";

const DEFAULT_SNAPSHOT_DIR = path.join(process.cwd(), "data", "product-snapshots");
const SNAPSHOT_DIR = process.env.PRODUCT_SNAPSHOTS_DIR || DEFAULT_SNAPSHOT_DIR;
const MANIFEST_FILE = path.join(SNAPSHOT_DIR, "manifest.json");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface DailySnapshotPayload {
  date: string;
  syncedAt: string;
  count: number;
  products: ProductLite[];
}

interface ManifestEntry {
  date: string;
  syncedAt: string | null;
  count: number;
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
  if (!DATE_RE.test(date)) throw new Error(`Invalid snapshot date: ${date}`);
  return path.join(SNAPSHOT_DIR, `${date}.json.gz`);
}

function readManifest(): Manifest {
  try {
    const raw = fs.readFileSync(MANIFEST_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Manifest;
    if (parsed?.version !== 1 || !Array.isArray(parsed.snapshots)) {
      return { version: 1, snapshots: [] };
    }
    return {
      version: 1,
      snapshots: parsed.snapshots.filter((s) => DATE_RE.test(s.date)),
    };
  } catch {
    return { version: 1, snapshots: [] };
  }
}

function writeManifest(manifest: Manifest): void {
  ensureDir();
  const sorted = [...manifest.snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const body = JSON.stringify({ version: 1, snapshots: sorted }, null, 2);
  const tmp = MANIFEST_FILE + ".tmp";
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, MANIFEST_FILE);
}

function deleteSnapshotFile(date: string): void {
  try {
    fs.unlinkSync(snapshotFile(date));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export function pruneDailySnapshotsOnDisk(keep: number): number {
  ensureDir();
  const manifest = readManifest();
  const existing = manifest.snapshots.filter((s) => fs.existsSync(snapshotFile(s.date)));
  const toDrop = existing.slice(0, Math.max(0, existing.length - keep));
  for (const entry of toDrop) deleteSnapshotFile(entry.date);

  const dropped = new Set(toDrop.map((s) => s.date));
  const kept = existing.filter((s) => !dropped.has(s.date));
  writeManifest({ version: 1, snapshots: kept });
  return toDrop.length;
}

export function writeDailySnapshotToDisk(date: string, products: ProductLite[], syncedAt: string, keep: number): void {
  ensureDir();
  const payload: DailySnapshotPayload = { date, syncedAt, count: products.length, products };
  const gz = zlib.gzipSync(JSON.stringify(payload), { level: 9 });
  const file = snapshotFile(date);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, gz);
  fs.renameSync(tmp, file);

  const stat = fs.statSync(file);
  const manifest = readManifest();
  const snapshots = manifest.snapshots.filter((s) => s.date !== date);
  snapshots.push({
    date,
    syncedAt,
    count: products.length,
    sizeBytes: stat.size,
    writtenAt: new Date().toISOString(),
  });
  writeManifest({ version: 1, snapshots });
  pruneDailySnapshotsOnDisk(keep);
}

export function readDailySnapshotFromDisk(date: string): { products: ProductLite[]; syncedAt: string | null } | null {
  try {
    const gz = fs.readFileSync(snapshotFile(date));
    const json = zlib.gunzipSync(gz).toString("utf-8");
    const snap = JSON.parse(json) as DailySnapshotPayload;
    if (!Array.isArray(snap.products)) return null;
    return { products: snap.products, syncedAt: snap.syncedAt ?? null };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[products-daily-snapshots] read failed:", e);
    }
    return null;
  }
}

export function listDailySnapshotsOnDisk(): { date: string; syncedAt: string | null }[] {
  const manifest = readManifest();
  return manifest.snapshots
    .filter((s) => fs.existsSync(snapshotFile(s.date)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((s) => ({ date: s.date, syncedAt: s.syncedAt }));
}

export interface DailySnapshotStorageStats {
  dir: string;
  count: number;
  totalSizeBytes: number;
  oldestDate: string | null;
  newestDate: string | null;
  snapshots: ManifestEntry[];
}

export function getDailySnapshotStorageStats(): DailySnapshotStorageStats {
  const manifest = readManifest();
  const snapshots = manifest.snapshots
    .filter((s) => fs.existsSync(snapshotFile(s.date)))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    dir: SNAPSHOT_DIR,
    count: snapshots.length,
    totalSizeBytes: snapshots.reduce((sum, s) => sum + s.sizeBytes, 0),
    oldestDate: snapshots[0]?.date ?? null,
    newestDate: snapshots[snapshots.length - 1]?.date ?? null,
    snapshots,
  };
}
