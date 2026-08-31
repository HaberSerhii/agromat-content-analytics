import { NextResponse } from "next/server";
import { hasServerBearer, isDashboardRequest } from "@/lib/dashboard-auth";
import { runDueContentReviewChecks } from "@/lib/content-review-metrics";
import { runDueNewProductChecks } from "@/lib/new-product-metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (
    !hasServerBearer(request, "CRON_SECRET") &&
    !isDashboardRequest(request)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [contentReviews, newProducts] = await Promise.all([
      runDueContentReviewChecks(),
      runDueNewProductChecks(),
    ]);
    return NextResponse.json({
      ok: true,
      ...contentReviews,
      newProducts,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "content_review_check_failed",
      },
      { status: 500 },
    );
  }
}
