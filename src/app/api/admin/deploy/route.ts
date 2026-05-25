import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LOG = process.env.DEPLOY_LOG || "/tmp/agromat-deploy.log";
// process.cwd() is the project root when Next.js runs `npm start` from there.
const SCRIPT = path.join(process.cwd(), "scripts", "deploy.sh");

function authorize(req: Request): boolean {
  const cron = process.env.CRON_SECRET;
  const dash = process.env.NEXT_PUBLIC_DASHBOARD_SECRET;
  const auth = req.headers.get("authorization") || "";
  return Boolean(
    (cron && auth === `Bearer ${cron}`) ||
    (dash && auth === `Bearer ${dash}`),
  );
}

// POST → kick off the deploy script detached. Returns immediately; the script
// survives the pm2 restart that it triggers at the end. Poll GET for status.
export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await fs.access(SCRIPT);
  } catch {
    return NextResponse.json({ error: `Deploy script not found at ${SCRIPT}` }, { status: 500 });
  }
  // setsid + detached + stdio:'ignore' so the child has no pipe to this
  // process. When pm2 kills us at the end of deploy, the child continues.
  const child = spawn("setsid", ["bash", SCRIPT], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, APP_DIR: process.cwd() },
  });
  child.unref();
  return NextResponse.json({ ok: true, started: new Date().toISOString(), pid: child.pid, log: LOG });
}

// GET → return current commit + tail of the deploy log so the caller can see
// progress. Does not block; if no log exists yet, returns empty.
export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let log = "";
  try {
    const buf = await fs.readFile(LOG, "utf8");
    // Cap to last ~16KB so the response stays bounded.
    log = buf.length > 16_000 ? buf.slice(buf.length - 16_000) : buf;
  } catch { /* no log yet */ }
  return NextResponse.json({
    ok: true,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    log,
  });
}
