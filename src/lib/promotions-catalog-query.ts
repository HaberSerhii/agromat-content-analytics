import type {
  PromotionCatalogRow,
  PromotionOption,
  PromotionsCatalogFacets,
  PromotionsCatalogSummary,
} from "@/lib/promotions-types";

export type PromotionsKpiFilter =
  | "all"
  | "promotions"
  | "new_promotions"
  | "disabled_promotions"
  | "added_products"
  | "deleted_products"
  | "switched_products"
  | "updated_products"
  | "products"
  | "linked"
  | "not_site"
  | "no_photo"
  | "missing_attributes"
  | "no_reviews"
  | "no_sku";

export interface PromotionsCatalogFilters {
  search: string;
  category: string;
  brand: string;
  price: string;
  stock: string;
  photo: string;
  attributes: string;
  reviews: string;
  sku: string;
  statuses: Set<string> | null;
  promotions: Set<string> | null;
  links: Set<string> | null;
  kpi: PromotionsKpiFilter;
}

export const UNLINKED_PROMOTION = "__unlinked__";

const KPI_FILTERS = new Set<PromotionsKpiFilter>([
  "all", "promotions", "new_promotions", "disabled_promotions",
  "added_products", "deleted_products", "switched_products", "updated_products",
  "products", "linked", "not_site", "no_photo", "missing_attributes",
  "no_reviews", "no_sku",
]);

function setParam(searchParams: URLSearchParams, name: string): Set<string> | null {
  if (!searchParams.has(name)) return null;
  const value = searchParams.get(name) ?? "";
  return new Set(value ? value.split(",") : []);
}

export function parsePromotionsCatalogFilters(searchParams: URLSearchParams): PromotionsCatalogFilters {
  const requestedKpi = searchParams.get("kpi") as PromotionsKpiFilter | null;
  return {
    search: searchParams.get("search") ?? "",
    category: searchParams.get("category") ?? "all",
    brand: searchParams.get("brand") ?? "all",
    price: searchParams.get("price") ?? "all",
    stock: searchParams.get("stock") ?? "all",
    photo: searchParams.get("photo") ?? "all",
    attributes: searchParams.get("attributes") ?? "all",
    reviews: searchParams.get("reviews") ?? "all",
    sku: searchParams.get("sku") ?? "all",
    statuses: setParam(searchParams, "statuses"),
    promotions: setParam(searchParams, "promotions"),
    links: setParam(searchParams, "links"),
    kpi: requestedKpi && KPI_FILTERS.has(requestedKpi) ? requestedKpi : "all",
  };
}

export function buildPromotionsCatalogFacets(items: PromotionCatalogRow[]): PromotionsCatalogFacets {
  const categories = new Map<number, string>();
  const brands = new Set<string>();
  const statuses = new Map<number, string>();
  for (const item of items) {
    if (item.categoryId != null) categories.set(item.categoryId, item.categoryName);
    if (item.brand !== "—") brands.add(item.brand);
    statuses.set(item.statusId, item.statusName);
  }
  return {
    categories: [...categories.entries()].sort((a, b) => a[1].localeCompare(b[1], "uk")),
    brands: [...brands].sort((a, b) => a.localeCompare(b, "uk")),
    statuses: [...statuses.entries()].sort((a, b) => a[1].localeCompare(b[1], "uk")),
  };
}

