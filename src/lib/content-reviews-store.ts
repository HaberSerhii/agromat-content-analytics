import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/redis";
import type {
  ContentProductReview,
  ContentReviewAction,
  ContentReviewManager,
  ContentReviewMetrics,
} from "@/lib/content-review-types";

const INDEX_KEY = "products:content-reviews:index:v1";
const DUE_INDEX_KEY = "products:content-reviews:due:v1";
const recordKey = (id: string) => `products:content-reviews:record:v1:${id}`;
const activeKey = (code: number) =>
  `products:content-reviews:active:v1:${code}`;

function dateScore(value: string): number {
  return Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
}

export function kyivDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function contentReviewCheckDate(changedAt: string): string {
  const [year, month] = changedAt.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10);
}

export function contentReviewMetricWindow(anchorDate: string): {
  from: string;
  to: string;
} {
  const to = new Date(`${anchorDate}T12:00:00Z`);
  to.setUTCDate(to.getUTCDate() - 1);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function contentReviewControlWindow(checkAt: string): {
  from: string;
  to: string;
} {
  const [year, month] = checkAt.slice(0, 7).split("-").map(Number);
  const previousMonth = new Date(Date.UTC(year, month - 2, 1));
  const previousYear = previousMonth.getUTCFullYear();
  const previousMonthNumber = previousMonth.getUTCMonth() + 1;
  const from = `${previousYear}-${String(previousMonthNumber).padStart(2, "0")}-01`;
  const to = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

function parseRecord(raw: string | null): ContentProductReview | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ContentProductReview;
    return value?.id && value?.code ? value : null;
  } catch {
    return null;
  }
}

async function readRecords(ids: string[]): Promise<ContentProductReview[]> {
  if (!ids.length) return [];
  const pipeline = getRedis().pipeline();
  for (const id of ids) pipeline.get(recordKey(id));
  const values = await pipeline.exec();
  return values
    .map((value) => parseRecord(typeof value === "string" ? value : null))
    .filter((value): value is ContentProductReview => Boolean(value));
}

export async function listContentProductReviews(): Promise<
  ContentProductReview[]
> {
  const ids = await getRedis().zrange(INDEX_KEY, 0, -1);
  const records = await readRecords(ids);
  return records.sort(
    (left, right) =>
      right.changedAt.localeCompare(left.changedAt) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

export async function listDueContentProductReviews(
  throughDate: string,
): Promise<ContentProductReview[]> {
  const ids = await getRedis().zrange(
    DUE_INDEX_KEY,
    0,
    dateScore(throughDate),
    { byScore: true },
  );
  const records = await readRecords(ids);
  return records.filter(
    (record) => !record.after && record.checkAt <= throughDate,
  );
}

export interface SaveContentProductReviewInput {
  productId: number;
  code: number;
  goodsRef: number;
  name: string;
  url: string;
  categoryId: number;
  categoryName: string;
  brand: string;
  manager: ContentReviewManager;
  actions: ContentReviewAction[];
  before: ContentReviewMetrics;
}

export async function saveContentProductReview(
  input: SaveContentProductReviewInput,
): Promise<ContentProductReview> {
  const redis = getRedis();
  const now = new Date().toISOString();
  const changedAt = kyivDate();
  const existingId = await redis.get(activeKey(input.code));
  const existing = existingId
    ? parseRecord(await redis.get(recordKey(existingId)))
    : null;
  const window = contentReviewMetricWindow(changedAt);
  const review: ContentProductReview = existing
    ? {
        ...existing,
        productId: input.productId,
        goodsRef: input.goodsRef,
        name: input.name,
        url: input.url,
        categoryId: input.categoryId,
        categoryName: input.categoryName,
        brand: input.brand,
        manager: input.manager,
        actions: input.actions,
        updatedAt: now,
      }
    : {
        id: randomUUID(),
        productId: input.productId,
        code: input.code,
        goodsRef: input.goodsRef,
        name: input.name,
        url: input.url,
        categoryId: input.categoryId,
        categoryName: input.categoryName,
        brand: input.brand,
        manager: input.manager,
        actions: input.actions,
        changedAt,
        checkAt: contentReviewCheckDate(changedAt),
        before: {
          ...input.before,
          periodFrom: window.from,
          periodTo: window.to,
        },
        after: null,
        checkedAt: null,
        createdAt: now,
        updatedAt: now,
      };

  await Promise.all([
    redis.set(recordKey(review.id), JSON.stringify(review)),
    redis.set(activeKey(review.code), review.id),
    redis.zadd(INDEX_KEY, {
      score: Date.parse(review.createdAt),
      member: review.id,
    }),
    redis.zadd(DUE_INDEX_KEY, {
      score: dateScore(review.checkAt),
      member: review.id,
    }),
  ]);
  return review;
}

export async function completeContentProductReview(
  review: ContentProductReview,
  after: ContentReviewMetrics,
): Promise<ContentProductReview> {
  const completed: ContentProductReview = {
    ...review,
    after,
    checkedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const redis = getRedis();
  await Promise.all([
    redis.set(recordKey(completed.id), JSON.stringify(completed)),
    redis.del(activeKey(completed.code)),
    redis.zrem(DUE_INDEX_KEY, completed.id),
  ]);
  return completed;
}
