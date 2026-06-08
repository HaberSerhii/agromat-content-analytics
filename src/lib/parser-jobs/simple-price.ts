import { promises as fs } from "node:fs";
import path from "node:path";

export type SimplePriceAdapter = "plitka" | "leoceramika";
export type SimplePriceAction = `prices-${SimplePriceAdapter}`;
export type LocalSimplePriceJobStatus = "starting" | "running" | "done" | "error";

export interface LocalSimplePriceJob {
  ok: boolean;
  job_id: string;
  action: SimplePriceAction;
  status: LocalSimplePriceJobStatus;
  current: number;
  total: number;
  label?: string;
  started_at: number;
  finished_at: number | null;
  error: string | null;
  result: {
    total?: number;
    found?: number;
    new_finds?: number;
    price_changes?: number;
    errors?: number;
    blocked?: number;
  } | null;
}

const JOB_DIR = path.join(process.cwd(), "data", "parser-jobs");

export const SIMPLE_PRICE_ADAPTERS = new Set<SimplePriceAdapter>(["plitka", "leoceramika"]);

export function isSimplePriceAdapter(adapter: string): adapter is SimplePriceAdapter {
  return SIMPLE_PRICE_ADAPTERS.has(adapter as SimplePriceAdapter);
}

export function makeSimplePriceJobId(adapter: SimplePriceAdapter): string {
  return `${adapter}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function jobFile(jobId: string): string {
  return path.join(JOB_DIR, `${jobId}.json`);
}

function activeFile(adapter: SimplePriceAdapter): string {
  return path.join(JOB_DIR, `${adapter}-active.json`);
}

export function isSimplePriceJobId(jobId: string): boolean {
  return /^(?:plitka|leoceramika)-[a-z0-9-]{8,80}$/i.test(jobId);
}

export async function readSimplePriceJob(jobId: string): Promise<LocalSimplePriceJob | null> {
  if (!isSimplePriceJobId(jobId)) return null;
  try {
    const raw = await fs.readFile(jobFile(jobId), "utf8");
    return JSON.parse(raw) as LocalSimplePriceJob;
  } catch {
    return null;
  }
}

export async function writeSimplePriceJob(job: LocalSimplePriceJob): Promise<void> {
  const adapter = job.action.replace(/^prices-/, "") as SimplePriceAdapter;
  await fs.mkdir(JOB_DIR, { recursive: true });
  await fs.writeFile(jobFile(job.job_id), `${JSON.stringify(job, null, 2)}\n`);
  await fs.writeFile(activeFile(adapter), `${JSON.stringify({ job_id: job.job_id }, null, 2)}\n`);
}

export async function readActiveSimplePriceJob(adapter: SimplePriceAdapter): Promise<LocalSimplePriceJob | null> {
  try {
    const raw = await fs.readFile(activeFile(adapter), "utf8");
    const active = JSON.parse(raw) as { job_id?: string };
    if (!active.job_id) return null;
    return readSimplePriceJob(active.job_id);
  } catch {
    return null;
  }
}

export function isSimplePriceJobInFlight(job: LocalSimplePriceJob | null): boolean {
  return job?.status === "starting" || job?.status === "running";
}

export function newSimplePriceJob(
  adapter: SimplePriceAdapter,
  jobId = makeSimplePriceJobId(adapter),
): LocalSimplePriceJob {
  const label = adapter === "plitka" ? "Plitka.ua" : "LeoCeramika";
  return {
    ok: true,
    job_id: jobId,
    action: `prices-${adapter}`,
    status: "starting",
    current: 0,
    total: 0,
    label: `${label}: підготовка`,
    started_at: Math.floor(Date.now() / 1000),
    finished_at: null,
    error: null,
    result: null,
  };
}
