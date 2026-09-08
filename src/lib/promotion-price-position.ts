import { GET as parserPricesGet } from "@/app/api/parser/prices/route";
import { fetchAllPromotions, isBundlePromotion } from "@/lib/products-api";

export type PromotionPricePosition = "all" | "lower" | "higher";

type ParserPriceRow = {
  code: number | null;
  ourPrice: number | null;
  byCompetitor: Record<string, { price: number | null } | undefined>;
};

type ParserPricesPayload = { rows?: ParserPriceRow[] };

export type DailyPricePositionGroups = {
  snapshotDate: string;
  betterCodes: number[];
  worseCodes: number[];
};

export function normalizePromotionPricePosition(value: string | null): PromotionPricePosition {
  return value === "lower" || value === "higher" ? value : "all";
}

function matchesPosition(row: ParserPriceRow, position: Exclude<PromotionPricePosition, "all">) {
  if (!Number.isFinite(row.ourPrice) || (row.ourPrice ?? 0) <= 0) return false;
  const competitorPrices = Object.values(row.byCompetitor || {})
    .map((cell) => cell?.price)
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price) && price > 0);
  if (!competitorPrices.length) return false;
  const lowestCompetitorPrice = Math.min(...competitorPrices);
  return position === "lower"
    ? (row.ourPrice as number) < lowestCompetitorPrice
    : (row.ourPrice as number) > lowestCompetitorPrice;
}

export async function readPricePositionCodes(position: PromotionPricePosition): Promise<Set<number> | null> {
  if (position === "all") return null;
  const groups = await readCurrentPricePositionGroups();
  return new Set(position === "lower" ? groups.betterCodes : groups.worseCodes);
}

export async function readCurrentPricePositionGroups(): Promise<DailyPricePositionGroups> {
  const url = new URL("http://internal/api/parser/prices");
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", "10000");
  const headers = process.env.CRON_SECRET
    ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
    : undefined;
  const response = await parserPricesGet(new Request(url, { headers }));
  if (!response.ok) throw new Error(`parser_prices_${response.status}`);
  const payload = await response.json() as ParserPricesPayload;
  const rows = payload.rows ?? [];
  const uniqueSorted = (position: "lower" | "higher") => [...new Set(rows
    .filter((row) => row.code != null && matchesPosition(row, position))
    .map((row) => row.code as number))].sort((left, right) => left - right);
  const datedPayload = payload as ParserPricesPayload & { snapshotDate?: string | null };
  return {
    snapshotDate: datedPayload.snapshotDate || new Date().toISOString().slice(0, 10),
    betterCodes: uniqueSorted("lower"),
    worseCodes: uniqueSorted("higher"),
  };
}

function overlapsRange(
  promotion: { start_date: string | null; end_date: string | null; is_unlimited: boolean },
  from: string,
  to: string,
) {
  if (promotion.start_date && promotion.start_date > to) return false;
  if (!promotion.is_unlimited && promotion.end_date && promotion.end_date < from) return false;
  return true;
}

export async function readPromotionalPricePositionCodes(
  position: Exclude<PromotionPricePosition, "all">,
  from: string,
  to: string,
): Promise<Set<number>> {
  const [positionCodes, promotions] = await Promise.all([
    readPricePositionCodes(position),
    fetchAllPromotions(),
  ]);
  const promotionalCodes = new Set(promotions
    .filter((promotion) => !isBundlePromotion(promotion) && !promotion.has_related)
    .filter((promotion) => overlapsRange(promotion, from, to))
    .flatMap((promotion) => promotion.products.map((product) => product.code))
    .filter((code) => Number.isFinite(code) && code > 0));
  return new Set([...(positionCodes ?? [])].filter((code) => promotionalCodes.has(code)));
}
