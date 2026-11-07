import type { AvailabilityFilter } from "./product-availability";
import type { DailyAvailabilitySnapshot } from "./product-availability-daily";

export function availabilityMembers(snapshot: DailyAvailabilitySnapshot, filter: AvailabilityFilter, status: "active" | "inactive") {
  const members = new Map<number, { id: number; category: string; brand: string }>();
  for (const [id, category, brand, state, flags] of snapshot.products) {
    if (filter.categories.length && !filter.categories.includes(snapshot.categories[category][0])) continue;
    if (filter.brands.length && !filter.brands.includes(snapshot.brands[brand][1])) continue;
    if (filter.promotion !== "all" && Boolean(flags & 2) !== (filter.promotion === "promo")) continue;
    if ((state === 5 && !(flags & 1)) !== (status === "active")) continue;
    members.set(id, { id, category: snapshot.categories[category][1], brand: snapshot.brands[brand][1] });
  }
  return members;
}

export function availabilityChanges(current: ReturnType<typeof availabilityMembers>, previous: ReturnType<typeof availabilityMembers>) {
  return {
    added: [...current.values()].filter(product => !previous.has(product.id)),
    removed: [...previous.values()].filter(product => !current.has(product.id)),
  };
}
