"use client";

import { useState } from "react";
import type { DailyProductPoint } from "@/lib/product-daily-dynamics";

const metrics = { impressions: { label: "Impressions", color: "#118dff" }, ctr: { label: "CTR", color: "#6d5bd0" }, atc: { label: "ATC", color: "#087a55" }, contentScore: { label: "CS", color: "#e39a25" } };
type Metric = keyof typeof metrics;
const format = (value: number | null, metric: Metric) => value == null ? "Немає даних" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: metric === "impressions" ? 0 : 2 }).format(value)}${metric === "ctr" || metric === "atc" ? "%" : ""}`;

export function ProductDailyDynamics({ points, error, loading, scope }: { points: DailyProductPoint[]; error?: string; loading: boolean; scope: string }) {
  const [metric, setMetric] = useState<Metric>("impressions");
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const config = metrics[metric];
  const width = 1100, height = 250, left = 70, right = 25, top = 20, bottom = 38;
  const max = Math.max(metric === "contentScore" ? 100 : 1, ...points.map(point => point[metric] ?? 0));
  const x = (index: number) => left + index / Math.max(points.length - 1, 1) * (width - left - right);
  const y = (value: number) => height - bottom - value / max * (height - top - bottom);
  let path = "", connected = false;
  points.forEach((point, index) => {
    const value = point[metric];
    if (value == null) { connected = false; return; }
    path += `${connected ? "L" : "M"}${x(index)},${y(value)} `; connected = true;
  });
  const active = points.find(point => point.date === activeDate);
  const month = points[0]?.date.slice(0,7);
  return <section className="rounded-2xl border border-[#dfe4ea] bg-white p-4" aria-label="Денна динаміка товарів">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[9px] font-black uppercase tracking-[.14em] text-[#118dff]">Поточний місяць · по днях</p><h2 className="mt-1 text-sm font-black text-[#26313d]">{config.label} · {month || "Поточний місяць"}</h2><p className="mt-1 text-[10px] text-[#78838e]">{scope}</p></div>
      <div role="group" aria-label="Показник графіка" className="flex flex-wrap gap-1 rounded-xl bg-[#f5f7fa] p-1">{(Object.keys(metrics) as Metric[]).map(key => <button key={key} type="button" aria-pressed={metric === key} onClick={() => { setMetric(key); setActiveDate(null); }} className={`rounded-lg px-3 py-2 text-[11px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#118dff] ${metric === key ? "bg-white text-[#118dff] shadow-sm" : "text-[#78838e] hover:bg-white"}`}>{metrics[key].label}</button>)}</div>
    </div>
    {loading ? <p role="status" className="py-16 text-center text-xs text-[#78838e]">Завантаження денної динаміки…</p> : <>
      <p className="mt-3 min-h-5 text-xs font-bold" style={{ color: config.color }} aria-live="polite">{active ? `${active.date.split("-").reverse().join(".")} · ${format(active[metric], metric)}` : "Оберіть точку, щоб побачити значення за день"}</p>
      {points.some(point => point[metric] != null) ? <div className="overflow-x-auto"><svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[600px]" role="img" aria-label={`${config.label} за днями поточного місяця`}>
        {[0,1,2,3,4].map(tick => { const value = max * tick / 4; return <g key={tick}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} stroke="#e8edf1" /><text x={left-10} y={y(value)+4} textAnchor="end" fontSize="10" fill="#78838e">{new Intl.NumberFormat("uk-UA", {notation:"compact",maximumFractionDigits:1}).format(value)}{metric === "ctr" || metric === "atc" ? "%" : ""}</text></g>; })}
        <path d={path} fill="none" stroke={config.color} strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((point,index) => <g key={point.date}><text x={x(index)} y={height-12} textAnchor="middle" fontSize="10" fill="#78838e">{point.date.slice(8)}</text>{point[metric] != null && <circle cx={x(index)} cy={y(point[metric]!)} r={activeDate === point.date ? 6 : 4} fill={config.color} stroke="white" strokeWidth="2" tabIndex={0} role="button" aria-label={`${point.date}: ${format(point[metric], metric)}`} onFocus={() => setActiveDate(point.date)} onMouseEnter={() => setActiveDate(point.date)} onClick={() => setActiveDate(point.date)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveDate(point.date); } }}><title>{`${point.date}: ${format(point[metric], metric)}`}</title></circle>}</g>)}
      </svg></div> : <p className="py-16 text-center text-xs text-[#78838e]">Немає денних даних для цього показника</p>}
      <p className="mt-2 text-[10px] text-[#8a949e]">{metric === "contentScore" ? "CS — середнє серед товарів із налаштованими обов’язковими атрибутами. Зберігається щодня під час відкриття аналізу; останнє значення дня. Минулі дні без збереженого CS показано як пропуски." : "CTR = перегляди PDP / Impressions · ATC = додавання в кошик / перегляди PDP. Поточний день неповний; дані GA4 можуть надходити із затримкою."}</p>
    </>}
    {error && !loading && <p role="alert" className="mt-2 text-xs text-[#b73535]">{error}</p>}
  </section>;
}
