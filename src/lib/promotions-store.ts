import { getRedis } from "@/lib/redis";
import type { ApiPromotion, ApiPromotionProduct } from "@/lib/products-api";
import fs from "fs";
import path from "path";

const BASELINE_KEY = "promotions:baseline:v1";
const BASELINE_FILE = path.join(process.cwd(), "data", "promotions-baseline.json");

export interface PromotionBaselineProduct {
  id: number;
  goodsRef: number;
  code: number;
  sku: string | null;
  name: string;
  url: string;
  fixPrice: number | null;
  resultPrice: number | null;
  statusId: number;
  statusName: string;
}

export interface PromotionBaselineEntry {
  id: number;
  idinc: number;
  name: string;
  type: string;
  startDate: string | null;
  endDate: string | null;
  capturedAt: string;
  products: PromotionBaselineProduct[];
}

export interface PromotionsBaseline {
  version: 1;
  capturedAt: string;
  promotions: Record<string, PromotionBaselineEntry>;
}

function productSnapshot(product: ApiPromotionProduct): PromotionBaselineProduct {
  return {
    id: product.id,
    goodsRef: product.goods_ref,
    code: product.code,
    sku: product.sku,
    name: product.name,
    url: product.url,
    fixPrice: product.fix_price,
    resultPrice: product.result_price,
    statusId: product.status.id,
    statusName: product.status.name,
  };
}

function promotionSnapshot(promotion: ApiPromotion, capturedAt: string): PromotionBaselineEntry {
  return {
    id: promotion.id,
    idinc: promotion.idinc,
    name: promotion.name,
    type: promotion.type?.name ?? "Публічна",
    startDate: promotion.start_date,
    endDate: promotion.end_date,
    capturedAt,
    products: promotion.products.map(productSnapshot),
  };
}

export async function readOrExtendPromotionsBaseline(
  currentPromotions: ApiPromotion[],
): Promise<PromotionsBaseline> {
  const redis = getRedis();
  let raw: string | null = null;
  let redisAvailable = true;
  try {
    raw = await redis.get(BASELINE_KEY);
  } catch {
    redisAvailable = false;
    try {
      raw = fs.existsSync(BASELINE_FILE) ? fs.readFileSync(BASELINE_FILE, "utf-8") : null;
    } catch {
      raw = null;
    }
  }
  const now = new Date().toISOString();
  let baseline: PromotionsBaseline;

  try {
    baseline = raw ? JSON.parse(raw) as PromotionsBaseline : {
      version: 1,
      capturedAt: now,
      promotions: {},
    };
  } catch {
    baseline = { version: 1, capturedAt: now, promotions: {} };
  }

  let changed = !raw;
  for (const promotion of currentPromotions) {
    const key = String(promotion.idinc);
    if (baseline.promotions[key]) continue;
    baseline.promotions[key] = promotionSnapshot(promotion, now);
    changed = true;
  }

  if (changed) {
    const serialized = JSON.stringify(baseline);
    if (redisAvailable) {
      try {
        await redis.set(BASELINE_KEY, serialized);
      } catch {
        redisAvailable = false;
      }
    }
    if (!redisAvailable) {
      fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
      const tempFile = `${BASELINE_FILE}.tmp`;
      fs.writeFileSync(tempFile, serialized);
      fs.renameSync(tempFile, BASELINE_FILE);
    }
  }
  return baseline;
}
