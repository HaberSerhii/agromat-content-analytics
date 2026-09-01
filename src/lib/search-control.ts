import { captureContentReviewMetricsForWindow } from "@/lib/content-review-metrics";
import { contentReviewMetricWindow, kyivDate } from "@/lib/content-reviews-store";
import { CONTENT_REVIEW_MANAGERS } from "@/lib/content-review-types";
import { normalizeSearchQuery, readMultisearchNoResultsCounts } from "@/lib/search-analytics";
import { listSearchQueryProcessing } from "@/lib/search-query-processing-store";
import type {
  SearchControlMetricSummary,
  SearchControlResponse,
  SearchControlRow,
  SearchQueryProcessing,
} from "@/lib/search-analytics-types";
import { readAllLite } from "@/lib/products-store";
import { readUniqueSalesDocumentsForProductGroups } from "@/lib/sales-s3";

type MetricMap = Awaited<ReturnType<typeof captureContentReviewMetricsForWindow>>;

export function searchControlCheckDate(updatedAt: string): string {
  const [year, month] = updatedAt.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10);
}

export function previousFullMonth(today = kyivDate()): { from: string; to: string } {
  const [year, month] = today.slice(0, 7).split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 2, 1));
  const to = new Date(Date.UTC(year, month - 1, 0));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function uniqueProcessingRecords(
  processing: Record<string, SearchQueryProcessing>,
): SearchQueryProcessing[] {
  const records = new Map<string, SearchQueryProcessing>();
  for (const record of Object.values(processing)) {
    if (!record.manager || !record.goodsRefs.length) continue;
    const current = records.get(record.queryKey);
    if (!current || current.updatedAt < record.updatedAt) records.set(record.queryKey, record);
  }
  return [...records.values()].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  );
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null);
  if (!present.length) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function summarizeMetrics(
  record: SearchQueryProcessing,
  metrics: MetricMap,
  window: { from: string; to: string },
): SearchControlMetricSummary {
  const rows = record.goodsRefs.map((goodsRef) => metrics.get(goodsRef)).filter(Boolean);
  return {
    impressions: rows.reduce((sum, row) => sum + (row?.impressions || 0), 0),
    ctr: average(rows.map((row) => row?.ctr ?? null)),
    atc: average(rows.map((row) => row?.atc ?? null)),
    periodFrom: window.from,
    periodTo: window.to,
  };
}

function metricScore(before: number | null, after: number | null): -1 | 0 | 1 | null {
  if (before == null || after == null) return null;
  const difference = after - before;
  if (Math.abs(difference) < 0.0001) return 0;
  return difference > 0 ? 1 : -1;
}

