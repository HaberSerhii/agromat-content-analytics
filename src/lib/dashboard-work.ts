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

export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, load: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await load(items[index]);
    }
  }));
  return result;
}
