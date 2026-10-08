"use client";
import { useState } from "react";
import { marketingChartScale } from "@/lib/marketing-chart-scale";
import type { MarketingDay } from "@/lib/marketing-daily-series";

const metrics = [
  {key: "transactions", label: "Транзакції", color: "#118dff"},
  {key: "revenue", label: "Дохід", color: "#22a06b"},
  {key: "aov", label: "AOV", color: "#7c5ce7"},
] as const;
const number = new Intl.NumberFormat("uk-UA", {maximumFractionDigits: 0});
const shortNumber = new Intl.NumberFormat("uk-UA", {notation: "compact", maximumFractionDigits: 1});

export function MarketingDailyChart({days, campaign, loading, error, onClear}: {
  days: MarketingDay[]; campaign: string; loading: boolean; error: string; onClear: () => void;
}) {
  const [metric, setMetric] = useState<(typeof metrics)[number]["key"]>("transactions");
  const chosen = metrics.find(item => item.key === metric)!;
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const scale = marketingChartScale(Math.max(0, ...days.map(day => day[metric])));
  const width = Math.max(720, days.length * 34 + 120);
  const left = 86, top = 42, plotHeight = 185, plotWidth = width - left - 28;
  const axisLabel = metric === "transactions" ? "Кількість транзакцій" : metric === "revenue" ? "Дохід, грн" : "Середній чек, грн";
  const monthLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("uk-UA", {month: "long", year: "numeric", timeZone: "Europe/Kyiv"});
  const firstMonth = days[0] ? monthLabel(days[0].date) : "";
  const lastMonth = days.at(-1) ? monthLabel(days.at(-1)!.date) : "";
  const dateAxisLabel = firstMonth === lastMonth ? firstMonth : `${firstMonth} — ${lastMonth}`;
  const points = days.map((day, index) => ({day,
    x: left + (days.length === 1 ? plotWidth / 2 : index / (days.length - 1) * plotWidth),
    y: top + plotHeight * (1 - day[metric] / scale.maximum),
  }));
  const hovered = points.find(point => point.day.date === hoveredDate);
  const tooltipWidth = 230, tooltipHeight = 100;
  const tooltipX = hovered ? Math.min(width - tooltipWidth - 10, Math.max(left, hovered.x - tooltipWidth / 2)) : 0;
  const tooltipY = hovered ? Math.max(top + 4, hovered.y - tooltipHeight - 14) : 0;
  return <section className="rounded-xl border p-4" style={{borderColor: "var(--border)", background: "var(--bg-card)"}} aria-busy={loading}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-sm font-bold">Динаміка за днями</h3>
        <p className="mt-1 break-all text-[11px]" style={{color: "var(--text-dim)"}}>{campaign ? `Кампанія: ${campaign === "missing" ? "Без UTM" : campaign}` : "Усі кампанії"} · {days[0]?.date || ""} — {days.at(-1)?.date || ""}</p>
        {campaign && <button type="button" onClick={onClear} className="mt-1 text-xs font-bold text-[#118dff]">Усі кампанії</button>}
      </div>
      <div className="flex gap-1 rounded-lg p-1" style={{background: "var(--bg-input)"}} aria-label="Показник графіка">
        {metrics.map(item => <button key={item.key} type="button" aria-pressed={metric === item.key} onClick={() => { setMetric(item.key); setHoveredDate(null); }} className="rounded-md px-3 py-1.5 text-xs font-bold" style={{background: metric === item.key ? item.color : "transparent", color: metric === item.key ? "white" : "var(--text-dim)"}}>{item.label}</button>)}
      </div>
    </div>
    {loading ? <p className="py-16 text-center text-xs text-[#118dff]" role="status">Оновлення графіка…</p>
      : error ? <p className="py-12 text-center text-xs text-red-700">Не вдалося оновити графік.</p>
      : days.length === 0 ? <p className="py-12 text-center text-xs">Оберіть період для графіка.</p>
      : <>
        <div className="mt-4 overflow-x-auto">
          <svg viewBox={`0 0 ${width} 290`} className="h-[290px] w-full" style={{minWidth: width}} role="group" aria-label={`${axisLabel} за днями · ${campaign || "Усі кампанії"}`} onMouseLeave={() => setHoveredDate(null)}>
            <text x={left} y={18} fontSize="12" fontWeight="600" fill="var(--text-dim)">{axisLabel}</text>
            {scale.ticks.map(tick => {
              const y = top + plotHeight * (1 - tick / scale.maximum);
              return <g key={tick}>
                <line x1={left} x2={width - 28} y1={y} y2={y} stroke="var(--border)" />
                <text x={left - 10} y={y + 4} textAnchor="end" fontSize="10" fill="var(--text-dim)">{metric === "transactions" ? number.format(tick) : shortNumber.format(tick)}</text>
              </g>;
            })}
            <polyline points={points.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke={chosen.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {points.map(({day, x, y}) => <g key={day.date} tabIndex={0} role="button"
              aria-label={`${day.date}: дохід ${number.format(day.revenue)} грн, середній чек ${number.format(day.aov)} грн, транзакції ${number.format(day.transactions)}`}
              onMouseEnter={() => setHoveredDate(day.date)} onFocus={() => setHoveredDate(day.date)} onBlur={() => setHoveredDate(null)}
              onClick={() => setHoveredDate(day.date)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setHoveredDate(day.date); } if (event.key === "Escape") setHoveredDate(null); }}>
              <circle cx={x} cy={y} r={hoveredDate === day.date ? 6 : 4} fill="var(--bg-card)" stroke={chosen.color} strokeWidth="2.5" />
              <circle cx={x} cy={y} r="13" fill="transparent" className="cursor-pointer" />
              <text x={x} y={top + plotHeight + 21} textAnchor="middle" fontSize="10" fill="var(--text-dim)">{`${day.date.slice(8)}.${day.date.slice(5, 7)}`}</text>
            </g>)}
            <text x={left + plotWidth / 2} y={278} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-dim)">{dateAxisLabel.charAt(0).toUpperCase() + dateAxisLabel.slice(1)} · дати</text>
            {hovered && <g role="tooltip" pointerEvents="none" aria-label={`${hovered.day.date}: дохід ${number.format(hovered.day.revenue)} грн, середній чек ${number.format(hovered.day.aov)} грн, транзакції ${number.format(hovered.day.transactions)}`}>
              <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="8" fill="var(--bg-card)" stroke="var(--border2)" />
              <text x={tooltipX + 12} y={tooltipY + 20} fontSize="11" fontWeight="700" fill="var(--text)">{hovered.day.date.split("-").reverse().join(".")}</text>
              <text x={tooltipX + 12} y={tooltipY + 43} fontSize="11" fill="#22a06b">Дохід: {number.format(hovered.day.revenue)} грн</text>
              <text x={tooltipX + 12} y={tooltipY + 64} fontSize="11" fill="#7c5ce7">Середній чек: {number.format(hovered.day.aov)} грн</text>
              <text x={tooltipX + 12} y={tooltipY + 85} fontSize="11" fill="#118dff">Транзакції: {number.format(hovered.day.transactions)}</text>
            </g>}
          </svg>
        </div>
        <p className="text-[10px]" style={{color: "var(--text-muted)"}}>Наведіть на точку для деталей · {metric === "aov" ? "AOV = дохід дня / транзакції дня" : chosen.label === "Дохід" ? "Сума замовлень, грн" : "Кількість замовлень"}</p>
        {!days.some(day => day.transactions > 0) && <p className="mt-2 text-xs" style={{color: "var(--text-dim)"}}>За вибраними фільтрами замовлень немає.</p>}
      </>}
  </section>;
}
