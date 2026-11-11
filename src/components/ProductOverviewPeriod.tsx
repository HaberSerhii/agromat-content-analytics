"use client";
import { ProductOverviewTrendChart } from "@/components/ProductOverviewTrendChart";
import { useState } from "react";
import type {
  OverviewPeriod,
  OverviewPoint,
} from "@/lib/product-overview-period";
const metrics = [
  { key: "newProducts", label: "Нові товари" },
  { key: "ctr", label: "CTR · Каталог → PDP" },
  { key: "atc", label: "ATC · PDP → Кошик" },
  { key: "contentScore", label: "Content Score" },
] as const;
type Metric = (typeof metrics)[number]["key"];
function total(points: OverviewPoint[], metric: Metric): number | null {
  if (metric === "ctr") {
    const impressions = points.reduce((s, p) => s + p.impressions, 0);
    return impressions
      ? (points.reduce((s, p) => s + p.views, 0) / impressions) * 100
      : null;
  }
  const values = points
    .map((p) => p[metric])
    .filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}
const format = (n: number | null, key: Metric) =>
  n === null
    ? "—"
    : key === "contentScore"
      ? n.toFixed(2)
      : `${n.toLocaleString("uk-UA", { maximumFractionDigits: key === "ctr" || key === "atc" ? 2 : 0 })}${key === "ctr" || key === "atc" ? "%" : ""}`;
const formatChange = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""} ${Math.abs(rounded).toFixed(2)}`;
};
const changeColor = (value: number | null) => value != null && Math.round(value * 100) > 0 ? "text-[#087a55]" : value != null && Math.round(value * 100) < 0 ? "text-[#c63f3f]" : "text-slate-500";
export function ProductOverviewPeriod({
  data,
  from,
  to,
  onFrom,
  onTo,
  loading,
  analyticsLoading,
}: {
  data: OverviewPeriod | null | undefined;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  loading: boolean;
  analyticsLoading: boolean;
}) {
  const [metric, setMetric] = useState<Metric>("ctr");
  const [compare, setCompare] = useState(false);
  const current = data?.current || [],
    previous = data?.year || [];
  const values = [...current, ...(compare ? previous : [])].flatMap((p) =>
    p[metric] === null ? [] : [p[metric] as number],
  );
  return (
    <section className="mb-5 space-y-4" aria-busy={loading}>
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4">
        <label className="text-xs font-bold">
          Період від
          <input
            aria-label="Період від"
            type="date"
            value={from}
            max={to}
            onChange={(e) => onFrom(e.target.value)}
            className="mt-2 block rounded-lg border p-2"
          />
        </label>
        <label className="text-xs font-bold">
          до
          <input
            aria-label="Період до"
            type="date"
            value={to}
            min={from}
            onChange={(e) => onTo(e.target.value)}
            className="mt-2 block rounded-lg border p-2"
          />
        </label>
        <span className="pb-2 text-xs text-slate-500">
          Усі фільтри каталогу застосовуються до показників і графіка
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => {
          const value =
            m.key === "contentScore"
              ? (data?.contentScore ?? null)
              : m.key === "atc" ? (data?.atcTotals?.current ?? null) : total(current, m.key);
          return (
            <div key={m.key} className="rounded-2xl border bg-white p-5">
              <h3 className="text-xs font-bold text-slate-500">{m.label}</h3>
              <p className="my-3 text-3xl font-black">
                {loading ||
                (analyticsLoading && (m.key === "ctr" || m.key === "atc"))
                  ? "…"
                  : format(value, m.key)}
                {m.key === "contentScore" && !loading && data?.contentScoreChange?.dayDelta != null && (
                  <span className={`ml-2 inline-block text-sm font-bold align-middle ${changeColor(data.contentScoreChange.dayDelta)}`}>
                    {formatChange(data.contentScoreChange.dayDelta)}
                  </span>
                )}
              </p>
              {m.key === "ctr" || m.key === "atc" ? (
                (["year", "month"] as const).map((period) => {
                  const before = m.key === "atc" ? (data?.atcTotals?.[period] ?? null) : total(data?.[period] || [], m.key);
                  const diff =
                    value !== null && before !== null && before > 0
                      ? Math.round(((value - before) / before) * 10000) / 100
                      : null;
                  return (
                    <p key={period} className="mt-1 text-xs text-slate-500">
                      {diff === null
                        ? "—"
                        : `${diff > 0 ? "+" : ""}${diff.toLocaleString("uk-UA", { maximumFractionDigits: 2 })}%`}{" "}
                      · до{" "}
                      {period === "year" ? "минулого року" : "минулого місяця"}
                    </p>
                  );
                })
              ) : m.key === "newProducts" ? (
                <p className="text-xs text-slate-500">
                  Уперше з’явилися за вибраний період
                </p>
              ) : null}
              {m.key === "contentScore" && !loading && data?.contentScoreError && (
                <p role="alert" className="text-xs text-[#c63f3f]">{data.contentScoreError}</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="analytics-chart-card rounded-2xl border border-[#dfe4ea] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-black text-[#26313d]">
              Щоденна динаміка
            </h3>
            <p className="mt-1 text-[10px] text-[#8a939c]">
              Наведіть на точку, щоб побачити показники за день
            </p>
            <div className="mt-2 flex gap-4 text-[9px] font-bold text-[#687582]">
              <span>
                <i className="mr-1 inline-block h-0.5 w-4 bg-[#118dff] align-middle" />
                Обраний період
              </span>
              {compare && (
                <span>
                  <i className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-[#8a939c] align-middle" />
                  Минулий рік
                </span>
              )}
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[9px] font-bold uppercase tracking-[.12em] text-[#8a939c]">
              {metric === "contentScore" ? "Поточний стан" : "За період"}
            </div>
            <div className="analytics-chart-total mt-1 font-black text-[#26313d]">
              {loading ||
              (analyticsLoading && (metric === "ctr" || metric === "atc"))
                ? "…"
                : format(
                    metric === "contentScore"
                      ? (data?.contentScore ?? null)
                      : metric === "atc" ? (data?.atcTotals?.current ?? null) : total(current, metric),
                    metric,
                  )}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            Порівняти з минулим роком
          </label>
        </div>
        <div className="my-4 flex flex-wrap gap-2">
          {metrics.map((m) => (
            <button
              key={m.key}
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${metric === m.key ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {values.length > 0 ? (
          <div className="mt-6">
            <ProductOverviewTrendChart
              key={metric + from + to}
              current={current}
              previous={previous}
              metric={metric}
              label={metrics.find((m) => m.key === metric)!.label}
              compare={compare}
            />
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-slate-500">
            {loading ||
            (analyticsLoading && (metric === "ctr" || metric === "atc"))
              ? "Завантаження…"
              : metric === "contentScore"
                ? "Історичні щоденні значення Content Score ще не збережені. Поточний стан наведено вище."
                : "Немає даних за вибраний період"}
          </p>
        )}
        {data &&
          data.analyticsLoaded !== false &&
          !analyticsLoading &&
          !data.analyticsAvailable && (
            <p className="mt-3 text-xs text-amber-700">
              Аналітика GA4 недоступна. CTR та ATC не підміняються нулями.
            </p>
          )}
      </div>
    </section>
  );
}
