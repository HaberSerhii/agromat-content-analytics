import type { SearchMonthlyMetric } from "@/lib/search-analytics-types";
/** Most query/month cells are zero; share immutable values instead of millions of copies. */
export function createMonthlyMetricPool() {
  const pool = new Map<string, SearchMonthlyMetric>();
  return (value: SearchMonthlyMetric): SearchMonthlyMetric => {
    const key = [value.month, value.from, value.to, value.bigQueryCount, value.multisearchFoundCount, value.multisearchNoResultsCount, value.totalSearches].join("|");
    const saved = pool.get(key);
    if (saved) return saved;
    pool.set(key, Object.freeze(value));
    return value;
  };
}
