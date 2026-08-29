import { NextResponse } from "next/server";
import { hasServerBearer } from "@/lib/dashboard-auth";
import {
  claimPendingLocalRunnerJob,
  finishActiveLocalRunnerJob,
  isLocalRunnerAdapter,
  isLocalRunnerJobId,
  type LocalRunnerJob,
  writeLocalRunnerHeartbeat,
} from "@/lib/parser-jobs/local-runner";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  return hasServerBearer(request, "CRON_SECRET");
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  await writeLocalRunnerHeartbeat();
  const job = await claimPendingLocalRunnerJob();
  return NextResponse.json({ ok: true, job });
}

export async function PUT(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as Partial<LocalRunnerJob>;
  const jobId = String(body.job_id || "");
  const adapter = String(body.adapter || "");
  const status = String(body.status || "");
  if (!isLocalRunnerJobId(jobId) || !isLocalRunnerAdapter(adapter) || !["starting", "running", "blocked", "done", "error"].includes(status)) {
    return NextResponse.json({ ok: false, error: "invalid_job" }, { status: 400 });
  }
  const job: LocalRunnerJob = {
    ok: body.ok !== false,
    job_id: jobId,
    action: `prices-${adapter}`,
    adapter,
    status: status as LocalRunnerJob["status"],
    current: Number(body.current) || 0,
    total: Number(body.total) || 0,
    label: String(body.label || `${adapter}: ${status}`),
    started_at: Number(body.started_at) || Math.floor(Date.now() / 1000),
    finished_at: body.finished_at == null ? null : Number(body.finished_at),
    error: body.error == null ? null : String(body.error),
    result: body.result && typeof body.result === "object" ? body.result as Record<string, unknown> : null,
  };
  await Promise.all([finishActiveLocalRunnerJob(job), writeLocalRunnerHeartbeat()]);
  return NextResponse.json({ ok: true });
}
