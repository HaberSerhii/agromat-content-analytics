"use client";
/* eslint-disable @next/next/no-img-element -- product images come from the Agromat CDN */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CONTENT_REVIEW_ACTIONS,
  CONTENT_REVIEW_MANAGERS,
  type ContentProductReview,
  type ContentReviewAction,
  type ContentReviewManager,
  type ContentReviewMetrics,
} from "@/lib/content-review-types";
import type { NewProductAnalysisRow } from "@/lib/new-product-types";
import { SearchAnalyticsPanel } from "@/components/SearchAnalyticsPanel";
import { SearchControlPanel } from "@/components/SearchControlPanel";
import { ProductChangeHistoryModal } from "@/components/ProductChangeHistoryModal";

type FacetRow = { key: string; name: string; count: number };
type ProductRow = {
  id: number;
  code: number;
  goodsRef: number;
  sku: string | null;
  name: string;
  brand: string;
  brandId: number | null;
  categoryId: number;
  categoryName: string;
  url: string;
  price: number | null;
  currency: string;
  stockQty: number | null;
  statusId: number;
  statusName: string;
  deleted: boolean;
  firstSeenAt: string;
  imagesCount: number;
  reviewsCount: number;
  attributesCount: number;
  missingRequiredAttrsCount: number;
  missingRequiredAttrs?: string[];
  requiredAttrsConfigured?: boolean;
  impressions?: number;
  pdpViews?: number;
  ctr?: number | null;
  atc?: number | null;
  contentScore?: number | null;
  photoScore?: number;
  attributeScore?: number | null;
  reviewScore?: number;
  categoryP75Impressions?: number;
  categoryMedianCtr?: number;
  categoryMedianAtc?: number;
  categoryMedianContent?: number | null;
};

type ProductOpenTarget = {
  productId?: number;
  code: number;
  goodsRef: number;
  name: string;
};

type ProductFull = ProductRow & {
  categoryPath: string;
  priceBase: number | null;
  discountPct: number | null;
  ratingAvg: number | null;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string | null;
  images: Array<{ url: string; main: boolean; sort: number }>;
  attributes: Array<{ id: number; name: string; values: string[] }>;
  reviews: Array<{
    rating: number;
    text: string;
    author: string;
    advantage: string | null;
    disadvantage: string | null;
    date: string;
    likes: number;
    dislikes: number;
  }>;
};

type CategoryAnalysisRow = {
  categoryId: number;
  categoryName: string;
  total: number;
  totalDelta: number;
  withPhotosPct: number;
  withPhotosDelta: number;
  missingAttrsPct: number | null;
  available: number;
  availableDelta: number;
  inactive: number;
  inactiveDelta: number;
};

type SegmentMetric = {
  tile: number;
  sanitary: number;
  deltaTile: number;
  deltaSanitary: number;
};
type DashboardResponse = {
  currentDate: string;
  monthFrom: string;
  comparisonDate: string | null;
  syncedAt: string | null;
  syncState: {
    state: "idle" | "running" | "ok" | "error";
    startedAt?: string | null;
    finishedAt?: string | null;
    error?: string | null;
    progress?: { pages: number; totalPages: number; products: number };
    stats?: {
      total: number;
      newCount: number;
      statusChanges: number;
      pages: number;
      durationMs: number;
    };
  };
  metrics: {
    newProducts: SegmentMetric;
    inactiveProducts: SegmentMetric;
    promoProducts: SegmentMetric;
    ctr: {
      tile: number | null;
      sanitary: number | null;
      deltaTile: number;
      deltaSanitary: number;
      benchmark: number | null;
      available: boolean;
      improvedTile: number;
      improvedSanitary: number;
      declinedTile: number;
      declinedSanitary: number;
      error: string;
    };
  };
  facets: {
    categories: FacetRow[];
    brands: FacetRow[];
    statuses: FacetRow[];
    colors: string[];
  };
  rows: ProductRow[];
  categoryAnalysis: CategoryAnalysisRow[];
  categoryCtrAvailable: boolean;
  categoryCtrError: string;
  categoryCtrSummary: {
    currentThree: Array<{
      month: string;
      pdpCtr: number | null;
      atcCtr: number | null;
    }>;
    lastYear: Array<{
      month: string;
      pdpCtr: number | null;
      atcCtr: number | null;
    }>;
  };
  categoryTrendForecast: {
    available: boolean;
    forecastMonth: string;
    candidates: Array<{
      categoryId: number;
      categoryName: string;
      score: number;
      potential: "high" | "medium" | "watch";
      seasonalityPct: number;
      recentTrafficPct: number;
      recentAtcPct: number | null;
      historyYears: number;
      latestImpressions: number;
    }>;
  };
  productAnalysis: {
    available: boolean;
    error: string;
    contentAvailable: boolean;
    currentThree: Array<{
      month: string;
      ctr: number | null;
      atc: number | null;
    }>;
    lastYear: Array<{
      month: string;
      ctr: number | null;
      atc: number | null;
    }>;
    signalCounts: {
      highImpressions: number;
      lowCtr: number;
      lowAtc: number;
      poorContent: number;
    };
  };
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type ChartMode = "categories" | "brands" | "statuses";
type DashboardView =
  | "overview"
  | "new"
  | "categories"
  | "products"
  | "search"
  | "results";
type ResultMode = "new-products" | "merchandising" | "search";
type ProductSignal = "highImpressions" | "lowCtr" | "lowAtc" | "poorContent";
type ProcessingStatus = "all" | "processed" | "unprocessed";
type MetricKey = "newProducts" | "inactiveProducts" | "promoProducts" | "ctr";
type ContentManager = ContentReviewManager;
type ContentAction = ContentReviewAction;
type ReviewMetrics = ContentReviewMetrics;
type ProductIntervention = ContentProductReview;
type ReviewOutcome = "growth" | "flat" | "decline" | "waiting";

const PAGE_SIZE = 25;
const DEFAULT_STATUS_ID = "5";
const PROCESSING_FILTER_OPTIONS: FacetRow[] = [
  { key: "unprocessed", name: "Не оброблені менеджером", count: 0 },
  { key: "processed", name: "Оброблені менеджером", count: 0 },
  { key: "all", name: "Усі товари", count: 0 },
];
const VIEW_ITEMS: Array<{ id: DashboardView; label: string; hint: string }> = [
  { id: "overview", label: "Огляд", hint: "Головна сторінка" },
  { id: "new", label: "Нові товари", hint: "Уперше з’явилися на сайті" },
  {
    id: "categories",
    label: "Аналіз категорій",
    hint: "Контент та вебаналітика",
  },
  {
    id: "products",
    label: "Аналіз товарів",
    hint: "CTR, ATC та Content Score",
  },
  {
    id: "search",
    label: "Аналіз пошукової системи",
    hint: "BigQuery, Multisearch та Google Sheets",
  },
  {
    id: "results",
    label: "Контроль результату",
    hint: "Ефект після змін",
  },
];
const CONTENT_MANAGERS = [...CONTENT_REVIEW_MANAGERS];
const CONTENT_ACTIONS = [...CONTENT_REVIEW_ACTIONS];
const PRODUCT_SIGNAL_META: Array<{
  id: ProductSignal;
  label: string;
  rule: string;
  tone: string;
}> = [
  {
    id: "highImpressions",
    label: "High Impressions ↓",
    rule: "Impressions 30д ≥ 500 та ≥ P75 категорії",
    tone: "#118dff",
  },
  {
    id: "lowCtr",
    label: "Низький CTR ↑",
    rule: "Impressions ≥ 500 та CTR < 70% медіани категорії",
    tone: "#e05c68",
  },
  {
    id: "lowAtc",
    label: "Низький ATC ↑",
    rule: "PDP views ≥ 50 та ATC < 70% медіани категорії",
    tone: "#f39c4a",
  },
  {
    id: "poorContent",
    label: "Поганий Content Score ↑",
    rule: "Score < 70 та < 80% медіани категорії",
    tone: "#6d5bd0",
  },
];

function paginationItems(current: number, total: number) {
  const pages = new Set<number>([1, 2, total - 1, total]);
  for (let page = current - 1; page <= current + 1; page++) pages.add(page);
  const sorted = [...pages]
    .filter((page) => page >= 1 && page <= total)
    .sort((left, right) => left - right);
  const result: Array<number | "ellipsis"> = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}
const METRIC_META: Array<{
  key: MetricKey;
  label: string;
  symbol: string;
  tone: string;
  note: string;
}> = [
  {
    key: "newProducts",
    label: "Нові товари",
    symbol: "+",
    tone: "#118dff",
    note: "Уперше з’явилися цього місяця та є в наявності",
  },
  {
    key: "inactiveProducts",
    label: "Неактивні товари",
    symbol: "!",
    tone: "#d14343",
    note: "Перейшли в неактивний статус цього місяця",
  },
  {
    key: "promoProducts",
    label: "Акційні товари",
    symbol: "%",
    tone: "#e28a22",
    note: "Активні пропозиції на сьогодні",
  },
  {
    key: "ctr",
    label: "CTR Каталог → PDP",
    symbol: "↗",
    tone: "#0f9d72",
    note: "Оцінка: покращення +1, погіршення −1",
  },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("uk-UA").format(value || 0);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatPrice(value: number | null, currency = "UAH"): string {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(value)} ${currency}`;
}

function formatCtr(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(2)}%`;
}

function formatMonth(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}-01T12:00:00Z`);
  return new Intl.DateTimeFormat("uk-UA", { month: "short", year: "2-digit" })
    .format(date)
    .replace(" р.", "");
}

function formatGrowth(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatYears(value: number): string {
  const lastTwo = value % 100;
  const last = value % 10;
  const suffix =
    lastTwo >= 11 && lastTwo <= 14
      ? "років"
      : last === 1
        ? "рік"
        : last >= 2 && last <= 4
          ? "роки"
          : "років";
  return `${value} ${suffix}`;
}

function reviewOutcome(item: ProductIntervention): ReviewOutcome {
  if (!item.after) return "waiting";
  const signals: number[] = [];
  const impressionDelta = item.before.impressions
    ? (item.after.impressions - item.before.impressions) /
      item.before.impressions
    : 0;
  signals.push(impressionDelta > 0.05 ? 1 : impressionDelta < -0.05 ? -1 : 0);
  for (const key of ["ctr", "atc"] as const) {
    const before = item.before[key];
    const after = item.after[key];
    signals.push(
      before == null || after == null
        ? 0
        : after - before > 0.1
          ? 1
          : after - before < -0.1
            ? -1
            : 0,
    );
  }
  const contentDelta =
    item.before.contentScore == null || item.after.contentScore == null
      ? 0
      : item.after.contentScore - item.before.contentScore;
  signals.push(contentDelta > 1 ? 1 : contentDelta < -1 ? -1 : 0);
  const positive = signals.filter((signal) => signal > 0).length;
  const negative = signals.filter((signal) => signal < 0).length;
  if (positive >= 2 && positive > negative) return "growth";
  if (negative >= 2 && negative > positive) return "decline";
  return "flat";
}

function metricDelta(
  after: number | null,
  before: number | null,
): number | null {
  return after == null || before == null ? null : after - before;
}

const REVIEW_OUTCOME_META = {
  growth: { label: "Є зростання", color: "#087a55", background: "#e8f6ef" },
  flat: { label: "Без змін", color: "#64717d", background: "#eef1f4" },
  decline: { label: "Погіршення", color: "#bd3b3b", background: "#fff0f0" },
  waiting: { label: "Очікує заміру", color: "#93610b", background: "#fff7df" },
} as const;

const TREND_POTENTIAL_META = {
  high: {
    label: "Високий потенціал",
    color: "#b45309",
    background: "#fff4df",
  },
  medium: {
    label: "Потенціал зростання",
    color: "#087a55",
    background: "#e8f6ef",
  },
  watch: {
    label: "Під наглядом",
    color: "#64717d",
    background: "#eef1f4",
  },
} as const;

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("copy_failed");
}

function formatMonthRange(
  from: string | undefined,
  to: string | undefined,
): string {
  if (!from || !to) return "Поточний місяць";
  return `${formatDate(from)} — ${formatDate(to)}`;
}

function statusTone(row: ProductRow): { color: string; background: string } {
  if (row.deleted) return { color: "#737b84", background: "#eef0f2" };
  if (row.statusId === 5) return { color: "#087a55", background: "#e8f6ef" };
  if (row.statusId === 3) return { color: "#0b6fc2", background: "#eaf5ff" };
  if (row.statusId === 1 || row.statusId === 4)
    return { color: "#bd3b3b", background: "#fff0f0" };
  return { color: "#93610b", background: "#fff7df" };
}

function Delta({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (value === 0) return null;
  const positive = value > 0;
  const negative = value < 0;
  return (
    <span
      className="inline-flex min-w-7 items-center justify-center rounded-full px-1.5 py-1 text-[9px] font-black tabular-nums"
      style={{
        color: positive ? "#087a55" : negative ? "#bd3b3b" : "#7e8790",
        background: positive ? "#e6f5ee" : negative ? "#fdecec" : "#f0f2f4",
      }}
    >
      {positive ? "+" : ""}
      {formatNumber(value)}
      {suffix}
    </span>
  );
}

function MetricCard({
  meta,
  data,
}: {
  meta: (typeof METRIC_META)[number];
  data: DashboardResponse | null;
}) {
  const isCtr = meta.key === "ctr";
  const metric = isCtr ? data?.metrics.ctr : data?.metrics[meta.key];
  const tileValue = isCtr
    ? data?.metrics.ctr.tile == null
      ? "—"
      : `${data.metrics.ctr.tile.toFixed(2)}%`
    : formatNumber((metric as SegmentMetric | undefined)?.tile || 0);
  const sanitaryValue = isCtr
    ? data?.metrics.ctr.sanitary == null
      ? "—"
      : `${data.metrics.ctr.sanitary.toFixed(2)}%`
    : formatNumber((metric as SegmentMetric | undefined)?.sanitary || 0);
  const tileDelta = isCtr
    ? data?.metrics.ctr.deltaTile || 0
    : (metric as SegmentMetric | undefined)?.deltaTile || 0;
  const sanitaryDelta = isCtr
    ? data?.metrics.ctr.deltaSanitary || 0
    : (metric as SegmentMetric | undefined)?.deltaSanitary || 0;

  return (
    <article className="relative rounded-2xl border border-[#dfe4ea] bg-white p-4 shadow-[0_1px_2px_rgba(31,41,55,.05)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-black text-[#626d78]">
            {meta.label}
          </h3>
          <p
            className="mt-1 line-clamp-1 text-[8px] leading-3 text-[#9aa2aa]"
            title={meta.note}
          >
            {meta.note}
          </p>
        </div>
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-black"
          style={{ color: meta.tone, background: `${meta.tone}12` }}
        >
          {meta.symbol}
        </span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-[#e6e9ec]">
        <div className="pr-3">
          <div className="text-[9px] font-black uppercase tracking-[.14em] text-[#9aa4ae]">
            Плитка
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <strong className="text-[22px] font-black leading-none tracking-tight text-[#252f3a]">
              {tileValue}
            </strong>
            <Delta value={tileDelta} />
          </div>
        </div>
        <div className="pl-3">
          <div className="text-[9px] font-black uppercase tracking-[.14em] text-[#9aa4ae]">
            Сантехніка
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <strong className="text-[22px] font-black leading-none tracking-tight text-[#252f3a]">
              {sanitaryValue}
            </strong>
            <Delta value={sanitaryDelta} />
          </div>
        </div>
      </div>
      {isCtr && (
        <div className="mt-3 border-t border-[#eef0f2] pt-2 text-[8px] text-[#8c959e]">
          Глобальний бенчмарк сайту:{" "}
          <b className="text-[#596571]">
            {data?.metrics.ctr.benchmark == null
              ? "—"
              : `${data.metrics.ctr.benchmark.toFixed(2)}%`}
          </b>
        </div>
      )}
    </article>
  );
}

function ProductCtrPanel({
  eyebrow,
  title,
  subtitle,
  points,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  points: Array<{ month: string; ctr: number | null; atc: number | null }>;
}) {
  return (
    <article className="rounded-2xl border border-[#dfe6ec] bg-white p-4 shadow-[0_4px_16px_rgba(31,42,55,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[.14em] text-[#118dff]">
            {eyebrow}
          </div>
          <h2 className="mt-1 text-sm font-black text-[#27313c]">{title}</h2>
          <p className="mt-1 text-[10px] text-[#7d8892]">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto pb-1">
        <div
          className="grid gap-1.5"
          style={{
            minWidth: points.length === 4 ? 520 : 390,
            gridTemplateColumns: `repeat(${Math.max(points.length, 1)}, minmax(0, 1fr))`,
          }}
        >
          {points.map((point) => (
            <div
              key={point.month}
              className="min-w-0 rounded-xl border border-[#e5ebf0] bg-[#fbfcfd] p-2.5"
            >
              <div className="text-[9px] font-black uppercase tracking-[.1em] text-[#8b96a0]">
                {formatMonth(point.month)}
              </div>
              <div className="mt-2 flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-[9px] font-bold text-[#697580]">CTR</span>
                <b className="text-sm font-black text-[#118dff]">
                  {formatCtr(point.ctr)}
                </b>
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5 whitespace-nowrap border-t border-[#edf0f3] pt-1.5">
                <span className="text-[9px] font-bold text-[#697580]">ATC</span>
                <b className="text-sm font-black text-[#6556d8]">
                  {formatCtr(point.atc)}
                </b>
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function DonutChart({
  items,
  colors,
  total,
  activeKey,
  onSelect,
}: {
  items: FacetRow[];
  colors: string[];
  total: number;
  activeKey: string | null;
  onSelect: (item: FacetRow) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const highlighted =
    items.find((item) => item.key === hovered) ||
    items.find((item) => item.key === activeKey) ||
    null;
  return (
    <div
      className="relative mx-auto h-44 w-44"
      onMouseLeave={() => setHovered(null)}
    >
      <svg
        viewBox="0 0 42 42"
        className="h-full w-full -rotate-90"
        role="img"
        aria-label="Розподіл товарів"
      >
        <circle
          cx="21"
          cy="21"
          r="15.9155"
          fill="transparent"
          stroke="#edf0f3"
          strokeWidth="7"
        />
        {(() => {
          let offset = 0;
          return items.map((item, index) => {
            const percentage = total ? (item.count / total) * 100 : 0;
            const currentOffset = offset;
            offset += percentage;
            const active = item.key === hovered || item.key === activeKey;
            return (
              <circle
                key={item.key}
                cx="21"
                cy="21"
                r="15.9155"
                fill="transparent"
                stroke={colors[index % colors.length]}
                strokeWidth={active ? "8.5" : "7"}
                strokeDasharray={`${percentage} ${100 - percentage}`}
                strokeDashoffset={-currentOffset}
                pathLength="100"
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHovered(item.key)}
                onClick={() => onSelect(item)}
              >
                <title>
                  {item.name}: {item.count}
                </title>
              </circle>
            );
          });
        })()}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <b className="max-w-24 text-[11px] leading-4 text-[#26313d]">
          {highlighted?.name || formatNumber(total)}
        </b>
        <span className="mt-0.5 text-[9px] text-[#87919b]">
          {highlighted
            ? `${formatNumber(highlighted.count)} товарів`
            : "усі товари"}
        </span>
      </div>
    </div>
  );
}

function StyledSelect({
  value,
  options,
  placeholder,
  searchPlaceholder,
  onChange,
}: {
  value: string;
  options: FacetRow[];
  placeholder: string;
  searchPlaceholder: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.key === value);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("uk");
    return normalized
      ? options.filter((option) =>
          option.name.toLocaleLowerCase("uk").includes(normalized),
        )
      : options;
  }, [options, query]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2.5 text-left text-[11px] font-semibold shadow-[0_1px_1px_rgba(31,41,55,.03)] transition"
        style={{
          borderColor: open ? "#79baf2" : "#d8dde3",
          boxShadow: open ? "0 0 0 3px rgba(17,141,255,.08)" : undefined,
        }}
        aria-expanded={open}
      >
        <span
          className={
            selected ? "truncate text-[#34404c]" : "truncate text-[#7c8792]"
          }
        >
          {selected?.name || placeholder}
        </span>
        <span
          className={`shrink-0 text-[10px] text-[#7d8791] transition ${open ? "rotate-180" : ""}`}
        >
          ⌄
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-full min-w-[250px] overflow-hidden rounded-xl border border-[#d8dde3] bg-white shadow-[0_14px_36px_rgba(31,41,55,.16)]">
          <div className="border-b border-[#edf0f2] p-2">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-lg border border-[#d8dde3] bg-[#f8fafb] px-3 py-2 text-[10px] outline-none focus:border-[#118dff]"
            />
          </div>
          <div className="max-h-64 overflow-auto p-1.5">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
                setQuery("");
              }}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[10px] font-bold ${!value ? "bg-[#edf6ff] text-[#0b6fc2]" : "text-[#596571] hover:bg-[#f4f7f9]"}`}
            >
              <span>{placeholder}</span>
              {!value && <span>✓</span>}
            </button>
            {visible.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  onChange(option.key);
                  setOpen(false);
                  setQuery("");
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[10px] ${value === option.key ? "bg-[#edf6ff] font-bold text-[#0b6fc2]" : "text-[#596571] hover:bg-[#f4f7f9]"}`}
              >
                <span className="truncate">{option.name}</span>
                <span className="shrink-0 rounded-full bg-[#eef1f4] px-1.5 py-0.5 text-[8px] font-bold text-[#77828d]">
                  {formatNumber(option.count)}
                </span>
              </button>
            ))}
            {visible.length === 0 && (
              <div className="px-3 py-5 text-center text-[10px] text-[#8b949e]">
                Нічого не знайдено
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#e2e6ea] bg-[#f7f9fb] px-3 py-2.5">
      <div className="text-[8px] font-black uppercase tracking-[.12em] text-[#8d969f]">
        {label}
      </div>
      <div className="mt-1 text-[11px] font-semibold text-[#34404c]">
        {children}
      </div>
    </div>
  );
}