export async function buildSearchControlDataset(): Promise<SearchControlResponse> {
  const today = kyivDate();
  const warnings: string[] = [];
  const [processing, products] = await Promise.all([
    listSearchQueryProcessing(),
    readAllLite(),
  ]);
  const records = uniqueProcessingRecords(processing);
  const productsByGoodsRef = new Map(products.map((product) => [product.goodsRef, product]));
  const baselineGroups = new Map<string, SearchQueryProcessing[]>();
  for (const record of records) {
    if (record.controlBefore) continue;
    const date = record.updatedAt.slice(0, 10);
    const group = baselineGroups.get(date) || [];
    group.push(record);
    baselineGroups.set(date, group);
  }

  const baselineByDate = new Map<string, MetricMap>();
  await Promise.all(
    [...baselineGroups].map(async ([date, group]) => {
      const window = contentReviewMetricWindow(date);
      try {
        baselineByDate.set(
          date,
          await captureContentReviewMetricsForWindow(
            [...new Set(group.flatMap((record) => record.goodsRefs))],
            window,
          ),
        );
      } catch (error) {
        warnings.push(
          `Початковий замір ${date}: ${error instanceof Error ? error.message : "помилка"}`,
        );
        baselineByDate.set(date, new Map());
      }
    }),
  );

  const measurementWindow = previousFullMonth(today);
  const dueRecords = records.filter((record) => searchControlCheckDate(record.updatedAt) <= today);
  const dueGoodsRefs = [...new Set(dueRecords.flatMap((record) => record.goodsRefs))];
  const [afterResult, noResultsResult, salesResult] = await Promise.allSettled([
    dueGoodsRefs.length
      ? captureContentReviewMetricsForWindow(dueGoodsRefs, measurementWindow)
      : Promise.resolve(new Map() as MetricMap),
    dueRecords.length
      ? readMultisearchNoResultsCounts(measurementWindow.from, measurementWindow.to)
      : Promise.resolve(new Map<string, number>()),
    dueRecords.length
      ? readUniqueSalesDocumentsForProductGroups({
          ...measurementWindow,
          groups: dueRecords.map((record) => ({
            key: record.queryKey,
            productCodes: record.idds,
          })),
        })
      : Promise.resolve({ total: 0, byKey: new Map<string, number>() }),
  ]);
  const afterMetrics = afterResult.status === "fulfilled" ? afterResult.value : new Map();
  const noResultsCounts = noResultsResult.status === "fulfilled" ? noResultsResult.value : null;
  const sales = salesResult.status === "fulfilled"
    ? salesResult.value
    : { total: 0, byKey: new Map<string, number>() };
  if (afterResult.status === "rejected")
    warnings.push(`Контрольний замір: ${afterResult.reason instanceof Error ? afterResult.reason.message : "помилка"}`);
  if (noResultsResult.status === "rejected")
    warnings.push(`Multisearch: ${noResultsResult.reason instanceof Error ? noResultsResult.reason.message : "помилка"}`);
  if (salesResult.status === "rejected")
    warnings.push(`Продажі: ${salesResult.reason instanceof Error ? salesResult.reason.message : "помилка"}`);

  const rows: SearchControlRow[] = records.map((record) => {
    const updateDate = record.updatedAt.slice(0, 10);
    const baselineWindow = contentReviewMetricWindow(updateDate);
    const before = record.controlBefore || summarizeMetrics(
      record,
      baselineByDate.get(updateDate) || new Map(),
      baselineWindow,
    );
    const due = searchControlCheckDate(record.updatedAt) <= today;
    const after = due
      ? summarizeMetrics(record, afterMetrics, measurementWindow)
      : null;
    const aliases = [...new Set([
      ...(record.aliasKeys || []),
      record.originalQuery,
      record.queryUk,
      record.queryRu,
    ].map(normalizeSearchQuery).filter(Boolean))];
    const noResults = due && noResultsCounts
      ? aliases.reduce((sum, alias) => sum + (noResultsCounts.get(alias) || 0), 0)
      : null;
    const liveProducts = record.goodsRefs.map((goodsRef) => productsByGoodsRef.get(goodsRef));
    return {
      key: record.queryKey,
      query: record.originalQuery,
      queryUk: record.queryUk,
      queryRu: record.queryRu,
      aliases,
      manager: record.manager!,
      products: record.products.map((product) => {
        const live = productsByGoodsRef.get(product.goodsRef);
        return live
          ? {
              code: live.code,
              goodsRef: live.goodsRef,
              name: live.name,
              url: live.url,
              stockQty: live.stockQty,
              statusName: live.statusName,
            }
          : product;
      }),
      sheetRow: record.sheetRow ?? null,
      processedAt: record.processedAt,
      updatedAt: record.updatedAt,
      checkAt: searchControlCheckDate(record.updatedAt),
      before,
      after,
      multisearchNoResultsCount: noResults,
      uniqueSales: due ? sales.byKey.get(record.queryKey) || 0 : null,
      productsOutOfStock: liveProducts.filter((product) => !product || (product.stockQty || 0) <= 0).length,
      ctrScore: after ? metricScore(before.ctr, after.ctr) : null,
      atcScore: after ? metricScore(before.atc, after.atc) : null,
    };
  });

  const outOfStockGoodsRefs = new Set<number>();
  for (const record of records) {
    for (const goodsRef of record.goodsRefs) {
      const product = productsByGoodsRef.get(goodsRef);
      if (!product || (product.stockQty || 0) <= 0) outOfStockGoodsRefs.add(goodsRef);
    }
  }
  const managers = CONTENT_REVIEW_MANAGERS.map((manager) => {
    const managerRows = rows.filter((row) => row.manager === manager);
    return {
      manager,
      queries: managerRows.length,
      measured: managerRows.filter((row) => row.after).length,
      improvedCtr: managerRows.filter((row) => row.ctrScore === 1).length,
      declinedCtr: managerRows.filter((row) => row.ctrScore === -1).length,
      improvedAtc: managerRows.filter((row) => row.atcScore === 1).length,
      declinedAtc: managerRows.filter((row) => row.atcScore === -1).length,
    };
  });

  return {
    rows,
    updatedAt: new Date().toISOString(),
    measurementFrom: dueRecords.length ? measurementWindow.from : null,
    measurementTo: dueRecords.length ? measurementWindow.to : null,
    stats: {
      processedQueries: rows.length,
      zeroNoResultsQueries: rows.filter((row) => row.multisearchNoResultsCount === 0).length,
      uniqueSales: sales.total,
      ctrScore: rows.reduce((sum, row) => sum + (row.ctrScore || 0), 0),
      atcScore: rows.reduce((sum, row) => sum + (row.atcScore || 0), 0),
      productsOutOfStock: outOfStockGoodsRefs.size,
      waitingQueries: rows.filter((row) => !row.after).length,
    },
    managers,
    warnings,
  };
}
