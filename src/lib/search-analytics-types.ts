import type { ContentReviewManager } from "@/lib/content-review-types";

export type SearchQueryStatus = "new" | "processed" | "garbage";

export interface SearchQueryProduct {
  code: number;
  goodsRef: number;
  name: string;
  url: string;
  stockQty: number | null;
  statusName: string;
}

export interface SearchQueryProcessing {
  queryKey: string;
  originalQuery: string;
  queryUk: string;
  queryRu: string;
  manager: ContentReviewManager | null;
  idds: number[];
  goodsRefs: number[];
  products: SearchQueryProduct[];
  source: "dashboard-test" | "google-sheet";
  sheetSynced: boolean;
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
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  status: SearchQueryStatus;
  manager: ContentReviewManager | null;
  garbageReason: string | null;
  products: SearchQueryProduct[];
  sheetSynced: boolean;
  processedAt: string | null;
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
