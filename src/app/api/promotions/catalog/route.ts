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
  listPromotionsSnapshotDates,
  readPromotionsDailySnapshot,
  writePromotionsDailySnapshot,
} from "@/lib/promotions-daily-snapshots";
import {
  readAllLite,
  readDailySnapshot,
  readLiteSyncedAt,
  readProductAttributeIndex,
  readRequiredAttrs,
  type ProductLite,
} from "@/lib/products-store";
import { readDiskSnapshot } from "@/lib/products-disk-cache";
import type {
  PromotionCatalogRow,
  PromotionLink,
  PromotionOption,
  PromotionsCatalogResponse,
} from "@/lib/promotions-types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function isDateCurrentPricingPromotion(promotion: ApiPromotion, date: string): boolean {
  if (promotion.has_related) return false;
  if (promotion.is_unlimited) return true;
  return (!promotion.start_date || promotion.start_date <= date)
    && (!promotion.end_date || promotion.end_date >= date);
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
      url: promotion.url.replace(/\/actions\//, "/discount/").replace(/\/?$/, "/"),
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

function productKey(product: Pick<ApiPromotionProduct, "id">): string {
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
  product: { id: number; goods_ref: number; code: number },
): ProductLite | undefined {
  return maps.byId.get(product.id) ?? maps.byRef.get(product.goods_ref) ?? maps.byCode.get(product.code);
}

function promotionMap(promotions: ApiPromotion[]): Map<number, ApiPromotion> {
  return new Map(promotions.map((promotion) => [promotion.idinc, promotion]));
}

function membershipMap(promotions: ApiPromotion[]): Map<string, Set<number>> {
  const membership = new Map<string, Set<number>>();
  for (const promotion of promotions) {
    for (const product of promotion.products) {
      const key = productKey(product);
      const set = membership.get(key) ?? new Set<number>();
      set.add(promotion.idinc);
      membership.set(key, set);
    }
  }
  return membership;
}

function missingDateResponse(date: string, availableDates: string[]) {
  return NextResponse.json({
    error: `Немає знімка акцій за ${date}`,
    availableDates,
  }, { status: 404 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedFrom = url.searchParams.get("from");
    const requestedTo = url.searchParams.get("to");
    if ((requestedFrom && !DATE_RE.test(requestedFrom)) || (requestedTo && !DATE_RE.test(requestedTo))) {
      return NextResponse.json({ error: "Дата має формат YYYY-MM-DD" }, { status: 400 });
    }
    if (requestedFrom && requestedTo && requestedFrom > requestedTo) {
      return NextResponse.json({ error: "Дата від не може бути пізніше дати до" }, { status: 400 });
    }

    const today = kyivToday();
    const toDate = requestedTo ?? today;
    const targetIsLive = toDate === today;

    const catalogMetadata = Promise.all([
      readRequiredAttrs(),
      readProductAttributeIndex(),
    ]).then(([requiredAttrs, attrIndex]) => ({ requiredAttrs, attrIndex }));

    let targetAllPromotions: ApiPromotion[];
    let targetCapturedAt: string;
    let targetCatalogProducts: ProductLite[];
    let syncedAt: string | null;

    if (targetIsLive) {
      const catalogData = Promise.all([readAllLite(), readLiteSyncedAt()])
        .then(([products, liveSyncedAt]) => ({ products, syncedAt: liveSyncedAt }))
        .catch(() => {
          const disk = readDiskSnapshot();
          return { products: disk?.products ?? [], syncedAt: disk?.syncedAt ?? null };
        });
      const [allPromotions, catalog] = await Promise.all([fetchAllPromotions(), catalogData]);
      targetAllPromotions = allPromotions;
      targetCapturedAt = new Date().toISOString();
      targetCatalogProducts = catalog.products;
      syncedAt = catalog.syncedAt;
      // Opening today's dashboard also self-heals a missed cron capture.
      try {
        writePromotionsDailySnapshot(today, targetAllPromotions, targetCapturedAt);
      } catch (error) {
        console.warn("[promotions/catalog] snapshot capture failed:", error instanceof Error ? error.message : error);
      }
    } else {
      const [promotionSnapshot, productSnapshot] = await Promise.all([
        Promise.resolve(readPromotionsDailySnapshot(toDate)),
        readDailySnapshot(toDate),
      ]);
      const availableDates = listPromotionsSnapshotDates();
      if (!promotionSnapshot) return missingDateResponse(toDate, availableDates);
      targetAllPromotions = promotionSnapshot.promotions;
      targetCapturedAt = promotionSnapshot.capturedAt;
      targetCatalogProducts = productSnapshot?.products ?? [];
      syncedAt = productSnapshot?.syncedAt ?? null;
    }

    const availableDates = listPromotionsSnapshotDates();
    const defaultFrom = [...availableDates].reverse().find((date) => date < toDate) ?? toDate;
    const fromDate = requestedFrom ?? defaultFrom;
    if (fromDate > toDate) {
      return NextResponse.json({ error: "Дата від не може бути пізніше дати до" }, { status: 400 });
    }

    let baselineAllPromotions: ApiPromotion[];
    let baselineCapturedAt: string;
    let baselineCatalogProducts: ProductLite[];
    if (fromDate === toDate) {
      baselineAllPromotions = targetAllPromotions;
      baselineCapturedAt = targetCapturedAt;
      baselineCatalogProducts = targetCatalogProducts;
    } else {
      const [promotionSnapshot, productSnapshot] = await Promise.all([
        Promise.resolve(readPromotionsDailySnapshot(fromDate)),
        readDailySnapshot(fromDate),
      ]);
      if (!promotionSnapshot) return missingDateResponse(fromDate, availableDates);
      baselineAllPromotions = promotionSnapshot.promotions;
      baselineCapturedAt = promotionSnapshot.capturedAt;
      baselineCatalogProducts = productSnapshot?.products ?? [];
    }

    const [{ requiredAttrs, attrIndex }, deletedProductIds, activeProductIdsWithoutImages] = await Promise.all([
      catalogMetadata,
      targetIsLive ? fetchDeletedProductIds().catch(() => new Set<number>()) : Promise.resolve(new Set<number>()),
      targetIsLive ? fetchActiveProductIdsWithoutImages().catch(() => null) : Promise.resolve(null),
    ]);

    const targetAll = targetAllPromotions.filter((promotion) => !isBundlePromotion(promotion));
    const baselineAll = baselineAllPromotions.filter((promotion) => !isBundlePromotion(promotion));
    const current = targetAll.filter((promotion) => isDateCurrentPricingPromotion(promotion, toDate));
    const baseline = baselineAll.filter((promotion) => isDateCurrentPricingPromotion(promotion, fromDate));
    const currentById = promotionMap(current);
    const baselineById = promotionMap(baseline);
    const currentMembership = membershipMap(current);
    const baselineMembership = membershipMap(baseline);
    const currentLinks = buildPublicLinks(targetAll);
    const baselineLinks = buildPublicLinks(baselineAll);
    const targetCatalogMaps = mapCatalogProducts(targetCatalogProducts);
    const baselineCatalogMaps = mapCatalogProducts(baselineCatalogProducts);

    const missingAttrsCount = (catalog: ProductLite | undefined) => {
      if (!catalog) return 0;
      const required = requiredAttrs[String(catalog.categoryId)] ?? [];
      if (required.length === 0) return 0;
      const present = new Set((attrIndex.get(catalog.id) ?? []).map((attribute) => attribute.id));
      return required.filter((id) => !present.has(id)).length;
    };

    const makeRow = (
      promotion: ApiPromotion,
      product: ApiPromotionProduct,
      change: PromotionCatalogRow["change"],
      catalogMaps: ReturnType<typeof mapCatalogProducts>,
      links: Map<number, PromotionLink[]>,
      previousPromotions: { idinc: number; name: string }[] = [],
      previousPromoPrice: number | null = null,
    ): PromotionCatalogRow => {
      const catalog = findCatalogProduct(catalogMaps, product);
      const basePrice = catalog?.priceBase ?? catalog?.price ?? null;
      const hasPublicProductData = Boolean(product.code > 0 && product.goods_ref > 0 && product.name && product.url);
      const onSite = targetIsLive
        ? !deletedProductIds.has(product.id) && hasPublicProductData
        : Boolean(catalog && !catalog.deleted && hasPublicProductData);
      const imagesCount = targetIsLive
        ? activeProductIdsWithoutImages === null
          ? (catalog?.imagesCount ?? 0)
          : !onSite || activeProductIdsWithoutImages.has(product.id)
            ? 0
            : Math.max(1, catalog?.imagesCount ?? 0)
        : (catalog?.imagesCount ?? 0);
      return {
        key: `${change ?? "same"}:${promotion.idinc}:${product.id}`,
        change,
        promotionId: promotion.id,
        promotionIdinc: promotion.idinc,
        promotionName: promotion.name,
        promotionType: promotion.type?.name ?? "Публічна",
        promotionStartDate: promotion.start_date,
        promotionEndDate: promotion.end_date,
        linkedPromotions: links.get(promotion.idinc) ?? [],
        previousPromotions,
        productId: product.id,
        goodsRef: product.goods_ref,
        code: product.code,
        sku: product.sku,
        name: catalog?.name ?? product.name,
        productUrl: catalog?.url ?? product.url,
        categoryId: catalog?.categoryId ?? null,
        categoryName: catalog?.categoryName ?? "—",
        brand: catalog?.brand ?? "—",
        basePrice,
        promoPrice: product.result_price,
        previousPromoPrice,
        discountPct: pct(basePrice, product.result_price),
        stockQty: catalog?.stockQty ?? null,
        statusId: catalog?.statusId ?? product.status.id,
        statusName: catalog?.statusName ?? product.status.name,
        imagesCount,
        reviewsCount: catalog?.reviewsCount ?? 0,
        attributesCount: catalog?.attributesCount ?? 0,
        missingRequiredAttrsCount: missingAttrsCount(catalog),
        onSite,
      };
    };

    const items: PromotionCatalogRow[] = [];
    for (const promotion of current) {
      const initial = baselineById.get(promotion.idinc);
      const initialIds = new Set((initial?.products ?? []).map(productKey));
      const initialProducts = new Map((initial?.products ?? []).map((product) => [productKey(product), product]));
      for (const product of promotion.products) {
        const key = productKey(product);
        const initialMembership = baselineMembership.get(key) ?? new Set<number>();
        const nowMembership = currentMembership.get(key) ?? new Set<number>();
        const removed = [...initialMembership].filter((idinc) => !nowMembership.has(idinc));
        const addedHere = !initialIds.has(key);
        const switched = addedHere && removed.length > 0;
        const previousProduct = initialProducts.get(key);
        const priceChanged = Boolean(
          previousProduct
          && previousProduct.result_price !== product.result_price,
        );
        const previousPromotions = removed.map((idinc) => ({
          idinc,
          name: baselineById.get(idinc)?.name ?? `IDINC ${idinc}`,
        }));
        items.push(makeRow(
          promotion,
          product,
          switched ? "switch" : addedHere ? "add" : priceChanged ? "update" : null,
          targetCatalogMaps,
          currentLinks,
          previousPromotions,
          priceChanged ? (previousProduct?.result_price ?? null) : null,
        ));
      }
    }

    for (const promotion of baseline) {
      const currentPromotion = currentById.get(promotion.idinc);
      const currentIds = new Set((currentPromotion?.products ?? []).map(productKey));
      for (const product of promotion.products) {
        const key = productKey(product);
        if (currentIds.has(key)) continue;
        const nowMembership = currentMembership.get(key) ?? new Set<number>();
        const initialMembership = baselineMembership.get(key) ?? new Set<number>();
        const addedElsewhere = [...nowMembership].some((idinc) => !initialMembership.has(idinc));
        if (addedElsewhere) continue;
        items.push(makeRow(promotion, product, "delete", baselineCatalogMaps, baselineLinks));
      }
    }

    const promotions: PromotionOption[] = current.map((promotion) => ({
      id: promotion.id,
      idinc: promotion.idinc,
      name: promotion.name,
      type: promotion.type?.name ?? "Публічна",
      percent: promotion.percent,
      startDate: promotion.start_date,
      endDate: promotion.end_date,
      linkedPromotions: currentLinks.get(promotion.idinc) ?? [],
      productCount: promotion.products.length,
      baselineCapturedAt,
      isNew: !baselineById.has(promotion.idinc),
      active: promotion.active,
    })).sort((a, b) => a.name.localeCompare(b.name, "uk"));

    const uniqueLinks = new Map<number, PromotionLink>();
    for (const links of currentLinks.values()) {
      for (const link of links) uniqueLinks.set(link.idinc, link);
    }

    const response: PromotionsCatalogResponse = {
      items,
      promotions,
      linkedPromotions: [...uniqueLinks.values()].sort((a, b) => a.name.localeCompare(b.name, "uk")),
      baselineCapturedAt,
      snapshotCapturedAt: targetCapturedAt,
      snapshotDates: availableDates,
      fromDate,
      toDate,
      syncedAt,
      generatedAt: new Date().toISOString(),
      today,
    };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося завантажити акції" },
      { status: 500 },
    );
  }
}
