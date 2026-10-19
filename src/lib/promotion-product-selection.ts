export type PromotionProductSelection = { date: string; label: string; productCodes: number[] };

export function normalizePromotionCodes(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((code): code is number => typeof code === "number" && Number.isSafeInteger(code) && code > 0))];
}

export function parsePromotionProductSelection(value: string | null): PromotionProductSelection | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    const productCodes = normalizePromotionCodes(parsed.productCodes);
    if (!productCodes || typeof parsed.label !== "string" || typeof parsed.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) return null;
    return { date: parsed.date, label: parsed.label, productCodes };
  } catch { return null; }
}
