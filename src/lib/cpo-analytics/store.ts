import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { CpoAnalyticsCube, CpoDiagnosticResult, CpoPeriodKind } from "./types";

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

async function atomicGzipWrite(file: string, value: unknown): Promise<number> {
  const compressed = await gzip(JSON.stringify(value), { level: 6 });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, compressed, { mode: 0o600 });
  await fs.rename(temporary, file);
  return compressed.byteLength;
}

export async function readCpoCube(): Promise<{ cube: CpoAnalyticsCube; compressedBytes: number } | null> {
  try {
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

