"use client";
import { useState } from "react";
import type {
  OverviewPeriod,
  OverviewPoint,
} from "@/lib/product-overview-period";
const metrics = [
  { key: "newProducts", label: "Нові товари" },
  { key: "ctr", label: "CTR · Каталог → PDP" },
  { key: "atc", label: "ATC · Додавання до кошика" },
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
    : `${n.toLocaleString("uk-UA", { maximumFractionDigits: key === "ctr" || key === "contentScore" ? 2 : 0 })}${key === "ctr" ? "%" : ""}`;
export function ProductOverviewPeriod({
  data,
  from,
  to,
  onFrom,
  onTo,
  loading,
}: {
  data: OverviewPeriod | null | undefined;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  loading: boolean;
}) {
  const [metric, setMetric] = useState<Metric>("ctr");
  const [compare, setCompare] = useState(false);
  const current = data?.current || [],
    previous = data?.year || [];
  const values = [...current, ...(compare ? previous : [])].flatMap((p) =>
    p[metric] === null ? [] : [p[metric] as number],
  );
  const max = Math.max(1, ...values);
  const x = (i: number, length: number) =>
      50 + (i / Math.max(1, length - 1)) * 900,
    y = (v: number) => 220 - (v / max) * 180;
  const path = (points: OverviewPoint[]) =>
    points
      .map((p, i) =>
        p[metric] === null
          ? ""
          : `${i === 0 || points[i - 1][metric] === null ? "M" : "L"}${x(i, points.length)},${y(p[metric] as number)}`,
      )
      .join(" ");
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
              : total(current, m.key);
          return (
            <div key={m.key} className="rounded-2xl border bg-white p-5">
              <h3 className="text-xs font-bold text-slate-500">{m.label}</h3>
              <p className="my-3 text-3xl font-black">
                {loading ? "…" : format(value, m.key)}
              </p>
              {m.key === "ctr" || m.key === "atc" ? (
                (["year", "month"] as const).map((period) => {
                  const before = total(data?.[period] || [], m.key);
                  const diff =
                    value !== null && before !== null ? value - before : null;
                  return (
                    <p key={period} className="mt-1 text-xs text-slate-500">
                      {diff === null
                        ? "—"
                        : `${diff > 0 ? "+" : ""}${diff.toLocaleString("uk-UA", { maximumFractionDigits: 2 })}${m.key === "ctr" ? " в.п." : ""}`}{" "}
                      · до{" "}
                      {period === "year" ? "минулого року" : "минулого місяця"}
                    </p>
                  );
                })
              ) : (
                <p className="text-xs text-slate-500">
                  {m.key === "contentScore"
                    ? "Поточний середній бал · товари з налаштованими атрибутами"
                    : "Уперше з’явилися за вибраний період"}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="font-bold">Щоденна динаміка</h3>
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
          <>
            <svg
              viewBox="0 0 1000 260"
              role="img"
              aria-label={`Щоденна динаміка: ${metrics.find((m) => m.key === metric)?.label}`}
              className="w-full"
            >
              {[0, 0.5, 1].map((t) => (
                <g key={t}>
                  <line
                    x1="50"
                    x2="950"
                    y1={y(max * t)}
                    y2={y(max * t)}
                    stroke="#e2e8f0"
                  />
                  <text x="0" y={y(max * t)} fontSize="12" fill="#64748b">
                    {format(max * t, metric)}
                  </text>
                </g>
              ))}
              <path
                d={path(current)}
                fill="none"
                stroke="#118dff"
                strokeWidth="3"
              />
              {compare && (
                <path
                  d={path(previous)}
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="2"
                  strokeDasharray="6 5"
                />
              )}
              {current.map(
                (p, i) =>
                  p[metric] !== null && (
                    <circle
                      key={p.date}
                      cx={x(i, current.length)}
                      cy={y(p[metric] as number)}
                      r="3"
                      fill="#118dff"
                    >
                      <title>
                        {p.date}: {format(p[metric], metric)}
                      </title>
                    </circle>
                  ),
              )}
              <text x="50" y="250" fontSize="12">
                {from}
              </text>
              <text x="950" y="250" textAnchor="end" fontSize="12">
                {to}
              </text>
            </svg>
            <p className="text-xs text-slate-500">
              Синя лінія — вибраний період
              {compare ? " · Пунктир — відповідний період торік" : ""}
            </p>
          </>
        ) : (
          <p className="py-12 text-center text-sm text-slate-500">
            {loading
              ? "Завантаження…"
              : metric === "contentScore"
                ? "Історичні щоденні значення Content Score ще не збережені. Поточний стан наведено вище."
                : "Немає даних за вибраний період"}
          </p>
        )}
        {data && !data.analyticsAvailable && (
          <p className="mt-3 text-xs text-amber-700">
            Аналітика GA4 недоступна. CTR та ATC не підміняються нулями.
          </p>
        )}
      </div>
    </section>
  );
}
