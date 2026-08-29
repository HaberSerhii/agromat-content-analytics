import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

const ACTIVE_WINDOW_MS = 30 * 60 * 1000;
const SESSION_TTL_SECONDS = 60 * 60;
const INDEX_KEY = "dashboard:active-sessions:v1";

interface DashboardSession {
  id: string;
  device: string;
  ip: string;
  firstSeen: string;
  lastSeen: string;
}

function requestIp(request: Request): string {
  return (request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "невідомо")
    .split(",")[0]
    .trim();
}

function deviceName(userAgent: string): string {
  const os = /iphone|ipad/i.test(userAgent)
    ? "iOS"
    : /android/i.test(userAgent)
      ? "Android"
      : /macintosh|mac os/i.test(userAgent)
        ? "macOS"
        : /windows/i.test(userAgent)
          ? "Windows"
          : /linux/i.test(userAgent)
            ? "Linux"
            : "Невідомий пристрій";
  const browser = /edg\//i.test(userAgent)
    ? "Edge"
    : /chrome\//i.test(userAgent)
      ? "Chrome"
      : /safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)
        ? "Safari"
        : /firefox\//i.test(userAgent)
          ? "Firefox"
          : "Браузер";
  return `${os} · ${browser}`;
}

export async function GET(request: Request) {
  if (!isDashboardRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redis = getRedis();
  const now = Date.now();
  const ip = requestIp(request);
  const userAgent = request.headers.get("user-agent") || "";
  const id = createHash("sha256").update(`${ip}|${userAgent}`).digest("hex").slice(0, 20);
  const key = `dashboard:session:${id}`;
  let previous: DashboardSession | null = null;
  try {
    const raw = await redis.get(key);
    previous = raw ? JSON.parse(raw) as DashboardSession : null;
  } catch {
    previous = null;
  }
  const session: DashboardSession = {
    id,
    device: deviceName(userAgent),
    ip,
    firstSeen: previous?.firstSeen || new Date(now).toISOString(),
    lastSeen: new Date(now).toISOString(),
  };
  await Promise.all([
    redis.set(key, JSON.stringify(session), { ex: SESSION_TTL_SECONDS }),
    redis.zadd(INDEX_KEY, { score: now, member: key }),
    redis.zremrangebyscore(INDEX_KEY, 0, now - ACTIVE_WINDOW_MS),
  ]);

  const keys = await redis.zrange(INDEX_KEY, now - ACTIVE_WINDOW_MS, now, { byScore: true, rev: true });
  const pipeline = redis.pipeline();
  keys.forEach((sessionKey) => pipeline.get(sessionKey));
  const rows = keys.length ? await pipeline.exec() : [];
  const sessions = rows.flatMap((raw) => {
    try {
      return raw ? [JSON.parse(String(raw)) as DashboardSession] : [];
    } catch {
      return [];
    }
  });
  return NextResponse.json({ activeWindowMinutes: 30, sessions });
}
