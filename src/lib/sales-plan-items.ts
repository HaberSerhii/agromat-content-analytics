type PlanItem = { code: string; name: string; category: string; qty: number; revenue: number };

export function isSalesPlanService(item: Pick<PlanItem, "code" | "name" | "category">) {
  if (item.code.trim() === "18385") return true;
  const category = item.category.toLocaleLowerCase("uk").trim();
  const name = item.name.toLocaleLowerCase("uk").trim();
  return /послуг|услуг/u.test(category)
    || /^(?:послуг|услуг|транспортні послуги|транспортные услуги|підйом та занос|delivery\b|shipping\b)/u.test(name);
}

/** Remove service positions and their returns without dropping goods in mixed orders. */
export function getSalesPlanAmounts(row: {
  items: PlanItem[]; docsSum: number; returnSum: number; goodsCount: number;
  returnGoodsCodes: string[]; returnRowSums: number[];
}) {
  const services = row.items.filter(isSalesPlanService);
  if (!services.length) return { docsSum: row.docsSum, returnSum: row.returnSum, goodsCount: row.goodsCount };
  const goods = row.items.filter((item) => !isSalesPlanService(item));
  if (!goods.length) return null;
  const serviceCodes = new Set(services.map((item) => item.code.trim()));
  const fallback = row.goodsCount > 0 ? row.docsSum / row.goodsCount : 0;
  return {
    docsSum: row.docsSum - services.reduce((sum, item) => sum + (item.revenue || fallback), 0),
    returnSum: row.returnSum - row.returnGoodsCodes.reduce((sum, code, index) => (
      sum + (serviceCodes.has(code.trim()) ? row.returnRowSums[index] || 0 : 0)
    ), 0),
    goodsCount: goods.reduce((sum, item) => sum + item.qty, 0),
  };
}
