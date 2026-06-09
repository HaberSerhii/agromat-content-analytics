export const SALES_PLAN_SEGMENTS = ["Плитка", "Сантехніка", "Інше"] as const;

export type SalesPlanSegment = (typeof SALES_PLAN_SEGMENTS)[number];

export type MonthlySalesPlan = {
  total: number;
  segments: Record<SalesPlanSegment, number>;
};

export const SALES_PLAN_BY_MONTH: Record<string, MonthlySalesPlan> = {
  "2026-02": { total: 3_600_000, segments: { "Плитка": 1_750_000, "Сантехніка": 1_850_000, "Інше": 0 } },
  "2026-03": { total: 4_500_000, segments: { "Плитка": 2_050_000, "Сантехніка": 2_450_000, "Інше": 0 } },
  "2026-04": { total: 5_000_000, segments: { "Плитка": 1_800_000, "Сантехніка": 3_200_000, "Інше": 0 } },
  "2026-05": { total: 5_300_000, segments: { "Плитка": 2_500_000, "Сантехніка": 2_800_000, "Інше": 0 } },
  "2026-06": { total: 5_500_000, segments: { "Плитка": 2_200_000, "Сантехніка": 3_300_000, "Інше": 0 } },
  "2026-07": { total: 6_000_000, segments: { "Плитка": 2_200_000, "Сантехніка": 3_800_000, "Інше": 0 } },
  "2026-08": { total: 7_000_000, segments: { "Плитка": 2_200_000, "Сантехніка": 4_800_000, "Інше": 0 } },
  "2026-09": { total: 7_100_000, segments: { "Плитка": 2_300_000, "Сантехніка": 4_800_000, "Інше": 0 } },
  "2026-10": { total: 7_200_000, segments: { "Плитка": 1_900_000, "Сантехніка": 5_300_000, "Інше": 0 } },
  "2026-11": { total: 7_500_000, segments: { "Плитка": 2_400_000, "Сантехніка": 5_100_000, "Інше": 0 } },
  "2026-12": { total: 5_000_000, segments: { "Плитка": 1_800_000, "Сантехніка": 3_200_000, "Інше": 0 } },
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
