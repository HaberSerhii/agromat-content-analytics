import { GoogleAuth } from "google-auth-library";

const DEFAULT_SHEET_ID = "12LQc7_q7ok9pufQJCNC-rtIYTc4OCdZwsdww_l_xrJc";
const DEFAULT_SHEET_NAME = "Лист1";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

type SheetValuesResponse = {
  values?: unknown[][];
  updatedRange?: string;
  updates?: { updatedRange?: string };
};

export interface SearchSheetSyncResult {
  action: "created" | "updated";
  rowNumber: number;
}

function sheetId(): string {
  return process.env.MULTISEARCH_GOOGLE_SHEET_ID || DEFAULT_SHEET_ID;
}

function sheetName(): string {
  return process.env.MULTISEARCH_GOOGLE_SHEET_NAME || DEFAULT_SHEET_NAME;
}

function quotedSheetName(): string {
  return `'${sheetName().replaceAll("'", "''")}'`;
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("uk")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ");
}

async function accessToken(): Promise<string> {
  const client = await new GoogleAuth({ scopes: [SHEETS_SCOPE] }).getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("Google Sheets access token is unavailable");
  return token.token;
}

async function sheetsFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(25_000),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = "";
    try {
      message = String((JSON.parse(text) as { error?: { message?: string } }).error?.message || "");
    } catch {}
    throw new Error(`Google Sheets HTTP ${response.status}${message ? `: ${message}` : ""}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function readRows(): Promise<string[][]> {
  const range = encodeURIComponent(`${quotedSheetName()}!A:C`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;
  const payload = await sheetsFetch<SheetValuesResponse>(url);
  return (payload.values || []).map((row) => [
    String(row[0] || "").trim(),
    String(row[1] || "").trim(),
    String(row[2] || "").trim(),
  ]);
}

function rowNumberFromRange(range: string | undefined, fallback: number): number {
  const match = range?.match(/![A-Z]+(\d+):/i);
  return match ? Number(match[1]) : fallback;
}

export async function syncSearchQueryToGoogleSheet(options: {
  matchQueries: string[];
  queryUk: string;
  queryRu: string;
  goodsRefs: number[];
}): Promise<SearchSheetSyncResult> {
  const rows = await readRows();
  const candidates = new Set(options.matchQueries.map(normalize).filter(Boolean));
  const rowIndex = rows.slice(1).findIndex((row) =>
    [normalize(row[0]), normalize(row[1])].some((query) => candidates.has(query)),
  );
  const values = [[
    options.queryUk.trim(),
    options.queryRu.trim(),
    [...new Set(options.goodsRefs)].join(", "),
  ]];

  if (rowIndex >= 0) {
    const rowNumber = rowIndex + 2;
    const range = encodeURIComponent(`${quotedSheetName()}!A${rowNumber}:C${rowNumber}`);
    const payload = await sheetsFetch<SheetValuesResponse>(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${range}?valueInputOption=RAW`,
      { method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values }) },
    );
    return {
      action: "updated",
      rowNumber: rowNumberFromRange(payload.updatedRange, rowNumber),
    };
  }

  const appendRange = encodeURIComponent(`${quotedSheetName()}!A:C`);
  const payload = await sheetsFetch<SheetValuesResponse>(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${appendRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values }) },
  );
  return {
    action: "created",
    rowNumber: rowNumberFromRange(payload.updates?.updatedRange, rows.length + 1),
  };
}
