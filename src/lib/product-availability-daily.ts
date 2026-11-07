import type { ProductLite } from "./products-store";
import { availabilityDate, type AvailabilityFilter } from "@/lib/product-availability";

/** Dictionaries preserve the labels and IDs observed on that day. Flags:
 * bit 0 = archived; bit 1 = promotional. No full product cards are retained. */
export type DailyAvailabilitySnapshot = {
  version: 1; date: string; syncedAt: string;
  categories: Array<[string, string]>; brands: Array<[string, string]>;
  products: Array<[number, number, number, number, number]>;
};
export type DailyAvailabilitySummary = {
  observedDays: number; expectedDays: number; firstDate: string | null; lastDate: string | null;
  totalSku: number; alwaysActive: number; alwaysInactive: number; mixed: number;
  activeSkuDays: number; inactiveSkuDays: number;
  averageActive: number | null; averageInactive: number | null; activeShare: number | null;
};
export function buildDailyAvailabilitySnapshot(products: ProductLite[], syncedAt: string): DailyAvailabilitySnapshot {
  const snapshot: DailyAvailabilitySnapshot = { version: 1, date: availabilityDate(syncedAt), syncedAt, categories: [], brands: [], products: [] };
  const categories = new Map<string, number>(), brands = new Map<string, number>(), seen = new Set<number>();
  for (const product of products) {
    if (seen.has(product.id)) continue; seen.add(product.id);
    const category: [string, string] = [String(product.categoryId ?? "unknown"), product.categoryName || "Без категорії"];
    const brand: [string, string] = [String(product.brandId ?? `name:${product.brand || "Без бренду"}`), product.brand || "Без бренду"];
    function index(map: Map<string, number>, values: Array<[string, string]>, value: [string, string]) {
      const key = JSON.stringify(value); let found = map.get(key);
      if (found === undefined) { found = values.length; map.set(key, found); values.push(value); }
      return found;
    }
    snapshot.products.push([product.id, index(categories, snapshot.categories, category), index(brands, snapshot.brands, brand), product.statusId, (product.deleted ? 1 : 0) | (product.isOnSale ? 2 : 0)]);
  }
  return snapshot;
}

/** Counts observations, never fills unobserved days with an invented status. */
export class DailyAvailabilityAccumulator {
  private states = new Map<number, { active: number; inactive: number }>();
  private dates = new Set<string>();
  private activeDays = 0;
  private inactiveDays = 0;
  add(snapshot: DailyAvailabilitySnapshot, filter: AvailabilityFilter) {
    if (this.dates.has(snapshot.date)) return;
    this.dates.add(snapshot.date);
    const categories = new Set(filter.categories), brands = new Set(filter.brands);
    for (const [id, category, brand, status, flags] of snapshot.products) {
      if (categories.size && !categories.has(snapshot.categories[category][0])) continue;
      if (brands.size && !brands.has(snapshot.brands[brand][1])) continue;
      if (filter.promotion !== "all" && Boolean(flags & 2) !== (filter.promotion === "promo")) continue;
      const state = this.states.get(id) || { active: 0, inactive: 0 };
      if (status === 5 && !(flags & 1)) { state.active++; this.activeDays++; }
      else { state.inactive++; this.inactiveDays++; }
      this.states.set(id, state);
    }
  }
  finish(expectedDays: number): DailyAvailabilitySummary {
    const dates = [...this.dates].sort();
    let alwaysActive = 0, alwaysInactive = 0, mixed = 0;
    for (const state of this.states.values()) {
      if (state.active && state.inactive) mixed++;
      else if (state.active) alwaysActive++;
      else alwaysInactive++;
    }
    return { observedDays: dates.length, expectedDays, firstDate: dates[0] || null, lastDate: dates.at(-1) || null,
      totalSku: this.states.size, alwaysActive, alwaysInactive, mixed, activeSkuDays: this.activeDays, inactiveSkuDays: this.inactiveDays,
      averageActive: dates.length ? this.activeDays / dates.length : null,
      averageInactive: dates.length ? this.inactiveDays / dates.length : null,
      activeShare: this.activeDays + this.inactiveDays ? this.activeDays / (this.activeDays + this.inactiveDays) * 100 : null };
  }
}
