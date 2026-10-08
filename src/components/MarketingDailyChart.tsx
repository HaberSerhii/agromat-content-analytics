"use client";
import { useState } from "react";
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
  const maximum = Math.max(1, ...days.map(day => day[metric]));
  const width = Math.max(640, days.length * 28 + 70);
  const left = 60, top = 16, plotHeight = 190, plotWidth = width - left - 20;
  const step = plotWidth / Math.max(1, days.length);
  const format = (value: number) => `${number.format(value)}${metric === "transactions" ? "" : " грн"}`;
  return <section className="rounded-xl border p-4" style={{borderColor: "var(--border)", background: "var(--bg-card)"}} aria-busy={loading}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-sm font-bold">Динаміка за днями</h3>
        <p className="mt-1 break-all text-[11px]" style={{color: "var(--text-dim)"}}>{campaign ? `Кампанія: ${campaign === "missing" ? "Без UTM" : campaign}` : "Усі кампанії"} · {days[0]?.date || ""} — {days.at(-1)?.date || ""}</p>
        {campaign && <button type="button" onClick={onClear} className="mt-1 text-xs font-bold text-[#118dff]">Усі кампанії</button>}
      </div>
      <div className="flex gap-1 rounded-lg p-1" style={{background: "var(--bg-input)"}} aria-label="Показник графіка">
        {metrics.map(item => <button key={item.key} type="button" aria-pressed={metric === item.key} onClick={() => setMetric(item.key)} className="rounded-md px-3 py-1.5 text-xs font-bold" style={{background: metric === item.key ? item.color : "transparent", color: metric === item.key ? "white" : "var(--text-dim)"}}>{item.label}</button>)}
      </div>
    </div>
    {loading ? <p className="py-16 text-center text-xs text-[#118dff]" role="status">Оновлення графіка…</p>
      : error ? <p className="py-12 text-center text-xs text-red-700">Не вдалося оновити графік.</p>
      : days.length === 0 ? <p className="py-12 text-center text-xs">Оберіть період для графіка.</p>
      : <>
        <div className="mt-4 overflow-x-auto">
          <svg viewBox={`0 0 ${width} 250`} className="h-[250px] w-full" style={{minWidth: width}} role="img" aria-label={`${chosen.label} за днями · ${campaign || "Усі кампанії"}`}>
            {[0, 0.25, 0.5, 0.75, 1].map(ratio => <g key={ratio}>
              <line x1={left} x2={width - 20} y1={top + plotHeight * (1 - ratio)} y2={top + plotHeight * (1 - ratio)} stroke="var(--border)" />
              <text x={left - 8} y={top + plotHeight * (1 - ratio) + 4} textAnchor="end" fontSize="10" fill="var(--text-dim)">{metric === "transactions" ? number.format(Math.ceil(maximum * ratio)) : shortNumber.format(maximum * ratio)}</text>
            </g>)}
            {days.map((day, index) => {
              const barHeight = Math.max(0, day[metric] / maximum * plotHeight);
              return <g key={day.date} tabIndex={0} role="img" aria-label={`${day.date}: ${chosen.label} ${format(day[metric])}`}>
                <title>{`${day.date}\nТранзакції: ${number.format(day.transactions)}\nДохід: ${number.format(day.revenue)} грн\nAOV: ${number.format(day.aov)} грн`}</title>
                <rect x={left + index * step + step * 0.15} y={top + plotHeight - barHeight} width={step * 0.7} height={Math.max(1, barHeight)} rx="3" fill={chosen.color} opacity={day[metric] ? 0.85 : 0.25} />
                <rect x={left + index * step} y={top} width={step} height={plotHeight} fill="transparent" />
                <text x={left + (index + 0.5) * step} y={top + plotHeight + 20} textAnchor="middle" fontSize="10" fill="var(--text-dim)">{day.date.slice(8)}</text>
              </g>;
            })}
          </svg>
        </div>
        <p className="text-[10px]" style={{color: "var(--text-muted)"}}>Наведіть на день для деталей · {metric === "aov" ? "AOV = дохід дня / транзакції дня" : chosen.label === "Дохід" ? "Сума замовлень, грн" : "Кількість замовлень"}</p>
        {!days.some(day => day.transactions > 0) && <p className="mt-2 text-xs" style={{color: "var(--text-dim)"}}>За вибраними фільтрами замовлень немає.</p>}
      </>}
  </section>;
}
