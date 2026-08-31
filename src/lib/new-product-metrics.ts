import { captureContentReviewMetrics } from "@/lib/content-review-metrics";
import {
  contentReviewControlWindow,
  kyivDate,
} from "@/lib/content-reviews-store";
import {
  completeNewProductAssignment,
  listDueNewProductAssignments,
} from "@/lib/new-product-assignments-store";
import { readAllLite } from "@/lib/products-store";
import { readCompletedSalesProductQuantities } from "@/lib/sales-s3";

export async function runDueNewProductChecks(
  throughDate = kyivDate(),
): Promise<{ due: number; completed: number; missing: number }> {
  const due = await listDueNewProductAssignments(throughDate);
  const products = await readAllLite();
  const productsByCode = new Map(
    products.map((product) => [product.code, product]),
  );
  let completed = 0;
  let missing = 0;
  const byCheckDate = new Map<string, typeof due>();
  for (const assignment of due) {
    const rows = byCheckDate.get(assignment.checkAt) || [];
    rows.push(assignment);
    byCheckDate.set(assignment.checkAt, rows);
  }

  for (const [checkAt, assignments] of byCheckDate) {
    const window = contentReviewControlWindow(checkAt);
    const [metrics, salesByCode] = await Promise.all([
      captureContentReviewMetrics(
        [...new Set(assignments.map((item) => item.goodsRef))],
        checkAt,
        "control",
      ),
      readCompletedSalesProductQuantities(window),
    ]);
    for (const assignment of assignments) {
      const productMetrics = metrics.get(assignment.goodsRef);
      if (!productMetrics) {
        missing++;
        continue;
      }
      await completeNewProductAssignment(assignment, {
        metrics: productMetrics,
        salesQty: salesByCode.get(assignment.code) || 0,
        stockQty: productsByCode.get(assignment.code)?.stockQty ?? null,
        periodFrom: window.from,
        periodTo: window.to,
        checkedAt: new Date().toISOString(),
      });
      completed++;
    }
  }
  return { due: due.length, completed, missing };
}
