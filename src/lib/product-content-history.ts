import { promises as fs } from "node:fs";
import path from "node:path";

export type ContentScoreSnapshotRow = { code: number; contentScore: number | null };
export type ContentScoreChange = {
  date: string;
  previousDate: string;
  dayDelta: number | null;
  monthDelta: number | null;
  monthBaselineDate: string | null;
};
const mean = (values: (number | null | undefined)[]) => {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length ? present.reduce((sum,value) => sum + value,0) / present.length : null;
};
export function contentScoreChange(today: string, current: number | null, history: Map<string, number | null>): ContentScoreChange {
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  const previousDate = day.toISOString().slice(0,10);
  const previous = history.get(previousDate) ?? null;
  const baseline = [...history].filter(([date, score]) => date.startsWith(today.slice(0,7)) && date < today && score != null).sort(([a],[b]) => a.localeCompare(b))[0];
  return { date: today, previousDate, dayDelta: current != null && previous != null ? current - previous : null,
    monthDelta: current != null && baseline ? current - baseline[1]! : null, monthBaselineDate: baseline?.[0] ?? null };
}
export async function readProductContentHistory(today: string, codes: number[], all: ContentScoreSnapshotRow[], from: string, to: string, requestedDates?: string[]) {
  const directory = process.env.PRODUCT_CONTENT_SNAPSHOTS_DIR || path.join(path.dirname(process.env.PRODUCT_SNAPSHOTS_DIR || path.join(process.cwd(), "data", "product-snapshots")), "product-content-snapshots");
  const current = Object.fromEntries(all.map(row => [row.code, row.contentScore]));
  let error = "";
  try {
    await fs.mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `${today}.${process.pid}.${crypto.randomUUID()}.tmp`);
    await fs.writeFile(temporary, JSON.stringify(current));
    await fs.rename(temporary, path.join(directory, `${today}.json`));
  } catch { error = "Не вдалося зберегти денний CS"; }
  const scores = new Map<string, number | null>();
  const dates = new Set(requestedDates);
  if (!requestedDates) {
    for (let day = new Date(`${from}T12:00:00Z`); day.toISOString().slice(0,10) <= to; day.setUTCDate(day.getUTCDate()+1)) dates.add(day.toISOString().slice(0,10));
  }
  for (const date of dates) {
    if (date > today) continue;
    let snapshot: Record<string, number | null>;
    try { snapshot = date === today ? current : JSON.parse(await fs.readFile(path.join(directory, `${date}.json`), "utf8")); }
    catch { continue; }
    scores.set(date, mean(codes.map(code => snapshot[code])));
  }
  return { scores, error, current: mean(codes.map(code => current[code])) };
}
