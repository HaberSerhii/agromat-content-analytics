import { GoogleAuth } from "google-auth-library";
import { getServerResult } from "@/lib/server-result-cache";
import { validateGa4Dates, type Ga4ApiReport } from "@/lib/ga4-marketing-report";
import type { Ga4OrderTransaction } from "@/lib/order-marketing-attribution";

export type Ga4OrderTransactions = {
  rows: Ga4OrderTransaction[];
  fetchedAt: string;
  limited: boolean;
};

export async function readGa4OrderTransactions(from: string, to: string): Promise<Ga4OrderTransactions> {
  validateGa4Dates(from, to);
  const propertyId = process.env.GA4_PROPERTY_ID?.trim();
  if (!propertyId || !/^\d+$/.test(propertyId)) throw new Error("GA4_PROPERTY_ID не налаштовано");
  const result = await getServerResult<Ga4OrderTransactions>({
    namespace: "ga4-order-transactions-v1", key: `${propertyId}:${from}:${to}`, ttlMs: 10 * 60_000, maxEntries: 32,
    load: async () => {
      const client = await new GoogleAuth({scopes: ["https://www.googleapis.com/auth/analytics.readonly"]}).getClient();
      const rows: Ga4OrderTransaction[] = [];
      let offset = 0;
      let limited = false;
      do {
        const response = await client.request<Ga4ApiReport>({
          url: `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
          method: "POST", timeout: 30_000,
          data: {
            dateRanges: [{startDate: from, endDate: to}],
            dimensions: ["transactionId", "sessionDefaultChannelGroup", "sessionSource", "sessionMedium", "sessionCampaignName"].map(name => ({name})),
            metrics: [{name: "ecommercePurchases"}],
            dimensionFilter: {filter: {fieldName: "eventName", stringFilter: {matchType: "EXACT", value: "purchase"}}},
            orderBys: ["transactionId", "sessionDefaultChannelGroup", "sessionSource", "sessionMedium", "sessionCampaignName"].map(dimensionName => ({dimension: {dimensionName}})),
            limit: "10000", offset: String(offset),
          },
        });
        const page = response.data;
        const batch = page.rows || [];
        for (const row of batch) {
          const value = (i: number) => row.dimensionValues?.[i]?.value || "(not set)";
          rows.push({ transactionId: value(0), channel: value(1), source: value(2), medium: value(3), campaign: value(4) });
        }
        offset += batch.length;
        limited ||= Boolean(page.metadata?.dataLossFromOtherRow || page.metadata?.subjectToThresholding);
        if (offset >= (page.rowCount ?? offset)) break;
        if (!batch.length || offset >= 100_000) throw new Error("Звіт GA4 завеликий; скоротіть період");
      } while (true);
      return { rows, fetchedAt: new Date().toISOString(), limited };
    },
  });
  return result.value;
}
