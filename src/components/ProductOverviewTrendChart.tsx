"use client";

import { useState } from "react";
import { ChartTrendSeries } from "@/components/ChartTrendSeries";
import type { OverviewPoint } from "@/lib/product-overview-period";

type Metric = "newProducts" | "ctr" | "atc" | "contentScore";
const chartX = (index: number, length: number) =>
  length <= 1 ? 50 : 2 + (index / (length - 1)) * 96;
const chartY = (value: number, max: number) => 92 - (value / max) * 84;
const dateLabel = (date: string) => date.split("-").reverse().join("-");
const format = (value: number | null, metric: Metric) =>
  value === null
    ? "—"
    : `${value.toLocaleString("uk-UA", { maximumFractionDigits: metric === "ctr" || metric === "atc" || metric === "contentScore" ? 2 : 0 })}${metric === "ctr" || metric === "atc" ? "%" : ""}`;
function previousYear(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return `${year - 1}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function ProductOverviewTrendChart({
  current,
  previous,
  metric,
  label,
  compare,
}: {
  current: OverviewPoint[];
  previous: OverviewPoint[];
  metric: Metric;
  label: string;
  compare: boolean;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const byDate = new Map(previous.map((p) => [p.date, p]));
  const comparison = current.map((p) => byDate.get(previousYear(p.date)));
  const values = [...current, ...(compare ? comparison : [])].flatMap((p) =>
    p?.[metric] == null ? [] : [p[metric] as number],
  );
  const peak = Math.max(1, ...values);
  const step =
    metric === "ctr" || metric === "atc" || metric === "contentScore"
      ? Math.pow(10, Math.floor(Math.log10(peak))) / 2
      : Math.max(1, Math.ceil(peak / 4));
  const max = Math.ceil(peak / step) * step;
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((v) => max * v);
  const point = (p: OverviewPoint | undefined, i: number) =>
    p?.[metric] == null
      ? null
      : { x: chartX(i, current.length), y: chartY(p[metric] as number, max) };
  const hovered = hoveredIndex === null ? null : current[hoveredIndex];
  const hoveredPrevious =
    hoveredIndex === null ? null : comparison[hoveredIndex];
  const left = hoveredIndex === null ? 0 : chartX(hoveredIndex, current.length);
  const labels = [
    ...new Set(
      Array.from({ length: Math.min(6, current.length) }, (_, i) =>
        Math.round(
          (i * (current.length - 1)) /
            Math.max(1, Math.min(6, current.length) - 1),
        ),
      ),
    ),
  ];
  return (
    <div className="grid grid-cols-[20px_52px_minmax(0,1fr)] gap-2 sm:grid-cols-[24px_68px_minmax(0,1fr)]">
      <div className="flex h-56 items-center justify-center overflow-visible">
        <span className="-rotate-90 whitespace-nowrap text-[9px] font-black uppercase tracking-[.08em] text-[#687582]">
          {label}
        </span>
      </div>
      <div className="relative h-56 text-[9px] font-semibold text-[#7d8994]">
        {ticks.map((value) => (
          <span
            key={value}
            className="absolute right-0 -translate-y-1/2 tabular-nums"
            style={{ top: `${chartY(value, max)}%` }}
          >
            {format(value, metric)}
          </span>
        ))}
      </div>
      <div className="min-w-0">
        <div
          className="relative h-56 bg-white"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          {hovered && (
            <div
              role="status"
              className="pointer-events-none absolute top-2 z-20 min-w-[180px] rounded-xl border border-[#cbdfee] bg-white p-3 text-[10px] shadow-lg"
              style={{
                left: `${left}%`,
                transform: `translateX(${left > 80 ? "-100%" : left < 20 ? "0" : "-50%"})`,
              }}
            >
              <div className="font-black text-[#26313d]">
                {dateLabel(hovered.date)}
              </div>
              <div className="mt-2 flex justify-between gap-4 text-[#6e7a86]">
                <span>{label}</span>
                <b className="text-[#118dff]">
                  {format(hovered[metric], metric)}
                </b>
              </div>
              {metric === "ctr" && (
                <>
                  <div className="mt-1 flex justify-between gap-4 text-[#6e7a86]">
                    <span>Покази в каталозі</span>
                    <b>{hovered.impressions.toLocaleString("uk-UA")}</b>
                  </div>
                  <div className="mt-1 flex justify-between gap-4 text-[#6e7a86]">
                    <span>Перегляди картки</span>
                    <b>{hovered.views.toLocaleString("uk-UA")}</b>
                  </div>
                </>
              )}
              {compare && (
                <div className="mt-2 flex justify-between gap-4 border-t border-[#edf0f2] pt-2 text-[#6e7a86]">
                  <span>
                    Рік тому
                    {hoveredPrevious
                      ? ` · ${dateLabel(hoveredPrevious.date)}`
                      : ""}
                  </span>
                  <b className="text-[#687582]">
                    {format(hoveredPrevious?.[metric] ?? null, metric)}
                  </b>
                </div>
              )}
            </div>
          )}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            role="img"
            aria-label={`Щоденна динаміка: ${label}`}
          >
            {ticks.map((value) => (
              <line
                key={value}
                x1="2"
                x2="98"
                y1={chartY(value, max)}
                y2={chartY(value, max)}
                stroke="#f0f3f6"
                strokeWidth="0.5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line
              x1="2"
              x2="2"
              y1="8"
              y2="92"
              stroke="#eef1f4"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1="2"
              x2="98"
              y1="92"
              y2="92"
              stroke="#eef1f4"
              vectorEffect="non-scaling-stroke"
            />
            {compare && (
              <ChartTrendSeries
                points={comparison.map(point)}
                baseline={92}
                comparison
              />
            )}
            <ChartTrendSeries points={current.map(point)} baseline={92} />
            {hovered && (
              <line
                x1={left}
                x2={left}
                y1="8"
                y2="92"
                stroke="#cbdfee"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {current.map((p, i) =>
            p[metric] === null ? null : (
              <button
                key={p.date}
                type="button"
                aria-label={`${dateLabel(p.date)}: ${format(p[metric], metric)}`}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                onFocus={() => setHoveredIndex(i)}
                onBlur={() => setHoveredIndex(null)}
                onClick={() => setHoveredIndex(i)}
                className="absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none"
                style={{
                  left: `${chartX(i, current.length)}%`,
                  top: `${chartY(p[metric] as number, max)}%`,
                }}
              >
                <span
                  className={`block rounded-full border-2 border-[#118dff] bg-white shadow-sm transition-all ${hoveredIndex === i ? "h-2.5 w-2.5 ring-2 ring-[#118dff]/20" : "h-2 w-2"}`}
                />
              </button>
            ),
          )}
        </div>
        <div className="relative mt-2 h-4 text-[9px] font-semibold text-[#7d8994]">
          {labels.map((i) => (
            <span
              key={current[i].date}
              className="absolute whitespace-nowrap"
              style={{
                left: `${chartX(i, current.length)}%`,
                transform: `translateX(${i === 0 ? "0" : i === current.length - 1 ? "-100%" : "-50%"})`,
              }}
            >
              {dateLabel(current[i].date)}
            </span>
          ))}
        </div>
        <div className="mt-1 text-center text-[9px] font-black uppercase tracking-[.08em] text-[#687582]">
          Дата
        </div>
      </div>
    </div>
  );
}
