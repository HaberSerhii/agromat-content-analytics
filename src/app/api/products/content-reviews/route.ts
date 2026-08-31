import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import {
  isContentReviewAction,
  isContentReviewManager,
  type ContentReviewMetrics,
} from "@/lib/content-review-types";
import {
  listContentProductReviews,
  saveContentProductReview,
} from "@/lib/content-reviews-store";

export const dynamic = "force-dynamic";

interface SaveBody {
  product?: {
    id?: number;
    code?: number;
    goodsRef?: number;
    name?: string;
    url?: string;
    categoryId?: number;
    categoryName?: string;
    brand?: string;
  };
  manager?: unknown;
  actions?: unknown;
  before?: Partial<ContentReviewMetrics>;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validHttpUrl(value: unknown): string | null {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : finiteNumber(value);
}

function validMetrics(value: SaveBody["before"]): ContentReviewMetrics | null {
  const impressions = finiteNumber(value?.impressions);
  if (impressions == null || impressions < 0) return null;
  return {
    impressions,
    ctr: nullableNumber(value?.ctr),
    atc: nullableNumber(value?.atc),
    contentScore: nullableNumber(value?.contentScore),
    categoryCtr: nullableNumber(value?.categoryCtr),
    categoryAtc: nullableNumber(value?.categoryAtc),
    categoryContent: nullableNumber(value?.categoryContent),
  };
}

export async function GET(request: Request) {
  if (!isDashboardRequest(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(
      { reviews: await listContentProductReviews() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "content_reviews_failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isDashboardRequest(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as SaveBody;
  const product = body.product || {};
  const productId = positiveInteger(product.id);
  const code = positiveInteger(product.code);
  const goodsRef = positiveInteger(product.goodsRef);
  const categoryId = positiveInteger(product.categoryId);
  const name = String(product.name || "")
    .trim()
    .slice(0, 500);
  const url = validHttpUrl(product.url);
  const categoryName = String(product.categoryName || "Без категорії")
    .trim()
    .slice(0, 300);
  const brand = String(product.brand || "Без бренду")
    .trim()
    .slice(0, 200);
  const actions = Array.isArray(body.actions)
    ? [...new Set(body.actions.filter(isContentReviewAction))]
    : [];
  const before = validMetrics(body.before);
  if (
    productId == null ||
    code == null ||
    goodsRef == null ||
    categoryId == null ||
    !name ||
    !url ||
    !isContentReviewManager(body.manager) ||
    !actions.length ||
    !before
  ) {
    return NextResponse.json(
      { error: "invalid_content_review" },
      { status: 400 },
    );
  }
  try {
    const review = await saveContentProductReview({
      productId,
      code,
      goodsRef,
      name,
      url,
      categoryId,
      categoryName,
      brand,
      manager: body.manager,
      actions,
      before,
    });
    return NextResponse.json({ review });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "content_review_save_failed",
      },
      { status: 500 },
    );
  }
}
