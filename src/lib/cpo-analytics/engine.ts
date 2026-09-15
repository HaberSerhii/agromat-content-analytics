import { cpoPeriodRanges } from "@/lib/cpo-analytics/periods";
import type {
  AnalyticsSignal,
  BusinessContribution,
  CpoAnalyticsCube,
  CpoCubeRow,
  CpoDiagnosticResult,
  CpoDimension,
  CpoFunnelStage,
  CpoPeriodKey,
  CpoPeriodKind,
  DiagnosticNode,
  FunnelTransition,
  MetricResult,
  MetricStatus,
  SegmentContribution,
  SignalCategory,
  SignalSeverity,
} from "./types";

export const CPO_THRESHOLDS = {
  minSessions: 100,
  minStageVolume: 100,
  minBaseConversions: 10,
  maxSignalsPerLevel: 5,
  maxGlobalSignals: 5,
} as const;

type PeriodRows = Record<CpoPeriodKey, CpoCubeRow[]>;
type OverallRows = Record<CpoPeriodKey, CpoCubeRow>;

const EMPTY_ROW: CpoCubeRow = {
  periodKind: "week",
  periodYear: 0,
  periodNumber: 0,
  dimension: "overall",
  dimensionValue: "all",
  users: 0,
  sessions: 0,
  viewItemSessions: 0,
  addToCartSessions: 0,
  beginCheckoutSessions: 0,
  purchaseSessions: 0,
  orders: 0,
  revenue: 0,
  viewItemEvents: 0,
  addToCartEvents: 0,
  beginCheckoutEvents: 0,
  purchaseEvents: 0,
};

const STAGE_FIELD: Record<CpoFunnelStage, keyof CpoCubeRow> = {
  sessions: "sessions",
  view_item: "viewItemSessions",
  add_to_cart: "addToCartSessions",
  begin_checkout: "beginCheckoutSessions",
  purchase: "purchaseSessions",
};

