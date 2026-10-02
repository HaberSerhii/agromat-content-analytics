import { createHash } from "node:crypto";
import { getServerResult } from "@/lib/server-result-cache";
import { deduplicatePayments, normalizePayment, summarizePayments, type OnlinePaymentsDataset } from "@/lib/online-payments";

export function liqpaySignature(data: string, privateKey: string) {
  return createHash("sha3-256").update(privateKey + data + privateKey).digest("base64");
}
export async function liqpayRead(action: "reports" | "status", params: Record<string, unknown>) {
  const publicKey = process.env.LIQPAY_PUBLIC_KEY;
  const privateKey = process.env.LIQPAY_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error("LiqPay is not configured");
  const data = Buffer.from(JSON.stringify({ ...params, action, version: 7, public_key: publicKey })).toString("base64");
  const response = await fetch("https://www.liqpay.ua/api/request", {
    method: "POST", body: new URLSearchParams({ data, signature: liqpaySignature(data, privateKey) }),
    cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`LiqPay HTTP ${response.status}`);
  const payload = await response.json() as Record<string, unknown>;
  const paymentResponse = action === "status" && payload.order_id != null && (payload.payment_id != null || payload.transaction_id != null || payload.liqpay_order_id != null) && payload.status != null;
  if (!paymentResponse && !["ok", "success"].includes(String(payload.result))) throw new Error("LiqPay відхилив запит. Перевірте ключі та доступ до API.");
  return payload;
}
/** Each archive request spans at most 28 days, within the documented one-month limit. */
export function archiveWindows(from: string, to: string) {
  const kyivStart = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    const utc = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 10) !== date) return NaN;
    const offset = new Intl.DateTimeFormat("en", { timeZone: "Europe/Kyiv", timeZoneName: "longOffset" }).formatToParts(new Date(utc)).find((part) => part.type === "timeZoneName")?.value;
    return Date.parse(`${date}T00:00:00${offset?.replace("GMT", "") || "+00:00"}`);
  };
  const start = kyivStart(from);
  const nextDay = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000);
  const end = Number.isFinite(kyivStart(to)) ? kyivStart(nextDay.toISOString().slice(0, 10)) - 1 : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start > 366 * 86_400_000) throw new Error("Оберіть коректний період до одного року");
  const windows = [];
  for (let cursor = start; cursor <= end; cursor += 28 * 86_400_000) windows.push({ date_from: cursor, date_to: Math.min(end, cursor + 28 * 86_400_000 - 1) });
  return windows;
}
export async function readOnlinePayments(from: string, to: string): Promise<OnlinePaymentsDataset> {
  const empty = { fetchedAt: null, payments: [], summary: summarizePayments([]) };
  if (!process.env.LIQPAY_PUBLIC_KEY || !process.env.LIQPAY_PRIVATE_KEY) return { ...empty, availability: "not_configured", notice: "LiqPay ще не підключено. Статуси транзакцій, причини відмов та статистика оплат з’являться після налаштування." };
  try {
    const result = await getServerResult({
      namespace: "liqpay-archive-v1", key: `${process.env.LIQPAY_PUBLIC_KEY}|${from}|${to}`,
      ttlMs: 60_000, maxEntries: 16,
      load: async () => {
        const payments = [];
        for (const window of archiveWindows(from, to)) {
          const payload = await liqpayRead("reports", { ...window, resp_format: "json" });
          if (!Array.isArray(payload.data)) throw new Error("LiqPay повернув неочікуваний формат архіву");
          payments.push(...payload.data.map((row: Record<string, unknown>) => normalizePayment(row)));
        }
        return { payments: deduplicatePayments(payments), fetchedAt: new Date().toISOString() };
      },
    });
    return { availability: "ready", notice: null, fetchedAt: result.value.fetchedAt, payments: result.value.payments, summary: summarizePayments(result.value.payments) };
  } catch {
    return { ...empty, availability: "error", notice: "Не вдалося завантажити LiqPay. Перевірте ключі, доступ до API та повторіть оновлення. Це помилка синхронізації, а не відмова платежу." };
  }
}
