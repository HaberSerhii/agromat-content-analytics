export type CompetitorPriceReviewReason =
  | "out_of_stock"
  | "partial_match"
  | "brand_missing"
  | "brand_mismatch"
  | "availability_unknown"
  | "parse_error"
  | null;

const IN_STOCK_RE = /instock|in\s*stock|є\s+в\s+наявності|в\s+наявності|в\s+наличии|наявний|доступний/i;
const OUT_OF_STOCK_RE = /out\s*of\s*stock|outofstock|немає|нет\s+в\s+наличии|відсут|закінчив/i;
const PRICE_UNAVAILABLE_RE = /ціна\s+(?:відсутня|не\s+вказана)|цена\s+(?:отсутствует|не\s+указана)/i;

const BRAND_ALIASES = new Map([
  ["groheag", "grohe"],
  ["hansgrohegroup", "hansgrohe"],
  ["ampm", "ampm"],
  ["villeroybosch", "villeroyboch"],
  ["villeroyanboch", "villeroyboch"],
  ["vileroybosch", "villeroyboch"],
]);

const BRAND_NOISE_TOKENS = new Set([
  "ag", "co", "gmbh", "inc", "kg", "llc", "ltd", "sa", "se", "sl", "sp",
  "company", "group", "international", "sales", "armaturen", "rubinetteria",
  "germany", "italy", "poland", "switzerland",
  "германия", "италия", "польша", "швейцария",
  "німеччина", "італія", "польща", "швейцарія",
]);

export function normalizeCompetitorBrand(value: string | null | undefined): string {
  const key = String(value || "").toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, "");
  return BRAND_ALIASES.get(key) || key;
}

export function competitorBrandsMatch(
  expected: string | null | undefined,
  found: string | null | undefined,
): boolean {
  const a = normalizeCompetitorBrand(expected);
  const b = normalizeCompetitorBrand(found);
  if (!a || !b) return false;
  if (a === b) return true;
  const expectedTokens = competitorBrandTokens(expected);
  const foundTokens = competitorBrandTokens(found);
  return expectedTokens.some((token) => foundTokens.includes(token));
}

function competitorBrandTokens(value: string | null | undefined): string[] {
  return String(value || "").toLowerCase().split(/[^a-zа-яіїєґ0-9]+/i)
    .map(normalizeCompetitorBrand)
    .filter((token) => token.length >= 3 && !BRAND_NOISE_TOKENS.has(token));
}

export function competitorBrandAppearsInText(
  expected: string | null | undefined,
  text: string | null | undefined,
): boolean {
  const tokens = competitorBrandTokens(expected);
  const normalizedText = normalizeCompetitorBrand(text);
  return tokens.length > 0 && tokens.some((token) => normalizedText.includes(token));
}

export function isCompetitorInStock(status: string | null | undefined): boolean {
  const value = String(status || "");
  return !PRICE_UNAVAILABLE_RE.test(value) && !OUT_OF_STOCK_RE.test(value) && IN_STOCK_RE.test(value);
}

export function evaluateCompetitorPrice(input: {
  observedPrice: number | null;
  status: string | null;
  confidence: string | null;
  expectedBrand: string | null;
  foundBrand: string | null;
}): { price: number | null; reviewReason: CompetitorPriceReviewReason } {
  const { observedPrice, status, confidence, expectedBrand, foundBrand } = input;
  const statusValue = String(status || "");
  if (!PRICE_UNAVAILABLE_RE.test(statusValue) && OUT_OF_STOCK_RE.test(statusValue)) {
    return { price: null, reviewReason: "out_of_stock" };
  }
  if (expectedBrand && foundBrand && !competitorBrandsMatch(expectedBrand, foundBrand)) {
    return { price: null, reviewReason: "brand_mismatch" };
  }
  if (observedPrice == null || observedPrice <= 0) {
    const parseError = /error|blocked|http_|parse/i.test(String(status || ""));
    return { price: null, reviewReason: parseError ? "parse_error" : "availability_unknown" };
  }
  if (!isCompetitorInStock(status)) {
    return { price: null, reviewReason: "availability_unknown" };
  }
  if (expectedBrand && !foundBrand) {
    return { price: null, reviewReason: "brand_missing" };
  }
  if (confidence !== "exact") {
    return { price: null, reviewReason: "partial_match" };
  }
  return { price: observedPrice, reviewReason: null };
}
