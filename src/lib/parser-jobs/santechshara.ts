import { promises as fs } from "node:fs";
import path from "node:path";

export type LocalParserJobStatus = "starting" | "running" | "blocked" | "done" | "error";

export interface LocalParserJob {
  ok: boolean;
  job_id: string;
  action: "prices-santechshara";
  status: LocalParserJobStatus;
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
const ACTIVE_FILE = path.join(JOB_DIR, "santechshara-active.json");

export function makeSantechsharaJobId(): string {
  return `santechshara-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function jobFile(jobId: string): string {
  return path.join(JOB_DIR, `${jobId}.json`);
}

export function isSantechsharaJobId(jobId: string): boolean {
  return /^santechshara-[a-z0-9-]{8,80}$/i.test(jobId);
}

export async function readSantechsharaJob(jobId: string): Promise<LocalParserJob | null> {
  if (!isSantechsharaJobId(jobId)) return null;
  try {
    const raw = await fs.readFile(jobFile(jobId), "utf8");
    return JSON.parse(raw) as LocalParserJob;
  } catch {
    return null;
  }
}

export async function writeSantechsharaJob(job: LocalParserJob): Promise<void> {
  await fs.mkdir(JOB_DIR, { recursive: true });
  await fs.writeFile(jobFile(job.job_id), `${JSON.stringify(job, null, 2)}\n`);
  await fs.writeFile(ACTIVE_FILE, `${JSON.stringify({ job_id: job.job_id }, null, 2)}\n`);
}

export async function readActiveSantechsharaJob(): Promise<LocalParserJob | null> {
  try {
    const raw = await fs.readFile(ACTIVE_FILE, "utf8");
    const active = JSON.parse(raw) as { job_id?: string };
    if (!active.job_id) return null;
    return readSantechsharaJob(active.job_id);
  } catch {
    return null;
  }
}

export function isJobInFlight(job: LocalParserJob | null): boolean {
  return job?.status === "starting" || job?.status === "running";
}

export function newSantechsharaJob(jobId = makeSantechsharaJobId()): LocalParserJob {
  return {
    ok: true,
    job_id: jobId,
    action: "prices-santechshara",
    status: "starting",
    current: 0,
    total: 0,
    label: "Сантехшара: підготовка браузера",
    started_at: Math.floor(Date.now() / 1000),
    finished_at: null,
    error: null,
    result: null,
  };
}
