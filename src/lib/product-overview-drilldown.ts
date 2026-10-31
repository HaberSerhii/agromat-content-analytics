import type { ProductLite } from "./products-store";

export type OverviewMetric = "newProducts" | "activeProducts" | "inactiveProducts" | "promoProducts" | "ctr";
export const OVERVIEW_SEGMENTS = {
  tile: "Плитка", sanitary: "Сантехніка", flooring: "Напольні покриття",
  power: "Зарядні станції", chemicals: "Будівельна хімія",
} as const;
export type OverviewSegment = keyof typeof OVERVIEW_SEGMENTS;
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
  if (!["newProducts", "activeProducts", "inactiveProducts", "promoProducts", "ctr"].includes(metric) ||
      !Object.hasOwn(OVERVIEW_SEGMENTS, segment) ||
      !["current", "changes", "added", "removed"].includes(scope)) return null;
  return { metric, segment, scope };
}

export function segmentOf(product: Pick<ProductLite, "categoryName" | "categoryPath">): "tile" | "sanitary" {
  return /плит|керам|кл[іи]нкер|моза|tile|gres/i.test(`${product.categoryName} ${product.categoryPath}`)
    ? "tile" : "sanitary";
}

export function overviewSegmentOf(product: Pick<ProductLite, "categoryName" | "categoryPath">): OverviewSegment {
  const category = `${product.categoryPath} ${product.categoryName}`;
  if (/х[іи]м[іи]|кле[йї]|затир|затиран|гермет|ґрунт|грунт|chem/i.test(category)) return "chemicals";
  if (/підлог|наполь|лам[іи]нат|паркет|в[іи]н[іи]л|floor/i.test(category)) return "flooring";
  if (/станц|електрост|электрост|заряд|генератор|power/i.test(category)) return "power";
  return segmentOf(product);
}

export function isActivatedInRange(product: ProductLite, from: string, to: string) {
  return !product.deleted && product.statusId === 5 && product.statusHistory.some(
    (change) => change.from !== 5 && change.to === 5 &&
      new Date(change.at).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }) >= from &&
      new Date(change.at).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }) <= to,
  );
}

// Counts and drilldowns share the same deduplicated cohorts, including segment moves.
export function buildOverviewCohorts(current: ProductLite[], previous: ProductLite[], legacySegments = false): OverviewCohorts {
  const unique = (products: ProductLite[], segment: OverviewSegment) =>
    new Map(products.filter((product) => (legacySegments ? segmentOf(product) : overviewSegmentOf(product)) === segment).map((product) => [product.id, product]));
  const cohort = (segment: OverviewSegment): OverviewCohort => {
    const now = unique(current, segment);
    const before = unique(previous, segment);
    return {
      current: [...now.values()],
      added: [...now.values()].filter((product) => !before.has(product.id)),
      removed: [...before.values()].filter((product) => !now.has(product.id)),
    };
  };
  return Object.fromEntries(Object.keys(OVERVIEW_SEGMENTS).map((segment) => [segment, cohort(segment as OverviewSegment)])) as OverviewCohorts;
}

export function overviewMetric(cohorts: OverviewCohorts) {
  return {
    segments: Object.fromEntries(Object.entries(cohorts).map(([key, value]) => [key, { count: value.current.length, delta: value.added.length - value.removed.length }])),
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
