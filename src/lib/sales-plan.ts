export const SALES_PLAN_SEGMENTS = ["Плитка", "Сантехніка", "Інше"] as const;

export const SALES_DASHBOARD_MANAGER_IDS = new Set(["58255", "58242", "4964", "6693"]);

export type SalesPlanSegment = (typeof SALES_PLAN_SEGMENTS)[number];

export type MonthlySalesPlan = {
  total: number;
  segments: Record<SalesPlanSegment, number>;
};

export const SALES_PLAN_BY_MONTH: Record<string, MonthlySalesPlan> = {
  "2026-01": { total: 3_400_000, segments: { "Плитка": 1_550_000, "Сантехніка": 1_850_000, "Інше": 0 } },
  "2026-02": { total: 3_600_000, segments: { "Плитка": 1_750_000, "Сантехніка": 1_850_000, "Інше": 0 } },
  "2026-03": { total: 4_500_000, segments: { "Плитка": 2_000_000, "Сантехніка": 2_500_000, "Інше": 0 } },
  "2026-04": { total: 5_050_000, segments: { "Плитка": 2_250_000, "Сантехніка": 2_800_000, "Інше": 0 } },
  "2026-05": { total: 5_300_000, segments: { "Плитка": 2_400_000, "Сантехніка": 2_900_000, "Інше": 0 } },
  "2026-06": { total: 5_800_000, segments: { "Плитка": 2_750_000, "Сантехніка": 3_050_000, "Інше": 0 } },
  "2026-07": { total: 6_250_000, segments: { "Плитка": 2_950_000, "Сантехніка": 3_300_000, "Інше": 0 } },
  "2026-08": { total: 6_850_000, segments: { "Плитка": 3_000_000, "Сантехніка": 3_850_000, "Інше": 0 } },
  "2026-09": { total: 6_700_000, segments: { "Плитка": 2_850_000, "Сантехніка": 3_850_000, "Інше": 0 } },
  "2026-10": { total: 6_800_000, segments: { "Плитка": 2_700_000, "Сантехніка": 4_100_000, "Інше": 0 } },
  "2026-11": { total: 6_200_000, segments: { "Плитка": 2_400_000, "Сантехніка": 3_800_000, "Інше": 0 } },
  "2026-12": { total: 4_900_000, segments: { "Плитка": 2_400_000, "Сантехніка": 2_500_000, "Інше": 0 } },
};

export function normalizeSalesPlanSegment(value: string): SalesPlanSegment {
  const normalized = value.toLocaleLowerCase("uk").replace(/\s+/g, " ").trim();
  if (normalized.includes("плит")) return "Плитка";
  if (normalized.includes("інше")) return "Інше";
  return "Сантехніка";
}

export function getMonthlySalesPlan(month: string) {
  return SALES_PLAN_BY_MONTH[month] || null;
}
