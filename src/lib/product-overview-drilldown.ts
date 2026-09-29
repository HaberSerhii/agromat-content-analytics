import type { ProductLite } from "./products-store";

export type OverviewMetric = "newProducts" | "inactiveProducts" | "promoProducts" | "ctr";
export type OverviewSegment = "tile" | "sanitary";
export type OverviewScope = "current" | "changes" | "added" | "removed";
export type OverviewSelection = {
  metric: OverviewMetric;
  segment: OverviewSegment;
  scope: OverviewScope;
};
export type OverviewCohort = {
  current: ProductLite[];
  added: ProductLite[];
  removed: ProductLite[];
};
export type OverviewCohorts = Record<OverviewSegment, OverviewCohort>;

export function normalizeOverviewSelection(value: unknown): OverviewSelection | null {
  if (!value || typeof value !== "object") return null;
  const { metric, segment, scope } = value as OverviewSelection;
  if (!["newProducts", "inactiveProducts", "promoProducts", "ctr"].includes(metric) ||
      !["tile", "sanitary"].includes(segment) ||
      !["current", "changes", "added", "removed"].includes(scope)) return null;
  return { metric, segment, scope };
}

export function segmentOf(product: Pick<ProductLite, "categoryName" | "categoryPath">): OverviewSegment {
  return /плит|керам|кл[іи]нкер|моза|tile|gres/i.test(`${product.categoryName} ${product.categoryPath}`)
    ? "tile" : "sanitary";
}

// Counts and drilldowns share the same deduplicated cohorts, including segment moves.
export function buildOverviewCohorts(current: ProductLite[], previous: ProductLite[]): OverviewCohorts {
  const unique = (products: ProductLite[], segment: OverviewSegment) =>
    new Map(products.filter((product) => segmentOf(product) === segment).map((product) => [product.id, product]));
  const cohort = (segment: OverviewSegment): OverviewCohort => {
    const now = unique(current, segment);
    const before = unique(previous, segment);
    return {
      current: [...now.values()],
      added: [...now.values()].filter((product) => !before.has(product.id)),
      removed: [...before.values()].filter((product) => !now.has(product.id)),
    };
  };
  return { tile: cohort("tile"), sanitary: cohort("sanitary") };
}

export function overviewMetric(cohorts: OverviewCohorts) {
  return {
    tile: cohorts.tile.current.length,
    sanitary: cohorts.sanitary.current.length,
    deltaTile: cohorts.tile.added.length - cohorts.tile.removed.length,
    deltaSanitary: cohorts.sanitary.added.length - cohorts.sanitary.removed.length,
  };
}

export function selectOverviewRows(cohort: OverviewCohort, scope: OverviewScope, products: ProductLite[]) {
  const live = new Map(products.map((product) => [product.id, product]));
  const rows = (items: ProductLite[], contribution: number) => items.map((product) => ({
    ...(live.get(product.id) || product),
    overviewContribution: contribution,
    overviewHistorical: !live.has(product.id),
  }));
  if (scope === "current") return rows(cohort.current, 0);
  if (scope === "added") return rows(cohort.added, 1);
  if (scope === "removed") return rows(cohort.removed, -1);
  return [...rows(cohort.added, 1), ...rows(cohort.removed, -1)];
}
