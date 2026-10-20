import { GoogleAuth } from "google-auth-library";
import { getServerResult } from "@/lib/server-result-cache";
import { ga4ReportRequest, parseGa4Rows, validateGa4Dates, type Ga4ApiReport, type Ga4MarketingReport } from "@/lib/ga4-marketing-report";

export class Ga4ConnectionError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function readGa4Marketing(from: string, to: string): Promise<Ga4MarketingReport> {
  validateGa4Dates(from, to);
  const propertyId = process.env.GA4_PROPERTY_ID?.trim();
  if (!propertyId || !/^\d+$/.test(propertyId))
    throw new Ga4ConnectionError("Підключення GA4 очікує налаштування: потрібні числовий GA4_PROPERTY_ID та доступ сервісного акаунта до ресурсу.", 503);
  const result = await getServerResult<Ga4MarketingReport>({
    namespace: "ga4-marketing-v1", key: `${propertyId}:${from}:${to}`, ttlMs: 10 * 60_000, maxEntries: 32,
    load: async () => {
      const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/analytics.readonly"] });
      let client;
      try { client = await auth.getClient(); }
      catch { throw new Ga4ConnectionError("Не вдалося авторизувати сервісний акаунт GA4. Перевірте серверні облікові дані Google.", 503); }
      const rows: Ga4MarketingReport["rows"] = [];
      let timeZone: string | undefined;
      let dataLossFromOtherRow = false;
      let subjectToThresholding = false;
      do {
        let page: Ga4ApiReport;
        try {
          const response = await client.request<Ga4ApiReport>({
            url: `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
            method: "POST", data: ga4ReportRequest(from, to, rows.length), timeout: 30_000,
          });
          page = response.data;
        } catch (error) {
          const status = (error as { response?: { status?: number } }).response?.status;
          if (status === 403 || status === 401) throw new Ga4ConnectionError("Немає доступу до GA4. Надайте сервісному акаунту роль «Читач» у ресурсі та ввімкніть Google Analytics Data API у Google Cloud.", 503);
          if (status === 429) throw new Ga4ConnectionError("Тимчасово вичерпано квоту GA4. Спробуйте пізніше.", 429);
          throw new Ga4ConnectionError("Не вдалося отримати звіт GA4. Перевірте ID ресурсу та з’єднання з Google.", 502);
        }
        const parsed = parseGa4Rows(page);
        rows.push(...parsed);
        timeZone = page.metadata?.timeZone || timeZone;
        dataLossFromOtherRow ||= Boolean(page.metadata?.dataLossFromOtherRow);
        subjectToThresholding ||= Boolean(page.metadata?.subjectToThresholding);
        if (rows.length >= (page.rowCount ?? rows.length)) break;
        if (!parsed.length || rows.length >= 100_000) throw new Ga4ConnectionError("Звіт завеликий. Скоротіть період, щоб отримати всі джерела.", 422);
      } while (true);
      return { rows, fetchedAt: new Date().toISOString(), propertyId, timeZone, dataLossFromOtherRow, subjectToThresholding };
    },
  });
  return result.value;
}
