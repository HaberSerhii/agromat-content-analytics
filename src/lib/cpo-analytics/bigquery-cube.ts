import { BigQuery } from "@google-cloud/bigquery";
import { cpoCubeSql } from "../../../scripts/lib/cpo-query.mjs";
import { currentKyivIdentity, isoWeekStart } from "./periods";
import { readCpoCube, saveCpoCube } from "./store";
import type { CpoAnalyticsCube, CpoCubeRow, CpoDimension, CpoPeriodKind } from "./types";

const COUNTRY = "Ukraine" as const;
const MAXIMUM_BYTES_BILLED = "100000000000";

type MetadataRow = {
  data_from: string | { value?: string } | null;
  data_to: string | { value?: string } | null;
};

type QueryRow = {
  period_kind: CpoPeriodKind;
  period_year: number | string;
  period_number: number | string;
  dimension_name: CpoDimension;
  dimension_value: string | null;
  users: number | string | null;
  sessions: number | string | null;
  view_item_sessions: number | string | null;
  add_to_cart_sessions: number | string | null;
  begin_checkout_sessions: number | string | null;
  purchase_sessions: number | string | null;
  orders: number | string | null;
  revenue: number | string | null;
  view_item_events: number | string | null;
  add_to_cart_events: number | string | null;
  begin_checkout_events: number | string | null;
  purchase_events: number | string | null;
};

function cleanIdentifier(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Некоректний BigQuery identifier");
  return value;
}

function projectId(): string {
  return cleanIdentifier(process.env.BIGQUERY_PROJECT_ID || "maximal-furnace-385413");
}

function datasetId(): string {
  return cleanIdentifier(process.env.BIGQUERY_DATASET_ID || "analytics_321347682");
}

function scalar(value: number | string | null): number {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function dateScalar(value: MetadataRow["data_from"]): string | null {
  if (typeof value === "string") return value.slice(0, 10);
  return value?.value?.slice(0, 10) || null;
}


async function metadata(client: BigQuery, project: string, dataset: string, location: string): Promise<{ dataFrom: string; dataTo: string }> {
  const [rows] = await client.query({
    query: `
      SELECT
        FORMAT_DATE('%Y-%m-%d', MIN(SAFE.PARSE_DATE('%Y%m%d', REGEXP_EXTRACT(table_name, r'^events_(\\d{8})$')))) AS data_from,
        FORMAT_DATE('%Y-%m-%d', MAX(SAFE.PARSE_DATE('%Y%m%d', REGEXP_EXTRACT(table_name, r'^events_(\\d{8})$')))) AS data_to
      FROM \`${project}.${dataset}.INFORMATION_SCHEMA.TABLES\`
      WHERE REGEXP_CONTAINS(table_name, r'^events_\\d{8}$')
    `,
    location,
  });
  const row = (rows as MetadataRow[])[0];
  const availableFrom = dateScalar(row?.data_from);
  const dataTo = dateScalar(row?.data_to);
  if (!availableFrom || !dataTo) throw new Error("У dataset не знайдено денні GA4 tables");
  const requestedFrom = isoWeekStart(currentKyivIdentity().year - 1, 1);
  return { dataFrom: availableFrom > requestedFrom ? availableFrom : requestedFrom, dataTo };
}

async function context() {
  const project = projectId();
  const dataset = datasetId();
  const client = new BigQuery({ projectId: project });
  const [datasetMetadata] = await client.dataset(dataset).getMetadata();
  const location = typeof datasetMetadata.location === "string" ? datasetMetadata.location : "EU";
  const range = await metadata(client, project, dataset, location);
  const options = {
    query: cpoCubeSql(project, dataset),
    params: { fromSuffix: range.dataFrom.replaceAll("-", ""), toSuffix: range.dataTo.replaceAll("-", ""), country: COUNTRY },
    location,
    maximumBytesBilled: MAXIMUM_BYTES_BILLED,
    useQueryCache: true,
  };
  return { project, dataset, client, location, range, options };
}

export async function estimateCpoCubeBytes(): Promise<number> {
  const { client, options } = await context();
  const [job] = await client.createQueryJob({ ...options, dryRun: true });
  return scalar(job.metadata.statistics?.query?.totalBytesProcessed || null);
}

export async function buildCpoCube(): Promise<{ cube: CpoAnalyticsCube; compressedBytes: number }> {
  const existing = await readCpoCube();
  if (existing) return existing;
  const { project, dataset, client, location, range, options } = await context();
  const [job] = await client.createQueryJob(options);
  // Fetch in bounded pages. The cube can contain many distinct landing pages
  // and cities; relying on the client's automatic pagination may keep the
  // request open indefinitely while materialising all rows at once.
  const queryRows: QueryRow[] = [];
  let pageToken: string | undefined;
  let jobComplete = false;
  do {
    const [page, nextQuery, response] = await job.getQueryResults({
      autoPaginate: false,
      maxResults: 10000,
      ...(pageToken ? { pageToken } : {}),
    });
    queryRows.push(...(page as QueryRow[]));
    pageToken = nextQuery?.pageToken;
    jobComplete = response?.jobComplete !== false;
    if (!jobComplete && !pageToken) await new Promise((resolve) => setTimeout(resolve, 1500));
  } while (pageToken || !jobComplete);
  if (queryRows.length === 0) throw new Error("BigQuery returned an empty CPO result");
  const [jobMetadata] = await job.getMetadata();
  const rows = (queryRows as QueryRow[]).map((row): CpoCubeRow => ({
    periodKind: row.period_kind,
    periodYear: scalar(row.period_year),
    periodNumber: scalar(row.period_number),
    dimension: row.dimension_name,
    dimensionValue: String(row.dimension_value || "(not set)"),
    users: scalar(row.users),
    sessions: scalar(row.sessions),
    viewItemSessions: scalar(row.view_item_sessions),
    addToCartSessions: scalar(row.add_to_cart_sessions),
    beginCheckoutSessions: scalar(row.begin_checkout_sessions),
    purchaseSessions: scalar(row.purchase_sessions),
    orders: scalar(row.orders),
    revenue: scalar(row.revenue),
    viewItemEvents: scalar(row.view_item_events),
    addToCartEvents: scalar(row.add_to_cart_events),
    beginCheckoutEvents: scalar(row.begin_checkout_events),
    purchaseEvents: scalar(row.purchase_events),
  }));
  const cube: CpoAnalyticsCube = {
    version: 1,
    countryFilter: COUNTRY,
    savedAt: new Date().toISOString(),
    projectId: project,
    datasetId: dataset,
    datasetLocation: location,
    dataFrom: range.dataFrom,
    dataTo: range.dataTo,
    bytesProcessed: scalar(jobMetadata.statistics?.query?.totalBytesProcessed || null),
    rows,
  };
  return { cube, compressedBytes: await saveCpoCube(cube) };
}
