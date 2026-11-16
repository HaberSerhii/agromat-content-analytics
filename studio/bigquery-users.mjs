import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const memory = new Map(),
  pending = new Map();
let queue = Promise.resolve(),
  started = [];
export function usersQuery(project, dataset, range, weekly = false) {
  if (!/^[a-zA-Z0-9_-]+$/.test(project) || !/^[a-zA-Z0-9_]+$/.test(dataset))
    throw new Error("invalid_dataset");
  const week =
    "FORMAT_DATE('%F', DATE_TRUNC(PARSE_DATE('%Y%m%d', event_date), ISOWEEK))";
  return {
    query: `SELECT ${weekly ? week + " AS week, " : ""}COUNT(DISTINCT user_pseudo_id) AS users, MIN(event_date) AS data_from, MAX(event_date) AS data_through FROM \`${project}.${dataset}.events_*\` WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND geo.country = @country${weekly ? " GROUP BY GROUPING SETS ((week), ()) ORDER BY week" : ""}`,
    params: {
      fromSuffix: range.from.replaceAll("-", ""),
      toSuffix: range.to.replaceAll("-", ""),
      country: "Ukraine",
    },
    maximumBytesBilled: "10000000000",
    useQueryCache: true,
  };
}
export function usersSafe(row = {}, updatedAt) {
  const iso = (v) =>
    typeof v === "string" && /^\d{8}$/.test(v)
      ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
      : null;
  const users = Number(row.users);
  if (!Number.isSafeInteger(users) || users < 0)
    throw new Error("invalid_users");
  return {
    available: true,
    users,
    dataFrom: iso(row.data_from),
    dataThrough: iso(row.data_through),
    hasData: Boolean(row.data_through),
    updatedAt,
    loadedAt: updatedAt,
    definition: "BigQuery · унікальні user_pseudo_id за весь період · Україна",
  };
}
export function usersBinsQuery(project, dataset, bins) {
  if (!Array.isArray(bins) || !bins.length || bins.length > 850)
    throw Error("invalid_bins");
  for (const bin of bins)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(bin.from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(bin.to) ||
      bin.from > bin.to
    )
      throw Error("invalid_bins");
  const range = {
    from: bins.map((bin) => bin.from).sort()[0],
    to: bins
      .map((bin) => bin.to)
      .sort()
      .at(-1),
  };
  const query = usersQuery(project, dataset, range);
  return {
    ...query,
    query: `WITH events AS (SELECT event_date,user_pseudo_id FROM \`${project}.${dataset}.events_*\` WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND geo.country = @country) SELECT b.key AS bin_key,COUNT(DISTINCT e.user_pseudo_id) AS users,MIN(e.event_date) AS data_from,MAX(e.event_date) AS data_through FROM UNNEST(@bins) b LEFT JOIN events e ON e.event_date BETWEEN b.fromSuffix AND b.toSuffix GROUP BY bin_key`,
    params: {
      ...query.params,
      bins: bins.map((bin) => ({
        key: bin.key,
        fromSuffix: bin.from.replaceAll("-", ""),
        toSuffix: bin.to.replaceAll("-", ""),
      })),
    },
  };
}
export function readUsersBins(bins) {
  const range = {
    from: bins.map((bin) => bin.from).sort()[0],
    to: bins
      .map((bin) => bin.to)
      .sort()
      .at(-1),
  };
  return readUsers(range, false, bins);
}
export async function readUsers(range, weekly = false, bins = null) {
  const key = `${range.from}_${range.to}${bins ? "_bins_" + createHash("sha256").update(JSON.stringify(bins)).digest("hex").slice(0, 16) : weekly ? "_weekly_v1" : ""}`,
    dir = process.env.STUDIO_BQ_CACHE_DIR;
  const file = dir ? path.join(dir, `${key}.json`) : null;
  let saved = memory.get(key);
  if (!saved && file)
    try {
      saved = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {}
  if (saved && Date.now() - Date.parse(saved.updatedAt) < 6 * 3600000) {
    memory.set(key, saved);
    return saved;
  }
  if (pending.has(key)) return pending.get(key);
  const run = queue
    .then(async () => {
      started = started.filter((t) => Date.now() - t < 3600000);
      if (started.length >= 24) throw new Error("query_budget");
      started.push(Date.now());
      const require = createRequire(import.meta.url);
      const { BigQuery } = require(
        process.env.STUDIO_BIGQUERY_SDK ||
          "/opt/agromat-content-analytics/node_modules/@google-cloud/bigquery",
      );
      const client = new BigQuery({
        projectId: process.env.BIGQUERY_PROJECT_ID,
      });
      const [rows] = await client.query({
        ...(bins
          ? usersBinsQuery(
              process.env.BIGQUERY_PROJECT_ID,
              process.env.BIGQUERY_DATASET_ID,
              bins,
            )
          : usersQuery(
              process.env.BIGQUERY_PROJECT_ID,
              process.env.BIGQUERY_DATASET_ID,
              range,
              weekly,
            )),
        jobTimeoutMs: 60000,
      });
      const updatedAt = new Date().toISOString();
      const value = bins
        ? {
            available: true,
            updatedAt,
            loadedAt: updatedAt,
            periods: rows.map((row) => ({
              key: row.bin_key,
              ...usersSafe(row, updatedAt),
            })),
          }
        : usersSafe(
            weekly ? rows.find((row) => !row.week) : rows[0],
            updatedAt,
          );
      if (weekly)
        value.weeks = rows
          .filter((row) => row.week)
          .map((row) => ({
            week: row.week,
            ...usersSafe(row, value.updatedAt),
          }));
      if (memory.size >= 60) memory.delete(memory.keys().next().value);
      memory.set(key, value);
      if (file)
        await fs.writeFile(file, JSON.stringify(value), { mode: 0o600 });
      return value;
    })
    .catch(() => ({
      available: false,
      users: null,
      notice: "BigQuery тимчасово недоступний. Спробуйте пізніше.",
    }))
    .finally(() => pending.delete(key));
  queue = run.then(() => {});
  pending.set(key, run);
  return run;
}
