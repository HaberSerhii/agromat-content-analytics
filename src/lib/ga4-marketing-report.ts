export type Ga4TrafficRow = {
  channel: string;
  source: string;
  medium: string;
  campaign: string;
  sessions: number;
  purchases: number;
  revenue: number;
};
export type Ga4MarketingReport = {
  rows: Ga4TrafficRow[];
  fetchedAt: string;
  propertyId: string;
  timeZone?: string;
  dataLossFromOtherRow: boolean;
  subjectToThresholding: boolean;
};
export type Ga4ApiReport = {
  rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
  rowCount?: number;
  metadata?: { timeZone?: string; dataLossFromOtherRow?: boolean; subjectToThresholding?: boolean };
};

export function validateGa4Dates(from: string, to: string) {
  for (const value of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
      throw new Error("Вкажіть коректні дати періоду");
  }
  if (from > to) throw new Error("Дата початку має бути не пізніше дати завершення");
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) throw new Error("Оберіть період до 367 днів");
}

export function ga4ReportRequest(from: string, to: string, offset = 0) {
  validateGa4Dates(from, to);
  return {
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: ["sessionDefaultChannelGroup", "sessionSource", "sessionMedium", "sessionCampaignName"].map(name => ({ name })),
    metrics: ["sessions", "ecommercePurchases", "purchaseRevenue"].map(name => ({ name })),
    currencyCode: "UAH",
    orderBys: [{ metric: { metricName: "sessions" }, desc: true },
      ...["sessionDefaultChannelGroup", "sessionSource", "sessionMedium", "sessionCampaignName"].map(dimensionName => ({ dimension: { dimensionName } }))],
    limit: "10000", offset: String(offset),
  };
}

export function parseGa4Rows(report: Ga4ApiReport): Ga4TrafficRow[] {
  return (report.rows || []).map(row => {
    const dimension = (i: number) => row.dimensionValues?.[i]?.value || "(not set)";
    const metric = (i: number) => {
      const value = Number(row.metricValues?.[i]?.value || 0);
      if (!Number.isFinite(value)) throw new Error("GA4 повернув некоректну метрику");
      return value;
    };
    return { channel: dimension(0), source: dimension(1), medium: dimension(2), campaign: dimension(3), sessions: metric(0), purchases: metric(1), revenue: metric(2) };
  });
}
