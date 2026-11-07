import { listSnapshotDates, readDailySnapshot, readAllLite, readLiteSyncedAt, readSyncState } from "@/lib/products-store";
import { availabilityDate, summarizeAvailability, type AvailabilityFilter, type AvailabilityReport } from "@/lib/product-availability";
import { readAvailabilitySnapshot, writeAvailabilitySnapshot } from "@/lib/product-availability-store";

let preparationQueue: Promise<void> = Promise.resolve();
async function prepare(months: string[]) {
  // Only one historical snapshot is inflated at a time, and each month is
  // converted once. Subsequent filters read compact persisted cubes only.
  const latest = new Map<string, { date: string; syncedAt: string | null }>();
  for (const entry of (await listSnapshotDates()).sort((a, b) => a.date.localeCompare(b.date))) {
    const month = entry.date.slice(0, 7);
    if (months.includes(month)) latest.set(month, entry);
  }
  for (const [month, entry] of latest) {
    const saved = await readAvailabilitySnapshot(month);
    if (saved && (!entry.syncedAt || Date.parse(saved.syncedAt) >= Date.parse(entry.syncedAt))) continue;
    const daily = await readDailySnapshot(entry.date, false);
    if (daily?.syncedAt) await writeAvailabilitySnapshot(daily.products, daily.syncedAt);
  }
  const [syncedAt, sync] = await Promise.all([readLiteSyncedAt(), readSyncState()]);
  if (sync.state === "ok" && !sync.error && sync.startedAt === syncedAt && syncedAt && months.includes(availabilityDate(syncedAt).slice(0, 7))) {
    const saved = await readAvailabilitySnapshot(availabilityDate(syncedAt).slice(0, 7));
    if (!saved || Date.parse(saved.syncedAt) < Date.parse(syncedAt)) {
      const products = await readAllLite();
      // The catalogue and observation timestamp must belong to the same sync.
      if (await readLiteSyncedAt() === syncedAt) await writeAvailabilitySnapshot(products, syncedAt);
    }
  }
}
export async function readAvailabilityReport(months: string[], filter: AvailabilityFilter): Promise<AvailabilityReport> {
  const work = preparationQueue.catch(() => undefined).then(() => prepare(months));
  preparationQueue = work;
  await work;
  const categories = new Map<string, string>(), brands = new Set<string>();
  const result: AvailabilityReport["months"] = [];
  for (const month of months) {
    const snapshot = await readAvailabilitySnapshot(month);
    if (snapshot) for (const group of snapshot.groups) { categories.set(group.categoryId, group.category); brands.add(group.brand); }
    result.push({ month, date: snapshot?.date || null, syncedAt: snapshot?.syncedAt || null, counts: snapshot ? summarizeAvailability(snapshot, filter) : null });
  }
  return { months: result, facets: {
    categories: [...categories].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "uk")),
    brands: [...brands].sort((a, b) => a.localeCompare(b, "uk")),
  } };
}
