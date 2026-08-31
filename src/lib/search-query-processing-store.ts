import { getRedis } from "@/lib/redis";
import type { SearchQueryProcessing } from "@/lib/search-analytics-types";

const STORE_KEY = "products:search-query-processing:v1";
const DISCOVERY_KEY = "products:search-query-discovery:v1";
const EXCLUSION_KEY = "products:search-query-exclusions:v1";
const SHEET_REVISION_KEY = "products:search-query-sheet-revision:v1";

export interface SearchQueryExclusion {
  queryKey: string;
  originalQuery: string;
  excludedAt: string;
}

function parseProcessing(raw: string | null): Record<string, SearchQueryProcessing> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, SearchQueryProcessing>;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export async function listSearchQueryProcessing(): Promise<
  Record<string, SearchQueryProcessing>
> {
  return parseProcessing(await getRedis().get(STORE_KEY));
}

export async function saveSearchQueryProcessing(
  processing: SearchQueryProcessing,
): Promise<SearchQueryProcessing> {
  const current = await listSearchQueryProcessing();
  const keys = [...new Set([processing.queryKey, ...(processing.aliasKeys || [])])];
  for (const key of keys) current[key] = processing;
  await getRedis().set(STORE_KEY, JSON.stringify(current));
  return processing;
}

export async function listSearchQueryExclusions(): Promise<
  Record<string, SearchQueryExclusion>
> {
  const raw = await getRedis().get(EXCLUSION_KEY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, SearchQueryExclusion>;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export async function excludeSearchQueries(
  queryKeys: string[],
  originalQuery: string,
): Promise<void> {
  const current = await listSearchQueryExclusions();
  const excludedAt = new Date().toISOString();
  for (const queryKey of [...new Set(queryKeys.filter(Boolean))]) {
    current[queryKey] = { queryKey, originalQuery, excludedAt };
  }
  await getRedis().set(EXCLUSION_KEY, JSON.stringify(current));
}

export async function getSearchSheetRevision(): Promise<number> {
  const revision = Number(await getRedis().get(SHEET_REVISION_KEY));
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export async function bumpSearchSheetRevision(): Promise<number> {
  const revision = (await getSearchSheetRevision()) + 1;
  await getRedis().set(SHEET_REVISION_KEY, String(revision));
  return revision;
}

export async function ensureSearchQueryDiscovery(
  queryKeys: string[],
  discoveredAt: string,
): Promise<Record<string, string>> {
  const current = parseDiscovery(await getRedis().get(DISCOVERY_KEY));
  let changed = false;
  for (const key of queryKeys) {
    if (!current[key]) {
      current[key] = discoveredAt;
      changed = true;
    }
  }
  if (changed) await getRedis().set(DISCOVERY_KEY, JSON.stringify(current));
  return current;
}

function parseDiscovery(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, string>;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
