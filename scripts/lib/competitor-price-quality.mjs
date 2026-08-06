const IN_STOCK_RE = /instock|in\s*stock|є\s+в\s+наявності|в\s+наявності|в\s+наличии|наявний|доступний/i;
const OUT_OF_STOCK_RE = /out\s*of\s*stock|outofstock|немає|нет\s+в\s+наличии|відсут|закінчив/i;

const BRAND_ALIASES = new Map([
  ["groheag", "grohe"],
  ["hansgrohegroup", "hansgrohe"],
  ["ampm", "ampm"],
]);

export function normalizeBrand(value) {
  const key = String(value || "").toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, "");
  return BRAND_ALIASES.get(key) || key;
}

export function brandsMatch(expected, found) {
  const a = normalizeBrand(expected);
  const b = normalizeBrand(found);
  return Boolean(a && b && (a === b || (a.length > 3 && (a.includes(b) || b.includes(a)))));
}

export function brandAppearsInText(expected, text) {
  const ignored = new Set(["ag", "gmbh", "ltd", "llc", "sl", "sa", "inc", "company", "group"]);
  const tokens = String(expected || "").toLowerCase().split(/[^a-zа-яіїєґ0-9]+/i)
    .map(normalizeBrand)
    .filter((token) => token.length >= 3 && !ignored.has(token));
  const normalizedText = normalizeBrand(text);
  return tokens.length > 0 && tokens.some((token) => normalizedText.includes(token));
}

export function isInStockStatus(status) {
  const value = String(status || "");
  return !OUT_OF_STOCK_RE.test(value) && IN_STOCK_RE.test(value);
}

export function isOutOfStockStatus(status) {
  return OUT_OF_STOCK_RE.test(String(status || ""));
}

export function priceForSnapshot(price, status) {
  return isInStockStatus(status) && Number(price) > 0 ? Number(price) : null;
}

export function matchConfidence(expectedBrand, foundBrand, current = "exact", sourceText = "") {
  if (!expectedBrand) return current;
  if (!foundBrand && brandAppearsInText(expectedBrand, sourceText)) return current;
  if (!foundBrand) return "partial";
  if (!brandsMatch(expectedBrand, foundBrand)) return "rejected";
  return current;
}

export function snapshotQualityIssue(previousRows, currentRows) {
  if (currentRows.length < 100) return null;
  const currentOut = currentRows.filter((row) => isOutOfStockStatus(row.status)).length;
  const currentRate = currentOut / currentRows.length;
  if (currentRate >= 0.8) {
    return `out_of_stock spike: ${currentOut}/${currentRows.length} (${Math.round(currentRate * 100)}%)`;
  }
  if (previousRows.length < 100) return null;
  const previousOut = previousRows.filter((row) => isOutOfStockStatus(row.status)).length;
  const previousRate = previousOut / previousRows.length;
  const allowedRate = Math.max(previousRate + 0.15, previousRate * 1.8);
  return currentRate > allowedRate
    ? `out_of_stock spike: ${Math.round(previousRate * 100)}% -> ${Math.round(currentRate * 100)}%`
    : null;
}
