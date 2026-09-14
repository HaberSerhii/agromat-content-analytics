export type BigQueryAuditEventMetric = {
  events: number;
  users: number;
  sessions: number;
  daysActive: number;
  firstSeen: string | null;
  lastSeen: string | null;
};

export type BigQueryAuditEvent = {
  name: string;
  current: BigQueryAuditEventMetric;
  previous: BigQueryAuditEventMetric;
  yearAgo: BigQueryAuditEventMetric;
  deltaPreviousPct: number | null;
  deltaYearAgoPct: number | null;
};

export type BigQueryAuditPeriod = {
  key: "current" | "previous" | "yearAgo";
  label: string;
  from: string;
  to: string;
  events: number;
  users: number;
  sessions: number;
  eventTypes: number;
};

export type BigQueryAuditParameter = {
  eventName: string;
  key: string;
  occurrences: number;
  populated: number;
  populationPct: number;
  valueType: "string" | "integer" | "float" | "double" | "unknown";
};

export type BigQueryAuditCheck = {
  key: string;
  label: string;
  status: "ok" | "warning" | "missing";
  detail: string;
};

export type BigQueryAuditResponse = {
  generatedAt: string;
  projectId: string;
  datasetId: string;
  datasetLocation: string | null;
  tableCount: number;
  dataFrom: string | null;
  dataTo: string | null;
  periodKind: "week" | "month";
  selectedPeriod: number;
  selectedYear: number;
  periods: {
    current: BigQueryAuditPeriod;
    previous: BigQueryAuditPeriod;
    yearAgo: BigQueryAuditPeriod;
  };
  sampleFrom: string;
  sampleTo: string;
  sampledDays: number;
  totals: {
    events: number;
    users: number;
    sessions: number;
    eventTypes: number;
    parameters: number;
  };
  events: BigQueryAuditEvent[];
  parameters: BigQueryAuditParameter[];
  checks: BigQueryAuditCheck[];
  bytesProcessed: number;
  storage: {
    source: "bigquery" | "saved";
    savedAt: string;
    compressedBytes: number;
  };
};
