export type CpoPeriodKind = "week" | "month";
export type CpoPeriodKey = "current" | "previous" | "yearAgo";
export type CpoDimension = "overall" | "device" | "source_medium" | "city" | "landing_page";
export type CpoFunnelStage = "sessions" | "view_item" | "add_to_cart" | "begin_checkout" | "purchase";

export type CpoCubeRow = {
  periodKind: CpoPeriodKind;
  periodYear: number;
  periodNumber: number;
  dimension: CpoDimension;
  dimensionValue: string;
  users: number;
  sessions: number;
  viewItemSessions: number;
  addToCartSessions: number;
  beginCheckoutSessions: number;
  purchaseSessions: number;
  orders: number;
  revenue: number;
  viewItemEvents: number;
  addToCartEvents: number;
  beginCheckoutEvents: number;
  purchaseEvents: number;
};

export type CpoAnalyticsCube = {
  version: 1;
  countryFilter: "Ukraine";
  savedAt: string;
  projectId: string;
  datasetId: string;
  datasetLocation: string;
  dataFrom: string;
  dataTo: string;
  bytesProcessed: number;
  rows: CpoCubeRow[];
};

export type CpoPeriodRange = {
  key: CpoPeriodKey;
  label: string;
  from: string;
  to: string;
  year: number;
  number: number;
};

export type CpoPeriodAvailability = {
  savedAt: string;
  dataFrom: string;
  dataTo: string;
  periods: Record<CpoPeriodKind, CpoPeriodRange[]>;
};

export type MetricStatus = "good" | "neutral" | "warning" | "high" | "critical" | "insufficient_data";

export type MetricResult = {
  key: string;
  label: string;
  format: "currency" | "number" | "percent";
  current: number;
  previous: number | null;
  previousYear: number | null;
  delta: number | null;
  deltaPercent: number | null;
  yoyDelta: number | null;
  yoyDeltaPercent: number | null;
  volume?: number;
  status: MetricStatus;
};

export type BusinessContribution = {
  key: "traffic" | "conversion" | "aov";
  label: string;
  current: number;
  previous: number;
  deltaPercent: number | null;
  revenueContribution: number;
  shareOfRevenueChangePct: number | null;
  isPrimaryDriver: boolean;
};

export type FunnelTransition = {
  key: string;
  label: string;
  fromStage: CpoFunnelStage;
  toStage: CpoFunnelStage;
  currentVolume: number;
  previousVolume: number;
  currentConversions: number;
  previousConversions: number;
  currentRate: number | null;
  previousRate: number | null;
  yearAgoRate: number | null;
  deltaPercent: number | null;
  yoyDeltaPercent: number | null;
  estimatedLostConversions: number;
  estimatedLostOrders: number;
  estimatedRevenueLoss: number;
  impactScore: number;
  confidenceScore: number;
  status: MetricStatus;
};

export type SegmentContribution = {
  dimension: Exclude<CpoDimension, "overall">;
  dimensionValue: string;
  transitionKey: string;
  volumeCurrent: number;
  volumePrevious: number;
  conversionsCurrent: number;
  conversionsPrevious: number;
  conversionCurrent: number;
  conversionPrevious: number;
  deltaAbsolute: number;
  deltaPercent: number | null;
  estimatedLostConversions: number;
  estimatedLostOrders: number;
  estimatedRevenueLoss: number;
  shareOfTotalLossPct: number;
  impactScore: number;
  confidenceScore: number;
  status: MetricStatus;
};

export type SignalSeverity = "info" | "warning" | "high" | "critical";
export type SignalCategory = "TRAFFIC" | "MARKETING" | "UX" | "CONTENT" | "COMMERCIAL" | "TECH" | "PAYMENT" | "DELIVERY" | "SEARCH" | "UNKNOWN";

export type AnalyticsSignal = {
  id: string;
  metric: string;
  title: string;
  currentValue: number;
  previousValue: number;
  deltaPercent: number;
  impactScore: number;
  confidenceScore: number;
  estimatedLostOrders: number;
  estimatedRevenueLoss: number;
  severity: SignalSeverity;
  category: SignalCategory;
  dimension?: Exclude<CpoDimension, "overall">;
  dimensionValue?: string;
  contributionPct?: number;
  detectedSince: string | null;
  resolvedAt: string | null;
  explanation: string;
  recommendedChecks: string[];
};

export type DiagnosticNode = {
  id: string;
  label: string;
  kind: "business" | "funnel" | "segment";
  deltaPercent: number | null;
  impact: number;
  status: MetricStatus;
  signalId?: string;
  children: DiagnosticNode[];
};

export type CpoDiagnosticResult = {
  version: 1;
  generatedAt: string;
  sourceCubeSavedAt: string;
  countryFilter: "Ukraine";
  periodKind: CpoPeriodKind;
  selectedPeriod: number;
  selectedYear: number;
  periods: Record<CpoPeriodKey, CpoPeriodRange>;
  overallStatus: SignalSeverity | "healthy";
  executiveMetrics: MetricResult[];
  businessDecomposition: BusinessContribution[];
  primaryProblem: AnalyticsSignal | null;
  topSignals: AnalyticsSignal[];
  funnel: FunnelTransition[];
  primaryFunnelStage: string | null;
  segmentContributions: Record<Exclude<CpoDimension, "overall">, SegmentContribution[]>;
  diagnosticTree: DiagnosticNode[];
  requiresAttention: AnalyticsSignal[];
  summary: string;
  limitations: string[];
  storage: {
    source: "saved";
    cubeCompressedBytes: number;
    diagnosticSnapshotPath: string | null;
  };
};
