import { dashboardWorkStats } from "@/lib/dashboard-work";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { serverResultCacheStats } from "@/lib/server-result-cache";
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();
export function dashboardPerformance() {
  return { allocator: process.env.LD_PRELOAD?.includes("jemalloc") ? "jemalloc" : "system", revision: process.env.VERCEL_GIT_COMMIT_SHA || null, sampledAt: new Date().toISOString(), uptimeSeconds: process.uptime(), memory: process.memoryUsage(),
    eventLoop: { meanMs: Number.isFinite(lag.mean) ? lag.mean / 1e6 : 0, p95Ms: lag.percentile(95) / 1e6, maxMs: lag.max / 1e6 },
    work: dashboardWorkStats(), resultCache: serverResultCacheStats() };
}
