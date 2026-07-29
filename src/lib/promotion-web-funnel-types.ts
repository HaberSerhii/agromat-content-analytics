export type WebFunnelPeriodKind = "week" | "month" | "custom";
export type WebFunnelChannel = "all" | "organic" | "cpc" | "direct";
export type WebFunnelStageKey =
  | "landing"
  | "view_item"
  | "cart"
  | "begin_checkout"
  | "purchase";

export type WebFunnelStage = {
  key: WebFunnelStageKey;
  label: string;
  users: number;
  conversionFromPreviousPct: number | null;
  conversionFromStartPct: number | null;
};

export type WebFunnelPeriod = {
  key: "current" | "previous" | "yearAgo";
  from: string;
  to: string;
  label: string;
  shortLabel: string;
  available: boolean;
  stages: WebFunnelStage[];
  startUsers: number;
  orderUsers: number;
  conversionRatePct: number | null;
};

export type WebFunnelComparison = {
  current: WebFunnelPeriod;
  previous: WebFunnelPeriod;
  yearAgo: WebFunnelPeriod;
};

export type PromotionWebFunnelResponse = {
  requestedUrl: string;
  normalizedUrl: string;
  scope: "sitewide" | "page";
  periodKind: WebFunnelPeriodKind;
  generatedAt: string;
  navigation: {
    previousAnchor: string;
    nextAnchor: string;
    canGoNext: boolean;
  };
  comparisons: Record<WebFunnelChannel, WebFunnelComparison>;
};
