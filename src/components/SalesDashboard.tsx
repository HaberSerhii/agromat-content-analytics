"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { SALES_AUTO_REFRESH_MS } from "@/lib/sales-refresh";

type SalesRow = {
  docsRef: string;
  number: string;
  createdDate: string;
  shippedDate: string | null;
  seller: string;
  state: string;
  docsSum: number;
  returnSum: number;
  goodsCount: number;
  goodsCodes: string;
  trademarksNames: string;
  groupRefs: string;
  goodsNames: string;
  margin: number | null;
  stockm: string;
  planGroup: string;
};

type BucketSummary = {
  label: string;
  docs: number;
  goods: number;
  revenue: number;
  avgMargin: number | null;
};

type CategoryProductSummary = {
  code: string;
  name: string;
  url: string;
  brand: string;
  category: string;
  orders: number;
  qty: number;
  revenue: number;
};

type CategoryProductsResponse = {
  category: string;
  items: CategoryProductSummary[];
};

type SalesDataset = {
  source: {
    bucket: string;
    key: string;
    size: number | null;
    lastModified: string | null;
    refreshPolicy: string;
    nextRefreshAt: string | null;
  };
  filter: {
    from: string | null;
    to: string | null;
    label: string;
    productCodes: number[];
    matchedProductCodes: number[];
    statuses: string[];
  };
  rows: SalesRow[];
  summary: {
    totalDocs: number;
    shippedDocs: number;
    shippedGoods: number;
    shippedRevenue: number;
    canceledDocs: number;
    returnedRevenue: number;
    firstShippedDate: string | null;
    lastShippedDate: string | null;
    selected: {
      docs: number;
      goods: number;
      revenue: number;
      returnedRevenue: number;
      canceledDocs: number;
      canceledRevenue: number;
    };
    plan: {
      month: string;
      plan: number | null;
      revenue: number;
      goods: number;
      docs: number;
      completionPct: number | null;
      segments: Array<{
        segment: string;
        plan: number;
        revenue: number;
        goods: number;
        docs: number;
        completionPct: number | null;
      }>;
      previousMonthRevenue: number;
      revenueDeltaPct: number | null;
      forecastRevenue: number | null;
      forecastCompletionPct: number | null;
      elapsedDays: number;
      daysInMonth: number;
    };
    orderInsights: {
      onlineOrders: {
        totalDocs: number;
        webshopDocs: number;
        webshopRevenue: number;
        webshopAverageOrderRevenue: number | null;
        webshopSharePct: number | null;
        marketingDocs: number;
        marketingRevenue: number;
        programs: Array<{ program: string; docs: number; revenue: number }>;
      };
      shippedEconomics: {
        shippedDocs: number;
        ordersWithReturns: number;
        returnRatePct: number | null;
        returnedPositions: number;
        returnedRevenue: number;
        costCoveredDocs: number;
        costCoveragePct: number | null;
        revenueWithCost: number;
        ownCost: number;
        estimatedGrossProfit: number;
        estimatedGrossMarginPct: number | null;
        returnedProducts: Array<{ code: string; name: string; positions: number; revenue: number }>;
      };
    };
    byDate: Array<{ date: string; docs: number; goods: number; revenue: number }>;
    ordersByDate: Array<{
      date: string;
      docs: number;
      managers: Array<{ seller: string; docs: number }>;
    }>;
    months: Array<{ month: string; docs: number; goods: number; revenue: number }>;
    segments: BucketSummary[];
    shippedSegments: BucketSummary[];
    brands: BucketSummary[];
    categories: BucketSummary[];
    categoryProducts: Record<string, CategoryProductSummary[]>;
    states: Array<{ state: string; docs: number; revenue: number }>;
    availableStates: Array<{ state: string; docs: number; revenue: number }>;
    cancelReasons: Array<{ reason: string; docs: number; revenue: number }>;
    documentStatusesBySegment: Array<{
      segment: "Плитка" | "Сантехніка";
      states: Array<{ state: string; docs: number; revenue: number }>;
      cancelReasons: Array<{ reason: string; docs: number; revenue: number }>;
    }>;
    managers: Array<{
      seller: string;
      plan: number | null;
      planSource: "configured" | "equal-share" | "missing";
      planRevenue: number;
      planCompletionPct: number | null;
      forecastRevenue: number | null;
      forecastCompletionPct: number | null;
      orderedDocs: number;
      completedDocs: number;
      completedUnits: number;
      unitsPerCheck: number | null;
      orderCompletionPct: number | null;
      orderedRevenue: number;
      completedRevenue: number;
      revenueCompletionPct: number | null;
      averageOrderRevenue: number | null;
      averageCompletedRevenue: number | null;
      averageRevenueCompletionPct: number | null;
      states: Array<{ state: string; docs: number; revenue: number }>;
      cancelReasons: Array<{ reason: string; docs: number; revenue: number }>;
    }>;
  };
};

type SalesManagerSummary = SalesDataset["summary"]["managers"][number];

type SalesWebMetricsDataset = {
  mode: "live" | "demo";
  notice: string | null;
  filter: { from: string; to: string; country: "Ukraine" };
  definition: { visits: string; addToCart: string; sessionToCart: string };
  dataThrough: string | null;
  months: Array<{
    month: string;
    visits: number;
    addToCartSessions: number;
    addToCartItems: number;
    sessionToCartPct: number;
    avgCartItemsPerSession: number | null;
  }>;
  totals: {
    visits: number;
    addToCartSessions: number;
    addToCartItems: number;
    sessionToCartPct: number;
    avgCartItemsPerSession: number | null;
  };
  conversions: {
    definition: string;
    categories: SalesConversionRow[];
    brands: SalesConversionRow[];
    products: SalesConversionRow[];
  };
};

type SalesConversionRow = {
  key: string;
  label: string;
  addToCartSessions: number;
  addToCartItems: number;
  actualOrders: number;
  conversionPct: number;
  url?: string;
};

type SalesWebshopOrder = {
  id: number;
  order_num: number | string | null;
  order_doc_id: number | string | null;
  is_synced: boolean;
  date: string;
  doc_date: string | null;
  status: string | null;
  http_status: number | null;
  payment: { status: string | null; type: string | null; system_ref: number | null } | null;
  totals: { cost: number; delivery: number; items_sum: number; weight: number; currency: string };
  customer: {
    client_id: number | null;
    first_name: string | null;
    last_name: string | null;
    patronymic: string | null;
    email: string | null;
    phone: string | null;
    callback: boolean;
    legal_name: string | null;
    legal_code: string | null;
    recipient: { first_name: string | null; last_name: string | null; patronymic: string | null; phone: string | null } | null;
  };
  delivery: { type: string | null; address: unknown; city_ref: string | null; department_ref: string | null; date: string | null; to_floor: number | null; elevator: boolean | null } | null;
  comments: string | null;
  source: { utm_source: string | null; utm_campaign: string | null } | null;
  has_items: boolean;
  items: Array<{
    product_id: number | string;
    goods_ref: number | null;
    code: number | string | null;
    sku: string | null;
    name: string;
    url: string | null;
    quantity: number;
    number_pieces: number | null;
    sale_measures_ref: number | null;
    is_set: boolean;
    price: number;
    price_old: number | null;
    line_total: number;
    availability_status: { id: number; name: string } | null;
  }>;
  fulfillment?: { current: { id: number; name: string; stage: number } | null; history: Array<{ id: number; name: string; stage: number; rolled_back: boolean; started_at: string | null; finished_at: string | null }> } | null;
  analytics_status?: string;
  return_info?: { webshopId: string; docsRef: string; number: string; returnSum: number; returnGoodsCodes: string[] } | null;
};

type SalesWebshopOrdersDataset = {
  data: SalesWebshopOrder[];
  meta: { total: number; page: number; per_page: number; total_pages: number; movements_included: boolean };
  summary: {
    basedOn: number;
    partial: boolean;
    total: number;
    revenue: number;
    averageOrder: number;
    deliveryRevenue: number;
    synced: number;
    syncedPct: number;
    onlinePaid: number;
    onlinePaidPct: number;
    paymentTypes: Array<{ key: string; docs: number }>;
    paymentStatuses: Array<{ key: string; docs: number }>;
    deliveryTypes: Array<{ key: string; docs: number }>;
    statuses: Array<{ key: string; docs: number }>;
    statusesTotal?: number;
  };
};

type RankingMetric = "goods" | "revenue";
type DocumentSegment = "Усі" | "Плитка" | "Сантехніка";

type SalesDashboardView = "overview" | "webshop" | "web" | "brands" | "categories" | "department" | "statuses" | "cancellations";
type WebshopSyncFilter = "all" | "synced" | "unsynced";
type WebshopPaymentFilter = "all" | "cash" | "bank" | "online_full" | "online_parts";
type WebshopDeliveryFilter = "all" | "npDepartment" | "npCourier" | "agrWarehouse" | "agrCity" | "agrUkraine";
type SalesWebshopOrderItem = SalesWebshopOrder["items"][number];

const numberFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const compactNumberFmt = new Intl.NumberFormat("uk-UA", { notation: "compact", maximumFractionDigits: 1 });
const pctFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });
const decimalFmt = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_FILTERS = [
  { label: "Повністю відвантажений", value: "Повністю відвантажений" },
  { label: "Скасована", value: "Скасована" },
  { label: "Відвантаження дозволено", value: "відвантаження дозволено" },
  { label: "Сформовано", value: "сформовано" },
] as const;

const SALES_VIEW_ITEMS: Array<{ id: SalesDashboardView; label: string; hint: string }> = [
  { id: "overview", label: "Огляд", hint: "План і динаміка" },
  { id: "webshop", label: "Webshop-замовлення", hint: "Реєстр і склад замовлень" },
  { id: "web", label: "Веб-аналіз продажів", hint: "Користувачі, кошики, замовлення" },
  { id: "brands", label: "Бренди", hint: "Кількість, сума і товари" },
  { id: "categories", label: "Категорії", hint: "Кількість, сума і товари" },
  { id: "department", label: "Відділ продажів", hint: "Плани й менеджери" },
  { id: "statuses", label: "Статуси документів", hint: "Кількість і сума" },
  { id: "cancellations", label: "Причини скасування", hint: "Кількість і сума" },
];

function fmtMoney(value: number) {
  return `${numberFmt.format(value)} грн`;
}

function fmtNum(value: number) {
  return numberFmt.format(value);
}

function fmtCompactMoney(value: number) {
  return `${compactNumberFmt.format(value)} ₴`;
}

function fmtPct(value: number | null) {
  return value == null ? "—" : `${pctFmt.format(value)}%`;
}

function fmtDecimal(value: number | null) {
  return value == null ? "—" : decimalFmt.format(value);
}

function fmtMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  const label = new Intl.DateTimeFormat("uk-UA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fmtIsoDateShort(value: string) {
  const [year, month, day] = value.split("-");
  return day && month && year ? `${day}-${month}-${year}` : value;
}

