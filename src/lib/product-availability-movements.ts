import type { DailyAvailabilitySnapshot } from "./product-availability-daily";
import type { AvailabilityFilter } from "./product-availability";

export type MovementMetric = "active" | "inactive" | "promoActive" | "promoInactive";
export const movementMetrics: MovementMetric[] = ["active", "inactive", "promoActive", "promoInactive"];
export type MovementCounts = Record<MovementMetric, number | null>;
export type MovementRow = { id: number; category: string; brand: string };
export function movementMembers(snapshot: DailyAvailabilitySnapshot, filter: AvailabilityFilter, ids?: Set<number>) {
  const all = new Map<number, { row: MovementRow; active: boolean; promo: boolean; matches: boolean }>();
  for (const [id, category, brand, status, flags] of snapshot.products) {
    all.set(id, { row: { id, category: snapshot.categories[category][1], brand: snapshot.brands[brand][1] }, active: status === 5 && !(flags & 1), promo: Boolean(flags & 2), matches:
      (!ids || ids.has(id)) && (!filter.categories.length || filter.categories.includes(snapshot.categories[category][0])) && (!filter.brands.length || filter.brands.includes(snapshot.brands[brand][1])) && (filter.promotion === "all" || Boolean(flags & 2) === (filter.promotion === "promo")) });
  }
  return all;
}
/** Monthly disabled cohort resets at the boundary. Missing SKU observations are not status changes. */
export class AvailabilityMovements {
  private previous: ReturnType<typeof movementMembers>;
  private disabled = new Set<number>();
  private hasBaseline: boolean;
  events = { active: { added: [] as MovementRow[], removed: [] as MovementRow[] }, promoActive: { added: [] as MovementRow[], removed: [] as MovementRow[] }, inactive: { added: [] as MovementRow[], removed: [] as MovementRow[] }, promoInactive: { added: [] as MovementRow[], removed: [] as MovementRow[] } };
  members: Record<MovementMetric, Map<number, MovementRow>> = { active: new Map(), inactive: new Map(), promoActive: new Map(), promoInactive: new Map() };
  private filter: AvailabilityFilter;
  private ids?: Set<number>;
  constructor(baseline: DailyAvailabilitySnapshot | null, filter: AvailabilityFilter, ids?: Set<number>) {
    this.filter = filter; this.ids = ids;
    this.previous = baseline ? movementMembers(baseline, filter, ids) : new Map();
    this.hasBaseline = Boolean(baseline);
  }
  add(snapshot: DailyAvailabilitySnapshot): MovementCounts {
    const current = movementMembers(snapshot, this.filter, this.ids);
    this.members = { active: new Map(), inactive: new Map(), promoActive: new Map(), promoInactive: new Map() };
    for (const [id, state] of current) {
      const wasActive = this.previous.get(id)?.active;
      if (state.matches && state.active && !wasActive) {
        this.events.active.added.push(state.row);
        if (state.promo) this.events.promoActive.added.push(state.row);
      }
      if (state.matches && !state.active && wasActive) {
        this.events.active.removed.push(state.row);
        if (state.promo) this.events.promoActive.removed.push(state.row);
      }
      const disabledBefore = this.disabled.has(id);
      if (state.active && disabledBefore && state.matches) {
        this.events.inactive.removed.push(state.row);
        if (state.promo) this.events.promoInactive.removed.push(state.row);
      }
      if (!state.active && this.previous.get(id)?.active && state.matches) {
        this.events.inactive.added.push(state.row);
        if (state.promo) this.events.promoInactive.added.push(state.row);
      }
      if (state.active) this.disabled.delete(id);
      else if (this.previous.get(id)?.active) this.disabled.add(id);
      if (!state.matches) continue;
      if (state.active) { this.members.active.set(id, state.row); if (state.promo) this.members.promoActive.set(id, state.row); }
      else if (this.disabled.has(id)) { this.members.inactive.set(id, state.row); if (state.promo) this.members.promoInactive.set(id, state.row); }
    }
    // Preserve the last observed status across missing observations.
    for (const [id, state] of current) this.previous.set(id, state);
    return { active: this.members.active.size, inactive: this.hasBaseline ? this.members.inactive.size : null, promoActive: this.members.promoActive.size, promoInactive: this.hasBaseline ? this.members.promoInactive.size : null };
  }
}
export function priorAvailabilityMonth(month: string) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
}
