import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const memory = new Map(),
  pending = new Map();
let queue = Promise.resolve(),
  started = [];
export function usersQuery(project, dataset, range) {
  if (!/^[a-zA-Z0-9_-]+$/.test(project) || !/^[a-zA-Z0-9_]+$/.test(dataset))
    throw new Error("invalid_dataset");
  return {
    query: `SELECT COUNT(DISTINCT user_pseudo_id) AS users, MIN(event_date) AS data_from, MAX(event_date) AS data_through FROM \`${project}.${dataset}.events_*\` WHERE _TABLE_SUFFIX BETWEEN @fromSuffix AND @toSuffix AND geo.country = @country`,
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
export async function readUsers(range) {
  const key = `${range.from}_${range.to}`,
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
        ...usersQuery(
          process.env.BIGQUERY_PROJECT_ID,
          process.env.BIGQUERY_DATASET_ID,
          range,
        ),
        jobTimeoutMs: 60000,
      });
      const value = usersSafe(rows[0], new Date().toISOString());
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
