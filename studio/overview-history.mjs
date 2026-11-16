import { calendarUserBins, yearBefore } from "./public/chart-periods.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { readUsers, readUsersBins } from "./bigquery-users.mjs";
const DAY = 86400000,
  TTL = 6 * 3600000;
const memory = new Map(),
  pending = new Map();
let salesQueue = Promise.resolve();
const shift = (date, days) =>
  new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
export function historyRange(
  today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }),
) {
  const yesterday = shift(today, -1),
    to = yesterday,
    from = shift(to, -364);
  return {
    from,
    to,
    previousFrom: yearBefore(from),
    previousTo: yearBefore(to),
    yearFrom: to.slice(0, 4) + "-01-01",
  };
}
export function salesDailySafe(raw, range) {
  // Public sales rows are a 50-row preview, so they cannot define cancellation history.
  const hasCancellations = Array.isArray(raw.summary?.canceledByDate);
  const canceled = new Map(
    (raw.summary?.canceledByDate || []).map((row) => [
      row.date,
      Number(row.docs) || 0,
    ]),
  );
  const first = raw.summary?.firstShippedDate?.slice(0, 10);
  const last = raw.summary?.lastShippedDate?.slice(0, 10);
  return {
    available: true,
    range,
    updatedAt: raw.source?.lastModified || null,
    coverageFrom: first || null,
    coverageTo: last || null,
    days: (raw.summary?.byDate || []).map((row) => ({
      date: row.date,
      revenue: Number(row.revenue) || 0,
      docs: Number(row.docs) || 0,
      canceled: hasCancellations ? canceled.get(row.date) || 0 : null,
    })),
  };
}
async function cached(key, load) {
  const current = memory.get(key);
  if (
    current &&
    Date.now() - Date.parse(current.loadedAt) < (current.partial ? 60000 : TTL)
  )
    return current;
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    const dir = process.env.STUDIO_BQ_CACHE_DIR;
    const filename = dir ? path.join(dir, "overview-" + key + ".json") : null;
    if (filename)
      try {
        const saved = JSON.parse(await fs.readFile(filename, "utf8"));
        if (Date.now() - Date.parse(saved.loadedAt) < TTL) {
          memory.set(key, saved);
          return saved;
        }
      } catch {}
    const value = { ...(await load()), loadedAt: new Date().toISOString() };
    if (!value.available) return value;
    if (memory.size >= 12) memory.delete(memory.keys().next().value);
    memory.set(key, value);
    if (filename && !value.partial)
      try {
        await fs.writeFile(filename, JSON.stringify(value), { mode: 0o600 });
      } catch {}
    return value;
  })().finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
export function webWeeklyRequest(range, daily = false) {
  return {
    dateRanges: [{ startDate: range.from, endDate: range.to }],
    dimensions: [{ name: daily ? "date" : "isoYearIsoWeek" }],
    metrics: [{ name: "sessions" }, { name: "ecommercePurchases" }],
    orderBys: [
      { dimension: { dimensionName: daily ? "date" : "isoYearIsoWeek" } },
    ],
    limit: "1000",
  };
}
async function webWeekly(range) {
  return cached("web-daily-v1-" + range.from + "-" + range.to, async () => {
    const property = process.env.GA4_PROPERTY_ID;
    if (!/^\d+$/.test(property || "")) return { available: false, weeks: [] };
    const require = createRequire(import.meta.url);
    const { GoogleAuth } = require(
      process.env.STUDIO_GOOGLE_AUTH_SDK ||
        "/opt/agromat-content-analytics/node_modules/google-auth-library",
    );
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    const client = await auth.getClient();
    const response = await client.request({
      url: `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
      method: "POST",
      data: webWeeklyRequest(range, true),
      timeout: 60000,
    });
    return {
      available: true,
      days: (response.data.rows || []).map((row) => ({
        date: row.dimensionValues[0].value.replace(
          /^(\d{4})(\d{2})(\d{2})$/,
          "$1-$2-$3",
        ),
        sessions: Number(row.metricValues[0].value) || 0,
        purchases: Number(row.metricValues[1].value) || 0,
      })),
      thresholded: Boolean(response.data.metadata?.subjectToThresholding),
      incomplete: Boolean(response.data.metadata?.dataLossFromOtherRow),
    };
  });
}
export async function readOverviewHistory({
  channel = "all",
  today,
  range: selectedRange,
  origin = process.env.STUDIO_UPSTREAM || "http://127.0.0.1:3000",
} = {}) {
  if (!["all", "site", "rozetka", "monomarket"].includes(channel))
    throw Error("invalid_channel");
  const host = new URL(origin);
  if (
    host.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(host.hostname)
  )
    throw Error("invalid_upstream");
  today ||= new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const range = selectedRange
    ? {
        ...selectedRange,
        previousFrom: yearBefore(selectedRange.from),
        previousTo: yearBefore(selectedRange.to),
      }
    : historyRange(today);
  return cached(
    "history-calendar-v1-" + channel + "-" + range.from + "-" + range.to,
    async () => {
      const ranges = [
        { from: range.from, to: range.to },
        { from: range.previousFrom, to: range.previousTo },
      ];
      const sales = [];
      // Two fixed, bounded year reads. Raw document rows never leave this process.
      for (const period of ranges) {
        const run = salesQueue.then(async () => {
          try {
            const response = await fetch(
              origin +
                "/api/sales?" +
                new URLSearchParams({ ...period, channel, compact: "0" }),
              {
                headers: {
                  "x-agromat-dashboard-auth":
                    process.env.STUDIO_UPSTREAM_AUTH || "",
                },
                signal: AbortSignal.timeout(120000),
              },
            );
            if (!response.ok) throw Error("sales_unavailable");
            return salesDailySafe(await response.json(), period);
          } catch {
            return { available: false, range: period, days: [] };
          }
        });
        salesQueue = run.then(() => {});
        sales.push(await run);
      }
      const usersRange = { from: range.previousFrom, to: range.to };
      const [users, web] = await Promise.all([
        readUsersBins(calendarUserBins(range)),
        webWeekly(usersRange).catch(() => ({ available: false, weeks: [] })),
      ]);
      return {
        available:
          sales.some((s) => s.available) || users.available || web.available,
        partial:
          !sales.every((s) => s.available) ||
          !users.available ||
          !web.available,
        range,
        channel,
        sales,
        users,
        web,
      };
    },
  );
}