export function filterPromotionsCatalogRows(
  items: PromotionCatalogRow[],
  filters: PromotionsCatalogFilters,
): PromotionCatalogRow[] {
  const normalizedSearch = filters.search.trim().toLowerCase();
  return items.filter((item) => {
    if (normalizedSearch && ![
      item.name,
      item.sku ?? "",
      String(item.code),
      String(item.goodsRef),
      String(item.productId),
      item.promotionName,
      String(item.promotionId),
      String(item.promotionIdinc),
    ].some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch))) return false;
    if (filters.category !== "all" && item.categoryId !== Number(filters.category)) return false;
    if (filters.brand !== "all" && item.brand !== filters.brand) return false;
    if (filters.price === "under1000" && !(item.promoPrice != null && item.promoPrice < 1000)) return false;
    if (filters.price === "1000to5000" && !(item.promoPrice != null && item.promoPrice >= 1000 && item.promoPrice <= 5000)) return false;
    if (filters.price === "over5000" && !(item.promoPrice != null && item.promoPrice > 5000)) return false;
    if (filters.stock === "positive" && !(item.stockQty != null && item.stockQty > 0)) return false;
    if (filters.stock === "zero" && item.stockQty !== 0) return false;
    if (filters.photo === "none" && (!item.onSite || item.imagesCount !== 0)) return false;
    if (filters.photo === "lt2" && (!item.onSite || item.imagesCount >= 2)) return false;
    if (filters.attributes === "none" && item.attributesCount !== 0) return false;
    if (filters.attributes === "missing" && item.missingRequiredAttrsCount === 0) return false;
    if (filters.reviews === "yes" && item.reviewsCount === 0) return false;
    if (filters.reviews === "no" && item.reviewsCount > 0) return false;
    if (filters.sku === "yes" && !item.sku) return false;
    if (filters.sku === "no" && item.sku) return false;
    if (filters.statuses !== null && !filters.statuses.has(String(item.statusId))) return false;
    if (filters.promotions !== null && !filters.promotions.has(String(item.promotionIdinc))) return false;
    if (filters.links !== null) {
      if (item.linkedPromotions.length === 0 && !filters.links.has(UNLINKED_PROMOTION)) return false;
      if (item.linkedPromotions.length > 0
        && !item.linkedPromotions.some((link) => filters.links?.has(String(link.idinc)))) return false;
    }
    return true;
  });
}

export function summarizePromotionsCatalog(
  rows: PromotionCatalogRow[],
  promotions: PromotionOption[],
): PromotionsCatalogSummary {
  const currentRows = rows.filter((item) => item.change !== "delete");
  const countUnique = (predicate: (item: PromotionCatalogRow) => boolean) =>
    new Set(currentRows.filter(predicate).map((item) => item.productId)).size;
  const representedPromotions = new Set(currentRows.map((item) => item.promotionIdinc));
  const representedOptions = promotions.filter((promotion) => representedPromotions.has(promotion.idinc));
  return {
    promotions: representedPromotions.size,
    products: countUnique(() => true),
    positions: currentRows.length,
    linkedProducts: countUnique((item) => item.linkedPromotions.length > 0),
    notOnSite: countUnique((item) => item.onSite === false),
    newPromotions: representedOptions.filter((promotion) => promotion.isNew).length,
    disabledPromotions: representedOptions.filter((promotion) => !promotion.active).length,
    addedProducts: new Set(rows.filter((item) => item.change === "add").map((item) => item.productId)).size,
    deletedProducts: new Set(rows.filter((item) => item.change === "delete").map((item) => item.productId)).size,
    switchedProducts: new Set(rows.filter((item) => item.change === "switch").map((item) => item.productId)).size,
    updatedProducts: new Set(rows.filter((item) => item.change === "update").map((item) => item.productId)).size,
    noPhoto: countUnique((item) => item.onSite && item.imagesCount === 0),
    missingAttributes: countUnique((item) => item.onSite && item.missingRequiredAttrsCount > 0),
    noReviews: countUnique((item) => item.onSite && item.reviewsCount === 0),
    noSku: countUnique((item) => item.onSite && !item.sku),
  };
}

export function applyPromotionsKpiFilter(
  rows: PromotionCatalogRow[],
  promotions: PromotionOption[],
  kpi: PromotionsKpiFilter,
): PromotionCatalogRow[] {
  if (kpi === "all") return rows;
  const promotionMap = new Map(promotions.map((promotion) => [promotion.idinc, promotion]));
  return rows.filter((item) => {
    const promotion = promotionMap.get(item.promotionIdinc);
    switch (kpi) {
      case "added_products": return item.change === "add";
      case "deleted_products": return item.change === "delete";
      case "switched_products": return item.change === "switch";
      case "updated_products": return item.change === "update";
      case "promotions":
      case "products": return item.change !== "delete";
      case "new_promotions": return item.change !== "delete" && promotion?.isNew === true;
      case "disabled_promotions": return item.change !== "delete" && promotion?.active === false;
      case "linked": return item.change !== "delete" && item.linkedPromotions.length > 0;
      case "not_site": return item.change !== "delete" && item.onSite === false;
      case "no_photo": return item.change !== "delete" && item.onSite && item.imagesCount === 0;
      case "missing_attributes": return item.change !== "delete" && item.onSite && item.missingRequiredAttrsCount > 0;
      case "no_reviews": return item.change !== "delete" && item.onSite && item.reviewsCount === 0;
      case "no_sku": return item.change !== "delete" && item.onSite && !item.sku;
      default: return true;
    }
  });
}
