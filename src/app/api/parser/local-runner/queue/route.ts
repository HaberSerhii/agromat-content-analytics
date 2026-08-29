import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import {
  isLocalRunnerAdapter,
  localRunnerIsOnline,
  makeLocalRunnerJob,
  queueLocalRunnerJob,
  readActiveLocalRunnerJob,
} from "@/lib/parser-jobs/local-runner";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDashboardRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { adapter?: string };
  const adapter = String(body.adapter || "").trim().toLowerCase();
  if (!isLocalRunnerAdapter(adapter)) {
    return NextResponse.json({ ok: false, error: "action_not_allowed" }, { status: 400 });
  }

  if (!await localRunnerIsOnline()) {
    return NextResponse.json({ ok: false, error: "local_runner_offline" }, { status: 503 });
  }

  const active = await readActiveLocalRunnerJob();
  if (active) {
    return NextResponse.json({ ok: false, error: "busy", active_job_id: active.job_id }, { status: 409 });
  }

  const job = makeLocalRunnerJob(adapter);
  await queueLocalRunnerJob(job);
  return NextResponse.json(job);
}
