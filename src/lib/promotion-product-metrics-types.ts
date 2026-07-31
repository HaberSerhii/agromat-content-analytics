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
    unmatchedGoodsRefs: number;
  };
  rankings: {
    addToCart: PromotionProductMetricRow[];
    listToProduct: PromotionProductMetricRow[];
    addToWishlist: PromotionProductMetricRow[];
  };
  totals: {
    addToCart: number;
    listToProduct: number;
    addToWishlist: number;
  };
};
