import { BigQuery } from "@google-cloud/bigquery";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readThroughBigQueryCache } from "@/lib/bigquery-result-cache";

export type DailyProductPoint = { date: string; impressions: number | null; ctr: number | null; atc: number | null; contentScore: number | null };
type ScoredProduct = { code: number; goodsRef: number; contentScore: number | null };
type EventDay = { date: string | { value: string }; impressions: number; views: number; carts: number };

export function dailyProductPoints(today: string, rows: EventDay[], scores: Map<string, number | null>, available: boolean): DailyProductPoint[] {
  const byDate = new Map(rows.map(row => [typeof row.date === "string" ? row.date : row.date.value, row]));
  return Array.from({ length: Number(today.slice(8)) }, (_, index) => {
    const date = `${today.slice(0, 8)}${String(index + 1).padStart(2, "0")}`;
    const row = byDate.get(date);
    const impressions = Number(row?.impressions || 0), views = Number(row?.views || 0), carts = Number(row?.carts || 0);
    return { date, impressions: available ? impressions : null,
      ctr: available && impressions > 0 ? views / impressions * 100 : null,
      atc: available && views > 0 ? carts / views * 100 : null, contentScore: scores.get(date) ?? null };
  });
}

export async function buildProductDailyDynamics(today: string, selected: ScoredProduct[], all: ScoredProduct[], table: string) {
  const from = `${today.slice(0, 7)}-01`;
  const refs = [...new Set(selected.map(row => row.goodsRef))].sort((a,b) => a-b);
  let rows: EventDay[] = [], available = true, error = "";
  if (refs.length) {
    try {
      rows = await readThroughBigQueryCache<EventDay[]>({
        namespace: "product-daily-dynamics", key: JSON.stringify([today, table, refs]),
        load: async () => {
          const [result] = await new BigQuery({ projectId: process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413" }).query({
            query: `SELECT event_date AS date, COUNTIF(event_name = 'view_item_list') AS impressions,
              COUNTIF(event_name = 'view_item') AS views, COUNTIF(event_name = 'add_to_cart') AS carts
              FROM ${table} WHERE event_date BETWEEN DATE(@from) AND DATE(@to)
              AND SAFE_CAST(NULLIF(TRIM(item_id), '') AS INT64) IN UNNEST(@refs)
              AND event_name IN ('view_item_list','view_item','add_to_cart') GROUP BY event_date`,
            params: { from, to: today, refs }, location: "EU", maximumBytesBilled: "50000000000",
          });
          return result as EventDay[];
        },
      });
    } catch { available = false; error = "Не вдалося завантажити денні показники GA4"; }
  }
  const directory = process.env.PRODUCT_CONTENT_SNAPSHOTS_DIR || path.join(path.dirname(process.env.PRODUCT_SNAPSHOTS_DIR || path.join(process.cwd(), "data", "product-snapshots")), "product-content-snapshots");
  const current = Object.fromEntries(all.map(row => [row.code, row.contentScore]));
  try {
    await fs.mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `${today}.${process.pid}.${crypto.randomUUID()}.tmp`);
    await fs.writeFile(temporary, JSON.stringify(current));
    await fs.rename(temporary, path.join(directory, `${today}.json`));
  } catch { error = [error, "Не вдалося зберегти денний CS"].filter(Boolean).join(" · "); }
  const scores = new Map<string, number | null>();
  for (let day = 1; day <= Number(today.slice(8)); day++) {
    const date = `${today.slice(0,8)}${String(day).padStart(2,"0")}`;
    let snapshot: Record<string, number | null>;
    try { snapshot = date === today ? current : JSON.parse(await fs.readFile(path.join(directory, `${date}.json`), "utf8")); }
    catch { continue; }
    const values = selected.map(row => snapshot[row.code]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    scores.set(date, values.length ? values.reduce((sum,value) => sum+value,0)/values.length : null);
  }
  return { points: dailyProductPoints(today, rows, scores, available), error };
}
