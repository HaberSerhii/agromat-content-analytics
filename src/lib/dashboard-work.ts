/** Bound independent report builds; raw source readers must not acquire this queue recursively. */
let active = 0, completed = 0, totalMs = 0;
const queue: (() => void)[] = [];
export async function runDashboardWork<T>(load: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>(resolve => queue.push(resolve));
  else active++;
  const start = performance.now();
  try { return await load(); }
  finally {
    completed++; totalMs += performance.now() - start;
    const next = queue.shift();
    if (next) next(); else active--;
  }
}
export const dashboardWorkStats = () => ({ active, queued: queue.length, completed, totalMs });
