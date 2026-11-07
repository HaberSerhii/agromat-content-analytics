import { readAvailabilityReport } from "@/lib/product-availability-report";
import { readAvailabilitySnapshot } from "@/lib/product-availability-store";
import { readDailyAvailabilitySnapshot, listDailyAvailabilitySnapshots } from "@/lib/product-availability-daily-store";
import { readAllLite } from "@/lib/products-store";
import { availabilityDate, type AvailabilityFilter } from "@/lib/product-availability";
import { AvailabilityMovements, priorAvailabilityMonth, type MovementCounts, type MovementMetric, type MovementRow, movementMetrics } from "@/lib/product-availability-movements";

export type MovementMonth = { month: string; date: string | null; counts: MovementCounts | null; days: Array<{ date: string; counts: MovementCounts | null }>; baselineDate: string | null; changes: Record<MovementMetric, { added: number; removed: number }> | null };
export type MovementReport = { months: MovementMonth[]; previous: MovementMonth | null; facets: { categories: Array<{id: string; name: string}>; brands: string[] } };
export async function readMovementReport(months: string[], filter: AvailabilityFilter, query: string, selection?: { metric: MovementMetric; mode: "total" | "added" | "removed" }) {
  const comparison = priorAvailabilityMonth(months[0]);
  const needed = [priorAvailabilityMonth(comparison), comparison, ...months];
  const prepared = await readAvailabilityReport(needed, filter, true, false);
  const catalogue = await readAllLite();
  const words = query.trim().toLocaleLowerCase("uk-UA").split(/\s+/).filter(Boolean);
  const ids = words.length ? new Set(catalogue.filter(product => {
    const text = [product.id, product.code, product.goodsRef, product.sku, product.name, product.brand, product.categoryName].join(" ").toLocaleLowerCase("uk-UA");
    return words.every(word => text.includes(word));
  }).map(product => product.id)) : undefined;
  const files = await listDailyAvailabilitySnapshots(needed);
  const today = availabilityDate(new Date().toISOString());
  const result: MovementMonth[] = [];
  let selectedRows: Array<MovementRow & { change: string }> = [];
  for (const month of [comparison, ...months]) {
    const baselineEntry = await readAvailabilitySnapshot(priorAvailabilityMonth(month));
    const baseline = baselineEntry ? await readDailyAvailabilitySnapshot(baselineEntry.date) : null;
    const exactBaseline = baseline?.syncedAt === baselineEntry?.syncedAt ? baseline : null;
    const accumulator = new AvailabilityMovements(exactBaseline, filter, ids);
    const days: MovementMonth["days"] = [];
    const lastDay = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 0)).getUTCDate();
    let counts: MovementCounts | null = null, date: string | null = null;
    for (let day = 1; day <= lastDay; day++) {
      const key = `${month}-${String(day).padStart(2,"0")}`;
      const file = files.find(file => file.date === key && key <= today);
      const snapshot = file ? await readDailyAvailabilitySnapshot(key) : null;
      const observed = snapshot ? accumulator.add(snapshot) : null;
      days.push({ date: key, counts: observed });
      if (observed) { counts = observed; date = key; }
    }
    const changes = exactBaseline && counts ? Object.fromEntries(movementMetrics.map(metric => [metric, {
      added: accumulator.events[metric].added.length,
      removed: accumulator.events[metric].removed.length,
    }])) as Record<MovementMetric, { added: number; removed: number }> : null;
    result.push({ month, counts, date, days, baselineDate: exactBaseline?.date || null, changes });
    if (selection && month === months.at(-1)) {
      if (!counts || counts[selection.metric] == null || (selection.mode !== "total" && !exactBaseline)) throw new Error("Недостатньо щоденних знімків для цієї вибірки");
      const after = accumulator.members[selection.metric];
      selectedRows = selection.mode === "total" ? [...after.values()].map(row => ({ ...row, change: "" })) : accumulator.events[selection.metric][selection.mode].map(row => ({ ...row, change: selection.mode === "added" ? "+" : "−" }));
    }
  }
  if (selection) {
    const products = new Map(catalogue.map(product => [product.id,product]));
    return { products: selectedRows.map(row => ({...row, name:products.get(row.id)?.name || `Товар #${row.id}`, sku:products.get(row.id)?.sku || "", url:products.get(row.id)?.url || ""})) };
  }
  return { months: result.slice(1), previous: result[0] || null, facets: prepared.facets } satisfies MovementReport;
}
