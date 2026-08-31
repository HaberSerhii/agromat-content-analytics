import { getRedis } from "@/lib/redis";
import type { SearchQueryProcessing } from "@/lib/search-analytics-types";

const STORE_KEY = "products:search-query-processing:v1";
const DISCOVERY_KEY = "products:search-query-discovery:v1";

function parse(raw: string | null): Record<string, SearchQueryProcessing> {
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
  return parse(await getRedis().get(STORE_KEY));
}

export async function saveSearchQueryProcessing(
  processing: SearchQueryProcessing,
): Promise<SearchQueryProcessing> {
  const current = await listSearchQueryProcessing();
  current[processing.queryKey] = processing;
  await getRedis().set(STORE_KEY, JSON.stringify(current));
  return processing;
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
