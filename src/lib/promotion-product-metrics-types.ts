import type {
  WebFunnelChannel,
  WebFunnelDevice,
} from "@/lib/promotion-web-funnel-types";

export type PromotionProductMetricRow = {
  goodsRef: number;
  code: number | null;
  name: string;
  url: string | null;
  stockQty: number | null;
  inStock: boolean;
  addToCartEvents: number;
  addToCartUsers: number;
  listImpressions: number;
  listClicks: number;
  listToProductConversionPct: number | null;
  addToWishlistEvents: number;
  addToWishlistUsers: number;
  productViews: number;
  soldQty: number;
  productToSaleConversionPct: number | null;
};

export type PromotionMissingProduct = {
  goodsRef: number;
  code: number | null;
  name: string;
};

export type PromotionProductMetricsResponse = {
  requestedUrl: string;
  normalizedUrl: string;
  scope: "sitewide" | "page";
  countryFilter: "Ukraine";
  from: string;
  to: string;
  channel: WebFunnelChannel;
  device: WebFunnelDevice;
  includeOutOfStock: boolean;
  generatedAt: string;
  tracking: {
    addToCartEvents: number;
    viewItemListEvents: number;
    selectItemEvents: number;
    addToWishlistEvents: number;
    productViewEvents: number;
    unmatchedGoodsRefs: number;
  };
  missingProducts: PromotionMissingProduct[];
  rankings: {
    addToCart: PromotionProductMetricRow[];
    listToProduct: PromotionProductMetricRow[];
    addToWishlist: PromotionProductMetricRow[];
    productToSale: PromotionProductMetricRow[];
    antiListToProduct: PromotionProductMetricRow[];
    antiProductToSale: PromotionProductMetricRow[];
  };
  totals: {
    addToCart: number;
    listToProduct: number;
    addToWishlist: number;
    productToSale: number;
    antiListToProduct: number;
    antiProductToSale: number;
  };
};
