import { listDailyAvailabilitySnapshots, readDailyAvailabilitySnapshot, writeDailyAvailabilitySnapshot } from "@/lib/product-availability-daily-store";
import { DailyAvailabilityAccumulator } from "@/lib/product-availability-daily";
import { listSnapshotDates, readDailySnapshot, readAllLite, readLiteSyncedAt, readSyncState } from "@/lib/products-store";
import { availabilityDate, summarizeAvailability, type AvailabilityFilter, type AvailabilityReport } from "@/lib/product-availability";
import { readAvailabilitySnapshot, writeAvailabilitySnapshot } from "@/lib/product-availability-store";

let preparationQueue: Promise<void> = Promise.resolve();
async function prepare(months: string[], includeDaily: boolean) {
  // Only one historical snapshot is inflated at a time, and each month is
  // converted once. Subsequent filters read compact persisted cubes only.
  const latest = new Map<string, { date: string; syncedAt: string | null }>();
  const sourceDates = (await listSnapshotDates()).sort((a, b) => a.date.localeCompare(b.date));
  for (const entry of sourceDates) {
    const month = entry.date.slice(0, 7);
    if (months.includes(month)) latest.set(month, entry);
  }
  for (const [month, entry] of latest) {
    const saved = await readAvailabilitySnapshot(month);
    if (saved?.preorderTracked && (!entry.syncedAt || Date.parse(saved.syncedAt) >= Date.parse(entry.syncedAt))) continue;
    const daily = await readDailySnapshot(entry.date, false);
    if (daily?.syncedAt) {
      await writeAvailabilitySnapshot(daily.products, daily.syncedAt);
      if (includeDaily) await writeDailyAvailabilitySnapshot(daily.products, daily.syncedAt);
    }
  }
  if (includeDaily) {
    const compact = new Map((await listDailyAvailabilitySnapshots(months)).map(entry => [entry.date, entry]));
    for (const entry of sourceDates) {
      if (!months.includes(entry.date.slice(0, 7))) continue;
      const saved = compact.get(entry.date);
      if (saved?.syncedAt && (!entry.syncedAt || Date.parse(saved.syncedAt) >= Date.parse(entry.syncedAt))) continue;
      const daily = await readDailySnapshot(entry.date, false);
      if (daily?.syncedAt) await writeDailyAvailabilitySnapshot(daily.products, daily.syncedAt);
    }
  }
  const [syncedAt, sync] = await Promise.all([readLiteSyncedAt(), readSyncState()]);
  if (sync.state === "ok" && !sync.error && sync.startedAt === syncedAt && syncedAt && months.includes(availabilityDate(syncedAt).slice(0, 7))) {
    const saved = await readAvailabilitySnapshot(availabilityDate(syncedAt).slice(0, 7));
    const daily = includeDaily ? (await listDailyAvailabilitySnapshots([availabilityDate(syncedAt).slice(0, 7)])).find(entry => entry.date === availabilityDate(syncedAt)) : null;
    if (!saved?.preorderTracked || Date.parse(saved.syncedAt) < Date.parse(syncedAt) || (includeDaily && daily?.syncedAt !== syncedAt)) {
      const products = await readAllLite();
      // The catalogue and observation timestamp must belong to the same sync.
      if (await readLiteSyncedAt() === syncedAt) {
        await writeAvailabilitySnapshot(products, syncedAt);
        if (includeDaily) await writeDailyAvailabilitySnapshot(products, syncedAt);
      }
    }
  }
}
export async function readAvailabilityReport(months: string[], filter: AvailabilityFilter, includeDaily = false, summarizeDaily = true): Promise<AvailabilityReport> {
  const work = preparationQueue.catch(() => undefined).then(() => prepare(months, includeDaily));
  preparationQueue = work;
  await work;
  const categories = new Map<string, string>(), brands = new Set<string>();
  const result: AvailabilityReport["months"] = [];
  const dailyFiles = includeDaily && summarizeDaily ? await listDailyAvailabilitySnapshots(months) : [];
  const today = availabilityDate(new Date().toISOString());
  for (const month of months) {
    const snapshot = await readAvailabilitySnapshot(month);
    if (snapshot) for (const group of snapshot.groups) { categories.set(group.categoryId, group.category); brands.add(group.brand); }
    let daily;
    if (includeDaily && summarizeDaily) {
      const files = dailyFiles.filter(file => file.date.startsWith(month) && file.date <= today);
      const expectedDays = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
      const { readDashboardReport } = await import("@/lib/dashboard-report-cache");
      const report = await readDashboardReport("availability-daily-report-v1", JSON.stringify({ month, expectedDays, files, filter }), 24 * 60 * 60_000, async () => {
        const accumulator = new DailyAvailabilityAccumulator();
        for (const file of files) {
          const day = await readDailyAvailabilitySnapshot(file.date);
          if (day) accumulator.add(day, filter);
        }
        return accumulator.finish(expectedDays);
      });
      daily = report.value;
    }
    result.push({ ...(daily ? { daily } : {}), month, date: snapshot?.date || null, syncedAt: snapshot?.syncedAt || null, counts: snapshot ? summarizeAvailability(snapshot, filter) : null });
  }
  return { months: result, facets: {
    categories: [...categories].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "uk")),
    brands: [...brands].sort((a, b) => a.localeCompare(b, "uk")),
  } };
}
