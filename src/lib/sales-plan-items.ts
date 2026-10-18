type PlanItem = { code: string; name: string; category: string; categoryKey?: string; brand?: string; qty: number; revenue: number; ownCost?: number };

export function isSalesPlanService(item: Pick<PlanItem, "code" | "name" | "category" | "categoryKey">) {
  if (item.code.trim() === "18385" || item.categoryKey?.split(".")[0] === "012") return true;
  const category = item.category.toLocaleLowerCase("uk").trim();
  const name = item.name.toLocaleLowerCase("uk").trim();
  return /послуг|услуг/u.test(category)
    || /^(?:послуг|услуг|транспортні послуги|транспортные услуги|підйом та занос|подъем|доставк|delivery\b|shipping\b)/u.test(name);
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
    docsSum: row.docsSum - services.reduce((sum, item) => sum + (Number.isFinite(item.revenue) ? item.revenue : fallback), 0),
    returnSum: row.returnSum - row.returnGoodsCodes.reduce((sum, code, index) => (
      sum + (serviceCodes.has(code.trim()) ? row.returnRowSums[index] || 0 : 0)
    ), 0),
    goodsCount: goods.reduce((sum, item) => sum + item.qty, 0),
  };
}

type GoodsSalesRow = {
  items: PlanItem[]; docsSum: number; returnSum: number; goodsCount: number;
  returnGoodsCodes: string[]; returnRowSums: number[];
};

/** One service exclusion rule shared by every ERP sales consumer. */
export function goodsOnlySalesRow<T extends GoodsSalesRow>(row: T): T | null {
  const amounts = getSalesPlanAmounts(row);
  if (!amounts) return null;
  const items = row.items.filter((item) => !isSalesPlanService(item));
  if (items.length === row.items.length) return row;
  const serviceCodes = new Set(row.items.filter(isSalesPlanService).map((item) => item.code.trim()));
  const returns = row.returnGoodsCodes.map((code, index) => ({ code, revenue: row.returnRowSums[index] || 0 }))
    .filter((item) => !serviceCodes.has(item.code.trim()));
  return {
    ...row, ...amounts, items,
    goodsCodes: items.map((item) => item.code).join("|"),
    goodsNames: items.map((item) => item.name).join("|"),
    trademarksNames: items.map((item) => item.brand || "").join("|"),
    ...("groupRefs" in row ? { groupRefs: String(row.groupRefs).split("|").filter((_, index) => row.items[index] && !isSalesPlanService(row.items[index])).join("|") } : {}),
    goodsCodeNumbers: items.map((item) => Number(item.code)).filter(Number.isFinite),
    returnGoodsCodes: returns.map((item) => item.code),
    returnRowSums: returns.map((item) => item.revenue),
    hasReturns: amounts.returnSum > 0 || returns.length > 0,
    ...("ownCost" in row ? { ownCost: items.every((item) => item.ownCost != null) ? items.reduce((sum, item) => sum + (item.ownCost || 0), 0) : Number(row.ownCost) * (row.docsSum ? amounts.docsSum / row.docsSum : 0) } : {}),
  };
}

/** Attribute returns to their goods, including repeated SKU lines and unallocated returns. */
export function netSalesItems<T extends PlanItem>(row: Omit<GoodsSalesRow, "items"> & { items: T[] }): T[] {
  const byCode = new Map<string, number>();
  row.returnGoodsCodes.forEach((code, index) => byCode.set(code, (byCode.get(code) || 0) + (row.returnRowSums[index] || 0)));
  const codeAmounts = new Map<string, number>();
  const codeCounts = new Map<string, number>();
  for (const item of row.items) {
    codeAmounts.set(item.code, (codeAmounts.get(item.code) || 0) + item.revenue);
    codeCounts.set(item.code, (codeCounts.get(item.code) || 0) + 1);
  }
  const itemTotal = row.items.reduce((sum, item) => sum + item.revenue, 0);
  let assigned = 0;
  const net = row.items.map((item) => {
    const codeTotal = codeAmounts.get(item.code) || 0;
    const returned = (byCode.get(item.code) || 0) * (codeTotal ? item.revenue / codeTotal : 1 / codeCounts.get(item.code)!);
    const revenue = item.revenue - returned;
    assigned += revenue;
    return { ...item, revenue };
  });
  const adjustment = row.docsSum - row.returnSum - assigned;
  let allocated = 0;
  return net.map((item, index) => {
    const correction = index === net.length - 1 ? adjustment - allocated : adjustment * (itemTotal ? row.items[index].revenue / itemTotal : 1 / net.length);
    allocated += correction;
    return { ...item, revenue: item.revenue + correction };
  });
}
