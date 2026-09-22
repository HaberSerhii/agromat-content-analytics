import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { CpoAnalyticsCube, CpoDiagnosticResult, CpoPeriodAvailability, CpoPeriodKind } from "./types";
import { availableCpoPeriods, cpoPeriodRanges } from "@/lib/cpo-analytics/periods";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

function root(): string {
  if (process.env.CPO_ANALYTICS_DIR) return process.env.CPO_ANALYTICS_DIR;
  if (process.env.BIGQUERY_AUDIT_DIR) return path.join(path.dirname(process.env.BIGQUERY_AUDIT_DIR), "cpo-analytics");
  if (process.env.PRODUCT_SNAPSHOTS_DIR) return path.join(path.dirname(process.env.PRODUCT_SNAPSHOTS_DIR), "cpo-analytics");
  return path.join(process.cwd(), "data", "cpo-analytics");
}

export function cpoCubeFile(): string {
  return path.join(root(), "ukraine-cpo-cube-v1.json.gz");
}

export async function cpoImportProgress(): Promise<number | null> {
  try {
    const state = JSON.parse(await fs.readFile(path.join(root(), 'recovery-progress.json'), 'utf8'));
    return typeof state.rows === 'number' ? state.rows : null;
  } catch { return null; }
}

// Read only the manifest for partitioned snapshots; opening the selector must
// not decompress all the period chunks or submit a BigQuery job.
export async function readCpoAvailability(): Promise<CpoPeriodAvailability | null> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root(), "partition-manifest.json"), "utf8")) as Omit<CpoAnalyticsCube, "rows"> & { partitions: Record<string, string[]> };
    if (manifest.version !== 1 || manifest.countryFilter !== "Ukraine") return null;
    return availableCpoPeriods(manifest, Object.keys(manifest.partitions).filter((key) => manifest.partitions[key].length > 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const stored = await readCpoCube();
  if (!stored) return null;
  const keys = stored.cube.rows.filter((row) => row.dimension === "overall" && row.sessions > 0)
    .map((row) => `${row.periodKind}-${row.periodYear}-${row.periodNumber}`);
  return availableCpoPeriods(stored.cube, keys);
}

async function atomicGzipWrite(file: string, value: unknown): Promise<number> {
  const compressed = await gzip(JSON.stringify(value), { level: 6 });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, compressed, { mode: 0o600 });
  await fs.rename(temporary, file);
  return compressed.byteLength;
}

export async function readCpoCube(selection?: { kind: CpoPeriodKind; period: number; year: number }): Promise<{ cube: CpoAnalyticsCube; compressedBytes: number } | null> {
  try {
    if (selection) {
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(root(), 'partition-manifest.json'), 'utf8')) as Omit<CpoAnalyticsCube, 'rows'> & { partitions: Record<string, string[]> };
        if (manifest.version !== 1 || manifest.countryFilter !== 'Ukraine') throw new Error('Invalid CPO manifest');
        const rows: CpoAnalyticsCube['rows'] = [];
        let compressedBytes = 0;
        for (const range of cpoPeriodRanges(selection.kind, selection.period, selection.year)) {
          for (const file of manifest.partitions[`${selection.kind}-${range.year}-${range.number}`] || []) {
            if (path.basename(file) !== file) throw new Error('Invalid partition filename');
            const raw = await fs.readFile(path.join(root(), file));
            compressedBytes += raw.length;
            const page = JSON.parse((await gunzip(raw)).toString('utf8')) as CpoAnalyticsCube['rows'];
            for (const row of page) rows.push(row);
          }
        }
        return { cube: { ...manifest, rows }, compressedBytes };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const file = cpoCubeFile();
    const [raw, stat] = await Promise.all([gunzip(await fs.readFile(file)), fs.stat(file)]);
    const cube = JSON.parse(raw.toString("utf8")) as CpoAnalyticsCube;
    if (cube.version !== 1 || cube.countryFilter !== "Ukraine" || !Array.isArray(cube.rows)) return null;
    return { cube, compressedBytes: stat.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("[cpo-analytics] cube read failed", error);
    return null;
  }
}

export async function saveCpoCube(cube: CpoAnalyticsCube): Promise<number> {
  return atomicGzipWrite(cpoCubeFile(), cube);
}

function safeSnapshotPart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 100);
}

export async function saveDiagnosticSnapshot(
  result: CpoDiagnosticResult,
  kind: CpoPeriodKind,
  period: number,
  year: number,
): Promise<string> {
  const sourceVersion = safeSnapshotPart(result.sourceCubeSavedAt);
  const file = path.join(root(), "diagnostics", String(year), `${kind}-${String(period).padStart(2, "0")}-${sourceVersion}.json.gz`);
  try {
    await fs.access(file);
  } catch {
    await atomicGzipWrite(file, result);
  }
  return file;
}
