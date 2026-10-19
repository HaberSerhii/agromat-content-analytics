import { isBundlePromotion, type ApiPromotion } from "@/lib/products-api";

export type PromotionInventoryProgram = {
  idinc: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
  productCount: number;
  url: string | null;
};
export type PromotionInventory = {
  date: string;
  previousDate: string;
  available: boolean;
  changesAvailable: boolean;
  capturedAt: string | null;
  promotions: PromotionInventoryProgram[];
  productCodes: number[];
  changes: { promotions: { added: number; removed: number }; products: { added: number; removed: number } } | null;
};

export function inventoryOnDate(promotions: ApiPromotion[], date: string, allowedCodes: Set<number> | null = null) {
  const products = new Set<number>();
  const programs: PromotionInventoryProgram[] = [];
  for (const promotion of promotions) {
    // These are P2 pricing programs. Their live `active` flag describes public
    // site visibility, not whether their prices apply on the requested date.
    if (promotion.has_related || isBundlePromotion(promotion)) continue;
    if (promotion.start_date && promotion.start_date > date) continue;
    if (!promotion.is_unlimited && promotion.end_date && promotion.end_date < date) continue;
    const codes = new Set(promotion.products.map(product => product.code)
      .filter(code => Number.isFinite(code) && code > 0 && (!allowedCodes || allowedCodes.has(code))));
    if (!codes.size) continue;
    for (const code of codes) products.add(code);
    programs.push({ idinc: promotion.idinc, name: promotion.name, startDate: promotion.start_date,
      endDate: promotion.is_unlimited ? null : promotion.end_date, productCount: codes.size, url: promotion.url });
  }
  return { promotions: programs.sort((a, b) => a.name.localeCompare(b.name, "uk")), productCodes: [...products].sort((a, b) => a - b) };
}

export function inventoryChanges(current: ReturnType<typeof inventoryOnDate>, previous: ReturnType<typeof inventoryOnDate>) {
  const difference = (now: number[], before: number[]) => {
    const currentSet = new Set(now), previousSet = new Set(before);
    return { added: [...currentSet].filter(value => !previousSet.has(value)).length,
      removed: [...previousSet].filter(value => !currentSet.has(value)).length };
  };
  return {
    promotions: difference(current.promotions.map(program => program.idinc), previous.promotions.map(program => program.idinc)),
    products: difference(current.productCodes, previous.productCodes),
  };
}
