import type {
  ContentReviewManager,
  ContentReviewMetrics,
} from "@/lib/content-review-types";

export const NEW_PRODUCT_TRACKING_START = "2026-09-01";
// A failed catalog sync stamped this whole batch with 2026-09-03. Keep the
// source data intact but hide that incident batch from the operational queue
// until it can be reviewed and safely reintroduced.
export const NEW_PRODUCT_HIDDEN_DATES = new Set(["2026-09-03"]);

export function isHiddenNewProductDate(firstSeenAt: string) {
  return NEW_PRODUCT_HIDDEN_DATES.has(firstSeenAt.slice(0, 10));
}

export interface NewProductMeasurement {
  metrics: ContentReviewMetrics;
  salesQty: number;
  stockQty: number | null;
  periodFrom: string;
  periodTo: string;
  checkedAt: string;
}

export interface NewProductAssignment {
  id: string;
  productId: number;
  code: number;
  goodsRef: number;
  name: string;
  url: string;
  categoryId: number;
  categoryName: string;
  brand: string;
  manager: ContentReviewManager;
  publishedAt: string;
  assignedAt: string;
  checkAt: string;
  measurement: NewProductMeasurement | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewProductAnalysisRow extends NewProductAssignment {
  segment: "tile" | "sanitary";
  statusId: number | null;
  statusName: string;
  stockQty: number | null;
  deleted: boolean;
}
