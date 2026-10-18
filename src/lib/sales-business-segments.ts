export const OTHER_SALES_GROUPS = ["Підлогові покриття", "Будівельна хімія", "Джерела живлення", "Меблі"] as const;
export type BusinessSegment = "Плитка" | "Сантехніка" | "Інше";

export function classifySalesCategory(key: string): { segment: BusinessSegment; otherGroup: string | null } {
  const root = key.split(".")[0];
  if (root === "001") return { segment: "Плитка", otherGroup: null };
  if (root === "002") return { segment: "Сантехніка", otherGroup: null };
  const otherGroup = root === "009" ? OTHER_SALES_GROUPS[0]
    : (root === "003" && /^(001|002|004|008|011|012|014|015|016|017|020|021|022|023|024)$/.test(key.split(".")[1] || "")) || root === "007" ? OTHER_SALES_GROUPS[1]
    : root === "020" || key === "011.010" ? OTHER_SALES_GROUPS[2]
    : root === "004" ? OTHER_SALES_GROUPS[3] : null;
  return { segment: "Інше", otherGroup };
}

/** Allocate each document once by item amounts, retaining its exact total. */
export function splitBusinessSales<T extends { categoryKey?: string; revenue: number; qty: number; category?: string }>(items: T[], total: number) {
  const sum = items.reduce((value, item) => value + item.revenue, 0);
  const groups = new Map<BusinessSegment, { segment: BusinessSegment; revenue: number; goods: number; items: T[]; otherGroups: Map<string, number>; remainderCategories: Map<string, number> }>();
  let allocated = 0;
  items.forEach((item, index) => {
    const { segment, otherGroup } = classifySalesCategory(item.categoryKey || "");
    const revenue = index === items.length - 1 ? total - allocated : sum !== 0 ? total * item.revenue / sum : total / items.length;
    allocated += revenue;
    const group = groups.get(segment) || { segment, revenue: 0, goods: 0, items: [], otherGroups: new Map<string, number>(), remainderCategories: new Map<string, number>() };
    group.revenue += revenue;
    group.goods += item.qty;
    group.items.push(item);
    if (otherGroup) group.otherGroups.set(otherGroup, (group.otherGroups.get(otherGroup) || 0) + revenue);
    if (segment === "Інше" && !otherGroup) {
      const label = item.category || "Без категорії";
      group.remainderCategories.set(label, (group.remainderCategories.get(label) || 0) + revenue);
    }
    groups.set(segment, group);
  });
  return [...groups.values()];
}