function fmtStatusLabel(status: string) {
  return STATUS_FILTERS.find((item) => item.value === status)?.label || status;
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-3 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

function CategoryRankingList({
  title,
  itemNoun,
  color,
  items,
  comparisonItems,
  metric,
  onMetricChange,
  productsByCategory,
  expandedCategory,
  loadingCategory,
  categoryError,
  onToggleCategory,
}: {
  title: string;
  itemNoun: string;
  color: string;
  items: BucketSummary[];
  comparisonItems: BucketSummary[];
  metric: RankingMetric;
  onMetricChange: (metric: RankingMetric) => void;
  productsByCategory: Record<string, CategoryProductSummary[]>;
  expandedCategory: string | null;
  loadingCategory: string | null;
  categoryError: string | null;
  onToggleCategory: (category: string) => void;
}) {
  const sortedItems = [...items].sort((left, right) => right[metric] - left[metric]);
  const comparisonByLabel = new Map(comparisonItems.map((item) => [item.label, item]));
  const maxValue = Math.max(1, ...sortedItems.map((item) => item[metric]));
  return (
    <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e8eb] px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-black text-[#26313d]">{title} · {fmtNum(items.length)}</span><span className="rounded-full bg-[#eaf8f1] px-2 py-1 text-[9px] font-black text-[#16865c]">Повністю відвантажено</span></div>
          <div className="mt-1 text-[10px] text-[#8a939c]">Документи створені й повністю відвантажені за обраний період · без доставки · натисніть на {itemNoun}, щоб переглянути товари</div>
        </div>
        <div className="inline-flex rounded-lg border border-[#d8dde3] bg-[#f7f9fb] p-0.5">
          {(["goods", "revenue"] as RankingMetric[]).map((value) => (
            <button key={value} type="button" onClick={() => onMetricChange(value)} className="rounded-md px-3 py-1.5 text-[10px] font-bold" style={{ background: metric === value ? "#118dff" : "transparent", color: metric === value ? "#fff" : "#687582" }}>
              {value === "goods" ? "У штуках" : "У грошах"}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1 p-4">
        {sortedItems.map((item) => {
          const expanded = expandedCategory === item.label;
          const products = [...(productsByCategory[item.label] || [])].sort((left, right) => metric === "goods" ? right.qty - left.qty : right.revenue - left.revenue);
          const comparison = comparisonByLabel.get(item.label);
          const currentValue = item[metric];
          const previousValue = comparison?.[metric] || 0;
          const delta = previousValue > 0 ? ((currentValue - previousValue) / previousValue) * 100 : null;
          return (
            <div key={item.label} className="border-t first:border-t-0 pt-2 first:pt-0" style={{ borderColor: "var(--border)" }}>
              <div className="grid gap-2 md:grid-cols-[minmax(150px,220px)_1fr_230px] md:items-center">
                <button
                  type="button"
                  onClick={() => onToggleCategory(item.label)}
                  className="text-left text-xs font-semibold truncate border-0 bg-transparent p-0"
                  style={{ color: "var(--text)" }}
                  title={item.label}
                >
                  <span className="inline-block w-4" aria-hidden="true">{expanded ? "−" : "+"}</span>
                  {item.label}
                </button>
                <ProgressBar value={(currentValue / maxValue) * 100} color={color} />
                <div className="text-xs md:text-right">
                  <b className="text-[#33404c]">{metric === "goods" ? `${fmtNum(currentValue)} шт` : fmtMoney(currentValue)}</b>
                  <div className="mt-0.5 text-[9px] text-[#8a939c]">Рік тому: {metric === "goods" ? `${fmtNum(previousValue)} шт` : fmtMoney(previousValue)} · <span style={{ color: delta == null ? "#8a939c" : delta >= 0 ? "#16865c" : "#d14b4b" }}>{fmtPct(delta)}</span></div>
                </div>
              </div>
              {expanded && (
                <div className="mt-3 overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
                  <table className="w-full text-[11px] border-collapse">
                    <thead style={{ background: "var(--bg-input)", color: "var(--text-dim)" }}>
                      <tr>
                        <th className="text-left px-2 py-2 w-8">#</th>
                        <th className="text-left px-2 py-2 min-w-[220px]">Товар</th>
                        <th className="text-left px-2 py-2 min-w-[100px]">URL</th>
                        <th className="text-left px-2 py-2 min-w-[120px]">Бренд</th>
                        <th className="text-right px-2 py-2 min-w-[110px]">Сума</th>
                        <th className="text-right px-2 py-2 min-w-[110px]">К-ть замовлень</th>
                        <th className="text-right px-2 py-2 min-w-[90px]">К-ть товарів</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingCategory === item.label && (
                        <tr>
                          <td className="px-2 py-5 text-center" colSpan={7} style={{ color: "var(--text-dim)" }}>Завантаження товарів…</td>
                        </tr>
                      )}
                      {loadingCategory !== item.label && products.map((product, index) => (
                        <tr key={`${product.code}-${product.name}-${index}`} className="border-t" style={{ borderColor: "var(--border)" }}>
                          <td className="px-2 py-2 tabular-nums" style={{ color: "var(--text-dim)" }}>{index + 1}</td>
                          <td className="px-2 py-2 font-semibold" style={{ color: "var(--text)" }}>
                            <div className="max-w-[340px] truncate" title={product.name}>{product.name}</div>
                            {product.code && <div className="text-[10px] tabular-nums" style={{ color: "var(--text-dim)" }}>IDD {product.code}</div>}
                          </td>
                          <td className="px-2 py-2">
                            {product.url ? (
                              <a href={product.url} target="_blank" rel="noreferrer" className="font-semibold" style={{ color: "#118dff" }}>Відкрити</a>
                            ) : (
                              <span style={{ color: "var(--text-dim)" }}>—</span>
                            )}
                          </td>
                          <td className="px-2 py-2" style={{ color: "var(--text-dim)" }}>{product.brand}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-bold" style={{ color: "var(--text)" }}>{fmtMoney(product.revenue)}</td>
                          <td className="px-2 py-2 text-right tabular-nums" style={{ color: "var(--text-dim)" }}>{fmtNum(product.orders)}</td>
                          <td className="px-2 py-2 text-right tabular-nums" style={{ color: "var(--text-dim)" }}>{fmtNum(product.qty)}</td>
                        </tr>
                      ))}
                      {loadingCategory !== item.label && categoryError && (
                        <tr>
                          <td className="px-2 py-5 text-center" colSpan={7} style={{ color: "#b91c1c" }}>{categoryError}</td>
                        </tr>
                      )}
                      {loadingCategory !== item.label && !categoryError && !products.length && (
                        <tr>
                          <td className="px-2 py-5 text-center" colSpan={7} style={{ color: "var(--text-dim)" }}>Немає товарів під обрані фільтри</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {!items.length && (
          <div className="p-3 text-xs" style={{ color: "var(--text-dim)" }}>Немає даних під обрані фільтри</div>
        )}
      </div>
    </section>
  );
}

function ManagerPlanOverview({
  managers,
  month,
  selectedSeller,
  onSelectSeller,
}: {
  managers: SalesManagerSummary[];
  month: string;
  selectedSeller: string | null;
  onSelectSeller: (seller: string | null) => void;
}) {
  const visibleManagers = selectedSeller
    ? managers.filter((manager) => manager.seller === selectedSeller)
    : managers;
  const missingPlanManagers = managers.filter((manager) => manager.planSource === "missing");

  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-base font-black" style={{ color: "var(--text)" }}>Виконання плану по менеджерах</div>
            <div className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>Оберіть менеджера — таблиця та статуси нижче відфільтруються автоматично.</div>
          </div>
          <button
            type="button"
            onClick={() => onSelectSeller(null)}
            className="h-8 rounded-lg border px-3 text-xs font-bold"
            style={{ borderColor: selectedSeller ? "var(--border)" : "#118dff", background: selectedSeller ? "var(--bg-input)" : "#118dff", color: selectedSeller ? "var(--text)" : "#fff" }}
          >
            Усі менеджери
          </button>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {managers.map((manager) => {
            const active = selectedSeller === manager.seller;
            return (
              <button
                key={manager.seller}
                type="button"
                onClick={() => onSelectSeller(manager.seller)}
                aria-pressed={active}
                className="shrink-0 rounded-lg border px-3 py-2 text-left text-xs font-bold"
                style={{ borderColor: active ? "#118dff" : "var(--border)", background: active ? "rgba(17,141,255,.10)" : "var(--bg-input)", color: active ? "#075985" : "var(--text)" }}
              >
                {manager.seller}
              </button>
            );
          })}
        </div>
        {missingPlanManagers.length > 0 && (
          <div className="mt-3 rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: "#fde68a", background: "#fffbeb", color: "#92400e" }}>
            План не заданий: {missingPlanManagers.map((manager) => manager.seller).join(", ")}.
          </div>
        )}
      </section>

      <div className={selectedSeller ? "grid gap-3" : "grid gap-3 xl:grid-cols-2"}>
        {visibleManagers.map((manager) => {
          const completion = manager.planCompletionPct || 0;
          return (
            <button
              key={manager.seller}
              type="button"
              onClick={() => onSelectSeller(manager.seller)}
              className="rounded-xl border p-4 text-left"
              style={{ borderColor: selectedSeller === manager.seller ? "#118dff" : "rgba(17,141,255,.28)", background: "linear-gradient(135deg, rgba(17,141,255,.10), rgba(34,197,94,.10))", boxShadow: "var(--shadow-sm)" }}
            >
              <div className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-dim)" }}>План місяця · {month}</div>
              <div className="mt-1 truncate text-sm font-black" style={{ color: "var(--text)" }} title={manager.seller}>{manager.seller}</div>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="text-2xl font-black tabular-nums" style={{ color: "var(--text)" }}>{fmtMoney(manager.planRevenue)}</div>
                <div className="pb-0.5 text-xs" style={{ color: "var(--text-dim)" }}>{manager.plan ? `з плану ${fmtMoney(manager.plan)}` : "план не заданий"}</div>
              </div>
              <div className="mt-3"><ProgressBar value={completion} color={completion >= 100 ? "#22c55e" : "#118dff"} /></div>
              <div className="mt-3 grid gap-1 text-xs sm:grid-cols-3">
                <div style={{ color: "var(--text-dim)" }}>Виконання: <b style={{ color: "var(--text)" }}>{fmtPct(manager.planCompletionPct)}</b></div>
                <div style={{ color: "var(--text-dim)" }}>Прогноз: <b style={{ color: "var(--text)" }}>{manager.forecastRevenue ? fmtMoney(manager.forecastRevenue) : "—"}</b></div>
                <div style={{ color: "var(--text-dim)" }}>Прогноз плану: <b style={{ color: "var(--text)" }}>{fmtPct(manager.forecastCompletionPct)}</b></div>
              </div>
            </button>
          );
        })}
      </div>

      <section className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)", background: "#314858", boxShadow: "var(--shadow-sm)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-white">
          <div className="text-sm font-black">Аналіз менеджерів</div>
          <div className="text-xs text-slate-300">{selectedSeller || "Усі менеджери"}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] border-collapse text-xs">
            <thead className="text-slate-200" style={{ background: "#3b5364" }}>
              <tr>
                <th className="px-3 py-3 text-left min-w-[270px]">Продавець</th>
                <th className="px-3 py-3 text-right">Кількість<br />замовлень</th>
                <th className="px-3 py-3 text-right">Кількість виконаних<br />замовлень</th>
                <th className="px-3 py-3 text-right">% виконаних<br />замовлень</th>
                <th className="px-3 py-3 text-right">Сума<br />замовлень</th>
                <th className="px-3 py-3 text-right">Сума виконаних<br />замовлень</th>
                <th className="px-3 py-3 text-right">% ТО виконаних<br />замовлень</th>
                <th className="px-3 py-3 text-right">Середня сума<br />замовлення</th>
                <th className="px-3 py-3 text-right">Середній<br />чек</th>
                <th className="px-3 py-3 text-right">К-сть од.<br />у чеку</th>
                <th className="px-3 py-3 text-right">% виконаного<br />сер. чеку</th>
              </tr>
            </thead>
            <tbody>
              {visibleManagers.map((manager, index) => (
                <tr
                  key={manager.seller}
                  onClick={() => onSelectSeller(manager.seller)}
                  className="cursor-pointer border-t text-slate-100"
                  style={{ borderColor: "rgba(255,255,255,.12)", background: selectedSeller === manager.seller ? "rgba(17,141,255,.18)" : "transparent" }}
                >
                  <td className="px-3 py-2.5 font-semibold"><span className="mr-2 text-slate-400">{index + 1}.</span>{manager.seller}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ background: "#4058a8" }}>{fmtNum(manager.orderedDocs)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ background: "#2386d8" }}>{fmtNum(manager.completedDocs)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ background: "#317eb6" }}>{fmtPct(manager.orderCompletionPct)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ background: "#398f3e" }}>{fmtNum(manager.orderedRevenue)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ background: "#45a24b" }}>{fmtNum(manager.completedRevenue)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ background: "#639780" }}>{fmtPct(manager.revenueCompletionPct)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ background: "#267083" }}>{fmtNum(manager.averageOrderRevenue || 0)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ background: "#168695" }}>{fmtNum(manager.averageCompletedRevenue || 0)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ background: "#168695" }}>{fmtDecimal(manager.unitsPerCheck)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ background: "#1ba2b5" }}>{fmtPct(manager.averageRevenueCompletionPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DocumentStatusOverview({
  states,
  cancelReasons,
  documentStatusesBySegment,
  title = "Статуси документів",
  showSegmentFilter = true,
}: {
  states: SalesDataset["summary"]["states"];
  cancelReasons: SalesDataset["summary"]["cancelReasons"];
  documentStatusesBySegment: SalesDataset["summary"]["documentStatusesBySegment"];
  title?: string;
  showSegmentFilter?: boolean;
}) {
  const [selectedSegment, setSelectedSegment] = useState<"Усі" | "Плитка" | "Сантехніка">("Усі");
  const segmentSummary = selectedSegment === "Усі"
    ? null
    : documentStatusesBySegment.find((item) => item.segment === selectedSegment);
  const visibleStates = segmentSummary?.states || states;
  const visibleCancelReasons = segmentSummary?.cancelReasons || cancelReasons;
  const totalDocuments = visibleStates.reduce((total, item) => total + item.docs, 0);
  const canceledDocuments = visibleStates
    .filter((item) => item.state.toLocaleLowerCase("uk").includes("скасован"))
    .reduce((total, item) => total + item.docs, 0);
  const canceledShare = totalDocuments ? (canceledDocuments / totalDocuments) * 100 : null;
  const maxRows = Math.max(visibleStates.length, visibleCancelReasons.length);
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>{title}</div>
          <div
            className="rounded-lg border px-2.5 py-1 text-xs"
            style={{ borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c" }}
            title={`Скасовано ${fmtNum(canceledDocuments)} із ${fmtNum(totalDocuments)} документів`}
          >
            Частка скасованих: <b>{fmtPct(canceledShare)}</b>
            <span className="ml-1 opacity-75">({fmtNum(canceledDocuments)} із {fmtNum(totalDocuments)})</span>
          </div>
        </div>
        {showSegmentFilter && <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}>
          {(["Усі", "Плитка", "Сантехніка"] as const).map((segment) => {
            const active = selectedSegment === segment;
            return (
              <button
                key={segment}
                type="button"
                onClick={() => setSelectedSegment(segment)}
                aria-pressed={active}
                className="h-7 rounded-md px-3 text-xs font-bold transition-colors"
                style={{
                  background: active ? "#118dff" : "transparent",
                  color: active ? "#fff" : "var(--text-dim)",
                }}
              >
                {segment}
              </button>
            );
          })}
        </div>}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[minmax(0,1.3fr)_72px_108px_108px_20px_minmax(0,1.3fr)_72px_108px] gap-x-2 text-[11px] font-bold" style={{ color: "var(--text-dim)" }}>
            <span>Статус заказу</span>
            <span className="text-right">К-сть</span>
            <span className="text-right">Сума</span>
            <span />
            <span>Причина скасування</span>
            <span className="text-right">К-сть</span>
            <span className="text-right">Сума</span>
          </div>
          <div className="mt-2 space-y-2">
            {Array.from({ length: maxRows }).map((_, index) => {
              const state = visibleStates[index];
              const reason = visibleCancelReasons[index];
              return (
                <div key={index} className="grid grid-cols-[minmax(0,1.3fr)_72px_108px_20px_minmax(0,1.3fr)_72px_108px] gap-x-2 text-xs">
                  <span className="font-semibold truncate" style={{ color: "var(--text)" }} title={state?.state}>{state?.state || ""}</span>
                  <span className="tabular-nums text-right" style={{ color: "var(--text-dim)" }}>{state ? fmtNum(state.docs) : ""}</span>
                  <span className="tabular-nums text-right" style={{ color: "var(--text-dim)" }}>{state ? fmtMoney(state.revenue) : ""}</span>
                  <span />
                  <span className="font-semibold truncate" style={{ color: "var(--text)" }} title={reason?.reason}>{reason?.reason || "—"}</span>
                  <span className="tabular-nums text-right" style={{ color: "var(--text-dim)" }}>{reason ? fmtNum(reason.docs) : "—"}</span>
                  <span className="tabular-nums text-right" style={{ color: "var(--text-dim)" }}>{reason ? fmtMoney(reason.revenue) : "—"}</span>
                </div>
              );
            })}
            {!maxRows && (
              <div className="text-xs" style={{ color: "var(--text-dim)" }}>Немає статусів під обрані фільтри</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusFilter({
  selectedStatuses,
  onReset,
  onToggle,
}: {
  selectedStatuses: string[];
  onReset: () => void;
  onToggle: (status: string) => void;
}) {
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" }}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReset}
          className="h-8 rounded-lg px-3 text-xs font-bold border"
          style={{
            borderColor: selectedStatuses.length ? "var(--border)" : "#118dff",
            background: selectedStatuses.length ? "var(--bg-input)" : "#118dff",
            color: selectedStatuses.length ? "var(--text)" : "#fff",
          }}
        >
          Усі статуси
        </button>
        {STATUS_FILTERS.map((status) => {
          const active = selectedStatuses.includes(status.value);
          return (
            <button
              key={status.value}
              type="button"
              onClick={() => onToggle(status.value)}
              className="h-8 rounded-lg px-3 text-xs font-bold border"
              style={{
                borderColor: active ? "#118dff" : "var(--border)",
                background: active ? "#118dff" : "var(--bg-input)",
                color: active ? "#fff" : "var(--text)",
              }}
            >
              {status.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DocumentSegmentFilter({ value, onChange }: { value: DocumentSegment; onChange: (value: DocumentSegment) => void }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dfe4ea] bg-white p-4 shadow-sm">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[.12em] text-[#7b8691]">Сегмент продажів</div>
        <div className="mt-1 text-[10px] text-[#8a939c]">Суми, кількість і частки перераховуються всередині вибраного сегмента</div>
      </div>
      <div className="inline-flex rounded-lg border border-[#d8dde3] bg-[#f7f9fb] p-0.5">
        {(["Усі", "Плитка", "Сантехніка"] as const).map((segment) => (
          <button key={segment} type="button" onClick={() => onChange(segment)} aria-pressed={value === segment} className="rounded-md px-3 py-1.5 text-[10px] font-bold transition-colors" style={{ background: value === segment ? "#118dff" : "transparent", color: value === segment ? "#fff" : "#687582" }}>
            {segment}
          </button>
        ))}
      </div>
    </section>
  );
}

function toInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function yearToDateRange() {
  const now = new Date();
  return {
    from: `${now.getFullYear()}-01-01`,
    to: toInputDate(now),
  };
}

function currentMonthRange() {
  const today = kyivToday();
  return {
    from: `${today.slice(0, 7)}-01`,
    to: today,
  };
}

function kyivToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function previousMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: toInputDate(first), to: toInputDate(last) };
}

function shiftIsoYear(value: string, offset: number) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  const targetYear = year + offset;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${targetYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function yearComparisonHint(current: number, previous: number, formatter: (value: number) => string) {
  const delta = previous > 0 ? ((current - previous) / previous) * 100 : null;
  return `Рік тому: ${formatter(previous)} · ${fmtPct(delta)}`;
}

function SalesMetricCard({
  label,
  value,
  hint,
  symbol,
  tone,
  description,
}: {
  label: string;
  value: string;
  hint: string;
  symbol: string;
  tone: string;
  description?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#dfe4ea] bg-white p-4 shadow-sm" title={description}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[.12em] text-[#7b8691]">{label}</div>
          <div className="mt-2 text-2xl font-black tracking-tight text-[#202a35]">{value}</div>
          <div className="mt-1 text-[10px] text-[#8a939c]">{hint}</div>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black" style={{ background: `${tone}18`, color: tone }}>
          {symbol}
        </span>
      </div>
    </div>
  );
}

function chartX(index: number, length: number) {
  return length <= 1 ? 50 : 2 + (index / (length - 1)) * 96;
}

function chartY(value: number, maxValue: number) {
  return 92 - (value / Math.max(1, maxValue)) * 84;
}

function salesAxis(maxValue: number) {
  const step = 200_000;
  const max = Math.max(step, (Math.floor(maxValue / step) + 1) * step);
  return {
    max,
    ticks: Array.from({ length: max / step + 1 }, (_, index) => max - index * step),
  };
}

function chartLabelIndices(length: number) {
  if (length <= 6) return Array.from({ length }, (_, index) => index);
  return [...new Set(Array.from({ length: 6 }, (_, index) => Math.round(index * (length - 1) / 5)))];
}

function SalesTrendChart({
  days,
  previousDays,
}: {
  days: SalesDataset["summary"]["byDate"];
  previousDays?: SalesDataset["summary"]["byDate"];
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const points = days.slice(-31);
  const previousByDate = new Map(previousDays?.map((point) => [point.date, point]) || []);
  const comparisonPoints = previousDays
    ? points.map((point) => previousByDate.get(shiftIsoYear(point.date, -1)) || { date: shiftIsoYear(point.date, -1), docs: 0, goods: 0, revenue: 0 })
    : [];
  const peakValue = Math.max(0, ...points.map((point) => point.revenue), ...comparisonPoints.map((point) => point.revenue));
  const axis = salesAxis(peakValue);
  const coordinates = points.map((point, index) => {
    const x = chartX(index, points.length);
    const y = chartY(point.revenue, axis.max);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const comparisonCoordinates = comparisonPoints.map((point, index) => {
    const x = chartX(index, comparisonPoints.length);
    const y = chartY(point.revenue, axis.max);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const total = points.reduce((sum, point) => sum + point.revenue, 0);
  const hovered = hoveredIndex == null ? null : points[hoveredIndex];
  const hoveredPrevious = hoveredIndex == null ? null : comparisonPoints[hoveredIndex];
  const hoveredLeft = hoveredIndex == null ? 0 : chartX(hoveredIndex, points.length);
  const xLabels = chartLabelIndices(points.length);

  return (
    <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5e8eb] px-5 py-4">
        <div>
          <h2 className="text-sm font-black text-[#26313d]">Динаміка відвантажень</h2>
          <p className="mt-1 text-[10px] text-[#8a939c]">Лише документи зі статусом «Повністю відвантажений»</p>
          {previousDays && <div className="mt-2 flex gap-4 text-[9px] font-bold text-[#687582]"><span><i className="mr-1 inline-block h-0.5 w-4 bg-[#118dff] align-middle" />Обраний період</span><span><i className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-[#8a939c] align-middle" />Минулий рік</span></div>}
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-[.12em] text-[#8a939c]">За період</div>
          <div className="mt-1 text-sm font-black text-[#26313d]">{fmtMoney(total)}</div>
        </div>
      </div>
      <div className="p-5">
        {points.length > 1 ? (
          <div className="grid grid-cols-[24px_68px_minmax(0,1fr)] gap-2">
            <div className="flex h-56 items-center justify-center overflow-visible">
              <span className="-rotate-90 whitespace-nowrap text-[9px] font-black uppercase tracking-[.08em] text-[#687582]">Сума продажів, грн</span>
            </div>
            <div className="relative h-56 text-[9px] font-semibold text-[#7d8994]">
              {axis.ticks.map((value) => <span key={value} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: `${chartY(value, axis.max)}%` }}>{fmtCompactMoney(value)}</span>)}
            </div>
            <div className="min-w-0">
              <div className="relative h-56 rounded-xl border border-[#edf1f4] bg-[linear-gradient(180deg,#f7fbff_0%,#fff_100%)]">
                {hovered && (
                  <div className="pointer-events-none absolute top-2 z-20 min-w-[180px] rounded-xl border border-[#cbdfee] bg-white p-3 text-[10px] shadow-lg" style={{ left: `${hoveredLeft}%`, transform: `translateX(${hoveredLeft > 80 ? "-100%" : hoveredLeft < 20 ? "0" : "-50%"})` }}>
                    <div className="font-black text-[#26313d]">{fmtIsoDateShort(hovered.date)}</div>
                    <div className="mt-2 flex justify-between gap-4 text-[#6e7a86]"><span>Продано</span><b className="text-[#26313d]">{fmtNum(hovered.goods)} шт</b></div>
                    <div className="mt-1 flex justify-between gap-4 text-[#6e7a86]"><span>Сума</span><b className="text-[#118dff]">{fmtMoney(hovered.revenue)}</b></div>
                    {hoveredPrevious && <div className="mt-2 flex justify-between gap-4 border-t border-[#edf0f2] pt-2 text-[#6e7a86]"><span>Рік тому</span><b className="text-[#687582]">{fmtMoney(hoveredPrevious.revenue)}</b></div>}
                  </div>
                )}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label="Графік продажів по днях">
                  {axis.ticks.map((value) => <line key={value} x1="2" x2="98" y1={chartY(value, axis.max)} y2={chartY(value, axis.max)} stroke="#e7edf3" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />)}
                  <line x1="2" x2="2" y1="8" y2="92" stroke="#b8c3cd" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <line x1="2" x2="98" y1="92" y2="92" stroke="#b8c3cd" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  {comparisonCoordinates && <polyline points={comparisonCoordinates} fill="none" stroke="#8a939c" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
                  <polyline points={coordinates} fill="none" stroke="#118dff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
                {points.map((point, index) => {
                  const x = chartX(index, points.length);
                  const y = chartY(point.revenue, axis.max);
                  return <button key={point.date} type="button" aria-label={`${fmtIsoDateShort(point.date)}: ${fmtNum(point.goods)} шт, ${fmtMoney(point.revenue)}`} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)} onFocus={() => setHoveredIndex(index)} onBlur={() => setHoveredIndex(null)} onClick={() => setHoveredIndex(index)} className="absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none" style={{ left: `${x}%`, top: `${y}%` }}>
                    <span className={`block rounded-full border-2 border-[#118dff] bg-white shadow-sm transition-all ${hoveredIndex === index ? "h-2.5 w-2.5 ring-2 ring-[#118dff]/20" : "h-2 w-2"}`} />
                  </button>;
                })}
              </div>
              <div className="relative mt-2 h-4 text-[9px] font-semibold text-[#7d8994]">{xLabels.map((index) => <span key={points[index].date} className="absolute whitespace-nowrap" style={{ left: `${chartX(index, points.length)}%`, transform: `translateX(${index === 0 ? "0" : index === points.length - 1 ? "-100%" : "-50%"})` }}>{fmtIsoDateShort(points[index].date)}</span>)}</div>
              <div className="mt-1 text-center text-[9px] font-black uppercase tracking-[.08em] text-[#687582]">Дата відвантаження</div>
            </div>
          </div>
        ) : (
          <div className="py-16 text-center text-xs text-[#8a939c]">Недостатньо даних для графіка</div>
        )}
      </div>
    </section>
  );
}

function OrdersTrendChart({
  days,
  previousDays,
}: {
  days: SalesDataset["summary"]["ordersByDate"];
  previousDays?: SalesDataset["summary"]["ordersByDate"];
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const points = days.slice(-31);
  const previousByDate = new Map(previousDays?.map((point) => [point.date, point]) || []);
  const comparisonPoints = previousDays
    ? points.map((point) => previousByDate.get(shiftIsoYear(point.date, -1)) || { date: shiftIsoYear(point.date, -1), docs: 0, managers: [] })
    : [];
  const maxValue = Math.max(1, ...points.map((point) => point.docs), ...comparisonPoints.map((point) => point.docs));
  const coordinates = points.map((point, index) => {
    const x = chartX(index, points.length);
    const y = chartY(point.docs, maxValue);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const comparisonCoordinates = comparisonPoints.map((point, index) => {
    const x = chartX(index, comparisonPoints.length);
    const y = chartY(point.docs, maxValue);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const total = points.reduce((sum, point) => sum + point.docs, 0);
  const hovered = hoveredIndex == null ? null : points[hoveredIndex];
  const hoveredPrevious = hoveredIndex == null ? null : comparisonPoints[hoveredIndex];
  const hoveredLeft = hoveredIndex == null ? 0 : chartX(hoveredIndex, points.length);
  const xLabels = chartLabelIndices(points.length);
  const yTicks = [1, 0.75, 0.5, 0.25, 0];

  return (
    <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5e8eb] px-5 py-4">
        <div><h2 className="text-sm font-black text-[#26313d]">Оформлені замовлення по днях</h2><p className="mt-1 text-[10px] text-[#8a939c]">Наведіть на точку, щоб побачити кількість і розподіл по менеджерах</p>{previousDays && <div className="mt-2 flex gap-4 text-[9px] font-bold text-[#687582]"><span><i className="mr-1 inline-block h-0.5 w-4 bg-[#805ad5] align-middle" />Обраний період</span><span><i className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-[#8a939c] align-middle" />Минулий рік</span></div>}</div>
        <div className="text-right"><div className="text-[9px] font-bold uppercase tracking-[.12em] text-[#8a939c]">За період</div><div className="mt-1 text-sm font-black text-[#26313d]">{fmtNum(total)} замовлень</div></div>
      </div>
      <div className="p-5">
        {points.length > 1 ? (
          <div className="grid grid-cols-[24px_50px_minmax(0,1fr)] gap-2">
            <div className="flex h-56 items-center justify-center overflow-visible">
              <span className="-rotate-90 whitespace-nowrap text-[9px] font-black uppercase tracking-[.08em] text-[#687582]">Кількість замовлень</span>
            </div>
            <div className="relative h-56 text-[9px] font-semibold text-[#7d8994]">
              {yTicks.map((ratio) => <span key={ratio} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: `${8 + (1 - ratio) * 84}%` }}>{fmtNum(Math.round(maxValue * ratio))}</span>)}
            </div>
            <div className="min-w-0">
              <div className="relative h-56 rounded-xl border border-[#edf1f4] bg-[linear-gradient(180deg,#f7fbff_0%,#fff_100%)]">
                {hovered && <div className="pointer-events-none absolute top-2 z-20 min-w-[230px] rounded-xl border border-[#d6caed] bg-white p-3 text-[10px] shadow-lg" style={{ left: `${hoveredLeft}%`, transform: `translateX(${hoveredLeft > 80 ? "-100%" : hoveredLeft < 20 ? "0" : "-50%"})` }}>
                  <div className="flex justify-between gap-4 font-black text-[#26313d]"><span>{fmtIsoDateShort(hovered.date)}</span><span>{fmtNum(hovered.docs)} total</span></div>
                  <div className="mt-2 space-y-1 border-t border-[#edf0f2] pt-2">{hovered.managers.map((manager) => <div key={manager.seller} className="flex justify-between gap-4 text-[#6e7a86]"><span className="max-w-[170px] truncate">{manager.seller}</span><b className="text-[#6b46c1]">{fmtNum(manager.docs)}</b></div>)}{!hovered.managers.length && <div className="text-[#8a939c]">Замовлень немає</div>}</div>
                  {hoveredPrevious && <div className="mt-2 flex justify-between gap-4 border-t border-[#edf0f2] pt-2 text-[#6e7a86]"><span>{fmtIsoDateShort(hoveredPrevious.date)} · рік тому</span><b>{fmtNum(hoveredPrevious.docs)}</b></div>}
                </div>}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label="Графік оформлених замовлень по днях">
                  {yTicks.map((ratio) => <line key={ratio} x1="2" x2="98" y1={8 + (1 - ratio) * 84} y2={8 + (1 - ratio) * 84} stroke="#e7edf3" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />)}
                  <line x1="2" x2="2" y1="8" y2="92" stroke="#b8c3cd" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <line x1="2" x2="98" y1="92" y2="92" stroke="#b8c3cd" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  {comparisonCoordinates && <polyline points={comparisonCoordinates} fill="none" stroke="#8a939c" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
                  <polyline points={coordinates} fill="none" stroke="#805ad5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
                {points.map((point, index) => {
                  const x = chartX(index, points.length);
                  const y = chartY(point.docs, maxValue);
                  return <button key={point.date} type="button" aria-label={`${fmtIsoDateShort(point.date)}: ${fmtNum(point.docs)} замовлень`} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)} onFocus={() => setHoveredIndex(index)} onBlur={() => setHoveredIndex(null)} onClick={() => setHoveredIndex(index)} className="absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none" style={{ left: `${x}%`, top: `${y}%` }}>
                    <span className={`block rounded-full border-2 border-[#805ad5] bg-white shadow-sm transition-all ${hoveredIndex === index ? "h-2.5 w-2.5 ring-2 ring-[#805ad5]/20" : "h-2 w-2"}`} />
                  </button>;
                })}
              </div>
              <div className="relative mt-2 h-4 text-[9px] font-semibold text-[#7d8994]">{xLabels.map((index) => <span key={points[index].date} className="absolute whitespace-nowrap" style={{ left: `${chartX(index, points.length)}%`, transform: `translateX(${index === 0 ? "0" : index === points.length - 1 ? "-100%" : "-50%"})` }}>{fmtIsoDateShort(points[index].date)}</span>)}</div>
              <div className="mt-1 text-center text-[9px] font-black uppercase tracking-[.08em] text-[#687582]">Дата оформлення</div>
            </div>
          </div>
        ) : <div className="py-16 text-center text-xs text-[#8a939c]">Недостатньо даних для графіка</div>}
      </div>
    </section>
  );
}

export function OrderInsightsPanel({ insights }: { insights: SalesDataset["summary"]["orderInsights"] }) {
  const online = insights.onlineOrders;
  const economics = insights.shippedEconomics;

  return (
    <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5e8eb] px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-black text-[#26313d]">Деталі замовлень</h2>
            <span className="rounded-full bg-[#eaf8f1] px-2 py-1 text-[9px] font-black text-[#16865c]">Нові дані API</span>
          </div>
          <p className="mt-1 text-[10px] text-[#8a939c]">Webshop ID, маркетингові програми, повернення та собівартість</p>
        </div>
        <div className="text-right text-[9px] leading-4 text-[#8a939c]">Замовлення — за датою оформлення<br />Економіка — за датою відвантаження</div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
        <SalesMetricCard
          label="З WEBSHOP ID"
          value={fmtNum(online.webshopDocs)}
          hint={`${fmtPct(online.webshopSharePct)} від ${fmtNum(online.totalDocs)} замовлень`}
          symbol="W"
          tone="#118dff"
          description="Кількість оформлених замовлень, для яких API передав webshop_id."
        />
        <SalesMetricCard
          label="СЕРЕДНІЙ ЧЕК WEBSHOP"
          value={online.webshopAverageOrderRevenue == null ? "—" : fmtMoney(online.webshopAverageOrderRevenue)}
          hint={`Сума ${fmtMoney(online.webshopRevenue)} · ${fmtNum(online.webshopDocs)} замовлень`}
          symbol="Ø"
          tone="#168b9b"
          description="Сума оформлених замовлень із webshop_id / кількість таких замовлень за обраний період."
        />
        <SalesMetricCard
          label="З МАРКЕТИНГОВОЮ ПРОГРАМОЮ"
          value={fmtNum(online.marketingDocs)}
          hint={`Сума замовлень: ${fmtMoney(online.marketingRevenue)}`}
          symbol="M"
          tone="#805ad5"
          description="Замовлення, у яких заповнене поле marketingprogram."
        />
        <SalesMetricCard
          label="З ПОВЕРНЕННЯМИ"
          value={fmtNum(economics.ordersWithReturns)}
          hint={`${fmtPct(economics.returnRatePct)} від відвантажених · ${fmtMoney(economics.returnedRevenue)}`}
          symbol="↩"
          tone="#e45858"
          description="Повністю відвантажені документи з ознакою або деталізацією повернення."
        />
        <SalesMetricCard
          label="ОЦІНОЧНА ВАЛОВА МАРЖА"
          value={fmtPct(economics.estimatedGrossMarginPct)}
          hint={`${fmtMoney(economics.estimatedGrossProfit)} · покриття ${fmtPct(economics.costCoveragePct)}`}
          symbol="₴"
          tone="#20a66a"
          description="Розрахунок лише для відвантажених документів із переданою собівартістю: (чистий продаж − собівартість) / чистий продаж."
        />
      </div>

      <div className="grid gap-4 border-t border-[#edf0f2] p-4 xl:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-[#e3e7eb]">
          <div className="flex items-center justify-between bg-[#f7f9fb] px-4 py-3">
            <div><h3 className="text-xs font-black text-[#33404c]">Маркетингові програми</h3><p className="mt-0.5 text-[9px] text-[#8a939c]">За кількістю оформлених замовлень</p></div>
            <span className="text-[9px] font-bold text-[#687582]">{fmtNum(online.programs.length)} програм</span>
          </div>
          <div className="divide-y divide-[#edf0f2]">
            {online.programs.slice(0, 8).map((program) => (
              <div key={program.program} className="grid grid-cols-[minmax(0,1fr)_65px_120px] items-center gap-2 px-4 py-2.5 text-[10px]">
                <span className="truncate font-bold text-[#3b4753]" title={program.program}>{program.program}</span>
                <span className="text-right font-black tabular-nums text-[#805ad5]">{fmtNum(program.docs)}</span>
                <span className="text-right tabular-nums text-[#687582]">{fmtMoney(program.revenue)}</span>
              </div>
            ))}
            {!online.programs.length && <div className="px-4 py-8 text-center text-[10px] text-[#8a939c]">Немає маркетингових програм за період</div>}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-[#e3e7eb]">
          <div className="flex items-center justify-between bg-[#f7f9fb] px-4 py-3">
            <div><h3 className="text-xs font-black text-[#33404c]">Товари у поверненнях</h3><p className="mt-0.5 text-[9px] text-[#8a939c]">Топ за сумою повернутих позицій</p></div>
            <span className="text-[9px] font-bold text-[#687582]">{fmtNum(economics.returnedPositions)} позицій</span>
          </div>
          <div className="divide-y divide-[#edf0f2]">
            {economics.returnedProducts.slice(0, 8).map((product) => (
              <div key={product.code} className="grid grid-cols-[minmax(0,1fr)_65px_120px] items-center gap-2 px-4 py-2.5 text-[10px]">
                <div className="min-w-0"><div className="truncate font-bold text-[#3b4753]" title={product.name}>{product.name}</div><div className="text-[9px] text-[#929ba4]">IDD {product.code}</div></div>
                <span className="text-right font-black tabular-nums text-[#e45858]">{fmtNum(product.positions)}</span>
                <span className="text-right tabular-nums text-[#687582]">{fmtMoney(product.revenue)}</span>
              </div>
            ))}
            {!economics.returnedProducts.length && <div className="px-4 py-8 text-center text-[10px] text-[#8a939c]">Немає деталізованих повернень за період</div>}
          </div>
        </div>
      </div>

      <div className="border-t border-[#edf0f2] bg-[#fbfcfd] px-5 py-3 text-[9px] leading-4 text-[#7b8691]">
        Собівартість доступна для {fmtNum(economics.costCoveredDocs)} із {fmtNum(economics.shippedDocs)} відвантажених документів. Оціночна маржа рахується тільки по документах із заповненим `rows_owncost` і не є бухгалтерським показником.
      </div>
    </section>
  );
}

function orderDateTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", { dateStyle: "short", timeStyle: "short" }).format(parsed);
}

function paymentLabel(value: string | null | undefined) {
  return ({ online: "Онлайн", online_full: "Онлайн · повна оплата", online_parts: "Оплата частинами", cash: "Готівка", bank: "Безготівкова" } as Record<string, string>)[value || ""] || value || "Не вказано";
}

function orderPaymentLabel(order: SalesWebshopOrder) {
  if (order.payment?.type === "online") return paymentLabel(order.payment.status === "paymet_parts" ? "online_parts" : "online_full");
  return paymentLabel(order.payment?.type);
}

function deliveryLabel(value: string | null | undefined) {
  return ({ npDepartment: "Нова пошта · відділення", npCourier: "Нова пошта · кур'єр", agrWarehouse: "Самовивіз AGROMAT", agrCity: "Доставка AGROMAT · місто", agrUkraine: "Доставка AGROMAT · Україна" } as Record<string, string>)[value || ""] || value || "Не вказано";
}

function customerName(order: SalesWebshopOrder) {
  return order.customer.legal_name || [order.customer.last_name, order.customer.first_name, order.customer.patronymic].filter(Boolean).join(" ") || "Без імені";
}

function formatDeliveryAddress(address: unknown) {
  if (!address) return "—";
  if (typeof address === "string") return address;
  const labels: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === "string" && /(name|address)/i.test(key) && !labels.includes(nested)) labels.push(nested);
      else if (typeof nested === "object") visit(nested);
    }
  };
  visit(address);
  return labels.join(" · ") || "Деталі адреси передані в API";
}

function DistributionList({ title, rows, label, selectedKey, onSelect, totalOverride }: { title: string; rows: Array<{ key: string; docs: number }>; label: (key: string) => string; selectedKey?: string; onSelect?: (key: string) => void; totalOverride?: number }) {
  const total = totalOverride ?? rows.reduce((sum, row) => sum + row.docs, 0);
  return (
    <section className="overflow-hidden rounded-xl border border-[#e3e7eb] bg-white">
      <div className="border-b border-[#edf0f2] bg-[#f7f9fb] px-4 py-3 text-xs font-black text-[#33404c]">{title}</div>
      <div className="divide-y divide-[#edf0f2]">{rows.map((row) => <button type="button" disabled={!onSelect} onClick={() => onSelect?.(row.key)} key={row.key} className={`grid w-full grid-cols-[minmax(0,1fr)_55px_55px] gap-2 px-4 py-2.5 text-left text-[10px] ${onSelect ? "hover:bg-[#eef7ff]" : "cursor-default"} ${selectedKey === row.key ? "bg-[#e5f3ff] ring-1 ring-inset ring-[#9cccf6]" : ""}`}><span className="truncate font-bold text-[#52606d]">{label(row.key)}</span><b className="text-right tabular-nums text-[#33404c]">{fmtNum(row.docs)}</b><span className="text-right tabular-nums text-[#8a939c]">{fmtPct(total ? (row.docs / total) * 100 : null)}</span></button>)}</div>
    </section>
  );
}

function WebshopOrdersRegister({ dataset, loading, error, page, syncFilter, paymentFilter, deliveryFilter, statusFilter, onPageChange, onSyncFilterChange, onPaymentFilterChange, onDeliveryFilterChange, onStatusFilterChange }: { dataset: SalesWebshopOrdersDataset | null; loading: boolean; error: string | null; page: number; syncFilter: WebshopSyncFilter; paymentFilter: WebshopPaymentFilter; deliveryFilter: WebshopDeliveryFilter; statusFilter: string; onPageChange: (page: number) => void; onSyncFilterChange: (filter: WebshopSyncFilter) => void; onPaymentFilterChange: (filter: WebshopPaymentFilter) => void; onDeliveryFilterChange: (filter: WebshopDeliveryFilter) => void; onStatusFilterChange: (filter: string) => void }) {
  const [query, setQuery] = useState("");
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<{ item: SalesWebshopOrderItem; orderId: number } | null>(null);
  const [orderDetails, setOrderDetails] = useState<Record<number, SalesWebshopOrder>>({});
  const [loadingOrderDetail, setLoadingOrderDetail] = useState<number | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("uk");
  const orders = (dataset?.data || []).filter((order) => !normalizedQuery || [String(order.id), String(order.order_num || ""), String(order.order_doc_id || ""), customerName(order), order.customer.email || "", order.customer.phone || "", order.status || "", ...order.items.flatMap((item) => [String(item.goods_ref || ""), String(item.code || ""), item.sku || "", item.name])].some((value) => value.toLocaleLowerCase("uk").includes(normalizedQuery)));
  const summary = dataset?.summary;
  const toggleOrder = async (order: SalesWebshopOrder) => {
    if (expandedOrder === order.id) {
      setExpandedOrder(null);
      return;
    }
    setExpandedOrder(order.id);
    if (orderDetails[order.id]) return;
    setLoadingOrderDetail(order.id);
    try {
      const response = await fetch(`/api/sales/webshop-orders?order_id=${order.id}`, { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.data) setOrderDetails((current) => ({ ...current, [order.id]: payload.data as SalesWebshopOrder }));
    } finally {
      setLoadingOrderDetail((current) => current === order.id ? null : current);
    }
  };

  return (
    <div className="space-y-4">
      {summary && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SalesMetricCard label="WEBSHOP-ЗАМОВЛЕННЯ" value={fmtNum(summary.total)} hint={summary.partial ? `Метрики нижче — за ${fmtNum(summary.basedOn)} записами` : "За обраний період"} symbol="W" tone="#118dff" />
          <SalesMetricCard label="СУМА ЗАМОВЛЕНЬ" value={fmtMoney(summary.revenue)} hint={summary.partial ? "За поточною сторінкою" : `${fmtNum(summary.total)} замовлень`} symbol="₴" tone="#805ad5" />
          <SalesMetricCard label="СЕРЕДНІЙ ЧЕК" value={fmtMoney(summary.averageOrder)} hint={summary.partial ? "За поточною сторінкою" : "Сума / кількість замовлень"} symbol="Ø" tone="#168b9b" />
          <SalesMetricCard label="СИНХРОНІЗОВАНО З P2" value={fmtPct(summary.syncedPct)} hint={`${fmtNum(summary.synced)} із ${fmtNum(summary.basedOn)} замовлень`} symbol="P2" tone="#20a66a" />
          <SalesMetricCard label="ОНЛАЙН-ОПЛАТА" value={fmtPct(summary.onlinePaidPct)} hint={`${fmtNum(summary.onlinePaid)} із ${fmtNum(summary.basedOn)} замовлень`} symbol="%" tone="#e39a25" />
        </div>
        <div className="grid items-start gap-3 xl:grid-cols-3"><DistributionList title="Способи оплати" rows={summary.paymentTypes} label={paymentLabel} selectedKey={paymentFilter === "all" ? undefined : paymentFilter} onSelect={(key) => onPaymentFilterChange(paymentFilter === key ? "all" : key as WebshopPaymentFilter)} /><DistributionList title="Способи доставки" rows={summary.deliveryTypes} label={deliveryLabel} selectedKey={deliveryFilter === "all" ? undefined : deliveryFilter} onSelect={(key) => onDeliveryFilterChange(deliveryFilter === key ? "all" : key as WebshopDeliveryFilter)} /><DistributionList title="Фінальні статуси замовлень P2" rows={summary.statuses} label={(value) => value === "unknown" ? "Не вказано" : value} selectedKey={statusFilter === "all" ? undefined : statusFilter} totalOverride={summary.statusesTotal} onSelect={(key) => onStatusFilterChange(statusFilter === key ? "all" : key)} /></div>
      </>}

      <section className="grid gap-3 rounded-xl border border-[#dfe4ea] bg-white p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
        <label><span className="mb-1 block text-[9px] font-black uppercase tracking-[.1em] text-[#84909b]">Спосіб оплати</span><select value={paymentFilter} onChange={(event) => onPaymentFilterChange(event.target.value as WebshopPaymentFilter)} className="h-9 w-full rounded-lg border border-[#d8dde3] bg-white px-3 text-[11px] font-bold text-[#52606d] outline-none focus:border-[#118dff]"><option value="all">Усі способи оплати</option><option value="online_full">Онлайн · повна оплата</option><option value="online_parts">Оплата частинами</option><option value="cash">Готівка</option><option value="bank">Безготівкова</option></select></label>
        <label><span className="mb-1 block text-[9px] font-black uppercase tracking-[.1em] text-[#84909b]">Спосіб доставки</span><select value={deliveryFilter} onChange={(event) => onDeliveryFilterChange(event.target.value as WebshopDeliveryFilter)} className="h-9 w-full rounded-lg border border-[#d8dde3] bg-white px-3 text-[11px] font-bold text-[#52606d] outline-none focus:border-[#118dff]"><option value="all">Усі способи доставки</option><option value="npDepartment">Нова пошта · відділення</option><option value="npCourier">Нова пошта · кур&apos;єр</option><option value="agrWarehouse">Самовивіз AGROMAT</option><option value="agrCity">Доставка AGROMAT · місто</option><option value="agrUkraine">Доставка AGROMAT · Україна</option></select></label>
        <button type="button" disabled={paymentFilter === "all" && deliveryFilter === "all" && statusFilter === "all"} onClick={() => { onPaymentFilterChange("all"); onDeliveryFilterChange("all"); onStatusFilterChange("all"); }} className="h-9 self-end rounded-lg border border-[#d8dde3] bg-[#f7f9fb] px-4 text-[10px] font-bold text-[#586572] disabled:opacity-40">Скинути фільтри</button>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e5e8eb] px-5 py-4">
          <div><h2 className="text-sm font-black text-[#26313d]">Детальний реєстр замовлень</h2><p className="mt-1 text-[10px] text-[#8a939c]">Клієнт, оплата, доставка, синхронізація, виконання та склад товарів</p></div>
          <div className="flex w-full flex-wrap items-end justify-end gap-3 sm:w-auto">
            <div><span className="mb-1 block text-[9px] font-black uppercase tracking-[.1em] text-[#84909b]">Синхронізація P2</span><div className="flex h-9 overflow-hidden rounded-lg border border-[#d8dde3] bg-white">{([['all', 'Усі'], ['synced', 'Синхронізовані'], ['unsynced', 'Не синхронізовані']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => onSyncFilterChange(value)} className={`border-l border-[#e5e8eb] px-3 text-[10px] font-bold first:border-l-0 ${syncFilter === value ? "bg-[#176aa8] text-white" : "text-[#586572] hover:bg-[#f4f7f9]"}`}>{label}</button>)}</div></div>
            <label className="w-full sm:w-[340px]"><span className="mb-1 block text-[9px] font-black uppercase tracking-[.1em] text-[#84909b]">Пошук на цій сторінці</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, документ, клієнт, телефон, товар…" className="h-9 w-full rounded-lg border border-[#d8dde3] bg-white px-3 text-[11px] outline-none focus:border-[#118dff]" /></label>
          </div>
        </div>
        {loading && <div className="px-5 py-14 text-center text-xs text-[#8a939c]">Завантаження замовлень і статусів P2…</div>}
        {!loading && error && <div className="m-4 rounded-xl border border-[#f0b6b6] bg-[#fff1f1] p-3 text-xs font-semibold text-[#b73535]">{error}</div>}
        {!loading && !error && dataset && <>
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#fbfcfd] px-5 py-2.5 text-[10px] text-[#7b8691]"><span>На сторінці: <b className="text-[#33404c]">{fmtNum(orders.length)}</b> · усього за фільтрами: <b className="text-[#33404c]">{fmtNum(dataset.meta.total)}</b></span><span>Історія P2 завантажується при відкритті замовлення</span></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[1320px] border-collapse text-[10px]"><thead className="bg-[#f3f6f8] text-[#697581]"><tr><th className="w-10 px-3 py-3" /><th className="px-3 py-3 text-left">ID / документ</th><th className="px-3 py-3 text-left">Дата</th><th className="px-3 py-3 text-left">Клієнт</th><th className="px-3 py-3 text-left">Статус</th><th className="px-3 py-3 text-left">Оплата</th><th className="px-3 py-3 text-left">Доставка</th><th className="px-3 py-3 text-right">Товарів</th><th className="px-3 py-3 text-right">Доставка, ₴</th><th className="px-3 py-3 text-right">Сума</th><th className="px-3 py-3 text-center">P2</th></tr></thead>
            <tbody>{orders.map((order) => { const expanded = expandedOrder === order.id; const detailedOrder = orderDetails[order.id] || order; const itemQty = order.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0); const currentStatus = order.analytics_status || detailedOrder.fulfillment?.current?.name || order.status || "Без статусу"; const isNovaPoshtaReturn = currentStatus === "Оформлено повернення НП"; return <Fragment key={order.id}><tr className="border-t border-[#e8ecef] hover:bg-[#f8fbfd]"><td className="px-3 py-3 text-center"><button type="button" onClick={() => void toggleOrder(order)} aria-expanded={expanded} className="flex h-6 w-6 items-center justify-center rounded-md bg-[#eef7ff] font-black text-[#118dff]">{expanded ? "−" : "+"}</button></td><td className="px-3 py-3"><div className="font-black tabular-nums text-[#176aa8]">#{order.id}</div><div className="mt-0.5 text-[9px] text-[#7b8691]">{order.order_num ? `№ ${order.order_num}` : "Без документа"}</div></td><td className="px-3 py-3 tabular-nums text-[#596673]">{orderDateTime(order.date)}</td><td className="max-w-[220px] px-3 py-3"><div className="truncate font-bold text-[#33404c]" title={customerName(order)}>{customerName(order)}</div><div className="mt-0.5 text-[9px] text-[#7b8691]">{order.customer.phone || order.customer.email || "—"}</div></td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 font-bold ${isNovaPoshtaReturn ? "bg-[#fff0e7] text-[#bd5c21]" : "bg-[#f0f3f6] text-[#52606d]"}`}>{currentStatus}</span>{isNovaPoshtaReturn && order.return_info && <div className="mt-1 text-[9px] font-bold text-[#bd5c21]">Повернення: {fmtMoney(order.return_info.returnSum)}</div>}</td><td className="px-3 py-3"><div className="font-bold text-[#805ad5]">{orderPaymentLabel(order)}</div><div className="mt-0.5 text-[9px] text-[#7b8691]">{order.payment?.status === "paymet_parts" ? "Платіж частинами" : order.payment?.status || "Статус не вказано"}</div></td><td className="max-w-[210px] truncate px-3 py-3 font-bold text-[#596673]" title={deliveryLabel(order.delivery?.type)}>{deliveryLabel(order.delivery?.type)}</td><td className="px-3 py-3 text-right tabular-nums">{fmtNum(itemQty)}</td><td className="px-3 py-3 text-right tabular-nums text-[#687582]">{fmtMoney(order.totals.delivery || 0)}</td><td className="px-3 py-3 text-right font-black tabular-nums text-[#26313d]">{fmtMoney(order.totals.cost || 0)}</td><td className="px-3 py-3 text-center"><span className={`rounded-full px-2 py-1 font-black ${order.is_synced ? "bg-[#eaf8f1] text-[#16865c]" : "bg-[#fff1f1] text-[#c54848]"}`}>{order.is_synced ? "Так" : "Ні"}</span></td></tr>
              {expanded && <tr className="border-t border-[#dce7ef] bg-[#f7fbfe]"><td colSpan={11} className="px-5 py-4"><div className="grid gap-4 xl:grid-cols-[1fr_1fr_1.4fr]"><div className="space-y-1 text-[10px]"><div className="font-black uppercase text-[#84909b]">Клієнт і отримувач</div><div><b>Телефон:</b> {order.customer.phone || "—"}</div><div><b>Email:</b> {order.customer.email || "—"}</div><div><b>Отримувач:</b> {order.customer.recipient ? [order.customer.recipient.last_name, order.customer.recipient.first_name].filter(Boolean).join(" ") || "—" : "—"}</div><div><b>Телефон отримувача:</b> {order.customer.recipient?.phone || "—"}</div></div><div className="space-y-1 text-[10px]"><div className="font-black uppercase text-[#84909b]">Доставка і джерело</div><div><b>Дата доставки:</b> {order.delivery?.date ? fmtIsoDateShort(order.delivery.date) : "—"}</div><div className="break-all"><b>Адреса:</b> {formatDeliveryAddress(order.delivery?.address)}</div><div><b>UTM:</b> {[order.source?.utm_source, order.source?.utm_campaign].filter(Boolean).join(" / ") || "—"}</div><div><b>Коментар:</b> {order.comments || "—"}</div></div><div><div className="font-black uppercase text-[#84909b]">Історія виконання P2</div><div className="mt-2 flex flex-wrap gap-2">{(detailedOrder.fulfillment?.history || []).map((entry, index) => <span key={`${entry.id}-${index}`} className={`rounded-lg border px-2 py-1.5 text-[9px] ${entry.rolled_back ? "border-[#f0b6b6] bg-[#fff1f1] text-[#b73535]" : "border-[#cfe3f5] bg-white text-[#176aa8]"}`}>{entry.name} · {orderDateTime(entry.started_at)}</span>)}{loadingOrderDetail === order.id && <span className="text-[10px] font-bold text-[#176aa8]">Завантаження історії…</span>}{loadingOrderDetail !== order.id && !detailedOrder.fulfillment?.history?.length && <span className="text-[10px] text-[#8a939c]">Історія недоступна</span>}</div></div></div>
                <div className="mt-4 overflow-hidden rounded-lg border border-[#dce4ea] bg-white"><table className="w-full border-collapse text-[10px]"><thead className="bg-[#f4f6f8] text-[#75808b]"><tr><th className="px-3 py-2 text-left">IDD / код</th><th className="px-3 py-2 text-left">Товар</th><th className="px-3 py-2 text-left">Наявність</th><th className="px-3 py-2 text-right">К-ть</th><th className="px-3 py-2 text-right">Стара ціна</th><th className="px-3 py-2 text-right">Ціна</th><th className="px-3 py-2 text-right">Сума</th></tr></thead><tbody>{order.items.map((item, index) => <tr key={`${item.product_id}-${index}`} className="border-t border-[#edf0f2]"><td className="px-3 py-2 tabular-nums text-[#687582]">{item.goods_ref || "—"}<div className="text-[9px]">{item.code || item.sku || ""}</div></td><td className="px-3 py-2 font-bold text-[#33404c]"><button type="button" onClick={() => setSelectedProduct({ item, orderId: order.id })} className="text-left hover:text-[#118dff] hover:underline">{item.name}</button></td><td className="px-3 py-2 text-[#687582]">{item.availability_status?.name || "—"}</td><td className="px-3 py-2 text-right tabular-nums">{fmtNum(item.quantity)}</td><td className="px-3 py-2 text-right tabular-nums text-[#8a939c]">{item.price_old ? fmtMoney(item.price_old) : "—"}</td><td className="px-3 py-2 text-right tabular-nums">{fmtMoney(item.price)}</td><td className="px-3 py-2 text-right font-bold tabular-nums">{fmtMoney(item.line_total)}</td></tr>)}</tbody></table></div></td></tr>}
            </Fragment>; })}</tbody></table></div>
          {!orders.length && <div className="border-t border-[#edf0f2] px-5 py-12 text-center text-xs text-[#8a939c]">Замовлень за цим запитом не знайдено</div>}
          <div className="flex items-center justify-between border-t border-[#edf0f2] px-5 py-3"><button type="button" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)} className="rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[10px] font-bold text-[#586572] disabled:opacity-40">← Попередня</button><span className="text-[10px] text-[#7b8691]">Сторінка <b>{dataset.meta.page}</b> із <b>{dataset.meta.total_pages}</b></span><button type="button" disabled={page >= dataset.meta.total_pages || loading} onClick={() => onPageChange(page + 1)} className="rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[10px] font-bold text-[#586572] disabled:opacity-40">Наступна →</button></div>
        </>}
      </section>
      {selectedProduct && <div role="dialog" aria-modal="true" aria-label="Деталі товару" className="fixed inset-0 z-50 flex items-center justify-center bg-[#15202b]/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProduct(null); }}>
        <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#dce3e9] bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-[#e8ecef] px-5 py-4"><div><div className="text-[9px] font-black uppercase tracking-[.14em] text-[#118dff]">Замовлення #{selectedProduct.orderId}</div><h3 className="mt-1 text-base font-black leading-snug text-[#26313d]">{selectedProduct.item.name}</h3></div><button type="button" aria-label="Закрити" onClick={() => setSelectedProduct(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f0f3f6] text-lg font-bold text-[#64717d]">×</button></div>
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <div className="rounded-xl bg-[#f7f9fb] p-3 text-[11px]"><div className="text-[9px] font-black uppercase text-[#8a949e]">Ідентифікатори</div><div className="mt-2"><b>IDD:</b> {selectedProduct.item.goods_ref || "—"}</div><div><b>Код:</b> {selectedProduct.item.code || "—"}</div><div><b>SKU:</b> {selectedProduct.item.sku || "—"}</div><div><b>Product ID:</b> {selectedProduct.item.product_id}</div></div>
            <div className="rounded-xl bg-[#f7f9fb] p-3 text-[11px]"><div className="text-[9px] font-black uppercase text-[#8a949e]">Замовлення</div><div className="mt-2"><b>Наявність:</b> {selectedProduct.item.availability_status?.name || "—"}</div><div><b>Кількість:</b> {fmtNum(selectedProduct.item.quantity)}</div><div><b>Ціна:</b> {fmtMoney(selectedProduct.item.price)}</div><div><b>Сума:</b> {fmtMoney(selectedProduct.item.line_total)}</div></div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[#e8ecef] px-5 py-4"><button type="button" onClick={() => setSelectedProduct(null)} className="rounded-lg border border-[#d8dde3] px-4 py-2 text-[10px] font-bold text-[#586572]">Закрити</button>{selectedProduct.item.url && <a href={selectedProduct.item.url} target="_blank" rel="noreferrer" className="rounded-lg bg-[#118dff] px-4 py-2 text-[10px] font-bold text-white">Відкрити на сайті ↗</a>}</div>
        </div>
      </div>}
    </div>
  );
}

function ConversionRanking({ title, rows }: { title: string; rows: SalesConversionRow[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
      <div className="border-b border-[#e5e8eb] px-4 py-3"><h3 className="text-xs font-black text-[#26313d]">{title}</h3><p className="mt-1 text-[9px] text-[#8a939c]">Топ-20 за конверсією сесій у додавання в кошик</p></div>
      <div className="divide-y divide-[#edf0f2]">
        {rows.map((row, index) => <div key={row.key} className="grid grid-cols-[24px_minmax(0,1fr)_70px] items-center gap-2 px-4 py-2.5 text-[10px]">
          <span className="text-[#9aa3ac]">{index + 1}</span>
          <div className="min-w-0"><div className="truncate font-bold text-[#3b4753]" title={row.label}>{row.url ? <a href={row.url} target="_blank" rel="noreferrer" className="hover:text-[#118dff]">{row.label}</a> : row.label}</div><div className="mt-0.5 text-[9px] text-[#929ba4]">{fmtNum(row.addToCartSessions)} сесій додали · {fmtNum(row.addToCartItems)} товарів · <span className="text-[8px]">факт. замовлень {fmtNum(row.actualOrders)}</span></div></div>
          <span className="text-right font-black text-[#16865c]">{fmtPct(row.conversionPct)}</span>
        </div>)}
        {!rows.length && <div className="px-4 py-8 text-center text-[10px] text-[#8a939c]">Немає даних</div>}
      </div>
    </section>
  );
}

function StatusSummaryList({
  title,
  subtitle,
  rows,
  labelKey,
  tone = "#118dff",
  shareLabel = "від документів",
}: {
  title: string;
  subtitle: string;
  rows: Array<{ docs: number; revenue: number } & Record<string, string | number>>;
  labelKey: "state" | "reason";
  tone?: string;
  shareLabel?: string;
}) {
  const totalDocs = rows.reduce((sum, row) => sum + row.docs, 0);
  const maxDocs = Math.max(1, ...rows.map((row) => row.docs));
  return (
    <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
      <div className="border-b border-[#e5e8eb] px-5 py-4">
        <h2 className="text-sm font-black text-[#26313d]">{title}</h2>
        <p className="mt-1 text-[10px] text-[#8a939c]">{subtitle}</p>
      </div>
      <div className="divide-y divide-[#edf0f2]">
        {rows.map((row, index) => (
          <div key={`${String(row[labelKey])}-${index}`} className="grid gap-3 px-5 py-3.5 md:grid-cols-[minmax(180px,1fr)_minmax(120px,1.2fr)_90px_150px] md:items-center">
            <div className="min-w-0">
              <div className="truncate text-xs font-bold text-[#33404c]" title={String(row[labelKey])}>{String(row[labelKey])}</div>
              <div className="mt-0.5 text-[9px] text-[#98a1aa]">{totalDocs ? fmtPct((row.docs / totalDocs) * 100) : "—"} {shareLabel}</div>
            </div>
            <ProgressBar value={(row.docs / maxDocs) * 100} color={tone} />
            <div className="text-right text-xs font-black tabular-nums text-[#33404c]">{fmtNum(row.docs)}</div>
            <div className="text-right text-xs font-bold tabular-nums text-[#63707c]">{fmtMoney(row.revenue)}</div>
          </div>
        ))}
        {!rows.length && <div className="px-5 py-10 text-center text-xs text-[#8a939c]">Немає даних за обраний період</div>}
      </div>
    </section>
  );
}

export function SalesDashboard() {
  const initialRange = useMemo(() => currentMonthRange(), []);
  const [view, setView] = useState<SalesDashboardView>("overview");
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [compareWithPreviousYear, setCompareWithPreviousYear] = useState(true);
  const [data, setData] = useState<SalesDataset | null>(null);
  const [comparisonData, setComparisonData] = useState<SalesDataset | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(true);
  const [rankingMetric, setRankingMetric] = useState<RankingMetric>("revenue");
  const [webMetrics, setWebMetrics] = useState<SalesWebMetricsDataset | null>(null);
  const [webMetricsError, setWebMetricsError] = useState<string | null>(null);
  const [webMetricsLoading, setWebMetricsLoading] = useState(true);
  const [webshopOrders, setWebshopOrders] = useState<SalesWebshopOrdersDataset | null>(null);
  const [webshopOrdersError, setWebshopOrdersError] = useState<string | null>(null);
  const [webshopOrdersLoading, setWebshopOrdersLoading] = useState(false);
  const [webshopOrdersPage, setWebshopOrdersPage] = useState(1);
  const [webshopSyncFilter, setWebshopSyncFilter] = useState<WebshopSyncFilter>("all");
  const [webshopPaymentFilter, setWebshopPaymentFilter] = useState<WebshopPaymentFilter>("all");
  const [webshopDeliveryFilter, setWebshopDeliveryFilter] = useState<WebshopDeliveryFilter>("all");
  const [webshopStatusFilter, setWebshopStatusFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [categoryProducts, setCategoryProducts] = useState<Record<string, CategoryProductSummary[]>>({});
  const [loadingCategory, setLoadingCategory] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);
  const [brandProducts, setBrandProducts] = useState<Record<string, CategoryProductSummary[]>>({});
  const [loadingBrand, setLoadingBrand] = useState<string | null>(null);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [selectedManager, setSelectedManager] = useState<string | null>(null);
  const [selectedDocumentSegment, setSelectedDocumentSegment] = useState<DocumentSegment>("Усі");
  const hasLoadedRef = useRef(false);
  const webshopScopeRef = useRef("");
  const liveCurrentMonthRef = useRef(true);

  useEffect(() => {
    let lastRefreshAt = Date.now();
    const refresh = () => {
      if (liveCurrentMonthRef.current) {
        const range = currentMonthRange();
        setDateFrom(range.from);
        setDateTo(range.to);
      }
      lastRefreshAt = Date.now();
      setRefreshTick((current) => current + 1);
    };
    const interval = window.setInterval(refresh, SALES_AUTO_REFRESH_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefreshAt >= SALES_AUTO_REFRESH_MS) {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    setCategoryProducts({});
    setBrandProducts({});
  }, [dateFrom, dateTo, selectedStatuses, refreshTick]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    if (hasLoadedRef.current) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setLoadingCategory(null);
    setCategoryError(null);
    setLoadingBrand(null);
    setBrandError(null);
    const params = new URLSearchParams();
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    params.set("compact", "1");
    selectedStatuses.forEach((status) => params.append("status", status));
    const request = fetch(`/api/sales?${params.toString()}`, { signal: controller.signal, cache: "no-store" });
    request
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Не вдалося завантажити аналіз продаж");
        return json as SalesDataset;
      })
      .then((json) => {
        if (!alive) return;
        setData(json);
        setError(null);
        hasLoadedRef.current = true;
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Не вдалося завантажити аналіз продаж");
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [dateFrom, dateTo, selectedStatuses, refreshTick]);

  useEffect(() => {
    if (!compareWithPreviousYear || !dateFrom || !dateTo) {
      setComparisonData(null);
      setComparisonLoading(false);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    const params = new URLSearchParams({
      from: shiftIsoYear(dateFrom, -1),
      to: shiftIsoYear(dateTo, -1),
      compact: "1",
    });
    selectedStatuses.forEach((status) => params.append("status", status));
    setComparisonLoading(true);
    fetch(`/api/sales?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити порівняння");
        return payload as SalesDataset;
      })
      .then((payload) => {
        if (alive) setComparisonData(payload);
      })
      .catch((reason: unknown) => {
        if (!alive || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setComparisonData(null);
      })
      .finally(() => {
        if (alive) setComparisonLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [compareWithPreviousYear, dateFrom, dateTo, selectedStatuses, refreshTick]);

  useEffect(() => {
    if (view !== "webshop") return;
    let alive = true;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(webshopOrdersPage) });
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (webshopSyncFilter !== "all") params.set("synced", webshopSyncFilter === "synced" ? "true" : "false");
    if (webshopPaymentFilter !== "all") params.set("payment", webshopPaymentFilter);
    if (webshopDeliveryFilter !== "all") params.set("delivery", webshopDeliveryFilter);
    if (webshopStatusFilter !== "all") params.set("order_status", webshopStatusFilter);
    const scopeKey = `${dateFrom}|${dateTo}|${webshopSyncFilter}|${webshopPaymentFilter}|${webshopDeliveryFilter}|${webshopStatusFilter}`;
    if (webshopScopeRef.current !== scopeKey) {
      webshopScopeRef.current = scopeKey;
      setWebshopOrders(null);
    }
    setWebshopOrdersLoading(true);
    setWebshopOrdersError(null);
    fetch(`/api/sales/webshop-orders?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити Webshop-замовлення");
        return payload as SalesWebshopOrdersDataset;
      })
      .then((payload) => {
        if (alive) setWebshopOrders(payload);
      })
      .catch((reason: unknown) => {
        if (!alive || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setWebshopOrdersError(reason instanceof Error ? reason.message : "Не вдалося завантажити Webshop-замовлення");
      })
      .finally(() => {
        if (alive) setWebshopOrdersLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [dateFrom, dateTo, view, webshopOrdersPage, webshopSyncFilter, webshopPaymentFilter, webshopDeliveryFilter, webshopStatusFilter, refreshTick]);

  useEffect(() => {
    const category = expandedCategory;
    if (!category || Object.prototype.hasOwnProperty.call(categoryProducts, category)) return;
    let alive = true;
    const controller = new AbortController();
    setLoadingCategory(category);
    setCategoryError(null);
    const params = new URLSearchParams({ category });
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    selectedStatuses.forEach((status) => params.append("status", status));
    const request = fetch(`/api/sales/category-products?${params.toString()}`, { signal: controller.signal, cache: "no-store" });
    request
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити товари категорії");
        return payload as CategoryProductsResponse;
      })
      .then((payload) => {
        if (!alive) return;
        setCategoryProducts((current) => ({ ...current, [payload.category]: payload.items }));
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setCategoryError(reason instanceof Error ? reason.message : "Не вдалося завантажити товари категорії");
      })
      .finally(() => {
        if (alive) setLoadingCategory(null);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [categoryProducts, dateFrom, dateTo, expandedCategory, selectedStatuses]);

  useEffect(() => {
    const brand = expandedBrand;
    if (!brand || Object.prototype.hasOwnProperty.call(brandProducts, brand)) return;
    let alive = true;
    const controller = new AbortController();
    setLoadingBrand(brand);
    setBrandError(null);
    const params = new URLSearchParams({ brand });
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    selectedStatuses.forEach((status) => params.append("status", status));
    const request = fetch(`/api/sales/brand-products?${params.toString()}`, { signal: controller.signal, cache: "no-store" });
    request
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити товари бренду");
        return payload as CategoryProductsResponse;
      })
      .then((payload) => {
        if (!alive) return;
        setBrandProducts((current) => ({ ...current, [payload.category]: payload.items }));
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setBrandError(reason instanceof Error ? reason.message : "Не вдалося завантажити товари бренду");
      })
      .finally(() => {
        if (alive) setLoadingBrand(null);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [brandProducts, dateFrom, dateTo, expandedBrand, selectedStatuses]);

  useEffect(() => {
    if (view !== "web") return;
    let alive = true;
    const controller = new AbortController();
    const fallbackRange = yearToDateRange();
    const params = new URLSearchParams({
      from: dateFrom || fallbackRange.from,
      to: dateTo || fallbackRange.to,
    });
    setWebMetricsLoading(true);
    fetch(`/api/sales/web-metrics?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Не вдалося завантажити вебаналітику");
        return json as SalesWebMetricsDataset;
      })
      .then((json) => {
        if (!alive) return;
        setWebMetrics(json);
        setWebMetricsError(null);
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setWebMetrics(null);
        setWebMetricsError(err instanceof Error ? err.message : "Не вдалося завантажити вебаналітику");
      })
      .finally(() => {
        if (alive) setWebMetricsLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [dateFrom, dateTo, view, refreshTick]);
  useEffect(() => {
    if (!data || !expandedCategory) return;
    if (!data.summary.categories.some((item) => item.label === expandedCategory)) {
      setExpandedCategory(null);
    }
  }, [data, expandedCategory]);

  useEffect(() => {
    if (!selectedManager) return;
    if (!data?.summary.managers.some((manager) => manager.seller === selectedManager)) {
      setSelectedManager(null);
    }
  }, [data, selectedManager]);

  if (loading) {
    return (
      <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>
        Завантаження аналізу продаж з AWS S3…
      </div>
    );
  }

  if (!data && error) {
    return (
      <div className="rounded-xl border p-5" style={{ borderColor: "rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)" }}>
        <div className="text-sm font-bold" style={{ color: "#b91c1c" }}>Аналіз продаж не завантажився</div>
        <div className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>
        Завантаження аналізу продаж з AWS S3…
      </div>
    );
  }

  const plan = data.summary.plan;
  const planPct = plan.completionPct ?? 0;
  const forecastPct = plan.forecastCompletionPct ?? null;
  const statusLabel = selectedStatuses.length ? selectedStatuses.map(fmtStatusLabel).join(", ") : "усіх статусів";
  const today = kyivToday();
  const dayAnchor = dateTo && dateTo <= today ? dateTo : today;
  const selectDay = (day: string) => {
    liveCurrentMonthRef.current = false;
    setDateFrom(day);
    setDateTo(day);
    setWebshopOrdersPage(1);
  };
  const applyCurrentMonth = () => {
    const range = currentMonthRange();
    liveCurrentMonthRef.current = true;
    setDateFrom(range.from);
    setDateTo(range.to);
    setWebshopOrdersPage(1);
  };
  const applyPreviousMonth = () => {
    const range = previousMonthRange();
    liveCurrentMonthRef.current = false;
    setDateFrom(range.from);
    setDateTo(range.to);
    setWebshopOrdersPage(1);
  };
  const applyAllPeriod = () => {
    liveCurrentMonthRef.current = false;
    setDateFrom("");
    setDateTo("");
    setCompareWithPreviousYear(false);
    setWebshopOrdersPage(1);
  };
  const refreshNow = () => {
    if (liveCurrentMonthRef.current) {
      const range = currentMonthRange();
      setDateFrom(range.from);
      setDateTo(range.to);
    }
    setRefreshTick((current) => current + 1);
  };
  const toggleStatus = (status: string) => {
    setSelectedStatuses((current) => (
      current.includes(status)
        ? current.filter((item) => item !== status)
        : [...current, status]
    ));
  };
  const resetStatuses = () => setSelectedStatuses([]);

  const activeView = SALES_VIEW_ITEMS.find((item) => item.id === view) || SALES_VIEW_ITEMS[0];
  const selectedManagerData = selectedManager
    ? data.summary.managers.find((manager) => manager.seller === selectedManager)
    : null;
  const currentTile = data.summary.shippedSegments?.find((segment) => segment.label === "Плитка");
  const currentPlumbing = data.summary.shippedSegments?.find((segment) => segment.label === "Сантехніка");
  const previousTile = comparisonData?.summary.shippedSegments?.find((segment) => segment.label === "Плитка");
  const previousPlumbing = comparisonData?.summary.shippedSegments?.find((segment) => segment.label === "Сантехніка");
  const averageCheck = data.summary.shippedDocs > 0
    ? data.summary.shippedRevenue / data.summary.shippedDocs
    : null;
  const previousAverageCheck = comparisonData && comparisonData.summary.shippedDocs > 0
    ? comparisonData.summary.shippedRevenue / comparisonData.summary.shippedDocs
    : null;
  const selectedSegmentSummary = selectedDocumentSegment === "Усі"
    ? null
    : data.summary.documentStatusesBySegment.find((item) => item.segment === selectedDocumentSegment);
  const visibleStatusRows = selectedDocumentSegment === "Усі" ? data.summary.states : selectedSegmentSummary?.states || [];
  const visibleCancelReasonRows = selectedDocumentSegment === "Усі" ? data.summary.cancelReasons || [] : selectedSegmentSummary?.cancelReasons || [];
  const statusDocsTotal = visibleStatusRows.reduce((sum, item) => sum + item.docs, 0);
  const statusRevenueTotal = visibleStatusRows.reduce((sum, item) => sum + item.revenue, 0);
  const canceledStatusRows = visibleStatusRows.filter((item) => item.state.toLocaleLowerCase("uk").includes("скасован"));
  const canceledStatusDocs = canceledStatusRows.reduce((sum, item) => sum + item.docs, 0);
  const canceledStatusRevenue = canceledStatusRows.reduce((sum, item) => sum + item.revenue, 0);
  const pageDescriptions: Record<SalesDashboardView, string> = {
    overview: "Виконання плану й динаміка повністю відвантажених замовлень.",
    webshop: "Детальні Webshop-замовлення: клієнти, оплата, доставка, товари та виконання P2.",
    web: "Шлях користувача від відвідування сайту до оформленого замовлення.",
    brands: "Продажі за брендами з деталізацією до рівня товару.",
    categories: "Продажі за категоріями з деталізацією до рівня товару.",
    department: "Плани, результативність і статуси замовлень по менеджерах.",
    statuses: "Повна структура документів за статусами, кількістю та сумою.",
    cancellations: "Причини скасувань, їхня частка, кількість і сума.",
  };

  return (
    <div className="min-h-[calc(100dvh-104px)] overflow-hidden rounded-2xl border border-[#dfe4ea] bg-[#f4f5f3] text-[#27313c] shadow-sm">
      <div className="grid min-h-[calc(100dvh-104px)] grid-cols-1 lg:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="bg-[#17202a] px-3 py-5 text-white lg:min-h-full">
          <div className="mb-7 flex items-center gap-3 px-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#118dff] text-lg font-black">A</span>
            <div>
              <div className="text-sm font-black tracking-[.12em]">АГРОМАТ</div>
              <div className="text-[9px] font-semibold uppercase tracking-[.2em] text-[#91a0af]">Sales analytics</div>
            </div>
          </div>
          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {SALES_VIEW_ITEMS.map((item, index) => {
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className="min-w-[190px] rounded-xl border-0 px-3 py-3 text-left transition lg:min-w-0"
                  style={{ background: active ? "#25384d" : "transparent", boxShadow: active ? "inset 3px 0 #118dff" : "none" }}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-black" style={{ color: active ? "#fff" : "#82909e", background: active ? "#118dff" : "#222d38" }}>{index + 1}</span>
                    <div className="min-w-0">
                      <div className="text-xs font-bold" style={{ color: active ? "#fff" : "#bac2ca" }}>{item.label}</div>
                      <div className="mt-0.5 truncate text-[9px] text-[#758391]">{item.hint}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
          <div className="mt-8 rounded-xl border border-[#304152] bg-[#1d2a36] p-3">
            <div className="text-[9px] font-bold uppercase tracking-[.14em] text-[#7f90a0]">Поточний фільтр</div>
            <div className="mt-2 text-[10px] font-bold leading-4 text-[#dce8f3]">{data.filter.label}</div>
            <div className="mt-1 text-[9px] leading-4 text-[#8192a2]">Дашборд перевіряє нові дані та статуси кожні 15 хвилин.</div>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="flex flex-col gap-3 border-b border-[#e1e4e8] bg-white px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="text-xs text-[#8b949e]">Аналіз продажів&nbsp; / &nbsp;<b className="text-[#27313c]">{activeView.label}</b></div>
            <div className="flex flex-wrap items-center gap-2">
              {refreshing && <span className="rounded-lg bg-[#eef7ff] px-3 py-1.5 text-[10px] font-bold text-[#0b6fc2]">Оновлення…</span>}
              <button type="button" onClick={refreshNow} disabled={refreshing || webshopOrdersLoading} className="rounded-lg border border-[#cfe3f5] bg-[#eef7ff] px-3 py-1.5 text-[10px] font-bold text-[#0b6fc2] disabled:cursor-wait disabled:opacity-60">Оновити зараз</button>
              <span className="rounded-lg border border-[#dfe4ea] bg-white px-3 py-1.5 text-[10px] text-[#68727d]">Джерело: <b className="text-[#27313c]">{view === "webshop" ? "Orders API + P2" : "облікова система + GA4"}</b></span>
            </div>
          </header>

          <div className="p-4 sm:p-5 xl:p-6">
            <section className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="mb-1 text-[10px] font-black uppercase tracking-[.2em] text-[#118dff]">Sales intelligence</div>
                <h1 className="text-2xl font-black tracking-tight text-[#202a35] sm:text-3xl">{activeView.label}</h1>
                <p className="mt-1 text-xs text-[#737d87]">{pageDescriptions[view]}</p>
              </div>
              <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold ${view === "web" && webMetrics?.mode === "demo" ? "border-[#f1d18f] bg-[#fff8e8] text-[#9b6817]" : "border-[#cfe3f5] bg-[#eef7ff] text-[#176aa8]"}`}>
                <span className={`h-2 w-2 rounded-full ${view === "web" && webMetrics?.mode === "demo" ? "bg-[#e39a25]" : "bg-[#20a66a]"}`} /> {view === "web" && webMetrics?.mode === "demo" ? "Тестові дані" : "Актуальні дані"}
              </div>
            </section>

            {error && <div className="mb-4 rounded-xl border border-[#f0b6b6] bg-[#fff1f1] p-3 text-xs font-semibold text-[#b73535]">{error}</div>}

            <section className="mb-5 rounded-2xl border border-[#dfe4ea] bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[150px] flex-1 sm:max-w-[190px]">
                  <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[.12em] text-[#84909b]">Дата від</span>
                  <input type="date" value={dateFrom} onChange={(event) => { liveCurrentMonthRef.current = false; setDateFrom(event.target.value); setWebshopOrdersPage(1); }} className="h-9 w-full rounded-lg border border-[#d8dde3] bg-white px-3 text-[11px] outline-none focus:border-[#118dff]" />
                </label>
                <label className="min-w-[150px] flex-1 sm:max-w-[190px]">
                  <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[.12em] text-[#84909b]">Дата до</span>
                  <input type="date" value={dateTo} onChange={(event) => { liveCurrentMonthRef.current = false; setDateTo(event.target.value); setWebshopOrdersPage(1); }} className="h-9 w-full rounded-lg border border-[#d8dde3] bg-white px-3 text-[11px] outline-none focus:border-[#118dff]" />
                </label>
                <button type="button" onClick={applyCurrentMonth} className="h-9 rounded-lg border-0 bg-[#118dff] px-3 text-[10px] font-bold text-white">Поточний місяць</button>
                <div className="flex items-center gap-1" aria-label="Перегляд за днями">
                  <button type="button" title="Попередній день" aria-label="Попередній день" onClick={() => selectDay(shiftDay(dayAnchor, -1))} className="h-9 rounded-lg border border-[#d8dde3] bg-[#f7f9fb] px-3 text-sm font-bold text-[#586572]">←</button>
                  <button type="button" onClick={() => selectDay(today)} className="h-9 rounded-lg border border-[#d8dde3] bg-[#f7f9fb] px-3 text-[10px] font-bold text-[#586572]">Сьогодні</button>
                  <button type="button" title="Наступний день" aria-label="Наступний день" disabled={dayAnchor >= today} onClick={() => selectDay(shiftDay(dayAnchor, 1))} className="h-9 rounded-lg border border-[#d8dde3] bg-[#f7f9fb] px-3 text-sm font-bold text-[#586572] disabled:cursor-not-allowed disabled:opacity-35">→</button>
                </div>
                <button type="button" onClick={applyPreviousMonth} className="h-9 rounded-lg border border-[#d8dde3] bg-[#f7f9fb] px-3 text-[10px] font-bold text-[#586572]">Минулий місяць</button>
                <button type="button" onClick={applyAllPeriod} className="h-9 rounded-lg border border-[#d8dde3] bg-[#f7f9fb] px-3 text-[10px] font-bold text-[#586572]">Весь період</button>
                {view !== "webshop" && <button
                  type="button"
                  aria-pressed={compareWithPreviousYear}
                  onClick={() => setCompareWithPreviousYear((current) => !current)}
                  disabled={!dateFrom || !dateTo}
                  className="flex h-9 items-center gap-2 rounded-lg border px-3 text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-45"
                  style={{ borderColor: compareWithPreviousYear ? "#9cccf6" : "#d8dde3", background: compareWithPreviousYear ? "#eef7ff" : "#f7f9fb", color: compareWithPreviousYear ? "#176aa8" : "#586572" }}
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded border text-[9px]" style={{ borderColor: compareWithPreviousYear ? "#118dff" : "#aeb7c0", background: compareWithPreviousYear ? "#118dff" : "#fff", color: "#fff" }}>{compareWithPreviousYear ? "✓" : ""}</span>
                  Порівняти з минулим роком
                </button>}
                <div className="ml-auto pb-2 text-[10px] text-[#7f8993]">Обрано: <b className="text-[#33404c]">{data.filter.label}</b></div>
              </div>
            </section>

            {view === "overview" && (
              <div className="space-y-4">
                <section className="overflow-hidden rounded-2xl border border-[#9cccf6] bg-[linear-gradient(135deg,#eef7ff_0%,#f2fbf6_100%)] p-5 shadow-sm">
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px] xl:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-[10px] font-black uppercase tracking-[.16em] text-[#5882a7]">Загальне виконання плану · {fmtMonth(plan.month)}</div>
                        <span className="rounded-full bg-white/80 px-2 py-1 text-[9px] font-bold text-[#1771b5]">Повністю відвантажено</span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-end gap-3">
                        <div className="text-3xl font-black tracking-tight text-[#202a35] sm:text-4xl">{fmtMoney(plan.revenue)}</div>
                        <div className="pb-1 text-xs text-[#687784]">{plan.plan ? `із ${fmtMoney(plan.plan)}` : "план ще не заданий"}</div>
                      </div>
                      <div className="mt-5"><ProgressBar value={planPct} color={planPct >= 100 ? "#20a66a" : "#118dff"} /></div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div><div className="text-[9px] font-bold uppercase text-[#7f8c97]">Виконання</div><div className="mt-1 text-lg font-black text-[#26313d]">{fmtPct(plan.completionPct)}</div></div>
                        <div><div className="text-[9px] font-bold uppercase text-[#7f8c97]">Прогноз</div><div className="mt-1 text-lg font-black text-[#26313d]">{plan.forecastRevenue ? fmtMoney(plan.forecastRevenue) : "—"}</div></div>
                        <div><div className="text-[9px] font-bold uppercase text-[#7f8c97]">Прогноз плану</div><div className="mt-1 text-lg font-black text-[#26313d]">{fmtPct(forecastPct)}</div></div>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      {plan.segments.filter((segment) => segment.segment !== "Інше").map((segment) => (
                        <div key={segment.segment} className="rounded-xl border border-white/80 bg-white/75 p-3">
                          <div className="flex items-center justify-between gap-3 text-[10px]"><b className="text-[#33404c]">{segment.segment}</b><span className="font-black text-[#1771b5]">{fmtPct(segment.completionPct)}</span></div>
                          <div className="mt-1 text-[9px] text-[#7e8994]">{fmtMoney(segment.revenue)} із {fmtMoney(segment.plan)}</div>
                          <div className="mt-2"><ProgressBar value={segment.completionPct || 0} color="#118dff" /></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <SalesMetricCard label={compareWithPreviousYear ? "Продажі · до минулого року" : "Продажі"} value={fmtMoney(data.summary.shippedRevenue)} hint={!compareWithPreviousYear ? "Порівняння вимкнено" : comparisonLoading ? "Завантаження порівняння…" : yearComparisonHint(data.summary.shippedRevenue, comparisonData?.summary.shippedRevenue || 0, fmtMoney)} symbol={!comparisonData ? "₴" : data.summary.shippedRevenue >= comparisonData.summary.shippedRevenue ? "↗" : "↘"} tone={!comparisonData ? "#168b9b" : data.summary.shippedRevenue >= comparisonData.summary.shippedRevenue ? "#20a66a" : "#e45858"} />
                  <SalesMetricCard label="Відвантажено документів" value={fmtNum(data.summary.shippedDocs)} hint={!compareWithPreviousYear ? "Порівняння вимкнено" : comparisonLoading ? "Завантаження порівняння…" : yearComparisonHint(data.summary.shippedDocs, comparisonData?.summary.shippedDocs || 0, fmtNum)} symbol="D" tone="#118dff" />
                  <SalesMetricCard label="Відвантажено товарів" value={fmtNum(data.summary.shippedGoods)} hint={!compareWithPreviousYear ? "Порівняння вимкнено" : comparisonLoading ? "Завантаження порівняння…" : yearComparisonHint(data.summary.shippedGoods, comparisonData?.summary.shippedGoods || 0, (value) => `${fmtNum(value)} шт`)} symbol="#" tone="#805ad5" />
                  <SalesMetricCard label="Середній чек" value={averageCheck == null ? "—" : fmtMoney(averageCheck)} hint={!compareWithPreviousYear ? "Порівняння вимкнено" : comparisonLoading ? "Завантаження порівняння…" : averageCheck == null ? "Немає відвантажених документів" : previousAverageCheck == null ? "Немає даних для порівняння" : yearComparisonHint(averageCheck, previousAverageCheck, fmtMoney)} symbol="₴" tone="#168b9b" description="Сума продажів до вирахування повернень / кількість повністю відвантажених документів за обраний період." />
                  <SalesMetricCard label="Повернення" value={fmtMoney(data.summary.returnedRevenue)} hint={!compareWithPreviousYear ? "Порівняння вимкнено" : comparisonLoading ? "Завантаження порівняння…" : comparisonData ? yearComparisonHint(data.summary.returnedRevenue, comparisonData.summary.returnedRevenue, fmtMoney) : "Немає даних для порівняння"} symbol="↩" tone="#e45858" description="Сума повернень за документами, повністю відвантаженими в обраний період. Відбір за датою відвантаження, не за датою повернення." />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SalesMetricCard label="Плитка" value={fmtMoney(currentTile?.revenue || 0)} hint={!compareWithPreviousYear ? "Порівняння вимкнено" : comparisonLoading ? "Завантаження порівняння…" : yearComparisonHint(currentTile?.revenue || 0, previousTile?.revenue || 0, fmtMoney)} symbol="P" tone="#e39a25" />
                  <SalesMetricCard label="Сантехніка" value={fmtMoney(currentPlumbing?.revenue || 0)} hint={!compareWithPreviousYear ? "Порівняння вимкнено" : comparisonLoading ? "Завантаження порівняння…" : yearComparisonHint(currentPlumbing?.revenue || 0, previousPlumbing?.revenue || 0, fmtMoney)} symbol="S" tone="#20a66a" />
                </div>
                <SalesTrendChart days={data.summary.byDate} previousDays={compareWithPreviousYear && !comparisonLoading ? comparisonData?.summary.byDate : undefined} />
                <OrdersTrendChart days={data.summary.ordersByDate || []} previousDays={compareWithPreviousYear && !comparisonLoading ? comparisonData?.summary.ordersByDate : undefined} />
              </div>
            )}

            {view === "webshop" && <WebshopOrdersRegister dataset={webshopOrders} loading={webshopOrdersLoading} error={webshopOrdersError} page={webshopOrdersPage} syncFilter={webshopSyncFilter} paymentFilter={webshopPaymentFilter} deliveryFilter={webshopDeliveryFilter} statusFilter={webshopStatusFilter} onPageChange={setWebshopOrdersPage} onSyncFilterChange={(filter) => { setWebshopSyncFilter(filter); setWebshopOrdersPage(1); }} onPaymentFilterChange={(filter) => { setWebshopPaymentFilter(filter); setWebshopOrdersPage(1); }} onDeliveryFilterChange={(filter) => { setWebshopDeliveryFilter(filter); setWebshopOrdersPage(1); }} onStatusFilterChange={(filter) => { setWebshopStatusFilter(filter); setWebshopOrdersPage(1); }} />}

            {view === "web" && (
              <div className="space-y-4">
                {webMetrics?.mode === "demo" && <div className="rounded-xl border border-[#f1d18f] bg-[#fff8e8] p-4 text-xs text-[#805b1d]"><div className="font-black uppercase tracking-[.1em]">Тестові дані</div><div className="mt-1 leading-relaxed">{webMetrics.notice}</div></div>}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <SalesMetricCard label="Користувачі за період" value={webMetricsLoading ? "…" : webMetricsError ? "—" : fmtNum(webMetrics?.totals.visits || 0)} hint="GA4-сесії з України" symbol="U" tone="#805ad5" />
                  <SalesMetricCard label="Сесії з додаванням у кошик" value={webMetricsLoading ? "…" : webMetricsError ? "—" : fmtNum(webMetrics?.totals.addToCartSessions || 0)} hint={webMetricsError ? "GA4 не підключено локально" : `${fmtNum(webMetrics?.totals.addToCartItems || 0)} товарів додано`} symbol="C" tone="#e39a25" />
                  <SalesMetricCard label="Конверсія сесія → кошик" value={webMetricsLoading ? "…" : webMetricsError ? "—" : fmtPct(webMetrics?.totals.sessionToCartPct ?? null)} hint={`Сесії з add_to_cart / усі сесії`} symbol="%" tone="#20a66a" description="Основна вебконверсія дашборду: доля GA4-сесій, у яких товар додали в кошик." />
                  <SalesMetricCard label="Факт продажів" value={fmtMoney(data.summary.shippedRevenue)} hint={`Повністю відвантажено · ${fmtNum(data.summary.shippedGoods)} шт${data.summary.lastShippedDate ? ` · до ${fmtIsoDateShort(data.summary.lastShippedDate)}` : ""}`} symbol="₴" tone="#168b9b" description="Фактичні продажі за повністю відвантаженими документами за обраний період." />
                </div>
                {webMetricsError && <div className="rounded-xl border border-[#f0b6b6] bg-[#fff1f1] p-3 text-xs text-[#b73535]">Вебаналітика недоступна: {webMetricsError}</div>}
                <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5e8eb] px-5 py-4">
                    <div><h2 className="text-sm font-black text-[#26313d]">Вебаналітика по місяцях</h2><p className="mt-1 text-[10px] text-[#8a939c]">Основна конверсія — сесія → add_to_cart у GA4 · фактичні замовлення показані лише як довідковий показник</p></div>
                    {webMetrics?.dataThrough && <span className="text-[10px] text-[#7b8691]">Дані по {fmtIsoDateShort(webMetrics.dataThrough)}</span>}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[650px] border-collapse text-xs">
                      <thead className="bg-[#f7f9fb] text-[#75808b]"><tr><th className="px-5 py-3 text-left">Місяць</th><th className="px-4 py-3 text-right">Сесії</th><th className="px-4 py-3 text-right">Сесії з add_to_cart</th><th className="px-4 py-3 text-right">Товарів додано</th><th className="px-4 py-3 text-right">Конверсія</th><th className="px-5 py-3 text-right">Товарів / сесію</th></tr></thead>
                      <tbody>{(webMetrics?.months || []).map((month) => <tr key={month.month} className="border-t border-[#edf0f2]"><td className="px-5 py-3 font-bold text-[#33404c]">{fmtMonth(month.month)}</td><td className="px-4 py-3 text-right tabular-nums">{fmtNum(month.visits)}</td><td className="px-4 py-3 text-right tabular-nums text-[#687582]">{fmtNum(month.addToCartSessions)}</td><td className="px-4 py-3 text-right tabular-nums text-[#687582]">{fmtNum(month.addToCartItems)}</td><td className="px-4 py-3 text-right font-black tabular-nums text-[#168b5c]">{fmtPct(month.sessionToCartPct)}</td><td className="px-5 py-3 text-right tabular-nums text-[#b26f11]">{fmtDecimal(month.avgCartItemsPerSession)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </section>
                {!webMetricsError && webMetrics?.conversions && (
                  <section>
                    <div className="mb-3"><h2 className="text-sm font-black text-[#26313d]">Топ конверсій</h2><p className="mt-1 text-[10px] text-[#8a939c]">{webMetrics.conversions.definition}</p></div>
                    <div className="grid gap-4 xl:grid-cols-3">
                      <ConversionRanking title="Категорії" rows={webMetrics.conversions.categories} />
                      <ConversionRanking title="Бренди" rows={webMetrics.conversions.brands} />
                      <ConversionRanking title="Товари" rows={webMetrics.conversions.products} />
                    </div>
                  </section>
                )}
              </div>
            )}

            {view === "brands" && <CategoryRankingList title="Продажі за брендами" itemNoun="бренд" color="#20a66a" items={data.summary.brands} comparisonItems={comparisonData?.summary.brands || []} metric={rankingMetric} onMetricChange={setRankingMetric} productsByCategory={brandProducts} expandedCategory={expandedBrand} loadingCategory={loadingBrand} categoryError={brandError} onToggleCategory={(brand) => setExpandedBrand((current) => current === brand ? null : brand)} />}

            {view === "categories" && <CategoryRankingList title="Продажі за категоріями" itemNoun="категорію" color="#e39a25" items={data.summary.categories} comparisonItems={comparisonData?.summary.categories || []} metric={rankingMetric} onMetricChange={setRankingMetric} productsByCategory={categoryProducts} expandedCategory={expandedCategory} loadingCategory={loadingCategory} categoryError={categoryError} onToggleCategory={(category) => setExpandedCategory((current) => current === category ? null : category)} />}

            {view === "department" && (
              <div className="space-y-4">
                <ManagerPlanOverview managers={data.summary.managers || []} month={plan.month} selectedSeller={selectedManager} onSelectSeller={setSelectedManager} />
                <DocumentStatusOverview states={selectedManagerData?.states || data.summary.states} cancelReasons={selectedManagerData?.cancelReasons || data.summary.cancelReasons || []} documentStatusesBySegment={[]} title={`Статуси та скасування · ${selectedManager || "Усі менеджери"}`} showSegmentFilter={false} />
              </div>
            )}

            {view === "statuses" && (
              <div className="space-y-4">
                <DocumentSegmentFilter value={selectedDocumentSegment} onChange={setSelectedDocumentSegment} />
                <StatusFilter selectedStatuses={selectedStatuses} onReset={resetStatuses} onToggle={toggleStatus} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <SalesMetricCard label="Усього документів" value={fmtNum(statusDocsTotal)} hint={`сегмент: ${selectedDocumentSegment}`} symbol="Σ" tone="#118dff" />
                  <SalesMetricCard label="Сума документів" value={fmtMoney(statusRevenueTotal)} hint={`${statusLabel} · ${selectedDocumentSegment}`} symbol="₴" tone="#20a66a" />
                  <SalesMetricCard label="Скасовано" value={fmtNum(canceledStatusDocs)} hint={fmtMoney(canceledStatusRevenue)} symbol="×" tone="#e45858" />
                </div>
                <StatusSummaryList title={`Статуси документів · ${selectedDocumentSegment}`} subtitle="Кількість, частка та сума по кожному статусу всередині вибраного сегмента" rows={visibleStatusRows} labelKey="state" />
              </div>
            )}

            {view === "cancellations" && (
              <div className="space-y-4">
                <DocumentSegmentFilter value={selectedDocumentSegment} onChange={setSelectedDocumentSegment} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <SalesMetricCard label="Скасованих документів" value={fmtNum(canceledStatusDocs)} hint={`сегмент: ${selectedDocumentSegment}`} symbol="×" tone="#e45858" />
                  <SalesMetricCard label="Сума скасувань" value={fmtMoney(canceledStatusRevenue)} hint="втрачений оборот" symbol="₴" tone="#e39a25" />
                  <SalesMetricCard label="Частка скасувань" value={statusDocsTotal ? fmtPct((canceledStatusDocs / statusDocsTotal) * 100) : "—"} hint="від документів сегмента" symbol="%" tone="#805ad5" />
                </div>
                <StatusSummaryList title={`Причини скасування · ${selectedDocumentSegment}`} subtitle="Частка кожної причини серед скасувань вибраного сегмента" rows={visibleCancelReasonRows} labelKey="reason" tone="#e45858" shareLabel="від скасувань" />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
