import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { isContentReviewManager } from "@/lib/content-review-types";
import {
  listNewProductAssignments,
  saveNewProductAssignment,
} from "@/lib/new-product-assignments-store";
import {
  NEW_PRODUCT_TRACKING_START,
  type NewProductAnalysisRow,
} from "@/lib/new-product-types";
import { readAllLite, type ProductLite } from "@/lib/products-store";

export const dynamic = "force-dynamic";

function segmentOf(
  product: Pick<ProductLite, "categoryName" | "categoryPath">,
): "tile" | "sanitary" {
  const category = `${product.categoryName} ${product.categoryPath}`;
  return /плит|керам|кл[іи]нкер|моза|tile|gres/i.test(category)
    ? "tile"
    : "sanitary";
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: Request) {
  if (!isDashboardRequest(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [assignments, products] = await Promise.all([
      listNewProductAssignments(),
      readAllLite(),
    ]);
    const productsByCode = new Map(
      products.map((product) => [product.code, product]),
    );
    const rows: NewProductAnalysisRow[] = assignments
      .filter(
        (assignment) => assignment.publishedAt >= NEW_PRODUCT_TRACKING_START,
      )
      .map((assignment) => {
        const product = productsByCode.get(assignment.code);
        return {
          ...assignment,
          segment: product
            ? segmentOf(product)
            : /плит|керам|кл[іи]нкер|моза|tile|gres/i.test(
                  assignment.categoryName,
                )
              ? "tile"
              : "sanitary",
          statusId: product?.statusId ?? null,
          statusName: product?.statusName || "Немає в актуальному каталозі",
          stockQty:
            product?.stockQty ?? assignment.measurement?.stockQty ?? null,
          deleted: product?.deleted ?? true,
        };
      });
    return NextResponse.json(
      { assignments: rows, trackingStart: NEW_PRODUCT_TRACKING_START },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "new_assignments_failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isDashboardRequest(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    code?: unknown;
    manager?: unknown;
  };
  const code = positiveInteger(body.code);
  if (code == null || !isContentReviewManager(body.manager))
    return NextResponse.json(
      { error: "invalid_new_product_assignment" },
      { status: 400 },
    );
  try {
    const product = (await readAllLite()).find((item) => item.code === code);
    if (
      !product ||
      product.firstSeenAt.slice(0, 10) < NEW_PRODUCT_TRACKING_START
    )
      return NextResponse.json(
        { error: "product_is_outside_tracking_period" },
        { status: 400 },
      );
    const assignment = await saveNewProductAssignment({
      productId: product.id,
      code: product.code,
      goodsRef: product.goodsRef,
      name: product.name,
      url: product.url,
      categoryId: product.categoryId,
      categoryName:
        product.categoryName || product.categoryPath || "Без категорії",
      brand: product.brand || "Без бренду",
      manager: body.manager,
      publishedAt: product.firstSeenAt.slice(0, 10),
    });
    return NextResponse.json({ assignment });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "new_assignment_save_failed",
      },
      { status: 500 },
    );
  }
}
