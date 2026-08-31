import { BigQuery } from "@google-cloud/bigquery";
import {
  bigQueryCacheDay,
  readThroughBigQueryCache,
} from "@/lib/bigquery-result-cache";
import {
  completeContentProductReview,
  contentReviewControlWindow,
  contentReviewMetricWindow,
  kyivDate,
  listDueContentProductReviews,
} from "@/lib/content-reviews-store";
import type { ContentReviewMetrics } from "@/lib/content-review-types";
import {
  readAllLite,
  readProductAttributeIndex,
  readRequiredAttrs,
  type ProductLite,
} from "@/lib/products-store";

interface PerformanceRow {
  goods_ref: number | string | null;
  impressions: number | string | null;
  product_views: number | string | null;
  add_to_cart: number | string | null;
}

function productEventsTable(): string {
  const project = (
    process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413"
  ).replace(/`/g, "");
  const dataset = (
    process.env.BIGQUERY_DATASET_ID || "analytics_321347682"
  ).replace(/`/g, "");
  const table = (
    process.env.BIGQUERY_PRODUCT_EVENTS_TABLE || "items_detailed_events"
  ).replace(/`/g, "");
  return `\`${project}.${dataset}.${table}\``;
}

function performanceSql(): string {
  return `
WITH item_events AS (
  SELECT
    event_name,
    SAFE_CAST(NULLIF(TRIM(item_id), '') AS INT64) AS goods_ref
  FROM ${productEventsTable()}
  WHERE event_date BETWEEN PARSE_DATE('%Y%m%d', @dateFrom)
      AND PARSE_DATE('%Y%m%d', @dateTo)
    AND event_name IN ('view_item_list', 'view_item', 'add_to_cart')
)
SELECT
  goods_ref,
  COUNTIF(event_name = 'view_item_list') AS impressions,
  COUNTIF(event_name = 'view_item') AS product_views,
  COUNTIF(event_name = 'add_to_cart') AS add_to_cart
FROM item_events
WHERE goods_ref IS NOT NULL
GROUP BY goods_ref
`;
}

function numberValue(value: number | string | null): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function captureContentReviewMetrics(
  goodsRefs: number[],
  anchorDate: string,
  period: "rolling" | "control" = "rolling",
): Promise<Map<number, ContentReviewMetrics>> {
  const requested = new Set(goodsRefs);
  if (!requested.size) return new Map();
  const window =
    period === "control"
      ? contentReviewControlWindow(anchorDate)
      : contentReviewMetricWindow(anchorDate);
  const [products, attrIndex, requiredAttrs, rows] = await Promise.all([
    readAllLite(),
    readProductAttributeIndex(),
    readRequiredAttrs(),
    readThroughBigQueryCache<PerformanceRow[]>({
      namespace: "content-review-metrics",
      key: `v1:${bigQueryCacheDay()}:${productEventsTable()}:${window.from}:${window.to}`,
      load: async () => {
        const [queryRows] = await new BigQuery({
          projectId:
            process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413",
        }).query({
          query: performanceSql(),
          params: {
            dateFrom: window.from.replaceAll("-", ""),
            dateTo: window.to.replaceAll("-", ""),
          },
          location: "EU",
          maximumBytesBilled: "50000000000",
        });
        return queryRows as PerformanceRow[];
      },
    }),
  ]);
  const performanceByRef = new Map(
    rows.map((row) => [
      numberValue(row.goods_ref),
      {
        impressions: numberValue(row.impressions),
        productViews: numberValue(row.product_views),
        addToCart: numberValue(row.add_to_cart),
      },
    ]),
  );
  const contentScore = (product: ProductLite): number | null => {
    const required = requiredAttrs[String(product.categoryId)] || [];
    if (!required.length) return null;
    const present = new Set(
      (attrIndex.get(product.id) || []).map((attribute) => attribute.id),
    );
    const missing = required.filter(
      (attributeId) => !present.has(attributeId),
    ).length;
    const photoScore = Math.min(100, (product.imagesCount / 6) * 100);
    const attributeScore = Math.max(
      0,
      ((required.length - missing) / required.length) * 100,
    );
    const reviewScore = product.reviewsCount > 0 ? 100 : 0;
    return (
      Math.round(
        (photoScore * 0.4 + attributeScore * 0.4 + reviewScore * 0.2) * 10,
      ) / 10
    );
  };
  const baseRows = products.map((product) => {
    const performance = performanceByRef.get(product.goodsRef) || {
      impressions: 0,
      productViews: 0,
      addToCart: 0,
    };
    return {
      product,
      impressions: performance.impressions,
      productViews: performance.productViews,
      ctr:
        performance.impressions > 0
          ? (performance.productViews / performance.impressions) * 100
          : null,
      atc:
        performance.productViews > 0
          ? (performance.addToCart / performance.productViews) * 100
          : null,
      contentScore: contentScore(product),
    };
  });
  const byCategory = new Map<number, typeof baseRows>();
  for (const row of baseRows) {
    const categoryRows = byCategory.get(row.product.categoryId) || [];
    categoryRows.push(row);
    byCategory.set(row.product.categoryId, categoryRows);
  }
  const benchmarks = new Map<
    number,
    {
      ctr: number | null;
      atc: number | null;
      content: number | null;
    }
  >();
  for (const [categoryId, categoryRows] of byCategory) {
    benchmarks.set(categoryId, {
      ctr: median(
        categoryRows
          .filter((row) => row.impressions >= 500 && row.ctr != null)
          .map((row) => row.ctr as number),
      ),
      atc: median(
        categoryRows
          .filter((row) => row.productViews >= 50 && row.atc != null)
          .map((row) => row.atc as number),
      ),
      content: median(
        categoryRows
          .filter((row) => row.contentScore != null)
          .map((row) => row.contentScore as number),
      ),
    });
  }
  const result = new Map<number, ContentReviewMetrics>();
  for (const row of baseRows) {
    if (!requested.has(row.product.goodsRef)) continue;
    const benchmark = benchmarks.get(row.product.categoryId);
    result.set(row.product.goodsRef, {
      impressions: row.impressions,
      ctr: row.ctr,
      atc: row.atc,
      contentScore: row.contentScore,
      categoryCtr: benchmark?.ctr ?? null,
      categoryAtc: benchmark?.atc ?? null,
      categoryContent: benchmark?.content ?? null,
      periodFrom: window.from,
      periodTo: window.to,
    });
  }
  return result;
}

export async function runDueContentReviewChecks(
  throughDate = kyivDate(),
): Promise<{
  due: number;
  completed: number;
  missing: number;
}> {
  const due = await listDueContentProductReviews(throughDate);
  let completed = 0;
  let missing = 0;
  const byCheckDate = new Map<string, typeof due>();
  for (const review of due) {
    const reviews = byCheckDate.get(review.checkAt) || [];
    reviews.push(review);
    byCheckDate.set(review.checkAt, reviews);
  }
  for (const [checkAt, reviews] of byCheckDate) {
    const metrics = await captureContentReviewMetrics(
      [...new Set(reviews.map((review) => review.goodsRef))],
      checkAt,
      "control",
    );
    for (const review of reviews) {
      const after = metrics.get(review.goodsRef);
      if (!after) {
        missing++;
        continue;
      }
      await completeContentProductReview(review, after);
      completed++;
    }
  }
  return { due: due.length, completed, missing };
}