function ProductDetailsModal({
  product,
  onClose,
}: {
  product: ProductRow;
  onClose: () => void;
}) {
  const [data, setData] = useState<ProductFull | null>(null);
  const [required, setRequired] = useState<Record<string, number[]>>({});
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !showHistory) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, showHistory]);

  useEffect(() => {
    fetch(`/api/products/${product.id}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((value: ProductFull) => setData(value))
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Не вдалося завантажити товар",
        ),
      );
    fetch("/api/products/required-attrs")
      .then((response) => response.json())
      .then(setRequired)
      .catch(() => {});
  }, [product.id]);

  const current = data || product;
  const requiredIds = required[String(current.categoryId)] || [];
  const presentIds = new Set(
    data?.attributes.map((attribute) => attribute.id) || [],
  );
  const missingRequired = data
    ? requiredIds.filter((id) => !presentIds.has(id))
    : [];
  const tone = statusTone(current);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#111827a6] p-3 sm:p-5"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[92dvh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-[#dfe4ea] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#e4e8ec] bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-[.18em] text-[#118dff]">
              Картка товару
            </div>
            <h2 className="mt-1 text-base font-black leading-5 text-[#26313d] sm:text-lg">
              {current.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[#7d8791]">
              <span>{data?.categoryPath || current.categoryName}</span>
              <span>·</span>
              <span className="rounded-full px-2 py-0.5 font-bold" style={tone}>
                {current.deleted
                  ? `Архів · ${current.statusName}`
                  : current.statusName}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              className="rounded-lg border border-[#cfc9f2] bg-[#f3f1ff] px-3 py-2 text-[10px] font-black text-[#6556d8]"
            >
              Історія змін
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#f0f3f5] px-3 py-2 text-[10px] font-bold text-[#58636d]"
            >
              × Закрити
            </button>
          </div>
        </header>
        <div className="space-y-5 p-5">
          {error && (
            <div className="rounded-xl border border-[#efb5b5] bg-[#fff1f1] p-3 text-xs text-[#bd3b3b]">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <DetailCell label="ID">{current.id}</DetailCell>
            <DetailCell label="goods_ref">{current.goodsRef}</DetailCell>
            <DetailCell label="Код товару">{current.code}</DetailCell>
            <DetailCell label="Артикул (SKU)">{current.sku || "—"}</DetailCell>
            <DetailCell label="Бренд">{current.brand || "—"}</DetailCell>
            <DetailCell label="Ціна">
              {formatPrice(current.price, current.currency)}{" "}
              {data?.discountPct ? (
                <span className="text-[#d97706]">−{data.discountPct}%</span>
              ) : null}
            </DetailCell>
            <DetailCell label="Залишок">{current.stockQty ?? "—"}</DetailCell>
            <DetailCell label="Перший раз бачили">
              {formatDate(current.firstSeenAt)}
            </DetailCell>
            <DetailCell label="Створено">
              {formatDate(data?.createdAt)}
            </DetailCell>
            <DetailCell label="Оновлено в API">
              {formatDate(data?.updatedAt)}
            </DetailCell>
            <DetailCell label="Статус змінено">
              {formatDateTime(data?.statusChangedAt)}
            </DetailCell>
            <DetailCell label="Посилання">
              <a
                href={current.url}
                target="_blank"
                rel="noreferrer"
                className="text-[#118dff] no-underline hover:underline"
              >
                Відкрити на сайті ↗
              </a>
            </DetailCell>
          </div>

          <section>
            <h3 className="mb-2 text-xs font-black text-[#34404c]">
              Фото ({data ? data.images.length : "…"})
            </h3>
            {data && data.images.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {[...data.images]
                  .sort((left, right) => left.sort - right.sort)
                  .map((image, index) => (
                    <a
                      key={`${image.url}:${index}`}
                      href={image.url}
                      target="_blank"
                      rel="noreferrer"
                      className="h-28 w-36 shrink-0 overflow-hidden rounded-xl border bg-[#f7f9fb]"
                      style={{
                        borderColor: image.main ? "#23a875" : "#dfe4ea",
                      }}
                    >
                      <img
                        src={image.url}
                        alt={`Фото ${index + 1}`}
                        className="h-full w-full object-contain"
                      />
                    </a>
                  ))}
              </div>
            ) : (
              <div className="rounded-xl bg-[#f7f9fb] p-5 text-center text-[10px] text-[#8b949e]">
                {data ? "Фото відсутні" : "Завантаження фото…"}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-black text-[#34404c]">
              Атрибути ({data ? data.attributes.length : "…"})
            </h3>
            {data && data.attributes.length > 0 ? (
              <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                {data.attributes.map((attribute) => {
                  const isRequired = requiredIds.includes(attribute.id);
                  return (
                    <div
                      key={attribute.id}
                      className="flex gap-2 rounded-xl border px-3 py-2 text-[10px]"
                      style={{
                        background: isRequired ? "#f3faf6" : "#f7f9fb",
                        borderColor: isRequired ? "#a7d8bd" : "#e2e6ea",
                      }}
                    >
                      {isRequired && <span className="text-[#087a55]">★</span>}
                      <span>
                        <span className="text-[#7b858f]">
                          {attribute.name}:
                        </span>{" "}
                        <b className="text-[#34404c]">
                          {attribute.values.join(", ") || "—"}
                        </b>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl bg-[#f7f9fb] p-5 text-center text-[10px] text-[#8b949e]">
                {data ? "Атрибути відсутні" : "Завантаження атрибутів…"}
              </div>
            )}
            {missingRequired.length > 0 && (
              <div className="mt-2 rounded-xl border border-[#efb5b5] bg-[#fff1f1] px-3 py-2 text-[10px] font-semibold text-[#bd3b3b]">
                Не вистачає обов’язкових атрибутів: {missingRequired.length}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-black text-[#34404c]">
              Відгуки ({data ? data.reviews.length : "…"})
            </h3>
            {data && data.reviews.length > 0 ? (
              <div className="space-y-2">
                {data.reviews.map((review, index) => (
                  <article
                    key={index}
                    className="rounded-xl border border-[#e2e6ea] bg-[#f7f9fb] p-3 text-[10px]"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <b className="text-[#34404c]">
                        {review.author || "Користувач"}
                      </b>
                      <span className="text-[#e4a11b]">
                        {"★".repeat(review.rating)}
                        {"☆".repeat(Math.max(0, 5 - review.rating))}
                      </span>
                      <span className="text-[#8b949e]">
                        {formatDate(review.date)}
                      </span>
                    </div>
                    {review.text && (
                      <p className="mt-2 leading-4 text-[#596571]">
                        {review.text}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-[#f7f9fb] p-5 text-center text-[10px] text-[#8b949e]">
                {data ? "Відгуків немає" : "Завантаження відгуків…"}
              </div>
            )}
          </section>
        </div>
      </div>
      {showHistory && (
        <ProductChangeHistoryModal
          id={current.id}
          productName={current.name}
          currency={current.currency}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

function MissingAttributesModal({
  product,
  onClose,
}: {
  product: ProductRow;
  onClose: () => void;
}) {
  const attributes = product.missingRequiredAttrs || [];
  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-[#11182799] p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.16em] text-[#e05c68]">
              Незаповнені атрибути
            </div>
            <h3 className="mt-1 text-sm font-black text-[#26313d]">
              {product.name}
            </h3>
            <p className="mt-1 text-[10px] text-[#8a949e]">
              IDD {product.code} · {formatNumber(attributes.length)} полів
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-[#f0f3f5] px-2.5 py-1.5 text-sm text-[#58636d]"
          >
            ×
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {attributes.map((attribute, index) => (
            <div
              key={`${attribute}:${index}`}
              className="flex items-center gap-2 rounded-xl border border-[#f0d4d7] bg-[#fff7f7] px-3 py-2.5 text-[11px] font-bold text-[#8d3c45]"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#fde7e9] text-[9px]">
                {index + 1}
              </span>
              {attribute}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BulkSearchModal({
  initialIds,
  onApply,
  onClose,
}: {
  initialIds: number[];
  onApply: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialIds.join("\n"));
  const ids = useMemo(
    () => [
      ...new Set(
        value
          .split(/[\s,;|]+/)
          .map(Number)
          .filter(Number.isFinite),
      ),
    ],
    [value],
  );
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#11182799] p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.18em] text-[#118dff]">
              Груповий фільтр
            </div>
            <h3 className="mt-1 text-base font-black text-[#26313d]">
              Пошук набором товарів
            </h3>
            <p className="mt-1 text-[10px] text-[#7c8792]">
              Вставте code, goods_ref або внутрішній ID через кому, пробіл чи з
              нового рядка.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-[#f0f3f5] px-2.5 py-1.5 text-sm text-[#58636d]"
          >
            ×
          </button>
        </div>
        <textarea
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={10}
          placeholder={"473998\n59002\n10452180"}
          className="w-full resize-y rounded-xl border border-[#d8dde3] p-3 text-xs outline-none focus:border-[#118dff]"
        />
        <div className="mt-2 text-[9px] text-[#8b949e]">
          Розпізнано: <b>{formatNumber(ids.length)}</b>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => {
              setValue("");
              onApply([]);
            }}
            className="rounded-lg border border-[#d8dde3] bg-white px-4 py-2 text-xs font-bold"
          >
            Очистити
          </button>
          <button
            onClick={() => onApply(ids)}
            className="rounded-lg border-0 bg-[#118dff] px-4 py-2 text-xs font-bold text-white"
          >
            Застосувати набір
          </button>
        </div>
      </div>
    </div>
  );
}

function ProcessProductModal({
  product,
  existing,
  saving,
  error,
  onSave,
  onClose,
}: {
  product: ProductRow;
  existing?: ProductIntervention;
  saving: boolean;
  error: string;
  onSave: (
    manager: ContentManager,
    actions: ContentAction[],
  ) => void | Promise<void>;
  onClose: () => void;
}) {
  const [manager, setManager] = useState<ContentManager | "">(
    existing?.manager || "",
  );
  const [actions, setActions] = useState<ContentAction[]>(
    existing?.actions || [],
  );
  const canSave = Boolean(manager && actions.length);
  const toggleAction = (action: ContentAction) => {
    setActions((current) =>
      current.includes(action)
        ? current.filter((item) => item !== action)
        : [...current, action],
    );
  };
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-[#111827a6] p-4"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#dfe4ea] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#e4e8ec] px-5 py-4">
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-[.18em] text-[#087a55]">
              Взяти в обробку
            </div>
            <h2 className="mt-1 truncate text-base font-black text-[#26313d]">
              {product.name}
            </h2>
            <p className="mt-1 text-[9px] text-[#87919b]">
              IDD {product.code} · goods_ref {product.goodsRef}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#f0f3f5] px-3 py-2 text-[10px] font-bold text-[#58636d]"
          >
            × Закрити
          </button>
        </header>
        <div className="space-y-5 p-5">
          <section>
            <h3 className="text-xs font-black text-[#34404c]">
              1. Хто бере товар в обробку?
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {CONTENT_MANAGERS.map((item) => {
                const selected = manager === item;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setManager(item)}
                    className="rounded-xl border px-4 py-3 text-left text-xs font-black transition"
                    style={{
                      color: selected ? "#087a55" : "#596571",
                      borderColor: selected ? "#68bd94" : "#dfe4e8",
                      background: selected ? "#eaf7f1" : "#fff",
                    }}
                  >
                    <span className="mr-2">{selected ? "●" : "○"}</span>
                    {item}
                  </button>
                );
              })}
            </div>
          </section>
          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-black text-[#34404c]">
                2. Які дії плануються?
              </h3>
              <span className="text-[9px] font-bold text-[#87919b]">
                Обрано: {actions.length}
              </span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {CONTENT_ACTIONS.map((action) => {
                const selected = actions.includes(action);
                return (
                  <button
                    key={action}
                    type="button"
                    onClick={() => toggleAction(action)}
                    className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[10px] font-bold transition"
                    style={{
                      color: selected ? "#087a55" : "#596571",
                      borderColor: selected ? "#8bc9a9" : "#e0e5e9",
                      background: selected ? "#f0faf5" : "#fbfcfd",
                    }}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px]"
                      style={{
                        color: selected ? "#fff" : "transparent",
                        borderColor: selected ? "#23a875" : "#cbd3da",
                        background: selected ? "#23a875" : "#fff",
                      }}
                    >
                      ✓
                    </span>
                    {action}
                  </button>
                );
              })}
            </div>
          </section>
          <div className="rounded-xl border border-[#d7e8df] bg-[#f3faf6] px-4 py-3 text-[9px] leading-4 text-[#557064]">
            Поточні Impressions, CTR, ATC і Content Score будуть зафіксовані як
            «до змін». Планова перевірка — першого числа через один повний
            місяць.
          </div>
          {error && (
            <div className="rounded-xl border border-[#f0b6b6] bg-[#fff1f1] px-4 py-3 text-[10px] font-bold text-[#b73535]">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-[#edf0f2] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-[#d8dde3] bg-white px-4 py-2 text-xs font-bold text-[#596571]"
            >
              Скасувати
            </button>
            <button
              type="button"
              disabled={!canSave || saving}
              onClick={() => {
                if (manager) void onSave(manager, actions);
              }}
              className="rounded-lg bg-[#23a875] px-5 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Зберігаємо…" : "ОК · Взяти в обробку"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssignNewProductModal({
  product,
  saving,
  error,
  onAssign,
  onClose,
}: {
  product: ProductRow;
  saving: boolean;
  error: string;
  onAssign: (manager: ContentManager) => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-[#111827a6] p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[#dfe4ea] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#e4e8ec] px-5 py-4">
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-[.18em] text-[#118dff]">
              Новий товар
            </div>
            <h2 className="mt-1 line-clamp-2 text-base font-black text-[#26313d]">
              {product.name}
            </h2>
            <p className="mt-1 text-[9px] text-[#87919b]">
              IDD {product.code} · goods_ref {product.goodsRef}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg bg-[#f0f3f5] px-3 py-2 text-[10px] font-bold text-[#58636d]"
          >
            × Закрити
          </button>
        </header>
        <div className="p-5">
          <h3 className="text-xs font-black text-[#34404c]">
            Оберіть відповідального менеджера
          </h3>
          <p className="mt-1 text-[9px] leading-4 text-[#7d8892]">
            Після призначення товар зникне зі списку нових задач і з’явиться в
            «Контроль результату → Аналіз нових товарів».
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {CONTENT_MANAGERS.map((manager) => (
              <button
                key={manager}
                type="button"
                disabled={saving}
                onClick={() => void onAssign(manager)}
                className="rounded-xl border border-[#cfe0ed] bg-[#f5faff] px-4 py-4 text-left text-xs font-black text-[#296b9d] transition hover:border-[#78b9e8] hover:bg-[#eaf6ff] disabled:cursor-wait disabled:opacity-50"
              >
                <span className="mr-2 text-[#118dff]">+</span>
                {manager}
              </button>
            ))}
          </div>
          {error && (
            <div className="mt-4 rounded-xl border border-[#f0b6b6] bg-[#fff1f1] px-4 py-3 text-[10px] font-bold text-[#b73535]">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewChange({
  value,
  suffix = "",
}: {
  value: number | null;
  suffix?: string;
}) {
  if (value == null) return null;
  const rounded = Math.round(value * 100) / 100;
  const positive = rounded > 0;
  const negative = rounded < 0;
  return (
    <span
      className="ml-1 rounded-full px-1.5 py-0.5 text-[8px] font-black tabular-nums"
      style={{
        color: positive ? "#087a55" : negative ? "#bd3b3b" : "#64717d",
        background: positive ? "#e8f6ef" : negative ? "#fff0f0" : "#eef1f4",
      }}
    >
      {positive ? "+" : ""}
      {rounded}
      {suffix}
    </span>
  );
}

function ReviewMetricsCard({
  metrics,
  before,
}: {
  metrics: ReviewMetrics;
  before?: ReviewMetrics;
}) {
  return (
    <div className="grid min-w-[250px] grid-cols-2 gap-1.5">
      {metrics.periodFrom && metrics.periodTo && (
        <div className="col-span-2 text-[7px] font-bold text-[#8a949e]">
          Період: {formatDate(metrics.periodFrom)} —{" "}
          {formatDate(metrics.periodTo)}
        </div>
      )}
      <div className="rounded-lg bg-[#f7f9fb] p-2">
        <div className="text-[7px] font-black uppercase tracking-[.08em] text-[#8a949e]">
          Impressions
        </div>
        <div className="mt-0.5 whitespace-nowrap text-[10px] font-black text-[#34404c]">
          {formatNumber(metrics.impressions)}
          {before && (
            <ReviewChange value={metrics.impressions - before.impressions} />
          )}
        </div>
      </div>
      <div className="rounded-lg bg-[#f7f9fb] p-2">
        <div className="text-[7px] font-black uppercase tracking-[.08em] text-[#8a949e]">
          CTR
        </div>
        <div className="mt-0.5 whitespace-nowrap text-[10px] font-black text-[#118dff]">
          {formatCtr(metrics.ctr)}
          {before && (
            <ReviewChange
              value={metricDelta(metrics.ctr, before.ctr)}
              suffix=" п.п."
            />
          )}
        </div>
        <div className="mt-0.5 text-[7px] text-[#929ca5]">
          кат. {formatCtr(metrics.categoryCtr)}
        </div>
      </div>
      <div className="rounded-lg bg-[#f7f9fb] p-2">
        <div className="text-[7px] font-black uppercase tracking-[.08em] text-[#8a949e]">
          ATC
        </div>
        <div className="mt-0.5 whitespace-nowrap text-[10px] font-black text-[#6556d8]">
          {formatCtr(metrics.atc)}
          {before && (
            <ReviewChange
              value={metricDelta(metrics.atc, before.atc)}
              suffix=" п.п."
            />
          )}
        </div>
        <div className="mt-0.5 text-[7px] text-[#929ca5]">
          кат. {formatCtr(metrics.categoryAtc)}
        </div>
      </div>
      <div className="rounded-lg bg-[#f7f9fb] p-2">
        <div className="text-[7px] font-black uppercase tracking-[.08em] text-[#8a949e]">
          Content Score
        </div>
        <div className="mt-0.5 whitespace-nowrap text-[10px] font-black text-[#087a55]">
          {metrics.contentScore == null ? "—" : metrics.contentScore.toFixed(1)}
          {before && (
            <ReviewChange
              value={metricDelta(metrics.contentScore, before.contentScore)}
            />
          )}
        </div>
        <div className="mt-0.5 text-[7px] text-[#929ca5]">
          кат.{" "}
          {metrics.categoryContent == null
            ? "—"
            : metrics.categoryContent.toFixed(1)}
        </div>
      </div>
    </div>
  );
}

function NewProductsAnalysisPanel({
  assignments,
  loading,
  error,
  onRefresh,
  onOpenProduct,
}: {
  assignments: NewProductAnalysisRow[];
  loading: boolean;
  error: string;
  onRefresh: () => void | Promise<void>;
  onOpenProduct: (product: ProductOpenTarget) => void;
}) {
  const [chartMode, setChartMode] = useState<"sales" | "stock">("sales");
  const segmentCount = (
    predicate: (item: NewProductAnalysisRow) => boolean = () => true,
  ) => ({
    tile: assignments.filter(
      (item) => item.segment === "tile" && predicate(item),
    ).length,
    sanitary: assignments.filter(
      (item) => item.segment === "sanitary" && predicate(item),
    ).length,
  });
  const published = segmentCount();
  const sold = segmentCount((item) => (item.measurement?.salesQty || 0) > 0);
  const measured = segmentCount((item) => Boolean(item.measurement));
  const waiting = {
    tile: published.tile - measured.tile,
    sanitary: published.sanitary - measured.sanitary,
  };
  const statusRows = [
    ...assignments
      .reduce((map, item) => {
        const row = map.get(item.statusName) || {
          status: item.statusName,
          tile: 0,
          sanitary: 0,
        };
        row[item.segment]++;
        map.set(item.statusName, row);
        return map;
      }, new Map<string, { status: string; tile: number; sanitary: number }>())
      .values(),
  ].sort(
    (left, right) => right.tile + right.sanitary - (left.tile + left.sanitary),
  );
  const managerChart = CONTENT_MANAGERS.map((manager) => {
    const checked = assignments.filter(
      (item) => item.manager === manager && item.measurement,
    );
    const positive = checked.filter((item) =>
      chartMode === "sales"
        ? (item.measurement?.salesQty || 0) > 0
        : (item.measurement?.stockQty || 0) > 0,
    ).length;
    return {
      manager,
      positive,
      negative: checked.length - positive,
    };
  });
  const chartMax = Math.max(
    1,
    ...managerChart.map((item) => item.positive + item.negative),
  );

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#e8edf1] bg-[#fbfcfd] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.14em] text-[#118dff]">
              Нові товари з 01.09.2026
            </div>
            <h2 className="mt-1 text-sm font-black text-[#27313c]">
              Ефективність нових публікацій
            </h2>
            <p className="mt-1 text-[10px] text-[#7d8892]">
              Для товарів, опублікованих у вересні, контрольний замір
              відбудеться 01.11.2026 — після одного повного календарного місяця.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={loading}
            className="self-start rounded-xl border border-[#bcd8f1] bg-[#edf6ff] px-3 py-2 text-[10px] font-black text-[#0b6fc2] disabled:opacity-50"
          >
            {loading ? "Оновлюємо…" : "Оновити"}
          </button>
        </div>
        {error && (
          <div className="border-b border-[#f0b6b6] bg-[#fff1f1] px-4 py-2.5 text-[10px] font-bold text-[#b73535]">
            {error}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Опубліковано",
            value: published,
            note: "призначено менеджерам",
            color: "#118dff",
          },
          {
            label: "Мали продажі",
            value: sold,
            note: "хоча б 1 продаж",
            color: "#23a875",
          },
          {
            label: "Без продажів",
            value: {
              tile: measured.tile - sold.tile,
              sanitary: measured.sanitary - sold.sanitary,
            },
            note: "серед перевірених",
            color: "#e05c68",
          },
          {
            label: "Очікують заміру",
            value: waiting,
            note: "контрольна дата попереду",
            color: "#d58a16",
          },
        ].map((item) => (
          <article
            key={item.label}
            className="rounded-2xl border border-[#dfe4ea] bg-white p-4"
          >
            <div className="text-[9px] font-black uppercase tracking-[.12em] text-[#8a949e]">
              {item.label}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[#f7f9fb] p-2.5">
                <div className="text-[8px] font-bold text-[#7d8892]">
                  Плитка
                </div>
                <div
                  className="mt-1 text-2xl font-black"
                  style={{ color: item.color }}
                >
                  {formatNumber(item.value.tile)}
                </div>
              </div>
              <div className="rounded-xl bg-[#f7f9fb] p-2.5">
                <div className="text-[8px] font-bold text-[#7d8892]">
                  Сантехніка
                </div>
                <div
                  className="mt-1 text-2xl font-black"
                  style={{ color: item.color }}
                >
                  {formatNumber(item.value.sanitary)}
                </div>
              </div>
            </div>
            <div className="mt-2 text-[8px] text-[#8b949e]">{item.note}</div>
          </article>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,.9fr)]">
        <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
          <header className="border-b border-[#e5e8eb] px-4 py-3">
            <h3 className="text-xs font-black text-[#26313d]">
              Кількість за статусами
            </h3>
            <p className="mt-0.5 text-[9px] text-[#8b949e]">
              Поточний статус окремо для плитки та сантехніки
            </p>
          </header>
          <div className="p-4">
            {statusRows.length ? (
              <div className="space-y-2">
                {statusRows.map((row) => (
                  <div
                    key={row.status}
                    className="grid grid-cols-[minmax(0,1fr)_80px_80px] items-center gap-2 rounded-xl bg-[#f7f9fb] px-3 py-2.5 text-[10px]"
                  >
                    <b className="truncate text-[#45515d]">{row.status}</b>
                    <span className="text-right text-[#118dff]">
                      Плитка: <b>{row.tile}</b>
                    </span>
                    <span className="text-right text-[#6556d8]">
                      Сант.: <b>{row.sanitary}</b>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-[10px] text-[#8b949e]">
                Поки немає призначених нових товарів
              </div>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e8eb] px-4 py-3">
            <div>
              <h3 className="text-xs font-black text-[#26313d]">
                Результат за менеджерами
              </h3>
              <p className="mt-0.5 text-[9px] text-[#8b949e]">
                Тільки товари після контрольного заміру
              </p>
            </div>
            <div className="flex rounded-xl bg-[#f0f3f5] p-1">
              {(
                [
                  ["sales", "Продажі"],
                  ["stock", "Залишки"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setChartMode(mode)}
                  className="rounded-lg px-3 py-1.5 text-[9px] font-black"
                  style={
                    chartMode === mode
                      ? { background: "#fff", color: "#118dff" }
                      : { color: "#78838d" }
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </header>
          <div className="space-y-4 p-4">
            {managerChart.map((item) => (
              <div key={item.manager}>
                <div className="mb-1.5 flex items-center justify-between text-[10px]">
                  <b className="text-[#45515d]">{item.manager}</b>
                  <span className="text-[#8b949e]">
                    {item.positive + item.negative} перевірено
                  </span>
                </div>
                <div className="flex h-7 overflow-hidden rounded-lg bg-[#edf0f3]">
                  <div
                    className="flex items-center justify-center bg-[#23a875] text-[9px] font-black text-white"
                    style={{ width: `${(item.positive / chartMax) * 100}%` }}
                    title={`${chartMode === "sales" ? "З продажами" : "Із залишком"}: ${item.positive}`}
                  >
                    {item.positive || ""}
                  </div>
                  <div
                    className="flex items-center justify-center bg-[#e05c68] text-[9px] font-black text-white"
                    style={{ width: `${(item.negative / chartMax) * 100}%` }}
                    title={`${chartMode === "sales" ? "Без продажів" : "Без залишку"}: ${item.negative}`}
                  >
                    {item.negative || ""}
                  </div>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-4 border-t border-[#edf0f2] pt-3 text-[9px] font-bold text-[#68737e]">
              <span>
                <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded bg-[#23a875]" />
                {chartMode === "sales" ? "Є продажі" : "Є залишок"}
              </span>
              <span>
                <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded bg-[#e05c68]" />
                {chartMode === "sales" ? "Без продажів" : "Без залишку"}
              </span>
            </div>
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1480px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#e3e7eb] bg-[#f7f9fb] text-[8px] font-black uppercase tracking-[.08em] text-[#77828d]">
                <th className="px-3 py-3">Товар</th>
                <th className="px-3 py-3">Категорія / бренд</th>
                <th className="px-3 py-3">Менеджер</th>
                <th className="px-3 py-3">CTR / ATC / Content Score</th>
                <th className="px-3 py-3">Залишок через місяць</th>
                <th className="px-3 py-3">Продажі через місяць</th>
                <th className="px-3 py-3">Опубліковано</th>
                <th className="px-3 py-3">Дата заміру</th>
              </tr>
            </thead>
            <tbody>
              {loading && !assignments.length && (
                <tr>
                  <td
                    colSpan={8}
                    className="p-12 text-center text-xs text-[#82909d]"
                  >
                    Завантажуємо аналітику нових товарів…
                  </td>
                </tr>
              )}
              {assignments.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[#edf0f2] align-top last:border-0 hover:bg-[#fbfcfd]"
                >
                  <td className="min-w-[300px] px-3 py-3">
                    <button
                      type="button"
                      onClick={() => onOpenProduct({ productId: item.productId, code: item.code, goodsRef: item.goodsRef, name: item.name })}
                      className="text-left text-[10px] font-black leading-4 text-[#27313c] hover:text-[#118dff] hover:underline"
                    >
                      {item.name}
                    </button>
                    <div className="mt-1 text-[8px] text-[#8b949e]">
                      IDD: {item.code} · goods_ref: {item.goodsRef}
                    </div>
                  </td>
                  <td className="min-w-[220px] px-3 py-3 text-[9px] text-[#68737e]">
                    <b className="block text-[#45515d]">{item.categoryName}</b>
                    <span className="mt-1 block">{item.brand}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[10px] font-black text-[#34404c]">
                    {item.manager}
                  </td>
                  <td className="px-3 py-3">
                    {item.measurement ? (
                      <ReviewMetricsCard metrics={item.measurement.metrics} />
                    ) : (
                      <span className="inline-flex rounded-full bg-[#fff4df] px-2.5 py-1 text-[9px] font-black text-[#a36b0e]">
                        Очікує заміру
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center text-[11px] font-black text-[#45515d]">
                    {item.measurement
                      ? (item.measurement.stockQty ?? "—")
                      : "Очікує"}
                  </td>
                  <td
                    className="px-3 py-3 text-center text-[11px] font-black"
                    style={{
                      color:
                        (item.measurement?.salesQty || 0) > 0
                          ? "#087a55"
                          : "#bd3b3b",
                    }}
                  >
                    {item.measurement ? item.measurement.salesQty : "Очікує"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[10px] font-semibold text-[#596571]">
                    {formatDate(item.publishedAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <b className="text-[10px] text-[#34404c]">
                      {formatDate(item.checkAt)}
                    </b>
                    <div className="mt-1 text-[8px] text-[#8b949e]">
                      {item.measurement ? "Виконано" : "Заплановано"}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !error && assignments.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="p-12 text-center text-xs text-[#82909d]"
                  >
                    Нові товари ще не призначені менеджерам
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function ProductCardsDashboardV2() {
  const [view, setView] = useState<DashboardView>("overview");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [allFacets, setAllFacets] = useState<
    DashboardResponse["facets"] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const [pagePickerDraft, setPagePickerDraft] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [bulkIds, setBulkIds] = useState<number[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [statusId, setStatusId] = useState(DEFAULT_STATUS_ID);
  const [processingStatus, setProcessingStatus] =
    useState<ProcessingStatus>("unprocessed");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minStock, setMinStock] = useState("");
  const [maxStock, setMaxStock] = useState("");
  const [productSignal, setProductSignal] = useState<ProductSignal | "">("");
  const [chartMode, setChartMode] = useState<ChartMode>("categories");
  const [copied, setCopied] = useState("");
  const [bulkAction, setBulkAction] = useState<"excel" | "copy" | "">("");
  const [bulkActionError, setBulkActionError] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(
    null,
  );
  const [productOpenError, setProductOpenError] = useState("");
  const [attributesProduct, setAttributesProduct] = useState<ProductRow | null>(
    null,
  );
  const [processingProduct, setProcessingProduct] = useState<ProductRow | null>(
    null,
  );
  const [assigningNewProduct, setAssigningNewProduct] =
    useState<ProductRow | null>(null);
  const [newAssignmentSaving, setNewAssignmentSaving] = useState(false);
  const [newAssignmentError, setNewAssignmentError] = useState("");
  const [newAssignments, setNewAssignments] = useState<NewProductAnalysisRow[]>(
    [],
  );
  const [newAssignmentsLoading, setNewAssignmentsLoading] = useState(false);
  const [newAssignmentsError, setNewAssignmentsError] = useState("");
  const [resultMode, setResultMode] = useState<ResultMode>("merchandising");
  const [interventions, setInterventions] = useState<ProductIntervention[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewSaveError, setReviewSaveError] = useState("");

  const openProduct = useCallback(async (target: ProductRow | ProductOpenTarget) => {
    setProductOpenError("");
    if ("statusId" in target && typeof target.id === "number") {
      setSelectedProduct(target);
      return;
    }
    try {
      const targetId = "productId" in target ? target.productId : undefined;
      const url = targetId
        ? `/api/products/${targetId}`
        : `/api/products/resolve?code=${encodeURIComponent(target.code)}&goodsRef=${encodeURIComponent(target.goodsRef)}`;
      const response = await fetch(url);
      const payload = (await response.json().catch(() => ({}))) as ProductRow & { error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setSelectedProduct(payload);
    } catch (cause) {
      setProductOpenError(cause instanceof Error ? cause.message : "Не вдалося відкрити картку товару");
    }
  }, []);
  const [resultSearch, setResultSearch] = useState("");
  const [resultCategory, setResultCategory] = useState("");
  const [resultBrand, setResultBrand] = useState("");
  const [resultManager, setResultManager] = useState<ContentManager | "">("");
  const [resultMonth, setResultMonth] = useState("");
  const loadRequestRef = useRef(0);
  const interventionsLoadedRef = useRef(false);
  const newAssignmentsLoadedRef = useRef(false);
  const loadScopeKey = JSON.stringify([
    view,
    search,
    bulkIds,
    categoryId,
    brandId,
    statusId,
    processingStatus,
    minPrice,
    maxPrice,
    minStock,
    maxStock,
    productSignal,
  ]);
  const previousLoadScopeRef = useRef(loadScopeKey);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (view === "results" || view === "search") {
        setLoading(false);
        setError("");
        return;
      }
      const requestId = ++loadRequestRef.current;
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/products/dashboard-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            view,
            page,
            limit: PAGE_SIZE,
            search,
            bulkIds,
            categoryId: categoryId ? Number(categoryId) : null,
            brandId: brandId ? Number(brandId) : null,
            statusId:
              view === "new" ? null : statusId ? Number(statusId) : null,
            processingStatus: view === "products" ? processingStatus : "all",
            minPrice: minPrice ? Number(minPrice) : null,
            maxPrice: maxPrice ? Number(maxPrice) : null,
            minStock: minStock ? Number(minStock) : null,
            maxStock: maxStock ? Number(maxStock) : null,
            productSignal: productSignal || null,
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = (await response.json()) as DashboardResponse;
        if (requestId !== loadRequestRef.current) return;
        setData(next);
        setAllFacets((current) => current || next.facets);
      } catch (cause) {
        if (signal?.aborted || requestId !== loadRequestRef.current) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Не вдалося завантажити дашборд",
        );
      } finally {
        if (requestId === loadRequestRef.current) setLoading(false);
      }
    },
    [
      view,
      page,
      search,
      bulkIds,
      categoryId,
      brandId,
      statusId,
      processingStatus,
      minPrice,
      maxPrice,
      minStock,
      maxStock,
      productSignal,
    ],
  );

  const loadInterventions = useCallback(async () => {
    setReviewsLoading(true);
    setReviewsError("");
    try {
      const response = await fetch("/api/products/content-reviews", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        reviews?: ProductIntervention[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || `HTTP ${response.status}`);
      setInterventions(payload.reviews || []);
      interventionsLoadedRef.current = true;
    } catch (cause) {
      setReviewsError(
        cause instanceof Error
          ? cause.message
          : "Не вдалося завантажити контроль результатів",
      );
    } finally {
      setReviewsLoading(false);
    }
  }, []);

  const loadNewAssignments = useCallback(async () => {
    setNewAssignmentsLoading(true);
    setNewAssignmentsError("");
    try {
      const response = await fetch("/api/products/new-product-assignments", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        assignments?: NewProductAnalysisRow[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || `HTTP ${response.status}`);
      setNewAssignments(payload.assignments || []);
      newAssignmentsLoadedRef.current = true;
    } catch (cause) {
      setNewAssignmentsError(
        cause instanceof Error
          ? cause.message
          : "Не вдалося завантажити нові товари",
      );
    } finally {
      setNewAssignmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (previousLoadScopeRef.current !== loadScopeKey) {
      previousLoadScopeRef.current = loadScopeKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, loadScopeKey, page]);
  useEffect(() => {
    if (
      !interventionsLoadedRef.current &&
      (view === "products" ||
        (view === "results" && resultMode === "merchandising"))
    )
      void loadInterventions();
  }, [loadInterventions, resultMode, view]);
  useEffect(() => {
    if (
      !newAssignmentsLoadedRef.current &&
      view === "results" &&
      resultMode === "new-products"
    )
      void loadNewAssignments();
  }, [loadNewAssignments, resultMode, view]);
  const resetFilters = () => {
    setSearchDraft("");
    setSearch("");
    setBulkIds([]);
    setCategoryId("");
    setBrandId("");
    setStatusId(DEFAULT_STATUS_ID);
    setProcessingStatus("unprocessed");
    setMinPrice("");
    setMaxPrice("");
    setMinStock("");
    setMaxStock("");
    setProductSignal("");
    setPage(1);
    setPagePickerOpen(false);
    setPagePickerDraft("");
    setBulkActionError("");
  };
  const changeView = (next: DashboardView) => {
    setView(next);
    resetFilters();
  };
  const hasFilters = Boolean(
    search ||
    bulkIds.length ||
    categoryId ||
    brandId ||
    statusId !== DEFAULT_STATUS_ID ||
    processingStatus !== "unprocessed" ||
    minPrice ||
    maxPrice ||
    minStock ||
    maxStock ||
    productSignal,
  );
  const facetOptions = allFacets || data?.facets;
  const activeFilterLabel = [
    facetOptions?.categories.find((item) => item.key === categoryId)?.name,
    facetOptions?.brands.find((item) => item.key === brandId)?.name,
    facetOptions?.statuses.find((item) => item.key === statusId)?.name,
  ]
    .filter(Boolean)
    .join(" · ");
  const activeProductSignal = PRODUCT_SIGNAL_META.find(
    (item) => item.id === productSignal,
  );
  const productScopeLabel = [
    activeFilterLabel,
    search ? `пошук: ${search}` : "",
    bulkIds.length === 1
      ? `вибраний товар IDD: ${bulkIds[0]}`
      : bulkIds.length
        ? `набір IDD: ${bulkIds.length}`
        : "",
    activeProductSignal?.label || "",
    view === "products" && processingStatus !== "unprocessed"
      ? PROCESSING_FILTER_OPTIONS.find((item) => item.key === processingStatus)
          ?.name || ""
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const activeView =
    VIEW_ITEMS.find((item) => item.id === view) || VIEW_ITEMS[0];
  const trendCandidates = data?.categoryTrendForecast?.candidates || [];
  const trendLeader = trendCandidates[0];
  const trendLeaderMeta = trendLeader
    ? TREND_POTENTIAL_META[trendLeader.potential]
    : null;
  const processedByCode = useMemo(() => {
    const latest = new Map<number, ProductIntervention>();
    for (const item of interventions) {
      if (!latest.has(item.code)) latest.set(item.code, item);
    }
    return latest;
  }, [interventions]);
  const resultCategories = useMemo(
    () =>
      [...new Set(interventions.map((item) => item.categoryName))].sort(
        (a, b) => a.localeCompare(b, "uk"),
      ),
    [interventions],
  );
  const resultBrands = useMemo(
    () =>
      [...new Set(interventions.map((item) => item.brand))].sort((a, b) =>
        a.localeCompare(b, "uk"),
      ),
    [interventions],
  );
  const resultMonths = useMemo(
    () =>
      [
        ...new Set(interventions.map((item) => item.changedAt.slice(0, 7))),
      ].sort((a, b) => b.localeCompare(a)),
    [interventions],
  );
  const filteredInterventions = useMemo(() => {
    const needle = resultSearch.trim().toLocaleLowerCase("uk");
    return interventions
      .filter((item) => {
        if (
          needle &&
          !`${item.name} ${item.code} ${item.goodsRef}`
            .toLocaleLowerCase("uk")
            .includes(needle)
        )
          return false;
        if (resultCategory && item.categoryName !== resultCategory)
          return false;
        if (resultBrand && item.brand !== resultBrand) return false;
        if (resultManager && item.manager !== resultManager) return false;
        if (resultMonth && item.changedAt.slice(0, 7) !== resultMonth)
          return false;
        return true;
      })
      .sort(
        (left, right) =>
          right.changedAt.localeCompare(left.changedAt) ||
          left.name.localeCompare(right.name, "uk"),
      );
  }, [
    interventions,
    resultSearch,
    resultCategory,
    resultBrand,
    resultManager,
    resultMonth,
  ]);
  const resultOutcomeItems = useMemo(() => {
    const counts: Record<Exclude<ReviewOutcome, "waiting">, number> = {
      growth: 0,
      flat: 0,
      decline: 0,
    };
    for (const item of filteredInterventions) {
      const outcome = reviewOutcome(item);
      if (outcome !== "waiting") counts[outcome]++;
    }
    return [
      { key: "growth", name: "Є зростання", count: counts.growth },
      { key: "flat", name: "Без змін", count: counts.flat },
      { key: "decline", name: "Погіршення", count: counts.decline },
    ];
  }, [filteredInterventions]);
  const resultCheckedTotal = resultOutcomeItems.reduce(
    (total, item) => total + item.count,
    0,
  );
  const resultWaitingTotal = filteredInterventions.filter(
    (item) => reviewOutcome(item) === "waiting",
  ).length;
  const resultManagerCounts = CONTENT_MANAGERS.map((manager) => ({
    manager,
    count: filteredInterventions.filter((item) => item.manager === manager)
      .length,
  }));
  const chartItems = (data?.facets[chartMode] || []).slice(0, 10);
  const chartTotal = data?.total || 0;
  const chartActiveKey =
    chartMode === "categories"
      ? categoryId
      : chartMode === "brands"
        ? brandId
        : statusId;
  const chartTitle =
    chartMode === "categories"
      ? "Категорії"
      : chartMode === "brands"
        ? "Бренди"
        : "Статус товару";
  const syncPct = data?.syncState.progress?.totalPages
    ? Math.round(
        (data.syncState.progress.pages / data.syncState.progress.totalPages) *
          100,
      )
    : data?.syncState.state === "ok"
      ? 100
      : 0;

  const copy = async (value: string | number, key: string) => {
    try {
      await copyText(String(value));
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {}
  };
  const saveIntervention = async (
    product: ProductRow,
    manager: ContentManager,
    actions: ContentAction[],
  ) => {
    setReviewSaving(true);
    setReviewSaveError("");
    try {
      const response = await fetch("/api/products/content-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: {
            id: product.id,
            code: product.code,
            goodsRef: product.goodsRef,
            name: product.name,
            url: product.url,
            categoryId: product.categoryId,
            categoryName: product.categoryName || "Без категорії",
            brand: product.brand || "Без бренду",
          },
          manager,
          actions,
          before: {
            impressions: product.impressions || 0,
            ctr: product.ctr ?? null,
            atc: product.atc ?? null,
            contentScore: product.contentScore ?? null,
            categoryCtr: product.categoryMedianCtr ?? null,
            categoryAtc: product.categoryMedianAtc ?? null,
            categoryContent: product.categoryMedianContent ?? null,
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        review?: ProductIntervention;
        error?: string;
      };
      if (!response.ok || !payload.review)
        throw new Error(payload.error || `HTTP ${response.status}`);
      const saved = payload.review;
      setInterventions((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      setProcessingProduct(null);
    } catch (cause) {
      setReviewSaveError(
        cause instanceof Error
          ? cause.message
          : "Не вдалося зберегти обробку товару",
      );
    } finally {
      setReviewSaving(false);
    }
  };
  const assignNewProduct = async (
    product: ProductRow,
    manager: ContentManager,
  ) => {
    setNewAssignmentSaving(true);
    setNewAssignmentError("");
    try {
      const response = await fetch("/api/products/new-product-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: product.code, manager }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || `HTTP ${response.status}`);
      setAssigningNewProduct(null);
      newAssignmentsLoadedRef.current = false;
      await load();
    } catch (cause) {
      setNewAssignmentError(
        cause instanceof Error
          ? cause.message
          : "Не вдалося призначити менеджера",
      );
    } finally {
      setNewAssignmentSaving(false);
    }
  };
  const toggleCategoryFilter = (value: string | number) => {
    const key = String(value);
    setCategoryId((current) => (current === key ? "" : key));
    setPage(1);
  };
  const selectChartItem = (item: FacetRow) => {
    if (chartMode === "categories") toggleCategoryFilter(item.key);
    else if (chartMode === "brands")
      setBrandId((current) => (current === item.key ? "" : item.key));
    else setStatusId((current) => (current === item.key ? "" : item.key));
  };
  const idCell = (row: ProductRow) => (
    <div className="min-w-28 space-y-1">
      <button
        onClick={(event) => {
          event.stopPropagation();
          void copy(row.code, `code:${row.id}`);
        }}
        className="block rounded text-left text-[10px] font-black tabular-nums text-[#45515d] hover:text-[#118dff]"
        title="Скопіювати IDD"
      >
        IDD: {row.code}{" "}
        {copied === `code:${row.id}` && (
          <span className="text-[#087a55]">✓</span>
        )}
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          void copy(row.goodsRef, `ref:${row.id}`);
        }}
        className="block rounded text-left text-[9px] font-semibold tabular-nums text-[#89929b] hover:text-[#118dff]"
        title="Скопіювати goods_ref"
      >
        goods_ref: {row.goodsRef}{" "}
        {copied === `ref:${row.id}` && (
          <span className="text-[#087a55]">✓</span>
        )}
      </button>
    </div>
  );
  const skuCell = (row: ProductRow) => (
    <button
      disabled={!row.sku}
      onClick={(event) => {
        event.stopPropagation();
        if (row.sku) void copy(row.sku, `sku:${row.id}`);
      }}
      className="max-w-36 truncate rounded text-left text-[10px] font-semibold text-[#596571] hover:text-[#118dff] disabled:text-[#a5adb5]"
      title={row.sku ? "Скопіювати артикул" : "Артикул відсутній"}
    >
      {row.sku || "—"}{" "}
      {copied === `sku:${row.id}` && <span className="text-[#087a55]">✓</span>}
    </button>
  );
  const fetchAllFilteredRows = async () => {
    const response = await fetch("/api/products/dashboard-v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view: "products",
        page: 1,
        limit: Math.max(1, data?.total || 250_000),
        exportAll: true,
        search,
        bulkIds,
        categoryId: categoryId ? Number(categoryId) : null,
        brandId: brandId ? Number(brandId) : null,
        statusId: statusId ? Number(statusId) : null,
        processingStatus,
        minStock: minStock ? Number(minStock) : null,
        maxStock: maxStock ? Number(maxStock) : null,
        productSignal: productSignal || null,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as DashboardResponse;
  };
  const copyFilteredIds = async () => {
    setBulkAction("copy");
    setBulkActionError("");
    try {
      const exported = await fetchAllFilteredRows();
      await copyText(exported.rows.map((row) => row.code).join("\n"));
      setCopied("all-idd");
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      setBulkActionError("Не вдалося скопіювати IDD. Спробуйте ще раз.");
    } finally {
      setBulkAction("");
    }
  };
  const downloadFilteredExcel = async () => {
    setBulkAction("excel");
    setBulkActionError("");
    try {
      const [exported, XLSX] = await Promise.all([
        fetchAllFilteredRows(),
        import("xlsx"),
      ]);
      const headerRow = 5;
      const tableRows = exported.rows.map((row) => [
        row.name,
        row.code,
        row.goodsRef,
        row.categoryName || "Без категорії",
        row.brand || "Без бренду",
        row.sku || "—",
        row.imagesCount,
        row.requiredAttrsConfigured ? row.missingRequiredAttrsCount : null,
        row.reviewsCount,
        row.stockQty ?? 0,
        row.impressions ?? 0,
        row.ctr == null ? null : row.ctr / 100,
        row.categoryMedianCtr == null ? null : row.categoryMedianCtr / 100,
        row.atc == null ? null : row.atc / 100,
        row.categoryMedianAtc == null ? null : row.categoryMedianAtc / 100,
        row.contentScore ?? null,
        row.categoryMedianContent ?? null,
      ]);
      const worksheet = XLSX.utils.aoa_to_sheet([
        ["Аналіз товарів"],
        ["Фільтр", productScopeLabel || "Усі товари"],
        ["Кількість товарів", exported.rows.length],
        [],
        [
          "Товар",
          "IDD",
          "goods_ref",
          "Категорія",
          "Бренд",
          "Артикул",
          "Фото",
          "Незаповнені атрибути",
          "Відгуки",
          "Залишок",
          "Impressions",
          "CTR",
          "Бенчмарк CTR категорії",
          "ATC",
          "Бенчмарк ATC категорії",
          "Content Score",
          "Бенчмарк Content Score категорії",
        ],
        ...tableRows,
      ]);
      worksheet["!cols"] = [
        { wch: 52 },
        { wch: 12 },
        { wch: 14 },
        { wch: 32 },
        { wch: 24 },
        { wch: 18 },
        { wch: 9 },
        { wch: 22 },
        { wch: 10 },
        { wch: 11 },
        { wch: 14 },
        { wch: 11 },
        { wch: 22 },
        { wch: 11 },
        { wch: 22 },
        { wch: 16 },
        { wch: 31 },
      ];
      worksheet["!autofilter"] = {
        ref: `A${headerRow}:Q${headerRow + exported.rows.length}`,
      };
      for (let index = 0; index < exported.rows.length; index++) {
        const excelRow = headerRow + 1 + index;
        const productCell = worksheet[`A${excelRow}`];
        if (productCell && exported.rows[index].url) {
          productCell.l = { Target: exported.rows[index].url };
        }
        for (const column of ["L", "M", "N", "O"]) {
          const cell = worksheet[`${column}${excelRow}`];
          if (cell) cell.z = "0.00%";
        }
        for (const column of ["P", "Q"]) {
          const cell = worksheet[`${column}${excelRow}`];
          if (cell) cell.z = "0.0";
        }
      }
      const analyticsSheet = XLSX.utils.aoa_to_sheet([
        ["Аналітика за вибраним фільтром"],
        ["Фільтр", productScopeLabel || "Усі товари"],
        [],
        ["Період", "Місяць", "CTR", "ATC"],
        ...exported.productAnalysis.currentThree.map((point) => [
          "Останні 3 повні місяці",
          point.month,
          point.ctr == null ? null : point.ctr / 100,
          point.atc == null ? null : point.atc / 100,
        ]),
        ...exported.productAnalysis.lastYear.map((point) => [
          "Рік до року",
          point.month,
          point.ctr == null ? null : point.ctr / 100,
          point.atc == null ? null : point.atc / 100,
        ]),
      ]);
      analyticsSheet["!cols"] = [
        { wch: 25 },
        { wch: 14 },
        { wch: 12 },
        { wch: 12 },
      ];
      for (let excelRow = 5; excelRow <= 11; excelRow++) {
        for (const column of ["C", "D"]) {
          const cell = analyticsSheet[`${column}${excelRow}`];
          if (cell) cell.z = "0.00%";
        }
      }
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Товари");
      XLSX.utils.book_append_sheet(workbook, analyticsSheet, "Аналітика");
      XLSX.writeFile(
        workbook,
        `analiz-tovariv-${exported.currentDate || "export"}.xlsx`,
        { compression: true },
      );
    } catch {
      setBulkActionError("Не вдалося сформувати Excel. Спробуйте ще раз.");
    } finally {
      setBulkAction("");
    }
  };
  const compactIdCell = (row: ProductRow) => (
    <div className="mt-1 flex min-w-0 items-center gap-2 whitespace-nowrap text-[8px] font-semibold text-[#89929b]">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void copy(row.code, `code:${row.id}`);
        }}
        className="min-w-0 truncate hover:text-[#118dff]"
        title="Скопіювати IDD"
      >
        IDD: {row.code}
        {copied === `code:${row.id}` && (
          <span className="ml-0.5 text-[#087a55]">✓</span>
        )}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void copy(row.goodsRef, `ref:${row.id}`);
        }}
        className="min-w-0 truncate hover:text-[#118dff]"
        title="Скопіювати goods_ref"
      >
        goods_ref: {row.goodsRef}
        {copied === `ref:${row.id}` && (
          <span className="ml-0.5 text-[#087a55]">✓</span>
        )}
      </button>
    </div>
  );
  const selectProductRow = (row: ProductRow) => {
    setBulkIds((current) =>
      current.length === 1 && current[0] === row.code ? [] : [row.code],
    );
    setPage(1);
  };
  const currentPage = data?.page || 1;
  const totalPageCount = data?.totalPages || 1;
  const goToPage = (target: number) => {
    setPage(Math.min(totalPageCount, Math.max(1, target)));
    setPagePickerOpen(false);
    setPagePickerDraft("");
  };
  const pager = (
    <footer className="relative flex flex-col items-center justify-between gap-3 border-t border-[#e5e8eb] px-4 py-3 sm:flex-row">
      <span className="text-[10px] text-[#8a949e]">
        По {PAGE_SIZE} товарів · {formatNumber(data?.total || 0)} всього
      </span>
      <div className="flex flex-wrap items-center justify-center gap-1">
        <button
          disabled={currentPage <= 1}
          onClick={() => goToPage(currentPage - 1)}
          className="rounded-lg border border-[#d8dde3] bg-white px-3 py-1.5 text-[10px] font-bold disabled:opacity-30"
        >
          ← Назад
        </button>
        {paginationItems(currentPage, totalPageCount).map((item, index) =>
          item === "ellipsis" ? (
            <button
              key={`ellipsis:${index}`}
              type="button"
              onClick={() => {
                setPagePickerDraft(String(currentPage));
                setPagePickerOpen(true);
              }}
              className="h-7 min-w-7 rounded-lg border border-transparent px-2 text-[11px] font-black text-[#65717c] hover:border-[#bcd8f1] hover:bg-[#edf6ff]"
              title="Перейти до потрібної сторінки"
            >
              …
            </button>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => goToPage(item)}
              aria-current={item === currentPage ? "page" : undefined}
              className={`h-7 min-w-7 rounded-lg border px-2 text-[10px] font-black ${
                item === currentPage
                  ? "border-[#118dff] bg-[#118dff] text-white"
                  : "border-[#d8dde3] bg-white text-[#596571] hover:border-[#bcd8f1] hover:bg-[#edf6ff]"
              }`}
            >
              {item}
            </button>
          ),
        )}
        <button
          disabled={currentPage >= totalPageCount}
          onClick={() => goToPage(currentPage + 1)}
          className="rounded-lg border border-[#bcd8f1] bg-[#edf6ff] px-3 py-1.5 text-[10px] font-bold text-[#0b6fc2] disabled:opacity-30"
        >
          Далі →
        </button>
      </div>
      <span className="text-[10px] text-[#8a949e]">
        Сторінка {currentPage} з {totalPageCount}
      </span>
      {pagePickerOpen && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const target = Number(pagePickerDraft);
            if (Number.isFinite(target)) goToPage(Math.round(target));
          }}
          className="absolute bottom-[calc(100%-2px)] left-1/2 z-30 w-56 -translate-x-1/2 rounded-xl border border-[#d8dde3] bg-white p-3 shadow-xl"
        >
          <label
            htmlFor="product-page-picker"
            className="block text-[9px] font-black uppercase tracking-[.12em] text-[#7c8792]"
          >
            Перейти до сторінки
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="product-page-picker"
              autoFocus
              type="number"
              min={1}
              max={totalPageCount}
              value={pagePickerDraft}
              onChange={(event) => setPagePickerDraft(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[#d8dde3] px-2 py-1.5 text-[10px] outline-none focus:border-[#118dff]"
            />
            <button
              type="submit"
              className="rounded-lg bg-[#118dff] px-3 py-1.5 text-[10px] font-black text-white"
            >
              Перейти
            </button>
          </div>
        </form>
      )}
    </footer>
  );

  const filterBar = (compact = false) => (
    <div className="border-b border-[#e5e8eb] px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-[#26313d]">
            {view === "new"
              ? "Нові задачі з 01.09.2026 · партію 03.09 тимчасово приховано"
              : view === "categories"
                ? "Зріз за категоріями"
                : view === "products"
                  ? "Товарна ефективність"
                  : "Каталог товарів"}
          </h2>
          <p className="mt-0.5 text-[10px] text-[#8a939c]">
            {view === "categories"
              ? `${formatNumber(data?.categoryAnalysis.length || 0)} категорій за вибраними умовами`
              : `Показано ${formatNumber(data?.total || 0)} товарів за вибраними умовами`}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {view === "products" && (
            <>
              <button
                type="button"
                onClick={() => void downloadFilteredExcel()}
                disabled={Boolean(bulkAction) || !data?.total}
                className="rounded-lg border border-[#b9ddcb] bg-[#eaf7f1] px-3 py-2 text-[10px] font-black text-[#087a55] disabled:cursor-wait disabled:opacity-50"
              >
                {bulkAction === "excel"
                  ? "Формування Excel…"
                  : "↓ Завантажити Excel"}
              </button>
              <button
                type="button"
                onClick={() => void copyFilteredIds()}
                disabled={Boolean(bulkAction) || !data?.total}
                className="rounded-lg border border-[#bcd8f1] bg-[#edf6ff] px-3 py-2 text-[10px] font-black text-[#0b6fc2] disabled:cursor-wait disabled:opacity-50"
              >
                {bulkAction === "copy" ? "Копіювання IDD…" : "▣ Скопіювати IDD"}
              </button>
            </>
          )}
          <button
            onClick={resetFilters}
            disabled={!hasFilters}
            className="rounded-lg border border-[#cbd9e7] bg-[#f3f8fd] px-3 py-2 text-[10px] font-bold text-[#0b6fc2] disabled:cursor-default disabled:opacity-45"
          >
            Скинути фільтри
          </button>
        </div>
      </div>
      {bulkActionError && view === "products" && (
        <div className="mb-3 rounded-lg border border-[#f1b7b7] bg-[#fff2f2] px-3 py-2 text-[9px] font-semibold text-[#bd3b3b]">
          {bulkActionError}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        <StyledSelect
          value={categoryId}
          options={facetOptions?.categories || []}
          placeholder="Усі категорії"
          searchPlaceholder="Знайти категорію…"
          onChange={setCategoryId}
        />
        <StyledSelect
          value={brandId}
          options={facetOptions?.brands || []}
          placeholder="Усі бренди"
          searchPlaceholder="Знайти бренд…"
          onChange={setBrandId}
        />
        {view !== "new" && (
          <StyledSelect
            value={statusId}
            options={facetOptions?.statuses || []}
            placeholder="Усі статуси товару"
            searchPlaceholder="Знайти статус…"
            onChange={setStatusId}
          />
        )}
        {view === "products" && (
          <StyledSelect
            value={processingStatus}
            options={PROCESSING_FILTER_OPTIONS}
            placeholder="Не оброблені менеджером"
            searchPlaceholder="Знайти тип обробки…"
            onChange={(value) =>
              setProcessingStatus((value || "all") as ProcessingStatus)
            }
          />
        )}
      </div>
      {!compact && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
            <input
              type="number"
              min="0"
              value={minPrice}
              onChange={(event) => setMinPrice(event.target.value)}
              placeholder="Ціна від, ₴"
              className="rounded-xl border border-[#d8dde3] px-3 py-2.5 text-[11px] outline-none focus:border-[#118dff]"
            />
            <input
              type="number"
              min="0"
              value={maxPrice}
              onChange={(event) => setMaxPrice(event.target.value)}
              placeholder="Ціна до, ₴"
              className="rounded-xl border border-[#d8dde3] px-3 py-2.5 text-[11px] outline-none focus:border-[#118dff]"
            />
            <input
              type="number"
              min="0"
              value={minStock}
              onChange={(event) => setMinStock(event.target.value)}
              placeholder="Залишок від"
              className="rounded-xl border border-[#d8dde3] px-3 py-2.5 text-[11px] outline-none focus:border-[#118dff]"
            />
            <input
              type="number"
              min="0"
              value={maxStock}
              onChange={(event) => setMaxStock(event.target.value)}
              placeholder="Залишок до"
              className="rounded-xl border border-[#d8dde3] px-3 py-2.5 text-[11px] outline-none focus:border-[#118dff]"
            />
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setSearch(searchDraft.trim());
              }}
              className="flex min-w-0 flex-1"
            >
              <input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Код, goods_ref, артикул, назва або бренд"
                className="min-w-0 flex-1 rounded-l-xl border border-r-0 border-[#d8dde3] px-3 py-2.5 text-xs outline-none focus:border-[#118dff]"
              />
              <button className="rounded-r-xl border-0 bg-[#118dff] px-4 text-xs font-bold text-white">
                Пошук
              </button>
            </form>
            <button
              onClick={() => setBulkOpen(true)}
              className="rounded-xl border border-[#bcd8f1] bg-[#edf6ff] px-4 py-2 text-xs font-bold text-[#0b6fc2]"
            >
              Пошук набором {bulkIds.length ? `· ${bulkIds.length}` : ""}
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="min-h-[calc(100dvh-104px)] overflow-hidden rounded-2xl border border-[#dfe4ea] bg-[#f4f5f3] text-[#27313c] shadow-sm">
      <div className="grid min-h-[calc(100dvh-104px)] grid-cols-1 lg:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="bg-[#17202a] px-3 py-5 text-white lg:min-h-full">
          <div className="mb-7 flex items-center gap-3 px-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#118dff] text-lg font-black">
              A
            </span>
            <div>
              <div className="text-sm font-black tracking-[.12em]">АГРОМАТ</div>
              <div className="text-[9px] font-semibold uppercase tracking-[.2em] text-[#91a0af]">
                Content analytics
              </div>
            </div>
          </div>
          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {VIEW_ITEMS.map((item, index) => {
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => changeView(item.id)}
                  className="min-w-[170px] rounded-xl border-0 px-3 py-3 text-left transition lg:min-w-0"
                  style={{
                    background: active ? "#25384d" : "transparent",
                    boxShadow: active ? "inset 3px 0 #118dff" : "none",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-black"
                      style={{
                        color: active ? "#fff" : "#82909e",
                        background: active ? "#118dff" : "#222d38",
                      }}
                    >
                      {index + 1}
                    </span>
                    <div>
                      <div
                        className="text-xs font-bold"
                        style={{ color: active ? "#fff" : "#bac2ca" }}
                      >
                        {item.label}
                      </div>
                      <div className="mt-0.5 text-[9px] text-[#758391]">
                        {item.hint}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
          <div className="mt-8 rounded-xl border border-[#304152] bg-[#1d2a36] p-3">
            <div className="text-[9px] font-bold uppercase tracking-[.14em] text-[#7f90a0]">
              Період аналізу
            </div>
            <div className="mt-2 text-[10px] font-bold text-[#dce8f3]">
              {formatMonthRange(data?.monthFrom, data?.currentDate)}
            </div>
            <div className="mt-1 text-[9px] leading-4 text-[#8192a2]">
              Показники оновлюються щодня в межах поточного місяця.
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="flex flex-col gap-3 border-b border-[#e1e4e8] bg-white px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="text-xs text-[#8b949e]">
              Аналіз карток товару&nbsp; / &nbsp;
              <b className="text-[#27313c]">{activeView.label}</b>
            </div>
            <span className="rounded-lg border border-[#dfe4ea] bg-white px-3 py-1.5 text-[10px] text-[#68727d]">
              Останнє оновлення API:{" "}
              <b className="text-[#27313c]">{formatDateTime(data?.syncedAt)}</b>
            </span>
          </header>
          <div className="p-4 sm:p-5 xl:p-6">
            <section className="mb-5">
              <div className="mb-1 text-[10px] font-black uppercase tracking-[.2em] text-[#118dff]">
                {data?.currentDate || "Актуальні дані"}
              </div>
              <h1 className="text-2xl font-black tracking-tight text-[#202a35] sm:text-3xl">
                {view === "overview" ? (
                  <>
                    Аналіз <span className="text-[#118dff]">карток товару</span>
                  </>
                ) : (
                  <span className="text-[#118dff]">{activeView.label}</span>
                )}
              </h1>
              <p className="mt-1 text-xs text-[#737d87]">
                {view === "new"
                  ? "Нові товари з 01.09.2026 незалежно від статусу, які ще не призначені контент-менеджеру."
                  : view === "categories"
                    ? "Поточний стан контенту категорій та динаміка CTR Каталог → PDP."
                    : view === "products"
                      ? "Пошук точок зростання за видимістю, конверсією та якістю контенту."
                    : view === "search"
                        ? "Єдина черга пошукових запитів з BigQuery, Multisearch та Google Sheets."
                        : view === "results"
                          ? "Контроль ефекту контентних змін після завершення контрольного періоду."
                          : "Єдиний простір огляду каталогу, товарних статусів та ефективності переходів."}
              </p>
            </section>
            {error && (
              <button
                onClick={() => void load()}
                className="mb-4 w-full rounded-xl border border-[#f0b6b6] bg-[#fff1f1] p-3 text-left text-xs font-semibold text-[#b73535]"
              >
                Не вдалося завантажити дані: {error}. Натисніть, щоб повторити.
              </button>
            )}
            {view === "overview" && (
              <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                {METRIC_META.map((meta) => (
                  <MetricCard key={meta.key} meta={meta} data={data} />
                ))}
              </section>
            )}

            {view === "products" ? (
              <section className="space-y-4">
                <div className="grid gap-3 xl:grid-cols-2">
                  <ProductCtrPanel
                    eyebrow="Поточна динаміка"
                    title="CTR та ATC за останні 3 повні місяці"
                    subtitle={productScopeLabel || "Усі товари"}
                    points={data?.productAnalysis.currentThree || []}
                  />
                  <ProductCtrPanel
                    eyebrow="Рік до року"
                    title="CTR та ATC за аналогічний період торік"
                    subtitle={`3 попередні місяці + поточний місяць торік · ${productScopeLabel || "усі товари"}`}
                    points={data?.productAnalysis.lastYear || []}
                  />
                </div>

                <div className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
                  {filterBar(true)}
                  <div className="border-b border-[#e8edf1] bg-[#fbfcfd] px-4 py-3">
                    <div className="grid gap-2 lg:grid-cols-[160px_160px_minmax(280px,1fr)_auto]">
                      <input
                        type="number"
                        min="0"
                        value={minStock}
                        onChange={(event) => setMinStock(event.target.value)}
                        placeholder="Залишок від"
                        className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[11px] outline-none focus:border-[#118dff]"
                      />
                      <input
                        type="number"
                        min="0"
                        value={maxStock}
                        onChange={(event) => setMaxStock(event.target.value)}
                        placeholder="Залишок до"
                        className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[11px] outline-none focus:border-[#118dff]"
                      />
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          setSearch(searchDraft.trim());
                        }}
                        className="flex min-w-0"
                      >
                        <input
                          value={searchDraft}
                          onChange={(event) =>
                            setSearchDraft(event.target.value)
                          }
                          placeholder="IDD, goods_ref або артикул"
                          className="min-w-0 flex-1 rounded-l-xl border border-r-0 border-[#d8dde3] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#118dff]"
                        />
                        <button className="rounded-r-xl border-0 bg-[#118dff] px-4 text-xs font-bold text-white">
                          Пошук
                        </button>
                      </form>
                      <button
                        onClick={() => setBulkOpen(true)}
                        className="rounded-xl border border-[#b8d8f5] bg-[#edf6ff] px-4 py-2.5 text-[11px] font-bold text-[#0b6fc2]"
                      >
                        Пошук набором IDD
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {PRODUCT_SIGNAL_META.map((signal) => {
                        const active = productSignal === signal.id;
                        const count =
                          data?.productAnalysis.signalCounts[signal.id] || 0;
                        return (
                          <button
                            key={signal.id}
                            type="button"
                            title={signal.rule}
                            onClick={() =>
                              setProductSignal(active ? "" : signal.id)
                            }
                            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black transition-colors"
                            style={{
                              color: active ? "#fff" : signal.tone,
                              borderColor: `${signal.tone}55`,
                              background: active
                                ? signal.tone
                                : `${signal.tone}0d`,
                            }}
                          >
                            {signal.label}
                            <span
                              className="rounded-full px-1.5 py-0.5 text-[8px]"
                              style={{
                                color: active ? signal.tone : "#66717c",
                                background: active ? "#fff" : "#fff",
                              }}
                            >
                              {formatNumber(count)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[9px] leading-4 text-[#85909a]">
                      High Impressions використовує мінімум 500 та P75
                      категорії. Низькі CTR/ATC порівнюються з 70% медіани
                      категорії за достатнього sample. Content Score: фото 40% ·
                      атрибути 40% · відгуки 20%. Натисніть на рядок товару, щоб
                      перерахувати верхню аналітику лише для нього; повторний
                      клік поверне всю вибірку.
                    </p>
                  </div>
                  {data &&
                    (!data.productAnalysis.available ||
                      !data.productAnalysis.contentAvailable) && (
                      <div className="border-b border-[#f0d18a] bg-[#fff9e8] px-4 py-2 text-[9px] text-[#7b5b14]">
                        {!data.productAnalysis.available &&
                          "BigQuery недоступний — Impressions, CTR та ATC не підміняються тестовими значеннями. "}
                        {!data.productAnalysis.contentAvailable &&
                          "Не налаштовано перелік обов’язкових атрибутів — Content Score не розраховується."}
                      </div>
                    )}
                  <div className="overflow-hidden">
                    <table className="w-full table-fixed border-collapse text-left">
                      <colgroup>
                        <col className="w-[30%] xl:w-[24%]" />
                        <col className="hidden w-[11%] xl:table-column" />
                        <col className="hidden w-[8%] xl:table-column" />
                        <col className="hidden w-[8%] xl:table-column" />
                        <col className="hidden w-[4%] xl:table-column" />
                        <col className="w-[8%] xl:w-[7%]" />
                        <col className="hidden w-[4%] xl:table-column" />
                        <col className="w-[7%] xl:w-[5%]" />
                        <col className="w-[13%] xl:w-[7%]" />
                        <col className="w-[10%] xl:w-[6%]" />
                        <col className="w-[10%] xl:w-[6%]" />
                        <col className="w-[22%] xl:w-[10%]" />
                      </colgroup>
                      <thead className="bg-[#f7f8f8] text-[9px] font-black uppercase tracking-[.1em] text-[#8d969f]">
                        <tr>
                          <th className="px-2 py-3">Товар</th>
                          <th className="hidden px-2 py-3 xl:table-cell">
                            Категорія
                          </th>
                          <th className="hidden px-2 py-3 xl:table-cell">
                            Бренд
                          </th>
                          <th className="hidden px-2 py-3 xl:table-cell">
                            Артикул
                          </th>
                          <th className="hidden px-1 py-3 text-center xl:table-cell">
                            Фото
                          </th>
                          <th className="px-1 py-3 text-center">Атрибути</th>
                          <th className="hidden px-1 py-3 text-center xl:table-cell">
                            Відгуки
                          </th>
                          <th className="px-1 py-3 text-center">Залишок</th>
                          <th className="px-2 py-3 text-center">Impressions</th>
                          <th className="px-2 py-3 text-center">CTR</th>
                          <th className="px-2 py-3 text-center">ATC</th>
                          <th className="px-2 py-3 text-center">
                            Content Score
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {loading && !data && (
                          <tr>
                            <td
                              colSpan={12}
                              className="p-12 text-center text-xs text-[#82909d]"
                            >
                              Завантаження товарної аналітики…
                            </td>
                          </tr>
                        )}
                        {(data?.rows || []).map((row) => {
                          const score = row.contentScore;
                          const scoreTone =
                            score == null || row.categoryMedianContent == null
                              ? "#596571"
                              : score < row.categoryMedianContent
                                ? "#bd3b3b"
                                : "#087a55";
                          const ctrTone =
                            row.ctr == null || row.categoryMedianCtr == null
                              ? "#596571"
                              : row.ctr < row.categoryMedianCtr
                                ? "#bd3b3b"
                                : "#087a55";
                          const atcTone =
                            row.atc == null || row.categoryMedianAtc == null
                              ? "#596571"
                              : row.atc < row.categoryMedianAtc
                                ? "#bd3b3b"
                                : "#087a55";
                          const selected =
                            bulkIds.length === 1 && bulkIds[0] === row.code;
                          const processed = processedByCode.get(row.code);
                          return (
                            <tr
                              key={row.id}
                              onClick={() => selectProductRow(row)}
                              className={`cursor-pointer border-t border-[#edf0f2] transition-colors ${
                                processed
                                  ? "bg-[#eaf8f0] hover:bg-[#e2f5eb]"
                                  : selected
                                    ? "bg-[#edf6ff]"
                                    : "hover:bg-[#f8fbfd]"
                              }`}
                              title={
                                processed
                                  ? `Оброблено: ${processed.manager}`
                                  : "Натисніть, щоб вибрати товар; повторний клік поверне всю вибірку"
                              }
                            >
                              <td className="min-w-0 px-2 py-3">
                                <div className="flex min-w-0 items-start gap-2">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void openProduct(row);
                                    }}
                                    title={row.name}
                                    className="block min-w-0 flex-1 truncate text-left text-[10px] font-bold leading-5 text-[#34404c] hover:text-[#118dff] hover:underline"
                                  >
                                    {row.name}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setReviewSaveError("");
                                      setProcessingProduct(row);
                                    }}
                                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#23a875] text-[11px] font-black text-white shadow-sm transition hover:scale-105 hover:bg-[#16885d]"
                                    title={
                                      processed
                                        ? "Переглянути або змінити обробку"
                                        : "Взяти товар в обробку"
                                    }
                                  >
                                    {processed ? "✓" : "+"}
                                  </button>
                                </div>
                                {compactIdCell(row)}
                              </td>
                              <td className="hidden min-w-0 px-2 py-3 text-[9px] font-bold text-[#45515d] xl:table-cell">
                                <span
                                  className="block truncate"
                                  title={row.categoryName || "Без категорії"}
                                >
                                  {row.categoryName || "Без категорії"}
                                </span>
                              </td>
                              <td className="hidden min-w-0 px-2 py-3 text-[9px] text-[#65717c] xl:table-cell">
                                <span
                                  className="block truncate"
                                  title={row.brand || "Без бренду"}
                                >
                                  {row.brand || "Без бренду"}
                                </span>
                              </td>
                              <td className="hidden min-w-0 overflow-hidden px-2 py-3 xl:table-cell">
                                {skuCell(row)}
                              </td>
                              <td className="hidden px-1 py-3 text-center text-[10px] font-black text-[#596571] xl:table-cell">
                                {row.imagesCount}
                              </td>
                              <td className="px-1 py-3 text-center">
                                <button
                                  type="button"
                                  disabled={
                                    !row.requiredAttrsConfigured ||
                                    !row.missingRequiredAttrsCount
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setAttributesProduct(row);
                                  }}
                                  className="w-full rounded-lg px-1 py-1 text-[9px] font-black disabled:cursor-default"
                                  style={{
                                    color: !row.requiredAttrsConfigured
                                      ? "#7d8791"
                                      : row.missingRequiredAttrsCount
                                        ? "#bd3b3b"
                                        : "#087a55",
                                    background: !row.requiredAttrsConfigured
                                      ? "#f0f2f4"
                                      : row.missingRequiredAttrsCount
                                        ? "#fff0f0"
                                        : "#eaf7f1",
                                  }}
                                  title={
                                    !row.requiredAttrsConfigured
                                      ? "Обов’язкові атрибути для категорії не налаштовані"
                                      : row.missingRequiredAttrsCount
                                        ? "Показати незаповнені атрибути"
                                        : "Усі обов’язкові атрибути заповнені"
                                  }
                                >
                                  {row.requiredAttrsConfigured
                                    ? row.missingRequiredAttrsCount
                                    : "—"}
                                </button>
                              </td>
                              <td className="hidden px-1 py-3 text-center text-[10px] font-black text-[#596571] xl:table-cell">
                                {row.reviewsCount}
                              </td>
                              <td
                                className="px-1 py-3 text-center text-[10px] font-black"
                                style={{
                                  color:
                                    (row.stockQty ?? 0) === 0
                                      ? "#bd3b3b"
                                      : "#596571",
                                }}
                              >
                                {row.stockQty ?? "—"}
                              </td>
                              <td className="px-2 py-3 text-center text-[10px] font-black tabular-nums text-[#34404c]">
                                {formatNumber(row.impressions || 0)}
                              </td>
                              <td className="px-2 py-3 text-center">
                                <div
                                  className="text-[10px] font-black tabular-nums"
                                  style={{ color: ctrTone }}
                                >
                                  {formatCtr(row.ctr ?? null)}
                                </div>
                                <div
                                  className="mt-0.5 text-[7px] leading-3 text-[#929ca5] xl:whitespace-nowrap xl:text-[8px]"
                                  title={`Бенчмарк категорії: ${formatCtr(row.categoryMedianCtr ?? null)}`}
                                >
                                  <span className="hidden xl:inline">
                                    кат.{" "}
                                  </span>
                                  {formatCtr(row.categoryMedianCtr ?? null)}
                                </div>
                              </td>
                              <td className="px-2 py-3 text-center">
                                <div
                                  className="text-[10px] font-black tabular-nums"
                                  style={{ color: atcTone }}
                                >
                                  {formatCtr(row.atc ?? null)}
                                </div>
                                <div
                                  className="mt-0.5 text-[7px] leading-3 text-[#929ca5] xl:whitespace-nowrap xl:text-[8px]"
                                  title={`Бенчмарк категорії: ${formatCtr(row.categoryMedianAtc ?? null)}`}
                                >
                                  <span className="hidden xl:inline">
                                    кат.{" "}
                                  </span>
                                  {formatCtr(row.categoryMedianAtc ?? null)}
                                </div>
                              </td>
                              <td className="px-2 py-3 text-center">
                                <div
                                  className="flex items-center justify-center gap-2"
                                  title={`Фото: ${(row.photoScore || 0).toFixed(0)} · Атрибути: ${row.attributeScore == null ? "не налаштовано" : row.attributeScore.toFixed(0)} · Відгуки: ${(row.reviewScore || 0).toFixed(0)}`}
                                >
                                  <b
                                    className="min-w-9 text-[11px] font-black"
                                    style={{ color: scoreTone }}
                                  >
                                    {score == null ? "—" : score.toFixed(1)}
                                  </b>
                                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e9edf0]">
                                    <span
                                      className="block h-full rounded-full"
                                      style={{
                                        width: `${Math.min(100, score || 0)}%`,
                                        background: scoreTone,
                                      }}
                                    />
                                  </span>
                                </div>
                                <div className="mt-1 text-[7px] leading-3 text-[#929ca5] xl:text-[8px]">
                                  <span className="hidden xl:inline">
                                    Бенчмарк категорії:{" "}
                                  </span>
                                  {row.categoryMedianContent == null
                                    ? "—"
                                    : row.categoryMedianContent.toFixed(1)}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {!loading && data?.rows.length === 0 && (
                          <tr>
                            <td
                              colSpan={12}
                              className="p-12 text-center text-xs text-[#82909d]"
                            >
                              Товарів за вибраним сценарієм не знайдено
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {pager}
                </div>
              </section>
            ) : view === "search" ? (
              <SearchAnalyticsPanel onOpenProduct={(product) => void openProduct(product)} />
            ) : view === "results" ? (
              <section className="space-y-4">
                <div className="grid gap-2 rounded-2xl border border-[#dfe4ea] bg-white p-2 md:grid-cols-3">
                  {(
                    [
                      ["new-products", "Аналіз нових товарів"],
                      ["merchandising", "Аналіз мерчандайзингу товарів"],
                      ["search", "Аналіз пошукової системи"],
                    ] as Array<[ResultMode, string]>
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setResultMode(mode)}
                      className="rounded-xl px-3 py-3 text-[10px] font-black transition"
                      style={
                        resultMode === mode
                          ? { background: "#118dff", color: "white" }
                          : { background: "#f5f7f9", color: "#68737e" }
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {resultMode === "new-products" && (
                  <NewProductsAnalysisPanel
                    assignments={newAssignments}
                    loading={newAssignmentsLoading}
                    error={newAssignmentsError}
                    onRefresh={loadNewAssignments}
                    onOpenProduct={(product) => void openProduct(product)}
                  />
                )}
                {resultMode === "search" && (
                  <SearchControlPanel onOpenProduct={(product) => void openProduct(product)} />
                )}
                <div
                  className={`${resultMode === "merchandising" ? "" : "hidden"} overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white`}
                >
                  <div className="border-b border-[#e8edf1] bg-[#fbfcfd] p-4">
                    <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-[.14em] text-[#23a875]">
                          Серверний журнал
                        </div>
                        <h2 className="mt-1 text-sm font-black text-[#27313c]">
                          Оброблені товари та результат змін
                        </h2>
                        <p className="mt-1 text-[10px] text-[#7d8892]">
                          Фільтр місяця враховує дату внесення змін. Контрольний
                          замір виконується автоматично після одного повного
                          календарного місяця.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadInterventions()}
                        disabled={reviewsLoading}
                        className="self-start rounded-xl border border-[#bcd8f1] bg-[#edf6ff] px-3 py-2 text-[10px] font-black text-[#0b6fc2] disabled:opacity-50"
                      >
                        {reviewsLoading ? "Оновлюємо…" : "Оновити журнал"}
                      </button>
                    </div>
                    {reviewsError && (
                      <div className="mb-3 rounded-xl border border-[#f0b6b6] bg-[#fff1f1] px-3 py-2.5 text-[10px] font-bold text-[#b73535]">
                        Не вдалося завантажити журнал: {reviewsError}
                      </div>
                    )}
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(240px,1.4fr)_repeat(4,minmax(150px,1fr))_auto]">
                      <input
                        value={resultSearch}
                        onChange={(event) =>
                          setResultSearch(event.target.value)
                        }
                        placeholder="Пошук за товаром, IDD або goods_ref"
                        className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[11px] outline-none focus:border-[#118dff]"
                      />
                      <select
                        value={resultCategory}
                        onChange={(event) =>
                          setResultCategory(event.target.value)
                        }
                        className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[11px] font-semibold text-[#596571] outline-none focus:border-[#118dff]"
                      >
                        <option value="">Усі категорії</option>
                        {resultCategories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                      <select
                        value={resultBrand}
                        onChange={(event) => setResultBrand(event.target.value)}
                        className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[11px] font-semibold text-[#596571] outline-none focus:border-[#118dff]"
                      >
                        <option value="">Усі бренди</option>
                        {resultBrands.map((brand) => (
                          <option key={brand} value={brand}>
                            {brand}
                          </option>
                        ))}
                      </select>
                      <select
                        value={resultManager}
                        onChange={(event) =>
                          setResultManager(
                            event.target.value as ContentManager | "",
                          )
                        }
                        className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[11px] font-semibold text-[#596571] outline-none focus:border-[#118dff]"
                      >
                        <option value="">Усі менеджери</option>
                        {CONTENT_MANAGERS.map((manager) => (
                          <option key={manager} value={manager}>
                            {manager}
                          </option>
                        ))}
                      </select>
                      <select
                        value={resultMonth}
                        onChange={(event) => setResultMonth(event.target.value)}
                        className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[11px] font-semibold text-[#596571] outline-none focus:border-[#118dff]"
                      >
                        <option value="">Усі місяці змін</option>
                        {resultMonths.map((month) => (
                          <option key={month} value={month}>
                            {formatMonth(month)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          setResultSearch("");
                          setResultCategory("");
                          setResultBrand("");
                          setResultManager("");
                          setResultMonth("");
                        }}
                        className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[10px] font-black text-[#68737e] hover:bg-[#f4f7f9]"
                      >
                        Скинути
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  className={`${resultMode === "merchandising" ? "" : "hidden"} grid min-w-0 gap-4 min-[1800px]:grid-cols-[minmax(0,1fr)_300px]`}
                >
                  <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
                    {[
                      {
                        label: "Оброблено",
                        value: filteredInterventions.length,
                        note: "за вибраними фільтрами",
                        color: "#118dff",
                      },
                      {
                        label: "Перевірено",
                        value: resultCheckedTotal,
                        note: "є показники після змін",
                        color: "#6556d8",
                      },
                      {
                        label: "Є зростання",
                        value:
                          resultOutcomeItems.find(
                            (item) => item.key === "growth",
                          )?.count || 0,
                        note: "позитивний результат",
                        color: "#23a875",
                      },
                      {
                        label: "Очікують заміру",
                        value: resultWaitingTotal,
                        note: "контрольна дата попереду",
                        color: "#d58a16",
                      },
                    ].map((item) => (
                      <article
                        key={item.label}
                        className="rounded-2xl border border-[#dfe4ea] bg-white p-4 shadow-[0_4px_16px_rgba(31,42,55,0.04)]"
                      >
                        <div className="text-[9px] font-black uppercase tracking-[.12em] text-[#8a949e]">
                          {item.label}
                        </div>
                        <div
                          className="mt-2 text-3xl font-black tabular-nums"
                          style={{ color: item.color }}
                        >
                          {formatNumber(item.value)}
                        </div>
                        <div className="mt-1 text-[9px] text-[#8b949e]">
                          {item.note}
                        </div>
                      </article>
                    ))}
                  </div>

                  <aside className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white min-[1800px]:row-span-2">
                    <header className="border-b border-[#e5e8eb] px-4 py-3">
                      <h3 className="text-xs font-black text-[#26313d]">
                        Результат після змін
                      </h3>
                      <p className="mt-0.5 text-[9px] text-[#8b949e]">
                        Розподіл уже перевірених товарів
                      </p>
                    </header>
                    <div className="p-4">
                      <DonutChart
                        items={resultOutcomeItems}
                        colors={["#23a875", "#9aa4ae", "#e05c68"]}
                        total={resultCheckedTotal}
                        activeKey={null}
                        onSelect={() => {}}
                      />
                      <div className="mt-3 space-y-2">
                        {resultOutcomeItems.map((item, index) => (
                          <div
                            key={item.key}
                            className="flex items-center justify-between rounded-lg bg-[#f7f9fb] px-3 py-2 text-[10px]"
                          >
                            <span className="flex items-center gap-2 font-semibold text-[#596571]">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{
                                  background: ["#23a875", "#9aa4ae", "#e05c68"][
                                    index
                                  ],
                                }}
                              />
                              {item.name}
                            </span>
                            <b className="tabular-nums text-[#27313c]">
                              {formatNumber(item.count)}
                            </b>
                          </div>
                        ))}
                      </div>
                      <div className="mt-5 border-t border-[#edf0f2] pt-4">
                        <div className="mb-2 text-[9px] font-black uppercase tracking-[.12em] text-[#8a949e]">
                          Менеджери
                        </div>
                        <table className="w-full text-[10px]">
                          <tbody>
                            {resultManagerCounts.map((item) => (
                              <tr
                                key={item.manager}
                                className="border-t border-[#edf0f2] first:border-0"
                              >
                                <td className="py-2 font-semibold text-[#596571]">
                                  {item.manager}
                                </td>
                                <td className="py-2 text-right font-black tabular-nums text-[#27313c]">
                                  {formatNumber(item.count)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </aside>

                  <div className="min-w-0 overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
                    <div className="overflow-x-auto overscroll-x-contain">
                      <table className="w-full min-w-[1100px] border-collapse text-left">
                        <thead>
                          <tr className="border-b border-[#e3e7eb] bg-[#f7f9fb] text-[8px] font-black uppercase tracking-[.08em] text-[#77828d]">
                            <th className="px-3 py-3">Товар</th>
                            <th className="px-3 py-3">Менеджер / дії</th>
                            <th className="px-3 py-3">До змін</th>
                            <th className="px-3 py-3">Після змін</th>
                            <th className="px-3 py-3">Дата зміни</th>
                            <th className="px-3 py-3">Дата перевірки</th>
                            <th className="px-3 py-3">Результат</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reviewsLoading && (
                            <tr>
                              <td
                                colSpan={7}
                                className="p-12 text-center text-xs font-semibold text-[#82909d]"
                              >
                                Завантажуємо журнал обробок…
                              </td>
                            </tr>
                          )}
                          {filteredInterventions.map((item) => {
                            const outcome = reviewOutcome(item);
                            const outcomeMeta = REVIEW_OUTCOME_META[outcome];
                            return (
                              <tr
                                key={item.id}
                                className="border-b border-[#edf0f2] align-top last:border-0 hover:bg-[#fbfcfd]"
                              >
                                <td className="min-w-[230px] px-3 py-3">
                                  <button
                                    type="button"
                                    onClick={() => void openProduct({ productId: item.productId, code: item.code, goodsRef: item.goodsRef, name: item.name })}
                                    className="text-left text-[10px] font-black leading-4 text-[#27313c] hover:text-[#118dff] hover:underline"
                                  >
                                    {item.name}
                                  </button>
                                  <div className="mt-1 text-[8px] text-[#8b949e]">
                                    {item.categoryName} · {item.brand}
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void copy(
                                          item.code,
                                          `result-code:${item.id}`,
                                        )
                                      }
                                      className="text-[9px] font-black tabular-nums text-[#596571] hover:text-[#118dff]"
                                      title="Скопіювати IDD"
                                    >
                                      IDD: {item.code}{" "}
                                      {copied === `result-code:${item.id}` && (
                                        <span className="text-[#087a55]">
                                          ✓
                                        </span>
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void copy(
                                          item.goodsRef,
                                          `result-ref:${item.id}`,
                                        )
                                      }
                                      className="text-[9px] font-semibold tabular-nums text-[#89929b] hover:text-[#118dff]"
                                      title="Скопіювати goods_ref"
                                    >
                                      goods_ref: {item.goodsRef}{" "}
                                      {copied === `result-ref:${item.id}` && (
                                        <span className="text-[#087a55]">
                                          ✓
                                        </span>
                                      )}
                                    </button>
                                  </div>
                                </td>
                                <td className="min-w-[220px] px-3 py-3">
                                  <div className="text-[10px] font-black text-[#34404c]">
                                    {item.manager}
                                  </div>
                                  <div className="mt-1.5 flex max-w-[220px] flex-wrap gap-1">
                                    {item.actions.map((action) => (
                                      <span
                                        key={action}
                                        className="rounded-full bg-[#eef4f7] px-2 py-1 text-[7px] font-bold text-[#64717d]"
                                      >
                                        {action}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-3 py-3">
                                  <ReviewMetricsCard metrics={item.before} />
                                </td>
                                <td className="px-3 py-3">
                                  {item.after ? (
                                    <ReviewMetricsCard
                                      metrics={item.after}
                                      before={item.before}
                                    />
                                  ) : (
                                    <div className="flex min-h-[92px] min-w-[250px] items-center justify-center rounded-xl border border-dashed border-[#efc778] bg-[#fff9ec] px-4 text-center text-[9px] font-bold leading-4 text-[#a36b0e]">
                                      Автоматичний замір ще не виконано
                                    </div>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-[10px] font-semibold text-[#596571]">
                                  {formatDate(item.changedAt)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-3">
                                  <div className="text-[10px] font-black text-[#34404c]">
                                    {formatDate(item.checkAt)}
                                  </div>
                                  <div className="mt-1 text-[8px] text-[#8b949e]">
                                    1-й день після повного місяця
                                  </div>
                                </td>
                                <td className="min-w-[130px] px-3 py-3">
                                  <span
                                    className="inline-flex rounded-full px-2.5 py-1 text-[9px] font-black"
                                    style={{
                                      color: outcomeMeta.color,
                                      background: outcomeMeta.background,
                                    }}
                                  >
                                    {outcomeMeta.label}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                          {!reviewsLoading &&
                            !reviewsError &&
                            filteredInterventions.length === 0 && (
                              <tr>
                                <td
                                  colSpan={7}
                                  className="p-12 text-center text-xs text-[#82909d]"
                                >
                                  {interventions.length
                                    ? "Товарів за вибраними фільтрами не знайдено"
                                    : "Оброблених товарів поки немає"}
                                </td>
                              </tr>
                            )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>
            ) : view === "categories" ? (
              <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
                {filterBar(true)}
                <div className="grid gap-3 border-b border-[#e8edf1] bg-[#f8fafb] p-4 xl:grid-cols-2">
                  <article className="rounded-2xl border border-[#dfe6ec] bg-white p-4 shadow-[0_4px_16px_rgba(31,42,55,0.04)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-[.14em] text-[#118dff]">
                          Поточна динаміка
                        </div>
                        <h2 className="mt-1 text-sm font-black text-[#27313c]">
                          CTR за останні 3 повні місяці
                        </h2>
                        <p className="mt-1 text-[10px] text-[#7d8892]">
                          CTR PDP: каталог → картка · CTR ATC: картка → кошик
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-xl bg-[#edf6ff] px-2.5 py-2 text-[10px] font-black text-[#118dff]">
                          3 міс.
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 overflow-x-auto pb-1">
                      <div className="grid min-w-[390px] grid-cols-3 gap-1.5">
                        {(data?.categoryCtrSummary.currentThree || []).map(
                          (point) => (
                            <div
                              key={point.month}
                              className="min-w-0 rounded-xl border border-[#e5ebf0] bg-[#fbfcfd] p-2.5"
                            >
                              <div className="text-[9px] font-black uppercase tracking-[.1em] text-[#8b96a0]">
                                {formatMonth(point.month)}
                              </div>
                              <div className="mt-2 flex items-baseline gap-1.5 whitespace-nowrap">
                                <span className="text-[9px] font-bold text-[#697580]">
                                  CTR PDP
                                </span>
                                <b className="text-sm font-black text-[#118dff]">
                                  {formatCtr(point.pdpCtr)}
                                </b>
                              </div>
                              <div className="mt-1.5 flex items-baseline gap-1.5 whitespace-nowrap border-t border-[#edf0f3] pt-1.5">
                                <span className="text-[9px] font-bold text-[#697580]">
                                  CTR ATC
                                </span>
                                <b className="text-sm font-black text-[#6556d8]">
                                  {formatCtr(point.atcCtr)}
                                </b>
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  </article>

                  <article className="rounded-2xl border border-[#dfe6ec] bg-white p-4 shadow-[0_4px_16px_rgba(31,42,55,0.04)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-[.14em] text-[#6556d8]">
                          Рік до року
                        </div>
                        <h2 className="mt-1 text-sm font-black text-[#27313c]">
                          CTR за аналогічний період торік
                        </h2>
                        <p className="mt-1 text-[10px] text-[#7d8892]">
                          3 попередні місяці + поточний місяць минулого року ·{" "}
                          {activeFilterLabel || "усі товари"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-xl bg-[#f1efff] px-2.5 py-2 text-[10px] font-black text-[#6556d8]">
                          YoY
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 overflow-x-auto pb-1">
                      <div className="grid min-w-[520px] grid-cols-4 gap-1.5">
                        {(data?.categoryCtrSummary.lastYear || []).map(
                          (point) => (
                            <div
                              key={point.month}
                              className="min-w-0 rounded-xl border border-[#e5ebf0] bg-[#fbfcfd] p-2.5"
                            >
                              <div className="text-[9px] font-black uppercase tracking-[.1em] text-[#8b96a0]">
                                {formatMonth(point.month)}
                              </div>
                              <div className="mt-2 flex items-baseline gap-1.5 whitespace-nowrap">
                                <span className="text-[9px] font-bold text-[#697580]">
                                  CTR PDP
                                </span>
                                <b className="text-sm font-black text-[#118dff]">
                                  {formatCtr(point.pdpCtr)}
                                </b>
                              </div>
                              <div className="mt-1.5 flex items-baseline gap-1.5 whitespace-nowrap border-t border-[#edf0f3] pt-1.5">
                                <span className="text-[9px] font-bold text-[#697580]">
                                  CTR ATC
                                </span>
                                <b className="text-sm font-black text-[#6556d8]">
                                  {formatCtr(point.atcCtr)}
                                </b>
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  </article>
                </div>
                <div className="border-b border-[#e8edf1] bg-white p-4">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-[.16em] text-[#e07a16]">
                        Category forecast
                      </div>
                      <h2 className="mt-1 text-base font-black text-[#27313c]">
                        Трендові категорії на{" "}
                        {formatMonth(
                          data?.categoryTrendForecast?.forecastMonth || "",
                        )}
                      </h2>
                      <p className="mt-1 max-w-3xl text-[10px] leading-4 text-[#7d8892]">
                        Trend Score: сезонність 50% · динаміка impressions 30% ·
                        динаміка ATC 20%. Сезонність — медіана зростання до
                        прогнозного місяця за доступні роки.
                      </p>
                    </div>
                    <span className="w-fit rounded-xl border border-[#f2d2a9] bg-[#fff8ec] px-3 py-2 text-[9px] font-black text-[#a65c0c]">
                      Прогноз, не гарантія попиту
                    </span>
                  </div>

                  {trendLeader && trendLeaderMeta ? (
                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,.8fr)]">
                      <article className="overflow-hidden rounded-2xl border border-[#efcfaa] bg-gradient-to-br from-[#fff9ee] to-white p-4 shadow-[0_6px_20px_rgba(166,92,12,.08)]">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                          <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-full border-[7px] border-[#f2a444] bg-white shadow-sm">
                            <strong className="text-3xl font-black leading-none text-[#9a550b]">
                              {trendLeader.score}
                            </strong>
                            <span className="mt-1 text-[8px] font-black uppercase tracking-[.12em] text-[#9b7b59]">
                              зі 100
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <span
                              className="inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[.08em]"
                              style={{
                                color: trendLeaderMeta.color,
                                background: trendLeaderMeta.background,
                              }}
                            >
                              🔥 {trendLeaderMeta.label}
                            </span>
                            <h3 className="mt-2 text-xl font-black leading-tight text-[#27313c]">
                              {trendLeader.categoryName}
                            </h3>
                            <p className="mt-1 text-[10px] text-[#77828d]">
                              Найсильніший сукупний сигнал серед категорій ·
                              історія за {formatYears(trendLeader.historyYears)}
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                toggleCategoryFilter(trendLeader.categoryId)
                              }
                              className="mt-3 rounded-lg border border-[#efc58d] bg-white px-3 py-2 text-[9px] font-black text-[#9a550b] hover:bg-[#fff7e8]"
                            >
                              {categoryId === String(trendLeader.categoryId)
                                ? "Показати всі категорії ←"
                                : "Показати категорію →"}
                            </button>
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          {[
                            {
                              label: "Історична сезонність",
                              value: formatGrowth(trendLeader.seasonalityPct),
                              note: formatYears(trendLeader.historyYears),
                            },
                            {
                              label: "Свіжий тренд трафіку",
                              value: formatGrowth(trendLeader.recentTrafficPct),
                              note: "останній повний місяць",
                            },
                            {
                              label: "Свіжий тренд ATC",
                              value: formatGrowth(trendLeader.recentAtcPct),
                              note: "проксі комерційного попиту",
                            },
                          ].map((signal) => (
                            <div
                              key={signal.label}
                              className="rounded-xl border border-[#eee3d4] bg-white/85 p-3"
                            >
                              <div className="text-[8px] font-black uppercase tracking-[.1em] text-[#8b7d6d]">
                                {signal.label}
                              </div>
                              <div className="mt-1 text-lg font-black text-[#34404c]">
                                {signal.value}
                              </div>
                              <div className="mt-0.5 text-[8px] text-[#9b8e80]">
                                {signal.note}
                              </div>
                            </div>
                          ))}
                        </div>
                      </article>

                      <article className="rounded-2xl border border-[#dfe6ec] bg-[#fbfcfd] p-3">
                        <div className="mb-2 flex items-center justify-between gap-2 px-1">
                          <h3 className="text-[10px] font-black uppercase tracking-[.12em] text-[#687480]">
                            Рейтинг потенціалу
                          </h3>
                          <span className="text-[9px] text-[#929da7]">
                            Top {Math.min(5, trendCandidates.length)}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {trendCandidates
                            .slice(0, 5)
                            .map((candidate, index) => {
                              const meta =
                                TREND_POTENTIAL_META[candidate.potential];
                              return (
                                <button
                                  key={candidate.categoryId}
                                  type="button"
                                  onClick={() =>
                                    toggleCategoryFilter(candidate.categoryId)
                                  }
                                  className="grid w-full grid-cols-[26px_minmax(0,1fr)_54px] items-center gap-2 rounded-xl border border-[#e5eaee] bg-white px-2.5 py-2 text-left transition hover:border-[#efc58d] hover:bg-[#fffaf2]"
                                >
                                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#f0f3f5] text-[9px] font-black text-[#697580]">
                                    {index + 1}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block truncate text-[10px] font-black text-[#34404c]">
                                      {candidate.categoryName}
                                    </span>
                                    <span
                                      className="mt-0.5 block text-[8px] font-bold"
                                      style={{ color: meta.color }}
                                    >
                                      сезонність{" "}
                                      {formatGrowth(candidate.seasonalityPct)} ·
                                      трафік{" "}
                                      {formatGrowth(candidate.recentTrafficPct)}
                                    </span>
                                  </span>
                                  <span className="rounded-lg bg-[#fff3df] px-2 py-1.5 text-center text-sm font-black tabular-nums text-[#9a550b]">
                                    {candidate.score}
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                      </article>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[#e1e6ea] bg-[#f8fafb] px-4 py-5 text-center text-[10px] text-[#7f8a94]">
                      Недостатньо даних для прогнозу: потрібне щонайменше 1
                      сезонне порівняння, починаючи з 2025 року, та 200
                      impressions у базовому місяці.
                    </div>
                  )}
                </div>
                {!data?.categoryCtrAvailable && (
                  <div className="border-b border-[#f0d18a] bg-[#fff9e8] px-4 py-2 text-[9px] text-[#7b5b14]">
                    BigQuery недоступний — CTR PDP та CTR ATC не підміняються
                    тестовими значеннями.
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-left">
                    <thead className="bg-[#f7f8f8] text-[9px] font-black uppercase tracking-[.1em] text-[#8d969f]">
                      <tr>
                        <th className="min-w-56 px-3 py-3">Категорія</th>
                        <th className="px-3 py-3">Товарів</th>
                        <th className="px-3 py-3">З фото</th>
                        <th className="px-3 py-3">
                          З незаповненими атрибутами
                        </th>
                        <th className="px-3 py-3">Доступні до продажу</th>
                        <th className="px-3 py-3">Неактивні</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && !data && (
                        <tr>
                          <td
                            colSpan={6}
                            className="p-12 text-center text-xs text-[#82909d]"
                          >
                            Завантаження аналітики…
                          </td>
                        </tr>
                      )}
                      {(data?.categoryAnalysis || []).map((row) => (
                        <tr
                          key={row.categoryId}
                          className={`border-t border-[#edf0f2] align-top hover:bg-[#fbfcfd] ${categoryId === String(row.categoryId) ? "bg-[#eef7ff]" : ""}`}
                        >
                          <td className="px-3 py-3 text-[11px] font-bold text-[#34404c]">
                            <button
                              type="button"
                              onClick={() =>
                                toggleCategoryFilter(row.categoryId)
                              }
                              className="text-left font-bold text-[#34404c] hover:text-[#118dff]"
                              title={
                                categoryId === String(row.categoryId)
                                  ? "Зняти фільтр категорії"
                                  : "Відфільтрувати за категорією"
                              }
                            >
                              {row.categoryName}
                              {categoryId === String(row.categoryId) && (
                                <span className="ml-1.5 text-[#118dff]">×</span>
                              )}
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2 text-xs font-black text-[#26313d]">
                              {formatNumber(row.total)}
                              <Delta value={row.totalDelta} />
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2 text-[11px] font-bold text-[#087a55]">
                              {row.withPhotosPct.toFixed(1)}%
                              <Delta
                                value={row.withPhotosDelta}
                                suffix=" п.п."
                              />
                            </div>
                          </td>
                          <td className="px-3 py-3 text-[11px] font-bold text-[#bd3b3b]">
                            {row.missingAttrsPct == null
                              ? "Не налаштовано"
                              : `${row.missingAttrsPct.toFixed(1)}%`}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2 text-[11px] font-bold text-[#087a55]">
                              {formatNumber(row.available)}
                              <Delta value={row.availableDelta} />
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2 text-[11px] font-bold text-[#bd3b3b]">
                              {formatNumber(row.inactive)}
                              <Delta value={row.inactiveDelta} />
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!loading && data?.categoryAnalysis.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="p-12 text-center text-xs text-[#82909d]"
                          >
                            Категорій за цими фільтрами не знайдено
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : view === "new" ? (
              <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
                {filterBar(false)}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1280px] border-collapse text-left">
                    <thead className="bg-[#f7f8f8] text-[9px] font-black uppercase tracking-[.11em] text-[#8d969f]">
                      <tr>
                        <th className="px-3 py-3">IDD / goods_ref / дія</th>
                        <th className="px-3 py-3">Артикул</th>
                        <th className="min-w-64 px-3 py-3">Назва товару</th>
                        <th className="px-3 py-3">Дата додавання</th>
                        <th className="min-w-48 px-3 py-3">
                          Категорія / бренд
                        </th>
                        <th className="px-3 py-3 text-center">Фото</th>
                        <th className="px-3 py-3 text-center">
                          Незаповнені атрибути
                        </th>
                        <th className="px-3 py-3 text-center">Відгуки</th>
                        <th className="px-3 py-3 text-center">Залишок</th>
                        <th className="min-w-40 px-3 py-3">Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && !data && (
                        <tr>
                          <td
                            colSpan={10}
                            className="p-12 text-center text-xs text-[#82909d]"
                          >
                            Завантаження нових товарів…
                          </td>
                        </tr>
                      )}
                      {(data?.rows || []).map((row) => {
                        const tone = statusTone(row);
                        return (
                          <tr
                            key={row.id}
                            className="border-t border-[#edf0f2] hover:bg-[#fbfcfd]"
                          >
                            <td className="px-3 py-3">
                              <div className="flex items-start gap-2">
                                {idCell(row)}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewAssignmentError("");
                                    setAssigningNewProduct(row);
                                  }}
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#23a875] text-sm font-black text-white shadow-sm transition hover:bg-[#168a5e]"
                                  title="Призначити менеджера"
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-3">{skuCell(row)}</td>
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                onClick={() => void openProduct(row)}
                                className="line-clamp-2 text-left text-[11px] font-semibold leading-4 text-[#26313d] hover:text-[#118dff] hover:underline"
                              >
                                {row.name}
                              </button>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap text-[10px] font-semibold text-[#596571]">
                              {formatDate(row.firstSeenAt)}
                            </td>
                            <td className="px-3 py-3">
                              <div className="text-[10px] font-bold text-[#45515d]">
                                {row.categoryName}
                              </div>
                              <div className="mt-1 text-[9px] text-[#8a949e]">
                                {row.brand || "Без бренду"}
                              </div>
                            </td>
                            <td
                              className="px-3 py-3 text-center text-[11px] font-black"
                              style={{
                                color: row.imagesCount ? "#087a55" : "#bd3b3b",
                              }}
                            >
                              {row.imagesCount}
                            </td>
                            <td
                              className="px-3 py-3 text-center text-[11px] font-black"
                              style={{
                                color: !row.requiredAttrsConfigured
                                  ? "#7d8791"
                                  : row.missingRequiredAttrsCount
                                    ? "#bd3b3b"
                                    : "#087a55",
                              }}
                            >
                              {row.requiredAttrsConfigured
                                ? row.missingRequiredAttrsCount
                                : "—"}
                            </td>
                            <td className="px-3 py-3 text-center text-[11px] font-black text-[#596571]">
                              {row.reviewsCount}
                            </td>
                            <td className="px-3 py-3 text-center text-[11px] font-black text-[#596571]">
                              {row.stockQty ?? "—"}
                            </td>
                            <td className="min-w-40 px-3 py-3">
                              <span
                                className="inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[9px] font-bold"
                                style={tone}
                              >
                                {row.deleted
                                  ? `Архів · ${row.statusName}`
                                  : row.statusName}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {!loading && data?.rows.length === 0 && (
                        <tr>
                          <td
                            colSpan={10}
                            className="p-12 text-center text-xs text-[#82909d]"
                          >
                            Нових непризначених товарів з 01.09.2026 немає або аварійну партію 03.09.2026 тимчасово приховано
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {pager}
              </section>
            ) : (
              <section className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0 overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
                  {filterBar(false)}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[930px] border-collapse text-left">
                      <thead className="bg-[#f7f8f8] text-[9px] font-black uppercase tracking-[.12em] text-[#8d969f]">
                        <tr>
                          <th className="px-3 py-3">IDD / goods_ref</th>
                          <th className="px-3 py-3">Артикул</th>
                          <th className="min-w-72 px-3 py-3">Назва товару</th>
                          <th className="px-3 py-3">Бренд</th>
                          <th className="min-w-40 px-3 py-3">Статус товару</th>
                          <th className="px-3 py-3">Уперше у нас</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loading && !data && (
                          <tr>
                            <td
                              colSpan={6}
                              className="p-12 text-center text-xs text-[#82909d]"
                            >
                              Завантаження каталогу…
                            </td>
                          </tr>
                        )}
                        {!loading && data?.rows.length === 0 && (
                          <tr>
                            <td
                              colSpan={6}
                              className="p-12 text-center text-xs text-[#82909d]"
                            >
                              За цими фільтрами товарів не знайдено
                            </td>
                          </tr>
                        )}
                        {(data?.rows || []).map((row) => {
                          const tone = statusTone(row);
                          return (
                            <tr
                              key={row.id}
                              className="border-t border-[#edf0f2] hover:bg-[#fbfcfd]"
                            >
                              <td className="px-3 py-3">{idCell(row)}</td>
                              <td className="px-3 py-3">{skuCell(row)}</td>
                              <td className="px-3 py-3">
                                <button
                                  onClick={() => void openProduct(row)}
                                  className="line-clamp-2 text-left text-[11px] font-semibold leading-4 text-[#26313d] hover:text-[#118dff]"
                                >
                                  {row.name}
                                </button>
                                <div className="mt-1 text-[9px] text-[#9aa2aa]">
                                  {row.categoryName}
                                </div>
                              </td>
                              <td className="max-w-40 px-3 py-3">
                                <div
                                  className="truncate text-[10px] font-semibold text-[#68737e]"
                                  title={row.brand}
                                >
                                  {row.brand || "Без бренду"}
                                </div>
                              </td>
                              <td className="min-w-40 px-3 py-3">
                                <span
                                  className="inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[9px] font-bold"
                                  style={tone}
                                >
                                  {row.deleted
                                    ? `Архів · ${row.statusName}`
                                    : row.statusName}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-[10px] font-semibold text-[#68737e]">
                                {formatDate(row.firstSeenAt)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {pager}
                </div>
                <aside className="space-y-4">
                  <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
                    <header className="border-b border-[#e5e8eb] px-4 py-3">
                      <h3 className="text-xs font-black text-[#26313d]">
                        Розподіл товарів
                      </h3>
                      <p className="mt-0.5 text-[9px] text-[#8b949e]">
                        Топ 10 за кількістю товарів
                      </p>
                    </header>
                    <div className="grid grid-cols-3 gap-1 border-b border-[#edf0f2] p-2">
                      {(
                        ["categories", "brands", "statuses"] as ChartMode[]
                      ).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setChartMode(mode)}
                          className="rounded-lg px-2 py-1.5 text-[9px] font-black"
                          style={
                            chartMode === mode
                              ? { background: "#118dff", color: "white" }
                              : { background: "#f3f5f7", color: "#68737e" }
                          }
                        >
                          {mode === "categories"
                            ? "Категорії"
                            : mode === "brands"
                              ? "Бренди"
                              : "Статуси"}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-3 p-4">
                      <DonutChart
                        items={chartItems}
                        colors={data?.facets.colors || ["#118dff"]}
                        total={chartTotal}
                        activeKey={chartActiveKey || null}
                        onSelect={selectChartItem}
                      />
                      <div className="mb-1 text-[9px] font-black uppercase tracking-[.12em] text-[#8a949e]">
                        {chartTitle}
                      </div>
                      {chartItems.map((item, index) => {
                        const max = Math.max(1, chartItems[0]?.count || 1);
                        const active = item.key === chartActiveKey;
                        return (
                          <button
                            key={item.key}
                            onClick={() => selectChartItem(item)}
                            className={`block w-full rounded-lg p-1.5 text-left ${active ? "bg-[#edf6ff] ring-1 ring-[#9cccf6]" : "hover:bg-[#f7f9fb]"}`}
                          >
                            <div className="mb-1 flex items-center justify-between gap-3 text-[10px]">
                              <span className="truncate font-semibold text-[#59646f]">
                                {index + 1}. {item.name}
                              </span>
                              <b>{formatNumber(item.count)}</b>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-[#edf0f3]">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.max(3, Math.round((item.count / max) * 100))}%`,
                                  background:
                                    data?.facets.colors[
                                      index % (data.facets.colors.length || 1)
                                    ] || "#118dff",
                                }}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
                    <header className="flex items-start justify-between border-b border-[#e5e8eb] px-4 py-3">
                      <div>
                        <h3 className="text-xs font-black text-[#26313d]">
                          Стан оновлення API
                        </h3>
                        <p className="mt-0.5 text-[9px] text-[#8b949e]">
                          Каталог Agromat
                        </p>
                      </div>
                      <span className="rounded-full bg-[#e7f6ef] px-2 py-1 text-[9px] font-bold text-[#087a55]">
                        {data?.syncState.state === "running"
                          ? "Оновлення"
                          : data?.syncState.state === "error"
                            ? "Помилка"
                            : "Актуально"}
                      </span>
                    </header>
                    <div className="p-4">
                      <div className="mb-2 flex items-center justify-between text-[10px]">
                        <b>Дані синхронізовано</b>
                        <span className="text-[#7d8791]">{syncPct}%</span>
                      </div>
                      <div className="mb-4 h-2 overflow-hidden rounded-full bg-[#e9edf1]">
                        <div
                          className="h-full rounded-full bg-[#118dff]"
                          style={{ width: `${syncPct}%` }}
                        />
                      </div>
                      <div className="rounded-xl bg-[#f7f9fb] p-3 text-[9px] text-[#7d8791]">
                        Остання відповідь:{" "}
                        <b className="text-[#34404c]">
                          {formatDateTime(data?.syncedAt)}
                        </b>
                      </div>
                      <button
                        onClick={() => void load()}
                        disabled={loading}
                        className="mt-3 w-full rounded-lg border border-[#bcd8f1] bg-[#edf6ff] px-3 py-2 text-[10px] font-bold text-[#0b6fc2] disabled:opacity-50"
                      >
                        {loading ? "Оновлення даних…" : "Оновити відображення"}
                      </button>
                    </div>
                  </section>
                </aside>
              </section>
            )}
          </div>
        </main>
      </div>
      {bulkOpen && (
        <BulkSearchModal
          initialIds={bulkIds}
          onClose={() => setBulkOpen(false)}
          onApply={(ids) => {
            setBulkIds(ids);
            setBulkOpen(false);
          }}
        />
      )}
      {productOpenError && (
        <div className="fixed bottom-4 right-4 z-[170] max-w-sm rounded-xl border border-[#efb5b5] bg-[#fff1f1] px-4 py-3 text-[10px] font-bold text-[#bd3b3b] shadow-xl">
          Не вдалося відкрити товар: {productOpenError}
        </div>
      )}
      {selectedProduct && (
        <ProductDetailsModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
        />
      )}
      {attributesProduct && (
        <MissingAttributesModal
          product={attributesProduct}
          onClose={() => setAttributesProduct(null)}
        />
      )}
      {processingProduct && (
        <ProcessProductModal
          product={processingProduct}
          existing={processedByCode.get(processingProduct.code)}
          saving={reviewSaving}
          error={reviewSaveError}
          onClose={() => {
            if (reviewSaving) return;
            setReviewSaveError("");
            setProcessingProduct(null);
          }}
          onSave={(manager, actions) =>
            saveIntervention(processingProduct, manager, actions)
          }
        />
      )}
      {assigningNewProduct && (
        <AssignNewProductModal
          product={assigningNewProduct}
          saving={newAssignmentSaving}
          error={newAssignmentError}
          onClose={() => {
            if (newAssignmentSaving) return;
            setNewAssignmentError("");
            setAssigningNewProduct(null);
          }}
          onAssign={(manager) => assignNewProduct(assigningNewProduct, manager)}
        />
      )}
      {copied && (
        <div className="fixed bottom-5 right-5 z-[120] rounded-xl bg-[#087a55] px-4 py-2.5 text-[10px] font-bold text-white shadow-xl">
          ✓ Скопійовано в буфер обміну
        </div>
      )}
    </div>
  );
}
