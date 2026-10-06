export const PRODUCT_SORT_COLUMNS = [
  ["name", "Товар"], ["categoryName", "Категорія"], ["brand", "Бренд"],
  ["sku", "Артикул"], ["imagesCount", "Фото"],
  ["missingRequiredAttrsCount", "Атрибути"], ["reviewsCount", "Відгуки"],
  ["stockQty", "Залишок"], ["impressions", "Impressions"],
  ["ctr", "CTR"], ["atc", "ATC"], ["contentScore", "Content Score"],
] as const;
export type ProductSortKey = typeof PRODUCT_SORT_COLUMNS[number][0];
export function normalizeProductSortKey(value: unknown): ProductSortKey | null {
  return PRODUCT_SORT_COLUMNS.some(([key]) => key === value) ? value as ProductSortKey : null;
}
export function compareProductAnalysisRows(
  left: Partial<Record<ProductSortKey, string | number | null>> & { id: string | number },
  right: Partial<Record<ProductSortKey, string | number | null>> & { id: string | number },
  key: ProductSortKey,
  direction: "asc" | "desc",
) {
  const a = left[key];
  const b = right[key];
  const missingA = a == null || a === "";
  const missingB = b == null || b === "";
  if (missingA !== missingB) return missingA ? 1 : -1;
  const value = missingA ? 0 : typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), "uk", { numeric: true, sensitivity: "base" });
  return value ? value * (direction === "asc" ? 1 : -1) : String(left.id).localeCompare(String(right.id), "uk", { numeric: true });
}
