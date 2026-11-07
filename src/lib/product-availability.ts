import type { ProductLite } from "./products-store";

export type AvailabilityCounts = { active: number; inactive: number; promoActive: number; promoInactive: number; total: number; promo: number };
export type AvailabilityGroup = { categoryId: string; category: string; brand: string; promotion: boolean; active: number; inactive: number };
export type AvailabilitySnapshot = { version: 1; month: string; date: string; syncedAt: string; groups: AvailabilityGroup[] };
export type AvailabilityFilter = { categories: string[]; brands: string[]; promotion: "all" | "promo" | "regular" };
export type AvailabilityReport = {
  months: Array<{ month: string; date: string | null; syncedAt: string | null; counts: AvailabilityCounts | null; daily?: import("./product-availability-daily").DailyAvailabilitySummary }>;
  facets: { categories: Array<{ id: string; name: string }>; brands: string[] };
};
export function availabilityDate(timestamp: string) {
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("Invalid snapshot timestamp");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}

/** Frozen sparse cube: one SKU per catalogue ID; no full product records or
 * change histories need to stay resident to filter a historical month. */
export function buildAvailabilitySnapshot(products: ProductLite[], syncedAt: string): AvailabilitySnapshot {
  const date = availabilityDate(syncedAt);
  const seen = new Set<number>();
  const groups = new Map<string, AvailabilityGroup>();
  for (const product of products) {
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    const categoryId = String(product.categoryId ?? "unknown");
    const brand = product.brand || "Без бренду";
    const promotion = product.isOnSale === true;
    const key = JSON.stringify([categoryId, brand, promotion]);
    const group = groups.get(key) || { categoryId, category: product.categoryName || "Без категорії", brand, promotion, active: 0, inactive: 0 };
    if (!product.deleted && product.statusId === 5) group.active++;
    else group.inactive++;
    groups.set(key, group);
  }
  return { version: 1, month: date.slice(0, 7), date, syncedAt, groups: [...groups.values()] };
}

export function summarizeAvailability(snapshot: AvailabilitySnapshot, filter: AvailabilityFilter): AvailabilityCounts {
  const categories = new Set(filter.categories), brands = new Set(filter.brands);
  const counts: AvailabilityCounts = { active: 0, inactive: 0, promoActive: 0, promoInactive: 0, total: 0, promo: 0 };
  for (const group of snapshot.groups) {
    if (categories.size && !categories.has(group.categoryId)) continue;
    if (brands.size && !brands.has(group.brand)) continue;
    if (filter.promotion !== "all" && group.promotion !== (filter.promotion === "promo")) continue;
    counts.active += group.active; counts.inactive += group.inactive;
    if (group.promotion) { counts.promoActive += group.active; counts.promoInactive += group.inactive; }
  }
  counts.total = counts.active + counts.inactive;
  counts.promo = counts.promoActive + counts.promoInactive;
  return counts;
}
