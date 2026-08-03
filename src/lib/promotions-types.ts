export type PromotionChange = "add" | "delete" | "switch" | "update" | null;

export interface PromotionLink {
  idinc: number;
  name: string;
  url: string;
}

export interface PromotionOption {
  id: number;
  idinc: number;
  name: string;
  type: string;
  percent: number | null;
  startDate: string | null;
  endDate: string | null;
  linkedPromotions: PromotionLink[];
  productCount: number;
  baselineCapturedAt: string;
  isNew: boolean;
  active: boolean;
}

export interface PromotionCatalogRow {
  key: string;
  change: PromotionChange;
  promotionId: number;
  promotionIdinc: number;
  promotionName: string;
  promotionType: string;
  promotionStartDate: string | null;
  promotionEndDate: string | null;
  linkedPromotions: PromotionLink[];
  previousPromotions: { idinc: number; name: string }[];
  productId: number;
  goodsRef: number;
  code: number;
  sku: string | null;
  name: string;
  productUrl: string;
  categoryId: number | null;
  categoryName: string;
  brand: string;
  basePrice: number | null;
  promoPrice: number | null;
  previousPromoPrice: number | null;
  discountPct: number | null;
  stockQty: number | null;
  statusId: number;
  statusName: string;
  imagesCount: number;
  reviewsCount: number;
  attributesCount: number;
  missingRequiredAttrsCount: number;
  onSite: boolean;
}

export interface PromotionsCatalogResponse {
  items: PromotionCatalogRow[];
  promotions: PromotionOption[];
  linkedPromotions: PromotionLink[];
  baselineCapturedAt: string;
  snapshotCapturedAt: string;
  snapshotDates: string[];
  fromDate: string;
  toDate: string;
  syncedAt: string | null;
  generatedAt: string;
  today: string;
}