const TRANSITIONS: Array<{ from: CpoFunnelStage; to: CpoFunnelStage; label: string; core: boolean }> = [
  { from: "sessions", to: "view_item", label: "Сеанс → сторінка товару", core: false },
  { from: "view_item", to: "add_to_cart", label: "Сторінка товару → кошик", core: true },
  { from: "add_to_cart", to: "begin_checkout", label: "Кошик → оформлення", core: true },
  { from: "begin_checkout", to: "purchase", label: "Оформлення → покупка", core: true },
  { from: "sessions", to: "add_to_cart", label: "Сеанс → кошик", core: false },
  { from: "sessions", to: "purchase", label: "Сеанс → покупка", core: false },
];

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function pct(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function delta(current: number, baseline: number | null): number | null {
  return baseline == null ? null : current - baseline;
}

function deltaPct(current: number, baseline: number | null): number | null {
  return baseline != null && baseline !== 0 ? ((current - baseline) / Math.abs(baseline)) * 100 : null;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
}

function metricStatus(change: number | null, volume: number, minimumVolume: number = CPO_THRESHOLDS.minSessions): MetricStatus {
  if (volume < minimumVolume) return "insufficient_data";
  if (change == null || Math.abs(change) < 5) return "neutral";
  if (change > 0) return "good";
  const magnitude = Math.abs(change);
  if (magnitude >= 20) return "critical";
  if (magnitude >= 10) return "high";
  return "warning";
}

function severity(score: number): SignalSeverity {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "warning";
  return "info";
}

function statusFromSeverity(value: SignalSeverity): MetricStatus {
  return value === "info" ? "warning" : value;
}

function confidenceScore(input: {
  volume: number;
  baselineConversions: number;
  contributionPct?: number;
  deltaPercent: number | null;
  yoyDeltaPercent?: number | null;
}): number {
  const volume = clamp((Math.log10(Math.max(1, input.volume)) / 5) * 40, 0, 40);
  const conversions = clamp((input.baselineConversions / 100) * 20, 0, 20);
  const contribution = clamp((input.contributionPct || 0) * 0.25, 0, 25);
  const corroboration = input.deltaPercent != null && input.yoyDeltaPercent != null
    && input.deltaPercent < 0 && input.yoyDeltaPercent < 0 ? 15 : 0;
  return round(volume + conversions + contribution + corroboration, 0);
}

function impactScore(input: {
  deltaPercent: number | null;
  volume: number;
  estimatedLostOrders: number;
  estimatedRevenueLoss: number;
  totalOrders: number;
  totalRevenue: number;
  confidence: number;
}): number {
  const magnitude = clamp(Math.abs(input.deltaPercent || 0) / 30 * 30, 0, 30);
  const volume = clamp(Math.log10(Math.max(1, input.volume)) / 5 * 20, 0, 20);
  const lostOrders = clamp(input.estimatedLostOrders / Math.max(1, input.totalOrders) * 100, 0, 30);
  const revenue = clamp(input.estimatedRevenueLoss / Math.max(1, input.totalRevenue) * 100, 0, 20);
  return round((magnitude + volume + lostOrders + revenue) * (0.5 + input.confidence / 200), 0);
}

function stageValue(row: CpoCubeRow, stage: CpoFunnelStage): number {
  return Number(row[STAGE_FIELD[stage]]) || 0;
}

function overall(periodRows: PeriodRows): OverallRows {
  return Object.fromEntries(Object.entries(periodRows).map(([key, rows]) => [
    key,
    rows.find((row) => row.dimension === "overall") || EMPTY_ROW,
  ])) as OverallRows;
}

function makeMetric(input: {
  key: string;
  label: string;
  format: MetricResult["format"];
  current: number;
  previous: number;
  yearAgo: number;
  volume: number;
  minimumVolume?: number;
}): MetricResult {
  const change = deltaPct(input.current, input.previous);
  return {
    key: input.key,
    label: input.label,
    format: input.format,
    current: round(input.current),
    previous: round(input.previous),
    previousYear: round(input.yearAgo),
    delta: round(delta(input.current, input.previous) || 0),
    deltaPercent: change == null ? null : round(change),
    yoyDelta: round(delta(input.current, input.yearAgo) || 0),
    yoyDeltaPercent: deltaPct(input.current, input.yearAgo) == null ? null : round(deltaPct(input.current, input.yearAgo) || 0),
    volume: input.volume,
    status: metricStatus(change, input.volume, input.minimumVolume),
  };
}

function executiveMetrics(rows: OverallRows): MetricResult[] {
  const cr = (row: CpoCubeRow) => pct(row.orders, row.sessions) || 0;
  const aov = (row: CpoCubeRow) => row.orders > 0 ? row.revenue / row.orders : 0;
  const rate = (row: CpoCubeRow, numerator: CpoFunnelStage, denominator: CpoFunnelStage) => pct(stageValue(row, numerator), stageValue(row, denominator)) || 0;
  return [
    makeMetric({ key: "revenue", label: "Дохід", format: "currency", current: rows.current.revenue, previous: rows.previous.revenue, yearAgo: rows.yearAgo.revenue, volume: rows.current.orders, minimumVolume: CPO_THRESHOLDS.minBaseConversions }),
    makeMetric({ key: "orders", label: "Замовлення", format: "number", current: rows.current.orders, previous: rows.previous.orders, yearAgo: rows.yearAgo.orders, volume: rows.current.orders, minimumVolume: CPO_THRESHOLDS.minBaseConversions }),
    makeMetric({ key: "sessions", label: "Сеанси", format: "number", current: rows.current.sessions, previous: rows.previous.sessions, yearAgo: rows.yearAgo.sessions, volume: rows.current.sessions }),
    makeMetric({ key: "conversion_rate", label: "Коефіцієнт конверсії", format: "percent", current: cr(rows.current), previous: cr(rows.previous), yearAgo: cr(rows.yearAgo), volume: rows.current.sessions }),
    makeMetric({ key: "aov", label: "Середній чек", format: "currency", current: aov(rows.current), previous: aov(rows.previous), yearAgo: aov(rows.yearAgo), volume: rows.current.orders, minimumVolume: CPO_THRESHOLDS.minBaseConversions }),
    makeMetric({ key: "add_to_cart_rate", label: "Сторінка товару → кошик", format: "percent", current: rate(rows.current, "add_to_cart", "view_item"), previous: rate(rows.previous, "add_to_cart", "view_item"), yearAgo: rate(rows.yearAgo, "add_to_cart", "view_item"), volume: rows.current.viewItemSessions }),
    makeMetric({ key: "checkout_rate", label: "Кошик → оформлення", format: "percent", current: rate(rows.current, "begin_checkout", "add_to_cart"), previous: rate(rows.previous, "begin_checkout", "add_to_cart"), yearAgo: rate(rows.yearAgo, "begin_checkout", "add_to_cart"), volume: rows.current.addToCartSessions }),
    makeMetric({ key: "purchase_rate", label: "Оформлення → покупка", format: "percent", current: rate(rows.current, "purchase", "begin_checkout"), previous: rate(rows.previous, "purchase", "begin_checkout"), yearAgo: rate(rows.yearAgo, "purchase", "begin_checkout"), volume: rows.current.beginCheckoutSessions }),
  ];
}

function revenueAt(values: Record<"traffic" | "conversion" | "aov", number>): number {
  return values.traffic * values.conversion * values.aov;
}

export function shapleyRevenueContributions(previous: CpoCubeRow, current: CpoCubeRow): Record<"traffic" | "conversion" | "aov", number> {
  const factors = ["traffic", "conversion", "aov"] as const;
  const before = {
    traffic: previous.sessions,
    conversion: previous.sessions > 0 ? previous.orders / previous.sessions : 0,
    aov: previous.orders > 0 ? previous.revenue / previous.orders : 0,
  };
  const after = {
    traffic: current.sessions,
    conversion: current.sessions > 0 ? current.orders / current.sessions : 0,
    aov: current.orders > 0 ? current.revenue / current.orders : 0,
  };
  const permutations = [
    ["traffic", "conversion", "aov"], ["traffic", "aov", "conversion"],
    ["conversion", "traffic", "aov"], ["conversion", "aov", "traffic"],
    ["aov", "traffic", "conversion"], ["aov", "conversion", "traffic"],
  ] as const;
  const result = { traffic: 0, conversion: 0, aov: 0 };
  for (const permutation of permutations) {
    const state = { ...before };
    for (const factor of permutation) {
      const prior = revenueAt(state);
      state[factor] = after[factor];
      result[factor] += revenueAt(state) - prior;
    }
  }
  for (const factor of factors) result[factor] = round(result[factor] / permutations.length);
  return result;
}

function businessDecomposition(rows: OverallRows): BusinessContribution[] {
  const contributions = shapleyRevenueContributions(rows.previous, rows.current);
  const revenueChange = rows.current.revenue - rows.previous.revenue;
  const values = {
    traffic: { label: "Трафік", current: rows.current.sessions, previous: rows.previous.sessions },
    conversion: { label: "Коефіцієнт конверсії", current: pct(rows.current.orders, rows.current.sessions) || 0, previous: pct(rows.previous.orders, rows.previous.sessions) || 0 },
    aov: { label: "Середній чек", current: rows.current.orders ? rows.current.revenue / rows.current.orders : 0, previous: rows.previous.orders ? rows.previous.revenue / rows.previous.orders : 0 },
  };
  const primary = (Object.keys(contributions) as Array<keyof typeof contributions>)
    .sort((left, right) => contributions[left] - contributions[right])[0];
  return (Object.keys(values) as Array<keyof typeof values>).map((key) => ({
    key,
    label: values[key].label,
    current: round(values[key].current),
    previous: round(values[key].previous),
    deltaPercent: deltaPct(values[key].current, values[key].previous) == null ? null : round(deltaPct(values[key].current, values[key].previous) || 0),
    revenueContribution: contributions[key],
    shareOfRevenueChangePct: revenueChange !== 0 ? round(contributions[key] / revenueChange * 100) : null,
    isPrimaryDriver: key === primary && contributions[key] < 0,
  }));
}

function funnelTransitions(rows: OverallRows): FunnelTransition[] {
  const currentAov = rows.current.orders > 0 ? rows.current.revenue / rows.current.orders : 0;
  return TRANSITIONS.map((definition) => {
    const currentVolume = stageValue(rows.current, definition.from);
    const previousVolume = stageValue(rows.previous, definition.from);
    const currentConversions = stageValue(rows.current, definition.to);
    const previousConversions = stageValue(rows.previous, definition.to);
    const yearAgoVolume = stageValue(rows.yearAgo, definition.from);
    const yearAgoConversions = stageValue(rows.yearAgo, definition.to);
    const currentRate = pct(currentConversions, currentVolume);
    const previousRate = pct(previousConversions, previousVolume);
    const yearAgoRate = pct(yearAgoConversions, yearAgoVolume);
    const change = currentRate == null || previousRate == null ? null : deltaPct(currentRate, previousRate);
    const expectedNext = previousRate == null ? currentConversions : currentVolume * previousRate / 100;
    const lostNext = Math.max(0, expectedNext - currentConversions);
    const downstreamOrderRate = definition.to === "purchase" ? 1 : currentConversions > 0 ? rows.current.purchaseSessions / currentConversions : 0;
    const lostOrders = lostNext * clamp(downstreamOrderRate, 0, 1);
    const revenueLoss = lostOrders * currentAov;
    const confidence = confidenceScore({
      volume: currentVolume,
      baselineConversions: previousConversions,
      deltaPercent: change,
      yoyDeltaPercent: currentRate == null || yearAgoRate == null ? null : deltaPct(currentRate, yearAgoRate),
    });
    const score = impactScore({
      deltaPercent: change,
      volume: currentVolume,
      estimatedLostOrders: lostOrders,
      estimatedRevenueLoss: revenueLoss,
      totalOrders: rows.current.orders,
      totalRevenue: rows.current.revenue,
      confidence,
    });
    return {
      key: `${definition.from}_to_${definition.to}`,
      label: definition.label,
      fromStage: definition.from,
      toStage: definition.to,
      currentVolume,
      previousVolume,
      currentConversions,
      previousConversions,
      currentRate: currentRate == null ? null : round(currentRate),
      previousRate: previousRate == null ? null : round(previousRate),
      yearAgoRate: yearAgoRate == null ? null : round(yearAgoRate),
      deltaPercent: change == null ? null : round(change),
      yoyDeltaPercent: currentRate == null || yearAgoRate == null ? null : round(deltaPct(currentRate, yearAgoRate) || 0),
      estimatedLostConversions: round(lostNext),
      estimatedLostOrders: round(lostOrders),
      estimatedRevenueLoss: round(revenueLoss),
      impactScore: score,
      confidenceScore: confidence,
      status: metricStatus(change, currentVolume, CPO_THRESHOLDS.minStageVolume),
    };
  });
}

function segmentContributions(periodRows: PeriodRows, transition: FunnelTransition | null, totals: OverallRows): Record<Exclude<CpoDimension, "overall">, SegmentContribution[]> {
  const dimensions: Array<Exclude<CpoDimension, "overall">> = ["device", "source_medium", "city", "landing_page"];
  const empty: Record<Exclude<CpoDimension, "overall">, SegmentContribution[]> = {
    device: [],
    source_medium: [],
    city: [],
    landing_page: [],
  };
  if (!transition) return empty;
  const currentAov = totals.current.orders > 0 ? totals.current.revenue / totals.current.orders : 0;
  for (const dimension of dimensions) {
    const previousMap = new Map(periodRows.previous.filter((row) => row.dimension === dimension).map((row) => [row.dimensionValue, row]));
    const raw = periodRows.current.filter((row) => row.dimension === dimension).map((current) => {
      const previous = previousMap.get(current.dimensionValue) || EMPTY_ROW;
      const volumeCurrent = stageValue(current, transition.fromStage);
      const volumePrevious = stageValue(previous, transition.fromStage);
      const conversionsCurrent = stageValue(current, transition.toStage);
      const conversionsPrevious = stageValue(previous, transition.toStage);
      const conversionCurrent = pct(conversionsCurrent, volumeCurrent) || 0;
      const conversionPrevious = pct(conversionsPrevious, volumePrevious) || 0;
      const change = deltaPct(conversionCurrent, conversionPrevious);
      const lostConversions = Math.max(0, volumeCurrent * conversionPrevious / 100 - conversionsCurrent);
      const downstreamRate = transition.toStage === "purchase" ? 1 : conversionsCurrent > 0 ? current.purchaseSessions / conversionsCurrent : 0;
      const lostOrders = lostConversions * clamp(downstreamRate, 0, 1);
      return { current, previous, volumeCurrent, volumePrevious, conversionsCurrent, conversionsPrevious, conversionCurrent, conversionPrevious, change, lostConversions, lostOrders };
    }).filter((item) => item.volumeCurrent >= CPO_THRESHOLDS.minStageVolume
      && item.volumePrevious >= CPO_THRESHOLDS.minStageVolume
      && item.conversionsPrevious >= CPO_THRESHOLDS.minBaseConversions
      && item.change != null && item.change < 0 && item.lostOrders > 0);
    const totalLoss = raw.reduce((sum, item) => sum + item.lostOrders, 0);
    empty[dimension] = raw.map((item): SegmentContribution => {
      const share = totalLoss > 0 ? item.lostOrders / totalLoss * 100 : 0;
      const revenueLoss = item.lostOrders * currentAov;
      const confidence = confidenceScore({
        volume: item.volumeCurrent,
        baselineConversions: item.conversionsPrevious,
        contributionPct: share,
        deltaPercent: item.change,
      });
      const score = impactScore({
        deltaPercent: item.change,
        volume: item.volumeCurrent,
        estimatedLostOrders: item.lostOrders,
        estimatedRevenueLoss: revenueLoss,
        totalOrders: totals.current.orders,
        totalRevenue: totals.current.revenue,
        confidence,
      });
      return {
        dimension,
        dimensionValue: item.current.dimensionValue,
        transitionKey: transition.key,
        volumeCurrent: item.volumeCurrent,
        volumePrevious: item.volumePrevious,
        conversionsCurrent: item.conversionsCurrent,
        conversionsPrevious: item.conversionsPrevious,
        conversionCurrent: round(item.conversionCurrent),
        conversionPrevious: round(item.conversionPrevious),
        deltaAbsolute: round(item.conversionCurrent - item.conversionPrevious),
        deltaPercent: item.change == null ? null : round(item.change),
        estimatedLostConversions: round(item.lostConversions),
        estimatedLostOrders: round(item.lostOrders),
        estimatedRevenueLoss: round(revenueLoss),
        shareOfTotalLossPct: round(share),
        impactScore: score,
        confidenceScore: confidence,
        status: statusFromSeverity(severity(score)),
      };
    }).sort((left, right) => right.impactScore - left.impactScore).slice(0, CPO_THRESHOLDS.maxSignalsPerLevel);
  }
  return empty;
}

const RECOMMENDATIONS: Record<SignalCategory, string[]> = {
  TRAFFIC: ["Перевірити джерело та канал трафіку", "Порівняти кампанії", "Перевірити цільові сторінки та зміни бюджетів"],
  MARKETING: ["Перевірити кампанії та витрати", "Порівняти якість трафіку", "Перевірити UTM-розмітку"],
  UX: ["Перевірити сторінку та основні заклики до дії", "Порівняти мобільні й настільні пристрої", "Переглянути зміни інтерфейсу за період"],
  CONTENT: ["Перевірити контент сторінки", "Перевірити картки товарів", "Порівняти повноту атрибутів"],
  COMMERCIAL: ["Перевірити ціни", "Перевірити залишки та наявність", "Перевірити акції та знижки"],
  TECH: ["Перевірити релізи та помилки інтерфейсу", "Порівняти браузери й операційні системи", "Перевірити швидкість і доступність оформлення"],
  PAYMENT: ["Перевірити події помилок оплати", "Порівняти способи оплати", "Перевірити зворотні виклики та журнали інтеграцій"],
  DELIVERY: ["Перевірити способи доставки", "Перевірити географічні обмеження", "Перевірити API доставки"],
  SEARCH: ["Перевірити використання пошуку", "Перевірити запити без результатів", "Порівняти переходи з пошуку на сторінку товару та до кошика"],
  UNKNOWN: ["Перевірити суміжні показники", "Переглянути сегменти з найбільшим внеском", "Зіставити з релізами та інцидентами"],
};

function segmentCategory(dimension: Exclude<CpoDimension, "overall">): SignalCategory {
  if (dimension === "source_medium") return "MARKETING";
  if (dimension === "landing_page") return "UX";
  // A device concentration is an investigation area, not proof of a technical
  // cause. TECH requires browser/OS/error corroboration planned for Phase 2/4.
  return "UNKNOWN";
}

function signalFromFunnel(transition: FunnelTransition): AnalyticsSignal {
  const score = transition.impactScore;
  return {
    id: `funnel:${transition.key}`,
    metric: transition.key,
    title: transition.label,
    currentValue: transition.currentRate || 0,
    previousValue: transition.previousRate || 0,
    deltaPercent: transition.deltaPercent || 0,
    impactScore: score,
    confidenceScore: transition.confidenceScore,
    estimatedLostOrders: transition.estimatedLostOrders,
    estimatedRevenueLoss: transition.estimatedRevenueLoss,
    severity: severity(score),
    category: "UNKNOWN",
    detectedSince: null,
    resolvedAt: null,
    explanation: `${transition.label}: конверсія змінилася з ${round(transition.previousRate || 0)}% до ${round(transition.currentRate || 0)}%. Орієнтовний вплив — ${round(transition.estimatedLostOrders, 0)} втрачених замовлень.`,
    recommendedChecks: RECOMMENDATIONS.UNKNOWN,
  };
}

function signalFromSegment(segment: SegmentContribution, transition: FunnelTransition): AnalyticsSignal {
  const category = segmentCategory(segment.dimension);
  return {
    id: `segment:${transition.key}:${segment.dimension}:${segment.dimensionValue}`,
    metric: transition.key,
    title: `${transition.label} · ${segment.dimensionValue}`,
    currentValue: segment.conversionCurrent,
    previousValue: segment.conversionPrevious,
    deltaPercent: segment.deltaPercent || 0,
    impactScore: segment.impactScore,
    confidenceScore: segment.confidenceScore,
    estimatedLostOrders: segment.estimatedLostOrders,
    estimatedRevenueLoss: segment.estimatedRevenueLoss,
    severity: severity(segment.impactScore),
    category,
    dimension: segment.dimension,
    dimensionValue: segment.dimensionValue,
    contributionPct: segment.shareOfTotalLossPct,
    detectedSince: null,
    resolvedAt: null,
    explanation: `${segment.dimensionValue} пояснює ${round(segment.shareOfTotalLossPct, 0)}% оціненої втрати у цьому сегменті. Конверсія знизилась на ${round(Math.abs(segment.deltaPercent || 0))}%.`,
    recommendedChecks: RECOMMENDATIONS[category],
  };
}

function businessSignal(metrics: MetricResult[], decomposition: BusinessContribution[], rows: OverallRows): AnalyticsSignal | null {
  const revenue = metrics.find((metric) => metric.key === "revenue");
  const orders = metrics.find((metric) => metric.key === "orders");
  const driver = decomposition.find((item) => item.isPrimaryDriver);
  if (!revenue || !orders || (!((revenue.deltaPercent || 0) < -5) && !((orders.deltaPercent || 0) < -5))) return null;
  const previousCr = rows.previous.sessions > 0 ? rows.previous.orders / rows.previous.sessions : 0;
  const expectedOrders = rows.current.sessions * previousCr;
  const lostOrders = Math.max(0, expectedOrders - rows.current.orders);
  const currentAov = rows.current.orders > 0 ? rows.current.revenue / rows.current.orders : 0;
  const revenueLoss = lostOrders * currentAov;
  const change = Math.min(revenue.deltaPercent || 0, orders.deltaPercent || 0);
  const confidence = confidenceScore({ volume: rows.current.sessions, baselineConversions: rows.previous.orders, deltaPercent: change, yoyDeltaPercent: revenue.yoyDeltaPercent });
  const score = impactScore({ deltaPercent: change, volume: rows.current.sessions, estimatedLostOrders: lostOrders, estimatedRevenueLoss: revenueLoss, totalOrders: rows.current.orders, totalRevenue: rows.current.revenue, confidence });
  const category: SignalCategory = driver?.key === "traffic" ? "TRAFFIC" : driver?.key === "aov" ? "COMMERCIAL" : "UNKNOWN";
  return {
    id: "business:revenue-orders",
    metric: "revenue_orders",
    title: "Дохід і замовлення потребують уваги",
    currentValue: revenue.current,
    previousValue: revenue.previous || 0,
    deltaPercent: revenue.deltaPercent || 0,
    impactScore: score,
    confidenceScore: confidence,
    estimatedLostOrders: round(lostOrders),
    estimatedRevenueLoss: round(revenueLoss),
    severity: severity(score),
    category,
    detectedSince: null,
    resolvedAt: null,
    explanation: `Дохід змінився на ${round(revenue.deltaPercent || 0)}%, замовлення — на ${round(orders.deltaPercent || 0)}%. Головний математичний чинник: ${driver?.label || "не визначено"} (внесок ${round(driver?.revenueContribution || 0, 0)} грн).`,
    recommendedChecks: RECOMMENDATIONS[category],
  };
}

function diagnosticTree(
  metrics: MetricResult[],
  decomposition: BusinessContribution[],
  primaryFunnel: FunnelTransition | null,
  segments: Record<Exclude<CpoDimension, "overall">, SegmentContribution[]>,
  signals: AnalyticsSignal[],
): DiagnosticNode[] {
  const revenue = metrics.find((metric) => metric.key === "revenue");
  const signalByMetric = new Map(signals.map((signal) => [signal.metric, signal.id]));
  const businessChildren = decomposition.map((item): DiagnosticNode => ({
    id: `business:${item.key}`,
    label: item.label,
    kind: "business",
    deltaPercent: item.deltaPercent,
    impact: item.revenueContribution,
    status: metricStatus(item.deltaPercent, 1, 0),
    children: item.key === "conversion" && item.isPrimaryDriver && primaryFunnel ? [{
      id: `funnel:${primaryFunnel.key}`,
      label: primaryFunnel.label,
      kind: "funnel",
      deltaPercent: primaryFunnel.deltaPercent,
      impact: -primaryFunnel.estimatedRevenueLoss,
      status: primaryFunnel.status,
      signalId: signalByMetric.get(primaryFunnel.key),
      children: (Object.values(segments).flat().sort((a, b) => b.impactScore - a.impactScore).slice(0, CPO_THRESHOLDS.maxSignalsPerLevel)).map((segment) => ({
        id: `segment:${segment.dimension}:${segment.dimensionValue}`,
        label: segment.dimensionValue,
        kind: "segment" as const,
        deltaPercent: segment.deltaPercent,
        impact: -segment.estimatedRevenueLoss,
        status: segment.status,
        signalId: `segment:${primaryFunnel.key}:${segment.dimension}:${segment.dimensionValue}`,
        children: [],
      })),
    }] : [],
  }));
  return [{
    id: "revenue",
    label: "Дохід",
    kind: "business",
    deltaPercent: revenue?.deltaPercent || 0,
    impact: revenue?.delta || 0,
    status: revenue?.status || "neutral",
    signalId: signals.find((signal) => signal.id === "business:revenue-orders")?.id,
    children: businessChildren,
  }];
}

function summaryText(metrics: MetricResult[], decomposition: BusinessContribution[], funnel: FunnelTransition | null, signals: AnalyticsSignal[]): string {
  const revenue = metrics.find((metric) => metric.key === "revenue");
  const orders = metrics.find((metric) => metric.key === "orders");
  const driver = decomposition.find((item) => item.isPrimaryDriver);
  const segment = signals.find((signal) => signal.dimension);
  if (!signals.length) return "Значущих негативних сигналів із достатнім обсягом даних не знайдено.";
  return [
    `Дохід: ${round(revenue?.deltaPercent || 0)}%, замовлення: ${round(orders?.deltaPercent || 0)}%.`,
    driver ? `Основний бізнес-чинник — ${driver.label}: внесок ${round(driver.revenueContribution, 0)} грн.` : "Однозначний бізнес-чинник не визначено.",
    funnel ? `Найбільший негативний вплив у воронці — ${funnel.label}: ${round(funnel.deltaPercent || 0)}%.` : "Значущої проблеми у воронці не знайдено.",
    segment ? `Найсильніший сегментний сигнал — ${segment.dimensionValue}; внесок ${round(segment.contributionPct || 0, 0)}%.` : "Сегмент із достатньою вибіркою не виділено.",
  ].join(" ");
}

export function buildCpoDiagnostic(input: {
  cube: CpoAnalyticsCube;
  cubeCompressedBytes: number;
  periodKind: CpoPeriodKind;
  selectedPeriod: number;
  selectedYear: number;
}): CpoDiagnosticResult {
  const ranges = cpoPeriodRanges(input.periodKind, input.selectedPeriod, input.selectedYear);
  if (ranges[0].to > input.cube.dataTo) throw new Error(`Знімок CPO містить завершені дані лише до ${input.cube.dataTo}`);
  const periodRows = Object.fromEntries(ranges.map((range) => [
    range.key,
    input.cube.rows.filter((row) => row.periodKind === input.periodKind && row.periodYear === range.year && row.periodNumber === range.number),
  ])) as PeriodRows;
  const totals = overall(periodRows);
  if (!totals.current.sessions) throw new Error("У знімку CPO немає даних за обраний період");
  const metrics = executiveMetrics(totals);
  const decomposition = businessDecomposition(totals);
  const funnel = funnelTransitions(totals);
  const primaryFunnel = funnel.filter((item) => TRANSITIONS.find((definition) => `${definition.from}_to_${definition.to}` === item.key)?.core)
    .filter((item) => item.status !== "insufficient_data" && (item.deltaPercent || 0) < 0)
    .sort((left, right) => right.impactScore - left.impactScore)[0] || null;
  const segments = segmentContributions(periodRows, primaryFunnel, totals);
  const candidates: AnalyticsSignal[] = [];
  const business = businessSignal(metrics, decomposition, totals);
  if (business) candidates.push(business);
  if (primaryFunnel && primaryFunnel.impactScore >= 15) candidates.push(signalFromFunnel(primaryFunnel));
  for (const rows of Object.values(segments)) {
    if (rows[0]?.impactScore >= 15 && primaryFunnel) candidates.push(signalFromSegment(rows[0], primaryFunnel));
  }
  const topSignals = candidates.sort((left, right) => right.impactScore - left.impactScore).slice(0, CPO_THRESHOLDS.maxGlobalSignals);
  const overallStatus: CpoDiagnosticResult["overallStatus"] = topSignals[0]?.severity || "healthy";
  const periodMap = Object.fromEntries(ranges.map((range) => [range.key, range])) as CpoDiagnosticResult["periods"];
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceCubeSavedAt: input.cube.savedAt,
    countryFilter: "Ukraine",
    periodKind: input.periodKind,
    selectedPeriod: input.selectedPeriod,
    selectedYear: input.selectedYear,
    periods: periodMap,
    overallStatus,
    executiveMetrics: metrics,
    businessDecomposition: decomposition,
    primaryProblem: topSignals[0] || null,
    topSignals,
    funnel,
    primaryFunnelStage: primaryFunnel?.key || null,
    segmentContributions: segments,
    diagnosticTree: diagnosticTree(metrics, decomposition, primaryFunnel, segments, topSignals),
    requiresAttention: topSignals.slice(0, 3),
    summary: summaryText(metrics, decomposition, primaryFunnel, topSignals),
    limitations: [
      "Орієнтовна кількість втрачених замовлень і дохід є аналітичною оцінкою, а не бухгалтерськими даними.",
      "Пілотна версія аналізує виміри окремо; багаторівневі перетини сегментів заплановані для другого етапу.",
      "Дати виявлення та усунення проблем будуть доступні після появи другого знімка даних CPO та щоденного часового ряду.",
    ],
    storage: { source: "saved", cubeCompressedBytes: input.cubeCompressedBytes, diagnosticSnapshotPath: null },
  };
}
