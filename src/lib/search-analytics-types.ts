import type { ContentReviewManager } from "@/lib/content-review-types";

export type SearchQueryStatus =
  | "new"
  | "processed"
  | "garbage"
  | "deleted"
  | "brand-not-found";

export type SearchQueryExclusionReason = "deleted" | "brand-not-found";

export interface SearchQueryProduct {
  code: number;
  goodsRef: number;
  name: string;
  url: string;
  stockQty: number | null;
  statusName: string;
}

export interface SearchMonthlyMetric {
  month: string;
  from: string;
  to: string;
  bigQueryCount: number;
  multisearchFoundCount: number;
  multisearchNoResultsCount: number;
  totalSearches: number;
}

export interface SearchQueryProcessing {
  queryKey: string;
  aliasKeys?: string[];
  originalQuery: string;
  queryUk: string;
  queryRu: string;
  manager: ContentReviewManager | null;
  idds: number[];
  goodsRefs: number[];
  products: SearchQueryProduct[];
  source: "dashboard-test" | "dashboard-sync" | "google-sheet";
  sheetSynced: boolean;
  sheetRow?: number | null;
  controlBefore?: SearchControlMetricSummary;
  processedAt: string;
  updatedAt: string;
}

export interface SearchAnalyticsRow {
  key: string;
  query: string;
  queryUk: string;
  queryRu: string;
  aliases: string[];
  sources: Array<"bigquery" | "multisearch-found" | "multisearch-no-results" | "google-sheet">;
  bigQueryCount: number;
  multisearchFoundCount: number;
  multisearchNoResultsCount: number;
  totalSearches: number;
  monthly: SearchMonthlyMetric[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  status: SearchQueryStatus;
  manager: ContentReviewManager | null;
  garbageReason: string | null;
  products: SearchQueryProduct[];
  sheetSynced: boolean;
  sheetRow: number | null;
  processedAt: string | null;
  updatedAt: string | null;
}

export interface SearchControlMetricSummary {
  impressions: number;
  ctr: number | null;
  atc: number | null;
  periodFrom: string;
  periodTo: string;
}

export interface SearchControlRow {
  key: string;
  query: string;
  queryUk: string;
  queryRu: string;
  aliases: string[];
  manager: ContentReviewManager;
  products: SearchQueryProduct[];
  sheetRow: number | null;
  processedAt: string;
  updatedAt: string;
  checkAt: string;
  before: SearchControlMetricSummary;
  after: SearchControlMetricSummary | null;
  multisearchNoResultsCount: number | null;
  uniqueSales: number | null;
  productsOutOfStock: number;
  ctrScore: -1 | 0 | 1 | null;
  atcScore: -1 | 0 | 1 | null;
}

export interface SearchControlResponse {
  rows: SearchControlRow[];
  updatedAt: string;
  measurementFrom: string | null;
  measurementTo: string | null;
  stats: {
    processedQueries: number;
    zeroNoResultsQueries: number;
    uniqueSales: number;
    ctrScore: number;
    atcScore: number;
    productsOutOfStock: number;
    waitingQueries: number;
  };
  managers: Array<{
    manager: ContentReviewManager;
    queries: number;
    measured: number;
    improvedCtr: number;
    declinedCtr: number;
    improvedAtc: number;
    declinedAtc: number;
  }>;
  warnings: string[];
}

export interface SearchAnalyticsResponse {
  rows: SearchAnalyticsRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  updatedAt: string;
  periodFrom: string;
  periodTo: string;
  testMode: boolean;
  stats: {
    uniqueQueries: number;
    searchEvents: number;
    pendingQueries: number;
    processedQueries: number;
    garbageQueries: number;
    involvedProducts: number;
    productsInStock: number;
    productsOutOfStock: number;
  };
  sourceStats: {
    bigQueryQueries: number;
    bigQueryEvents: number;
    multisearchFoundQueries: number;
    multisearchFoundEvents: number;
    multisearchNoResultsQueries: number;
    multisearchNoResultsEvents: number;
    sheetMappings: number;
  };
  warnings: string[];
}
