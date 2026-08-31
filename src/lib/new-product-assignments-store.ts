import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/redis";
import type { ContentReviewManager } from "@/lib/content-review-types";
import { contentReviewCheckDate } from "@/lib/content-reviews-store";
import type {
  NewProductAssignment,
  NewProductMeasurement,
} from "@/lib/new-product-types";

const INDEX_KEY = "products:new-assignments:index:v1";
const DUE_INDEX_KEY = "products:new-assignments:due:v1";
const recordKey = (id: string) => `products:new-assignments:record:v1:${id}`;
const activeKey = (code: number) => `products:new-assignments:code:v1:${code}`;

function dateScore(value: string): number {
  return Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
}

function parseRecord(raw: string | null): NewProductAssignment | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as NewProductAssignment;
    return value?.id && value?.code ? value : null;
  } catch {
    return null;
  }
}

async function readRecords(ids: string[]): Promise<NewProductAssignment[]> {
  if (!ids.length) return [];
  const pipeline = getRedis().pipeline();
  for (const id of ids) pipeline.get(recordKey(id));
  const values = await pipeline.exec();
  return values
    .map((value) => parseRecord(typeof value === "string" ? value : null))
    .filter((value): value is NewProductAssignment => Boolean(value));
}

export async function listNewProductAssignments(): Promise<
  NewProductAssignment[]
> {
  const ids = await getRedis().zrange(INDEX_KEY, 0, -1);
  const records = await readRecords(ids);
  return records.sort(
    (left, right) =>
      right.publishedAt.localeCompare(left.publishedAt) ||
      right.assignedAt.localeCompare(left.assignedAt),
  );
}

export async function listAssignedNewProductCodes(): Promise<Set<number>> {
  return new Set((await listNewProductAssignments()).map((item) => item.code));
}

export async function listDueNewProductAssignments(
  throughDate: string,
): Promise<NewProductAssignment[]> {
  const ids = await getRedis().zrange(
    DUE_INDEX_KEY,
    0,
    dateScore(throughDate),
    { byScore: true },
  );
  return (await readRecords(ids)).filter(
    (record) => !record.measurement && record.checkAt <= throughDate,
  );
}

export interface SaveNewProductAssignmentInput {
  productId: number;
  code: number;
  goodsRef: number;
  name: string;
  url: string;
  categoryId: number;
  categoryName: string;
  brand: string;
  manager: ContentReviewManager;
  publishedAt: string;
}

export async function saveNewProductAssignment(
  input: SaveNewProductAssignmentInput,
): Promise<NewProductAssignment> {
  const redis = getRedis();
  const now = new Date().toISOString();
  const existingId = await redis.get(activeKey(input.code));
  const existing = existingId
    ? parseRecord(await redis.get(recordKey(existingId)))
    : null;
  const assignment: NewProductAssignment = existing
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
        updatedAt: now,
      }
    : {
        id: randomUUID(),
        ...input,
        assignedAt: now,
        checkAt: contentReviewCheckDate(input.publishedAt),
        measurement: null,
        createdAt: now,
        updatedAt: now,
      };

  await Promise.all([
    redis.set(recordKey(assignment.id), JSON.stringify(assignment)),
    redis.set(activeKey(assignment.code), assignment.id),
    redis.zadd(INDEX_KEY, {
      score: Date.parse(assignment.assignedAt),
      member: assignment.id,
    }),
    redis.zadd(DUE_INDEX_KEY, {
      score: dateScore(assignment.checkAt),
      member: assignment.id,
    }),
  ]);
  return assignment;
}

export async function completeNewProductAssignment(
  assignment: NewProductAssignment,
  measurement: NewProductMeasurement,
): Promise<NewProductAssignment> {
  const completed = {
    ...assignment,
    measurement,
    updatedAt: new Date().toISOString(),
  };
  const redis = getRedis();
  await Promise.all([
    redis.set(recordKey(completed.id), JSON.stringify(completed)),
    redis.zrem(DUE_INDEX_KEY, completed.id),
  ]);
  return completed;
}
