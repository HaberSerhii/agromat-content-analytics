"use client";

import { relativeChange, type DailyComparisons } from "@/lib/product-daily-comparison";
import { useState } from "react";
import type { DailyProductPoint } from "@/lib/product-daily-dynamics";

const metrics = { impressions: { label: "Impressions", color: "#118dff" }, ctr: { label: "CTR", color: "#6d5bd0" }, atc: { label: "ATC", color: "#087a55" }, contentScore: { label: "CS", color: "#e39a25" } };
type Metric = keyof typeof metrics;
const format = (value: number | null, metric: Metric) => value == null ? "Немає даних" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: metric === "impressions" ? 0 : 2 }).format(value)}${metric === "ctr" || metric === "atc" ? "%" : ""}`;

export function ProductDailyDynamics({ points, year = [], summary, error, loading, scope, month: selectedMonth, maxMonth, onMonthChange }: { points: DailyProductPoint[]; year?: DailyProductPoint[]; summary?: DailyComparisons; month?: string; maxMonth?: string; onMonthChange?: (month: string) => void; error?: string; loading: boolean; scope: string }) {
  const [compare, setCompare] = useState(false);
  const [metric, setMetric] = useState<Metric>("impressions");
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const config = metrics[metric];
  const width = 1100, height = 250, left = 70, right = 25, top = 20, bottom = 38;
  const max = Math.max(metric === "contentScore" ? 100 : 1, ...[...points, ...(compare ? year : [])].map(point => point[metric] ?? 0));
  const x = (index: number) => left + index / Math.max(points.length - 1, 1) * (width - left - right);
  const y = (value: number) => height - bottom - value / max * (height - top - bottom);
  const linePath = (series: DailyProductPoint[]) => {
    let path = "", connected = false;
    series.forEach((point, index) => {
      const value = point[metric];
      if (value == null) { connected = false; return; }
      path += `${connected ? "L" : "M"}${x(index)},${y(value)} `; connected = true;
    });
    return path;
  };
  const active = points.find(point => point.date === activeDate);
  const activeIndex = points.findIndex(point => point.date === activeDate);
  const prior = activeIndex >= 0 ? year[activeIndex] : null;
  const totals = summary?.[metric];
  const totalGrowth = relativeChange(totals?.current ?? null, totals?.year ?? null);
  const pointGrowth = relativeChange(active?.[metric] ?? null, prior?.[metric] ?? null);
  const growthText = (value: number | null) => value == null ? "Немає порівняння" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${new Intl.NumberFormat("uk-UA", {maximumFractionDigits:1}).format(Math.abs(value))}%`;
  const growthColor = (value: number | null) => value == null || Math.abs(value) < .05 ? "text-[#78838e]" : value > 0 ? "text-[#087a55]" : "text-[#c63f3f]";
  const currentEnd = totals?.through ?? null;
  const yearEnd = totals?.yearThrough ?? null;
  const popupValue = active?.[metric] ?? prior?.[metric] ?? 0;
  const popupAbove = y(popupValue) > height / 2;
  const month = selectedMonth || points[0]?.date.slice(0,7);
  return <section className="rounded-2xl border border-[#dfe4ea] bg-white p-4" aria-label="Денна динаміка товарів">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[9px] font-black uppercase tracking-[.14em] text-[#118dff]">Динаміка місяця · по днях</p><div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2"><h2 className="text-sm font-black text-[#26313d]">{config.label} · {month || "Поточний місяць"}</h2>{!loading && totals && <div className="flex flex-wrap items-center gap-2 text-xs"><strong style={{color:config.color}}>{format(totals.current,metric)}</strong>{compare && <><span className="text-[#78838e]">проти {format(totals.year,metric)}</span><strong className={`rounded-lg bg-[#f5f7fa] px-2 py-1 ${growthColor(totalGrowth)}`}>{growthText(totalGrowth)} р/р</strong></>}</div>}</div><p className="mt-1 text-[10px] text-[#78838e]">{scope}</p></div>
      <div className="flex flex-wrap items-center gap-3">
      {onMonthChange && <label className="text-[10px] font-bold text-[#78838e]">Місяць і рік<input type="month" aria-label="Місяць і рік графіка" min="2000-01" max={maxMonth} value={month || ""} onChange={event => onMonthChange(event.target.value)} className="ml-2 rounded-lg border border-[#dfe4ea] bg-white px-2 py-2 text-xs text-[#26313d]" /></label>}
      <div role="group" aria-label="Показник графіка" className="flex flex-wrap gap-1 rounded-xl bg-[#f5f7fa] p-1">{(Object.keys(metrics) as Metric[]).map(key => <button key={key} type="button" aria-pressed={metric === key} onClick={() => { setMetric(key); setActiveDate(null); }} className={`rounded-lg px-3 py-2 text-[11px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#118dff] ${metric === key ? "bg-white text-[#118dff] shadow-sm" : "text-[#78838e] hover:bg-white"}`}>{metrics[key].label}</button>)}</div>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#78838e]">
      <div className="flex flex-wrap gap-4"><span><i className="mr-1 inline-block h-0.5 w-4 align-middle" style={{ background: config.color }} />{points[0]?.date} — {currentEnd || "немає завершених днів"}</span>{compare && <span><i className="mr-1 inline-block w-4 border-t-2 border-dashed border-[#8a939c] align-middle" />{year[0]?.date} — {yearEnd || "немає даних"} · минулий рік</span>}</div>
      <label className="flex cursor-pointer items-center gap-2 text-xs font-bold"><input type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)} />Порівняти з минулим роком</label>
    </div>
    {loading ? <p role="status" className="py-16 text-center text-xs text-[#78838e]">Завантаження денної динаміки…</p> : <>
      {[...points, ...(compare ? year : [])].some(point => point[metric] != null) ? <div className="mt-5 overflow-x-auto"><div className="relative min-w-[600px]" onMouseLeave={() => setActiveDate(null)} onKeyDown={event => { if(event.key === "Escape") setActiveDate(null); }}><svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[600px]" role="img" aria-label={`${config.label} за днями поточного місяця`}>
        {[0,1,2,3,4].map(tick => { const value = max * tick / 4; return <g key={tick}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} stroke="#e8edf1" /><text x={left-10} y={y(value)+4} textAnchor="end" fontSize="10" fill="#78838e">{new Intl.NumberFormat("uk-UA", {notation:"compact",maximumFractionDigits:1}).format(value)}{metric === "ctr" || metric === "atc" ? "%" : ""}</text></g>; })}
        {compare && <path d={linePath(year)} fill="none" stroke="#8a939c" strokeWidth="2.5" strokeDasharray="6 5" />}
        {compare && year.map((point,index) => point[metric] != null ? <circle key={point.date} cx={x(index)} cy={y(point[metric]!)} r="3.5" fill="#8a939c" tabIndex={0} onMouseEnter={() => setActiveDate(points[index]?.date ?? null)} aria-describedby={active ? "daily-product-tooltip" : undefined} onFocus={() => setActiveDate(points[index]?.date ?? null)} onClick={() => setActiveDate(points[index]?.date ?? null)} aria-label={`${point.date}: ${format(point[metric], metric)}`}></circle> : null)}
        <path d={linePath(points)} fill="none" stroke={config.color} strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((point,index) => <g key={point.date}><text x={x(index)} y={height-12} textAnchor="middle" fontSize="10" fill="#78838e">{point.date.slice(8)}</text>{point[metric] != null && <circle cx={x(index)} cy={y(point[metric]!)} r={activeDate === point.date ? 6 : 4} fill={config.color} stroke="white" strokeWidth="2" tabIndex={0} role="button" aria-label={`${point.date}: ${format(point[metric], metric)}`} aria-describedby={active ? "daily-product-tooltip" : undefined} onFocus={() => setActiveDate(point.date)} onMouseEnter={() => setActiveDate(point.date)} onClick={() => setActiveDate(point.date)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveDate(point.date); } }}></circle>}</g>)}
      </svg>
        {active && <div id="daily-product-tooltip" role="tooltip" className="pointer-events-none absolute z-10 w-[300px] rounded-xl border border-[#dfe4ea] bg-white p-3 shadow-xl" style={{left:`clamp(156px, ${x(activeIndex)/width*100}%, calc(100% - 156px))`,top:`clamp(8px, calc(${y(popupValue)/height*100}% ${popupAbove ? "- 104px" : "+ 8px"}), calc(100% - 104px))`,transform:"translateX(-50%)"}}>
          <p className="mb-2 text-[10px] font-bold text-[#78838e]">{active.date.slice(8)}.{active.date.slice(5,7)} · {config.label}</p>
          <div className={`grid items-center gap-3 ${compare ? "grid-cols-[1fr_1fr_1.2fr]" : "grid-cols-1"}`}>
            <div><p className="text-[10px] text-[#78838e]">{active.date.slice(0,4)}</p><strong className="text-sm" style={{color:config.color}}>{format(active[metric],metric)}</strong></div>
            {compare && <><div><p className="text-[10px] text-[#78838e]">{prior?.date.slice(0,4) || "Минулий рік"}</p><strong className="text-sm text-[#65717e]">{format(prior?.[metric] ?? null,metric)}</strong></div><div className={`text-center ${growthColor(pointGrowth)}`}><strong className="text-sm">{growthText(pointGrowth)}</strong><p className="text-[9px]">рік до року</p></div></>}
          </div>
        </div>}
      </div></div> : <p className="py-16 text-center text-xs text-[#78838e]">Немає денних даних для цього показника</p>}
      {compare && !year.some(point => point[metric] != null) && <p className="mt-2 text-xs text-[#78838e]">Немає даних за аналогічний період минулого року для вибраного показника та товарів.</p>}
      <p className="mt-2 text-[10px] text-[#8a949e]">{metric === "contentScore" ? "CS — середнє серед товарів із налаштованими обов’язковими атрибутами. Підсумок — останній збережений CS, торік — той самий день. Зберігається під час відкриття аналізу; останнє значення дня. Минулі дні без збереженого CS показано як пропуски." : "CTR = перегляди PDP / Impressions · ATC = додавання в кошик / перегляди PDP. Порівняння — за однакові завершені дні до останньої доступної дати GA4. CTR і ATC за період розраховано із сумарних подій."}</p>
    </>}
    {error && !loading && <p role="alert" className="mt-2 text-xs text-[#b73535]">{error}</p>}
  </section>;
}
