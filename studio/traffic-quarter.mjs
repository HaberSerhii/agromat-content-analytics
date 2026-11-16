import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import {
  lastQuarterWeeks,
  calendarBins,
  addDays,
} from "./public/chart-periods.mjs";
export const trafficGroups = [
  { id: "organic", name: "Органіка", color: "#533afd" },
  { id: "paid", name: "Реклама", color: "#8d7afb" },
  { id: "direct", name: "Прямі", color: "#baaefa" },
  { id: "email", name: "Email і Viber", color: "#e1dbff" },
  { id: "other", name: "Інше", color: "#d6d7df" },
];
export function trafficGroup(channel, source = "") {
  if (/viber/i.test(source) || /email|sms|mobile push/i.test(channel))
    return "email";
  if (/^organic/i.test(channel)) return "organic";
  if (/paid|cross-network|display|affiliates/i.test(channel)) return "paid";
  if (channel === "Direct") return "direct";
  return "other";
}
export function trafficQuarterRequest(range, offset = 0) {
  return {
    dateRanges: [{ startDate: range.from, endDate: range.to }],
    dimensions: [
      { name: "isoYearIsoWeek" },
      { name: "sessionDefaultChannelGroup" },
      { name: "sessionSource" },
    ],
    metrics: [{ name: "sessions" }],
    orderBys: [
      "isoYearIsoWeek",
      "sessionDefaultChannelGroup",
      "sessionSource",
    ].map((dimensionName) => ({ dimension: { dimensionName } })),
    limit: "10000",
    offset: String(offset),
  };
}
export function normalizeTrafficQuarter(raw, range) {
  const grouped = new Map();
  for (const row of raw) {
    const week = row.dimensionValues?.[0]?.value,
      channel = row.dimensionValues?.[1]?.value || "",
      source = row.dimensionValues?.[2]?.value || "";
    const sessions = Number(row.metricValues?.[0]?.value);
    if (!/^\d{6}$/.test(week) || !Number.isFinite(sessions) || sessions < 0)
      throw Error("invalid_traffic");
    const counts =
      grouped.get(week) ||
      Object.fromEntries(trafficGroups.map((group) => [group.id, 0]));
    counts[trafficGroup(channel, source)] += sessions;
    grouped.set(week, counts);
  }
  const weeks = calendarBins(range, "week").map((week) => {
    const isoYear = addDays(week.from, 3).slice(0, 4),
      counts =
        grouped.get(isoYear + String(week.week).padStart(2, "0")) ||
        Object.fromEntries(trafficGroups.map((group) => [group.id, 0]));
    return {
      ...week,
      counts,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    };
  });
  return {
    available: true,
    range,
    groups: trafficGroups,
    weeks,
    total: weeks.reduce((sum, week) => sum + week.total, 0),
  };
}
let saved, pending;
export async function readTrafficQuarter(
  today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }),
) {
  const range = lastQuarterWeeks(today),
    key = range.from + ":" + range.to;
  if (
    saved?.key === key &&
    Date.now() - Date.parse(saved.value.updatedAt) < 6 * 3600000
  )
    return saved.value;
  if (pending?.key === key) return pending.promise;
  const promise = (async () => {
    const file = process.env.STUDIO_BQ_CACHE_DIR
      ? path.join(
          process.env.STUDIO_BQ_CACHE_DIR,
          "traffic-quarter-" + range.to + ".json",
        )
      : null;
    if (file)
      try {
        const value = JSON.parse(await fs.readFile(file, "utf8"));
        if (Date.now() - Date.parse(value.updatedAt) < 6 * 3600000) {
          saved = { key, value };
          return value;
        }
      } catch {}
    const property = process.env.GA4_PROPERTY_ID;
    if (!/^\d+$/.test(property || ""))
      return { available: false, range, notice: "Джерело GA4 не підключено." };
    const require = createRequire(import.meta.url),
      { GoogleAuth } = require(
        process.env.STUDIO_GOOGLE_AUTH_SDK ||
          "/opt/agromat-content-analytics/node_modules/google-auth-library",
      );
    const client = await new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    }).getClient();
    const rows = [];
    let thresholded = false,
      incomplete = false;
    do {
      const response = await client.request({
        url: `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
        method: "POST",
        data: trafficQuarterRequest(range, rows.length),
        timeout: 60000,
      });
      const page = response.data;
      rows.push(...(page.rows || []));
      thresholded ||= Boolean(page.metadata?.subjectToThresholding);
      incomplete ||= Boolean(page.metadata?.dataLossFromOtherRow);
      if (rows.length > 50000) throw Error("traffic_too_large");
      if (rows.length >= (page.rowCount ?? rows.length)) break;
      if (!page.rows?.length) throw Error("traffic_incomplete");
    } while (true);
    const value = {
      ...normalizeTrafficQuarter(rows, range),
      updatedAt: new Date().toISOString(),
      thresholded,
      incomplete,
    };
    saved = { key, value };
    if (file)
      try {
        await fs.writeFile(file, JSON.stringify(value), { mode: 0o600 });
      } catch {}
    return value;
  })()
    .catch(() => ({
      available: false,
      range,
      notice: "Немає повного тижневого звіту GA4.",
    }))
    .finally(() => {
      if (pending?.promise === promise) pending = null;
    });
  pending = { key, promise };
  return promise;
}
