import type {
  ContentReviewManager,
  ContentReviewMetrics,
} from "@/lib/content-review-types";

export const NEW_PRODUCT_TRACKING_START = "2026-09-01";

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
