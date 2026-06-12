import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { readAllLite, readFiltersCache, readLiteSyncedAt, type TimelineEvent } from "@/lib/products-store";

export const dynamic = "force-dynamic";

type Bucket = {
  key: string;
  name: string;
  total: number;
  up: number;
  down: number;
  withoutDiscount: number;
  withDiscount: number;
};

const ARCHIVE_STATUS_ID = -1;
const NO_BRAND_KEY = "none";

function bucket(map: Map<string, Bucket>, key: string, name: string) {
  const label = name.trim() || "Без назви";
  let value = map.get(key);
  if (!value) {
    value = { key, name: label, total: 0, up: 0, down: 0, withoutDiscount: 0, withDiscount: 0 };
    map.set(key, value);
  }
  return value;
}

function inRange(value: string | null | undefined, since: number, until: number) {
  if (!value) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= since && ms <= until;
}

function parseTimeline(raws: string[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const raw of raws) {
    try { out.push(JSON.parse(raw) as TimelineEvent); } catch {}
  }
  return out;
}

const KYIV_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function kyivOffsetAt(ms: number) {
  const parts = Object.fromEntries(KYIV_DATE_TIME.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return representedAsUtc - Math.floor(ms / 1000) * 1000;
}

function kyivDate(ms = Date.now()) {
  const parts = Object.fromEntries(KYIV_DATE_TIME.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDate(value: string | null, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const nextDay = Date.UTC(year, month - 1, day + (endOfDay ? 1 : 0));
  const firstPass = nextDay - kyivOffsetAt(nextDay);
  const start = nextDay - kyivOffsetAt(firstPass);
  return endOfDay ? start - 1 : start;
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const today = kyivDate();
  const from = q.get("from") || today;
  const to = q.get("to") || from;
  const parsedFrom = parseDate(from);
  const parsedTo = parseDate(to, true);
  if (parsedFrom == null || parsedTo == null || parsedFrom > parsedTo) {
    return NextResponse.json({ error: "invalid_date_range" }, { status: 400 });
  }
  const since = parsedFrom;
  const until = parsedTo;
  const statusParam = q.get("status_ids");
  const statusIds = new Set(
    (statusParam === "all" ? "" : statusParam || "5,3")
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite),
  );
  const categoryIdRaw = q.get("category_id");
  const categoryId = categoryIdRaw == null ? null : Number(categoryIdRaw);
  if (categoryIdRaw != null && !Number.isFinite(categoryId)) {
    return NextResponse.json({ error: "invalid_category_id" }, { status: 400 });
  }
  const brandIdRaw = q.get("brand_id");
  const brandId = brandIdRaw == null
    ? undefined
    : brandIdRaw === NO_BRAND_KEY ? null : Number(brandIdRaw);
  if (brandIdRaw != null && brandId !== null && !Number.isFinite(brandId)) {
    return NextResponse.json({ error: "invalid_brand_id" }, { status: 400 });
  }

  const [allProducts, syncedAt, priceRaws, filtersCache] = await Promise.all([
    readAllLite(),
    readLiteSyncedAt(),
    getRedis().zrange("products:timeline:prices", since, until, { byScore: true }) as Promise<string[]>,
    readFiltersCache(),
  ]);
  const statusMap = new Map((filtersCache?.filters.statuses ?? []).map((status) => [status.id, status]));
  statusMap.set(ARCHIVE_STATUS_ID, { id: ARCHIVE_STATUS_ID, name: "Архів" });
  const statuses = Array.from(statusMap.values()).sort((a, b) => a.id - b.id);
  const statusFilteredProducts = statusIds.size
    ? allProducts.filter((product) => statusIds.has(product.deleted ? ARCHIVE_STATUS_ID : product.statusId))
    : allProducts;
  const products = statusFilteredProducts.filter((product) => (
    (categoryId == null || product.categoryId === categoryId)
    && (brandId === undefined || product.brandId === brandId)
  ));

  const byId = new Map(products.map((p) => [p.id, p]));
  const categories = new Map<string, Bucket>();
  const brands = new Map<string, Bucket>();

  for (const product of products) {
    const cat = bucket(categories, String(product.categoryId), product.categoryName || product.categoryPath);
    const brand = bucket(brands, product.brandId == null ? NO_BRAND_KEY : String(product.brandId), product.brand || "Без бренду");
    for (const item of [cat, brand]) {
      item.total++;
      if ((product.discountPct ?? 0) > 0) item.withDiscount++;
      else item.withoutDiscount++;
    }
  }

  const repriced = new Set<number>();
  const repricedUp = new Set<number>();
  const repricedDown = new Set<number>();
  for (const event of parseTimeline(priceRaws)) {
    const product = byId.get(event.productId);
    if (!product || event.fromPrice == null || event.toPrice == null || event.fromPrice === event.toPrice) continue;
    repriced.add(product.id);
    const direction = event.toPrice > event.fromPrice ? "up" : "down";
    (direction === "up" ? repricedUp : repricedDown).add(product.id);
    bucket(categories, String(product.categoryId), product.categoryName || product.categoryPath)[direction]++;
    bucket(brands, product.brandId == null ? NO_BRAND_KEY : String(product.brandId), product.brand || "Без бренду")[direction]++;
  }

  const disabledIds = new Set<number>();
  for (const product of products) {
    if (product.deleted && inRange(product.statusChangedAt, since, until)) disabledIds.add(product.id);
    if (product.statusHistory.some((change) => {
      if (!inRange(change.at, since, until)) return false;
      return change.to === 1 || change.to === 4;
    })) disabledIds.add(product.id);
  }

  const rows = (values: Map<string, Bucket>) => Array.from(values.values())
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "uk"));

  return NextResponse.json({
    from,
    to,
    statusIds: Array.from(statusIds),
    categoryId,
    brandId: brandId === undefined ? undefined : brandId,
    statuses,
    syncedAt,
    newCount: products.filter((p) => inRange(p.firstSeenAt, since, until)).length,
    disabledCount: disabledIds.size,
    repricedCount: repriced.size,
    repricedUpCount: repricedUp.size,
    repricedDownCount: repricedDown.size,
    withoutDiscountCount: products.filter((p) => (p.discountPct ?? 0) <= 0).length,
    withDiscountCount: products.filter((p) => (p.discountPct ?? 0) > 0).length,
    categories: rows(categories),
    brands: rows(brands),
  }, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" },
  });
}
