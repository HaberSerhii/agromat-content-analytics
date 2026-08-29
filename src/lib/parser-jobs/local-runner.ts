import { getRedis } from "@/lib/redis";

export const LOCAL_RUNNER_ADAPTERS = ["santechshara", "vannaja"] as const;
export type LocalRunnerAdapter = typeof LOCAL_RUNNER_ADAPTERS[number];

export interface LocalRunnerJob {
  ok: boolean;
  job_id: string;
  action: string;
  adapter: LocalRunnerAdapter;
  status: "starting" | "running" | "blocked" | "done" | "error";
  current: number;
  total: number;
  label: string;
  started_at: number;
  finished_at: number | null;
  error: string | null;
  result: Record<string, unknown> | null;
}

const PENDING_KEY = "dashboard:local-parser:pending:v1";
const ACTIVE_KEY = "dashboard:local-parser:active:v1";
const HEARTBEAT_KEY = "dashboard:local-parser:heartbeat:v1";
const JOB_TTL_SECONDS = 24 * 60 * 60;

export function isLocalRunnerAdapter(value: string): value is LocalRunnerAdapter {
  return LOCAL_RUNNER_ADAPTERS.includes(value as LocalRunnerAdapter);
}

export function isLocalRunnerJobId(value: string): boolean {
  return /^local-(?:santechshara|vannaja)-[a-z0-9]+$/i.test(value);
}

export function makeLocalRunnerJob(adapter: LocalRunnerAdapter): LocalRunnerJob {
  const now = Date.now();
  return {
    ok: true,
    job_id: `local-${adapter}-${now.toString(36)}`,
    action: `prices-${adapter}`,
    adapter,
    status: "starting",
    current: 0,
    total: 0,
    label: `${adapter === "vannaja" ? "Vannaja" : "Santechshara"}: очікування локального runner`,
    started_at: Math.floor(now / 1000),
    finished_at: null,
    error: null,
    result: null,
  };
}

function jobKey(jobId: string): string {
  return `dashboard:local-parser:job:${jobId}`;
}

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await getRedis().get(key);
  if (!raw) return null;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

export async function readLocalRunnerJob(jobId: string): Promise<LocalRunnerJob | null> {
  if (!isLocalRunnerJobId(jobId)) return null;
  return readJson<LocalRunnerJob>(jobKey(jobId));
}

export async function writeLocalRunnerJob(job: LocalRunnerJob): Promise<void> {
  await getRedis().set(jobKey(job.job_id), JSON.stringify(job), { ex: JOB_TTL_SECONDS });
}

export async function queueLocalRunnerJob(job: LocalRunnerJob): Promise<void> {
  const redis = getRedis();
  await Promise.all([
    redis.set(PENDING_KEY, JSON.stringify(job), { ex: 60 * 60 }),
    writeLocalRunnerJob(job),
  ]);
}

export async function claimPendingLocalRunnerJob(): Promise<LocalRunnerJob | null> {
  const redis = getRedis();
  const pending = await readJson<LocalRunnerJob>(PENDING_KEY);
  if (!pending) return null;
  await redis.del(PENDING_KEY);
  const claimed: LocalRunnerJob = {
    ...pending,
    status: "starting",
    label: `${pending.adapter === "vannaja" ? "Vannaja" : "Santechshara"}: локальний runner прийняв команду`,
  };
  await Promise.all([
    writeLocalRunnerJob(claimed),
    redis.set(ACTIVE_KEY, claimed.job_id, { ex: JOB_TTL_SECONDS }),
  ]);
  return claimed;
}

export async function readActiveLocalRunnerJob(): Promise<LocalRunnerJob | null> {
  const activeJobId = await getRedis().get(ACTIVE_KEY);
  if (!activeJobId) return null;
  const job = await readLocalRunnerJob(String(activeJobId));
  if (!job || ["done", "error", "blocked"].includes(job.status)) {
    await getRedis().del(ACTIVE_KEY);
    return null;
  }
  return job;
}

export async function finishActiveLocalRunnerJob(job: LocalRunnerJob): Promise<void> {
  const redis = getRedis();
  await writeLocalRunnerJob(job);
  if (["done", "error", "blocked"].includes(job.status)) {
    const activeJobId = await redis.get(ACTIVE_KEY);
    if (String(activeJobId || "") === job.job_id) await redis.del(ACTIVE_KEY);
  }
}

export async function writeLocalRunnerHeartbeat(): Promise<void> {
  await getRedis().set(HEARTBEAT_KEY, String(Date.now()), { ex: 30 });
}

export async function localRunnerIsOnline(): Promise<boolean> {
  const raw = await getRedis().get(HEARTBEAT_KEY);
  const timestamp = Number(raw);
  return Number.isFinite(timestamp) && Date.now() - timestamp < 15_000;
}
