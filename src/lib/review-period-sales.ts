import { isDimensionOrderInPeriod } from "@/lib/sales-dimension-filter";
import { netSalesItems, isSalesPlanService } from "@/lib/sales-plan-items";

type Sale = {
  docsRef: string; number: string; webshopId: string; state: string;
  createdDate: string; shippedDate: string | null;
  docsSum: number; returnSum: number; goodsCount: number;
  returnGoodsCodes: string[]; returnRowSums: number[];
  items: Array<{ code: string; name: string; category: string; qty: number; revenue: number }>;
};

/** ERP is authoritative. Webshop IDs are navigation links, never the sales source. */
export function summarizeReviewPeriodSales(rows: Sale[], input: { from: string; to: string; productCodes: number[] }) {
  const codes = new Set(input.productCodes);
  const seen = new Set<string>();
  const documents = [];
  for (const row of rows) {
    if (!isDimensionOrderInPeriod(row, input)) continue;
    const key = row.docsRef || row.number;
    if (!key || seen.has(key)) continue;
    const items = netSalesItems(row).filter(item => codes.has(Number(item.code)) && !isSalesPlanService(item));
    if (!items.length) continue;
    seen.add(key);
    documents.push({
      docsRef: row.docsRef, number: row.number, webshopId: row.webshopId,
      createdDate: row.createdDate, shippedDate: row.shippedDate,
      quantity: items.reduce((sum, item) => sum + item.qty, 0),
      revenue: items.reduce((sum, item) => sum + item.revenue, 0), items,
    });
  }
  return {
    quantity: documents.reduce((sum, doc) => sum + doc.quantity, 0),
    revenue: documents.reduce((sum, doc) => sum + doc.revenue, 0),
    orders: documents.length,
    webshopIds: [...new Set(documents.map(doc => doc.webshopId).filter(Boolean))],
    withoutWebshop: documents.filter(doc => !doc.webshopId).length,
    documents,
  };
}
