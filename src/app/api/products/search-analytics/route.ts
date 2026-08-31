import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { isContentReviewManager } from "@/lib/content-review-types";
import {
  buildSearchAnalyticsDataset,
  normalizeSearchQuery,
} from "@/lib/search-analytics";
import {
  bumpSearchSheetRevision,
  excludeSearchQueries,
  listSearchQueryProcessing,
  saveSearchQueryProcessing,
} from "@/lib/search-query-processing-store";
import { syncSearchQueryToGoogleSheet } from "@/lib/multisearch-google-sheet";
import type {
  SearchAnalyticsResponse,
  SearchQueryProcessing,
  SearchQueryProduct,
} from "@/lib/search-analytics-types";
import { readAllLite } from "@/lib/products-store";

export const dynamic = "force-dynamic";

function integer(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  if (!isDashboardRequest(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(request.url);
    const page = integer(url.searchParams.get("page"), 1);
    const limit = Math.min(100, integer(url.searchParams.get("limit"), 25));
    const search = normalizeSearchQuery(url.searchParams.get("search") || "");
    const status = url.searchParams.get("status") || "all";
    const source = url.searchParams.get("source") || "all";
    const result = url.searchParams.get("result") || "all";
    const manager = url.searchParams.get("manager") || "all";
    const minCount = Math.max(0, Number(url.searchParams.get("minCount")) || 0);
    const dataset = await buildSearchAnalyticsDataset();
    const allRows = dataset.rows;
    const productMap = new Map<number, SearchQueryProduct>();
    for (const row of allRows)
      for (const product of row.products) productMap.set(product.goodsRef, product);
    const stats = {
      uniqueQueries: allRows.length,
      searchEvents: allRows.reduce((sum, row) => sum + row.totalSearches, 0),
      pendingQueries: allRows.filter((row) => row.status === "new").length,
      processedQueries: allRows.filter((row) => row.status === "processed").length,
      garbageQueries: allRows.filter((row) => row.status === "garbage").length,
      involvedProducts: productMap.size,
      productsInStock: [...productMap.values()].filter(
        (product) => (product.stockQty || 0) > 0,
      ).length,
      productsOutOfStock: [...productMap.values()].filter(
        (product) => (product.stockQty || 0) <= 0,
      ).length,
    };
    const rows = allRows
      .filter((row) => {
        if (
          search &&
          ![row.query, row.queryUk, row.queryRu, ...row.aliases].some((item) =>
            normalizeSearchQuery(item).includes(search),
          )
        )
          return false;
        if (status !== "all" && row.status !== status) return false;
        if (source !== "all" && !row.sources.includes(source as never)) return false;
        if (result === "no-results" && row.multisearchNoResultsCount <= 0)
          return false;
        if (result === "found" && row.multisearchFoundCount <= 0) return false;
        if (manager !== "all" && row.manager !== manager) return false;
        return row.totalSearches >= minCount;
      })
      .sort(
        (left, right) =>
          Number(right.status === "new") - Number(left.status === "new") ||
          right.multisearchNoResultsCount - left.multisearchNoResultsCount ||
          right.totalSearches - left.totalSearches ||
          left.query.localeCompare(right.query, "uk"),
      );
    const offset = (page - 1) * limit;
    const response: SearchAnalyticsResponse = {
      rows: rows.slice(offset, offset + limit),
      total: rows.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(rows.length / limit)),
      updatedAt: new Date().toISOString(),
      periodFrom: dataset.from,
      periodTo: dataset.to,
      testMode: false,
      stats,
      sourceStats: dataset.sourceStats,
      warnings: dataset.warnings,
    };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "search_analytics_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isDashboardRequest(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    query?: unknown;
    queryUk?: unknown;
    queryRu?: unknown;
    manager?: unknown;
    idds?: unknown;
  };
  const query = String(body.query || "").trim();
  const queryUk = String(body.queryUk || "").trim();
  const queryRu = String(body.queryRu || "").trim();
  const idds = Array.isArray(body.idds)
    ? [...new Set(
      body.idds
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value > 0),
    )]
    : [];
  if (!query || !queryUk || !queryRu || !isContentReviewManager(body.manager))
    return NextResponse.json({ error: "Заповніть запити та менеджера" }, { status: 400 });
  if (!idds.length)
    return NextResponse.json({ error: "Додайте хоча б один IDD" }, { status: 400 });
  try {
    const products = await readAllLite();
    const byCode = new Map(products.map((item) => [item.code, item]));
    const missingIds = idds.filter((code) => !byCode.has(code));
    if (missingIds.length)
      return NextResponse.json(
        { error: `IDD не знайдено: ${missingIds.join(", ")}`, missingIds },
        { status: 400 },
      );
    const selected = idds.map((code) => byCode.get(code)!);
    const existing = await listSearchQueryProcessing();
    const previous = existing[normalizeSearchQuery(query)];
    const aliasKeys = [...new Set([
      query,
      queryUk,
      queryRu,
      previous?.originalQuery || "",
      previous?.queryUk || "",
      previous?.queryRu || "",
    ].map(normalizeSearchQuery).filter(Boolean))];
    const sheet = await syncSearchQueryToGoogleSheet({
      matchQueries: aliasKeys,
      queryUk,
      queryRu,
      goodsRefs: selected.map((item) => item.goodsRef),
    });
    await bumpSearchSheetRevision();
    const now = new Date().toISOString();
    const processing: SearchQueryProcessing = {
      queryKey: normalizeSearchQuery(query),
      aliasKeys,
      originalQuery: query,
      queryUk,
      queryRu,
      manager: body.manager,
      idds,
      goodsRefs: selected.map((item) => item.goodsRef),
      products: selected.map((item) => ({
        code: item.code,
        goodsRef: item.goodsRef,
        name: item.name,
        url: item.url,
        stockQty: item.stockQty,
        statusName: item.statusName,
      })),
      source: "dashboard-sync",
      sheetSynced: true,
      sheetRow: sheet.rowNumber,
      processedAt: previous?.processedAt || now,
      updatedAt: now,
    };
    await saveSearchQueryProcessing(processing);
    return NextResponse.json({
      processing,
      testMode: false,
      sheetAction: sheet.action,
      sheetRowNumber: sheet.rowNumber,
      sheetRow: [queryUk, queryRu, processing.goodsRefs.join(", ")],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "search_processing_failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isDashboardRequest(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    query?: unknown;
    aliases?: unknown;
  };
  const query = String(body.query || "").trim();
  const aliases = Array.isArray(body.aliases)
    ? body.aliases.map((item) => String(item || ""))
    : [];
  const queryKeys = [...new Set([query, ...aliases].map(normalizeSearchQuery).filter(Boolean))];
  if (!queryKeys.length)
    return NextResponse.json({ error: "Пошуковий запит не вказаний" }, { status: 400 });
  await excludeSearchQueries(queryKeys, query);
  return NextResponse.json({ excluded: true, queryKeys });
}
