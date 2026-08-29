import { NextResponse } from "next/server";
import {
  fetchAllPromotions,
  isBundlePromotion,
  type ApiPromotion,
} from "@/lib/products-api";
import { readPromotionSalesDataset } from "@/lib/sales-s3";
import type {
  PromotionSalesPromotionInput,
  PromotionSalesPublicGroup,
} from "@/lib/promotion-sales-types";
import { canonicalSearchParams, getServerResult } from "@/lib/server-result-cache";

export const dynamic = "force-dynamic";

const COMPACT_CACHE_TTL_MS = 20 * 60_000;
const DETAIL_CACHE_TTL_MS = 5 * 60_000;

function kyivToday(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeDate(value: string | null, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function overlapsRange(promotion: ApiPromotion, from: string, to: string): boolean {
  if (promotion.has_related || promotion.products.length === 0) return false;
  if (promotion.start_date && promotion.start_date > to) return false;
  if (!promotion.is_unlimited && promotion.end_date && promotion.end_date < from) return false;
  return true;
}

function normalizePublicUrl(value: string): string {
  return value
    .replace(/\/actions\//, "/discount/")
    .replace(/\/?$/, "/");
}

function buildPublicUrls(promotions: ApiPromotion[]): Map<number, string> {
  const urls = new Map<number, string>();
  for (const promotion of promotions) {
    if (!promotion.active || !promotion.url || isBundlePromotion(promotion)) continue;
    const url = normalizePublicUrl(promotion.url);
    if (promotion.has_related) {
      for (const related of promotion.related_promotions ?? []) {
        if (!urls.has(related.idinc)) urls.set(related.idinc, url);
      }
    } else if (!urls.has(promotion.idinc)) {
      urls.set(promotion.idinc, url);
    }
  }
  return urls;
}

function buildPublicGroups(
  promotions: ApiPromotion[],
  availableIdincs: Set<number>,
): PromotionSalesPublicGroup[] {
  return promotions
    .filter((promotion) =>
      promotion.active
      && Boolean(promotion.url)
      && !isBundlePromotion(promotion))
    .map((promotion) => {
      const promotionIdincs = promotion.has_related
        ? (promotion.related_promotions ?? []).map((related) => related.idinc)
        : [promotion.idinc];
      return {
        id: promotion.id,
        name: promotion.name,
        url: normalizePublicUrl(promotion.url as string),
        promotionIdincs: [...new Set(promotionIdincs.filter((idinc) => availableIdincs.has(idinc)))],
      };
    })
    .filter((group) => group.promotionIdincs.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));
}

function toPromotionInput(
  promotion: ApiPromotion,
  publicUrls: Map<number, string>,
): PromotionSalesPromotionInput {
  return {
    id: promotion.id,
    idinc: promotion.idinc,
    name: promotion.name,
    startDate: promotion.start_date,
    endDate: promotion.end_date,
    productCodes: [...new Set(
      promotion.products
        .map((product) => product.code)
        .filter((code) => Number.isFinite(code) && code > 0),
    )],
    publicUrl: publicUrls.get(promotion.idinc) ?? null,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const today = kyivToday();
    const monthStart = `${today.slice(0, 7)}-01`;
    const rawFrom = normalizeDate(url.searchParams.get("from"), monthStart);
    const rawTo = normalizeDate(url.searchParams.get("to"), today);
    const from = rawFrom <= rawTo ? rawFrom : rawTo;
    const to = rawFrom <= rawTo ? rawTo : rawFrom;
    const selectedPromotionIdincs = [...new Set(
      url.searchParams
        .getAll("promotion_idinc")
        .map(Number)
        .filter((idinc) => Number.isFinite(idinc) && idinc > 0),
    )];
    const compact = url.searchParams.get("compact") === "1";
    const productsView = url.searchParams.get("view") === "products";
    const cacheKey = canonicalSearchParams(url.searchParams);
    const { value: json, status } = await getServerResult({
      namespace: "promotion-sales-json-v2",
      key: cacheKey,
      ttlMs: compact && !productsView ? COMPACT_CACHE_TTL_MS : DETAIL_CACHE_TTL_MS,
      maxEntries: 16,
      load: async () => {
        const allPromotions = await fetchAllPromotions();
        const publicUrls = buildPublicUrls(allPromotions);
        const promotions = allPromotions
          .filter((promotion) => !isBundlePromotion(promotion))
          .filter((promotion) => overlapsRange(promotion, from, to))
          .map((promotion) => toPromotionInput(promotion, publicUrls));
        const publicPromotionGroups = buildPublicGroups(
          allPromotions,
          new Set(promotions.map((promotion) => promotion.idinc)),
        );
        const dataset = await readPromotionSalesDataset({
          from,
          to,
          selectedPromotionIdincs,
          promotions,
          publicPromotionGroups,
          includeProducts: !compact || productsView,
        });
        return JSON.stringify(productsView
          ? { filter: dataset.filter, products: dataset.summary.products }
          : dataset);
      },
    });
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
        "X-Agromat-Cache": status,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося завантажити продажі акційних товарів" },
      { status: 500 },
    );
  }
}
