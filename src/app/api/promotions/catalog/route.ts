import { NextResponse } from "next/server";
import {
  fetchActiveProductIdsWithoutImages,
  fetchAllPromotions,
  fetchDeletedProductIds,
  isBundlePromotion,
  type ApiPromotion,
  type ApiPromotionProduct,
} from "@/lib/products-api";
import {
  readAllLite,
  readLiteSyncedAt,
  readProductAttributeIndex,
  readRequiredAttrs,
  type ProductLite,
} from "@/lib/products-store";
import { readDiskSnapshot } from "@/lib/products-disk-cache";
import {
  readOrExtendPromotionsBaseline,
  type PromotionBaselineProduct,
} from "@/lib/promotions-store";
import type {
  PromotionCatalogRow,
  PromotionLink,
  PromotionOption,
  PromotionsCatalogResponse,
} from "@/lib/promotions-types";

export const dynamic = "force-dynamic";

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

function isDateCurrentPricingPromotion(promotion: ApiPromotion, today: string): boolean {
  if (promotion.has_related) return false;
  if (promotion.is_unlimited) return true;
  return (!promotion.start_date || promotion.start_date <= today)
    && (!promotion.end_date || promotion.end_date >= today);
}

function buildPublicLinks(all: ApiPromotion[]): Map<number, PromotionLink[]> {
  const links = new Map<number, PromotionLink[]>();
  const add = (sourceIdinc: number, link: PromotionLink) => {
    const current = links.get(sourceIdinc) ?? [];
    if (!current.some((item) => item.idinc === link.idinc)) current.push(link);
    links.set(sourceIdinc, current);
  };

  for (const promotion of all) {
    if (!promotion.active || !promotion.url) continue;
    const publicLink = {
      idinc: promotion.idinc,
      name: promotion.name,
      url: promotion.url
        .replace(/\/actions\//, "/discount/")
        .replace(/\/?$/, "/"),
    };
    if (promotion.has_related) {
      for (const related of promotion.related_promotions ?? []) add(related.idinc, publicLink);
    } else {
      add(promotion.idinc, publicLink);
    }
  }
  return links;
}

function pct(basePrice: number | null, promoPrice: number | null): number | null {
  if (basePrice == null || promoPrice == null || basePrice <= 0) return null;
  return Math.max(0, Math.round(((basePrice - promoPrice) / basePrice) * 1000) / 10);
}

function productKey(product: Pick<ApiPromotionProduct, "id"> | Pick<PromotionBaselineProduct, "id">): string {
  return String(product.id);
}

function mapCatalogProducts(products: ProductLite[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const byRef = new Map(products.map((product) => [product.goodsRef, product]));
  const byCode = new Map(products.map((product) => [product.code, product]));
  return { byId, byRef, byCode };
}

function findCatalogProduct(
  maps: ReturnType<typeof mapCatalogProducts>,
  product: { id: number; goodsRef: number; code: number },
): ProductLite | undefined {
  return maps.byId.get(product.id) ?? maps.byRef.get(product.goodsRef) ?? maps.byCode.get(product.code);
}

export async function GET() {
  try {
    const catalogData = Promise.all([
      readAllLite(),
      readLiteSyncedAt(),
      readRequiredAttrs(),
      readProductAttributeIndex(),
    ]).then(([products, syncedAt, requiredAttrs, attrIndex]) => ({
      products,
      syncedAt,
      requiredAttrs,
      attrIndex,
    })).catch(() => {
      const disk = readDiskSnapshot();
      return {
        products: disk?.products ?? [],
        syncedAt: disk?.syncedAt ?? null,
        requiredAttrs: {} as Record<string, number[]>,
        attrIndex: new Map<number, { id: number; name: string }[]>(),
      };
    });
    const [
      allPromotions,
      catalog,
      deletedProductIds,
      activeProductIdsWithoutImages,
    ] = await Promise.all([
      fetchAllPromotions(),
      catalogData,
      fetchDeletedProductIds().catch(() => new Set<number>()),
      fetchActiveProductIdsWithoutImages().catch(() => null),
    ]);
    const {
      products: catalogProducts,
      syncedAt,
      requiredAttrs,
      attrIndex,
    } = catalog;
    const today = kyivToday();
    const promotionsWithoutBundles = allPromotions.filter((promotion) => !isBundlePromotion(promotion));
    const dateCurrent = promotionsWithoutBundles.filter((promotion) =>
      isDateCurrentPricingPromotion(promotion, today));
    const publicLinks = buildPublicLinks(promotionsWithoutBundles);
    // Empty promotions are not introduced as new baselines. If a previously
    // captured promotion becomes empty, however, keep it in the comparison so
    // every removed product is still emitted as DELETE.
    const baseline = await readOrExtendPromotionsBaseline(
      dateCurrent.filter((promotion) => promotion.products.length > 0),
    );
    const current = dateCurrent.filter((promotion) =>
      promotion.products.length > 0 || Boolean(baseline.promotions[String(promotion.idinc)]),
    );
    const catalogMaps = mapCatalogProducts(catalogProducts);
    const baselineMembership = new Map<string, Set<number>>();
    const currentMembership = new Map<string, Set<number>>();
    const currentPromotionIds = new Set(current.map((promotion) => promotion.idinc));
    for (const entry of Object.values(baseline.promotions)) {
      if (!currentPromotionIds.has(entry.idinc)) continue;
      for (const product of entry.products) {
        const key = productKey(product);
        const set = baselineMembership.get(key) ?? new Set<number>();
        set.add(entry.idinc);
        baselineMembership.set(key, set);
      }
    }
    for (const promotion of current) {
      for (const product of promotion.products) {
        const key = productKey(product);
        const set = currentMembership.get(key) ?? new Set<number>();
        set.add(promotion.idinc);
        currentMembership.set(key, set);
      }
    }

    const missingAttrsCount = (catalog: ProductLite | undefined) => {
      if (!catalog) return 0;
      const required = requiredAttrs[String(catalog.categoryId)] ?? [];
      if (required.length === 0) return 0;
      const present = new Set((attrIndex.get(catalog.id) ?? []).map((attribute) => attribute.id));
      return required.filter((id) => !present.has(id)).length;
    };

    const makeRow = (
      promotion: ApiPromotion,
      product: {
        id: number;
        goodsRef: number;
        code: number;
        sku: string | null;
        name: string;
        url: string;
        resultPrice: number | null;
        statusId: number;
        statusName: string;
      },
      change: PromotionCatalogRow["change"],
      previousPromotions: { idinc: number; name: string }[] = [],
    ): PromotionCatalogRow => {
      const catalog = findCatalogProduct(catalogMaps, product);
      const basePrice = catalog?.priceBase ?? catalog?.price ?? null;
      const hasPublicProductData = Boolean(
        product.code > 0 && product.goodsRef > 0 && product.name && product.url,
      );
      const onSite = !deletedProductIds.has(product.id) && hasPublicProductData;
      const imagesCount = activeProductIdsWithoutImages === null
        ? (catalog?.imagesCount ?? 0)
        : !onSite || activeProductIdsWithoutImages.has(product.id)
          ? 0
          : Math.max(1, catalog?.imagesCount ?? 0);
      return {
        key: `${change ?? "same"}:${promotion.idinc}:${product.id}`,
        change,
        promotionId: promotion.id,
        promotionIdinc: promotion.idinc,
        promotionName: promotion.name,
        promotionType: promotion.type?.name ?? "Публічна",
        promotionStartDate: promotion.start_date,
        promotionEndDate: promotion.end_date,
        linkedPromotions: publicLinks.get(promotion.idinc) ?? [],
        previousPromotions,
        productId: product.id,
        goodsRef: product.goodsRef,
        code: product.code,
        sku: product.sku,
        name: catalog?.name ?? product.name,
        productUrl: catalog?.url ?? product.url,
        categoryId: catalog?.categoryId ?? null,
        categoryName: catalog?.categoryName ?? "—",
        brand: catalog?.brand ?? "—",
        basePrice,
        promoPrice: product.resultPrice,
        discountPct: pct(basePrice, product.resultPrice),
        stockQty: catalog?.stockQty ?? null,
        statusId: catalog?.statusId ?? product.statusId,
        statusName: catalog?.statusName ?? product.statusName,
        imagesCount,
        reviewsCount: catalog?.reviewsCount ?? 0,
        attributesCount: catalog?.attributesCount ?? 0,
        missingRequiredAttrsCount: missingAttrsCount(catalog),
        onSite,
      };
    };

    const items: PromotionCatalogRow[] = [];
    for (const promotion of current) {
      const initial = baseline.promotions[String(promotion.idinc)];
      const initialIds = new Set((initial?.products ?? []).map(productKey));
      for (const product of promotion.products) {
        const key = productKey(product);
        const wasHere = initialIds.has(key);
        const initialMembership = baselineMembership.get(key) ?? new Set<number>();
        const nowMembership = currentMembership.get(key) ?? new Set<number>();
        const removed = [...initialMembership].filter((idinc) => !nowMembership.has(idinc));
        const addedHere = !wasHere;
        const switched = addedHere && removed.length > 0;
        const previousPromotions = removed.map((idinc) => {
          const previous = baseline.promotions[String(idinc)];
          return { idinc, name: previous?.name ?? `IDINC ${idinc}` };
        });
        items.push(makeRow(promotion, {
          id: product.id,
          goodsRef: product.goods_ref,
          code: product.code,
          sku: product.sku,
          name: product.name,
          url: product.url,
          resultPrice: product.result_price,
          statusId: product.status.id,
          statusName: product.status.name,
        }, switched ? "switch" : addedHere ? "add" : null, previousPromotions));
      }
    }

    for (const promotion of current) {
      const initial = baseline.promotions[String(promotion.idinc)];
      const currentIds = new Set(promotion.products.map(productKey));
      for (const product of initial?.products ?? []) {
        const key = productKey(product);
        if (currentIds.has(key)) continue;
        const nowMembership = currentMembership.get(key) ?? new Set<number>();
        const initialMembership = baselineMembership.get(key) ?? new Set<number>();
        const addedElsewhere = [...nowMembership].some((idinc) => !initialMembership.has(idinc));
        if (addedElsewhere) continue;
        items.push(makeRow(promotion, {
          id: product.id,
          goodsRef: product.goodsRef,
          code: product.code,
          sku: product.sku,
          name: product.name,
          url: product.url,
          resultPrice: product.resultPrice,
          statusId: product.statusId,
          statusName: product.statusName,
        }, "delete"));
      }
    }

    const promotions: PromotionOption[] = current.map((promotion) => {
      const initial = baseline.promotions[String(promotion.idinc)];
      return {
        id: promotion.id,
        idinc: promotion.idinc,
        name: promotion.name,
        type: promotion.type?.name ?? "Публічна",
        percent: promotion.percent,
        startDate: promotion.start_date,
        endDate: promotion.end_date,
        linkedPromotions: publicLinks.get(promotion.idinc) ?? [],
        productCount: promotion.products.length,
        baselineCapturedAt: initial?.capturedAt ?? baseline.capturedAt,
        isNew: Boolean(initial && initial.capturedAt !== baseline.capturedAt),
        active: promotion.active,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, "uk"));

    const uniqueLinks = new Map<number, PromotionLink>();
    for (const links of publicLinks.values()) {
      for (const link of links) uniqueLinks.set(link.idinc, link);
    }

    const response: PromotionsCatalogResponse = {
      items,
      promotions,
      linkedPromotions: [...uniqueLinks.values()].sort((a, b) => a.name.localeCompare(b.name, "uk")),
      baselineCapturedAt: baseline.capturedAt,
      syncedAt,
      generatedAt: new Date().toISOString(),
      today,
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося завантажити акції" },
      { status: 500 },
    );
  }
}
