"use client";

import { useEffect, useState } from "react";
import type { AvailabilityCounts, AvailabilityReport } from "@/lib/product-availability";
import { salesCsv } from "@/lib/sales-monthly";

const metrics: Array<{ key: keyof AvailabilityCounts; label: string }> = [
  { key: "active", label: "Активні · В наявності" },
  { key: "inactive", label: "Неактивні" },
  { key: "promoActive", label: "Акційні · активні" },
  { key: "promoInactive", label: "Акційні · неактивні" },
  { key: "promo", label: "Усі акційні" },
  { key: "total", label: "Усі SKU" },
];
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("uk-UA");
const monthName = (value: string) => new Date(`${value}-01T12:00:00Z`).toLocaleDateString("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" });
const todayMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).slice(0, 7);

function MultiFilter({ title, options, selected, onChange }: { title: string; options: Array<{ id: string; name: string }>; selected: string[]; onChange: (value: string[]) => void }) {
  const [query, setQuery] = useState("");
  const labels = [...options, ...selected.filter(id => !options.some(option => option.id === id)).map(id => ({ id, name: id }))];
  const visible = labels.filter(option => option.name.toLocaleLowerCase("uk-UA").includes(query.trim().toLocaleLowerCase("uk-UA")));
  return <details className="min-w-[230px] flex-1 rounded-lg border border-[#dfe4ea] bg-white">
    <summary className="cursor-pointer px-3 py-2.5 text-xs font-bold text-[#586572]">{title}: {selected.length ? `обрано ${selected.length}` : "усі"}</summary>
    <div className="border-t border-[#edf0f2] p-3">
      <div className="mb-2 flex gap-2"><input type="search" aria-label={`Пошук: ${title}`} value={query} onChange={event => setQuery(event.target.value)} placeholder="Пошук…" className="min-w-0 flex-1 rounded-lg border border-[#d8dde3] px-3 py-2 text-xs" /><button type="button" disabled={!selected.length} onClick={() => onChange([])} className="text-xs font-bold text-[#118dff] disabled:text-gray-400">Скинути</button></div>
      <div className="grid max-h-56 gap-2 overflow-auto sm:grid-cols-2">{visible.map(option => <label key={option.id} className="flex cursor-pointer items-center gap-2 text-xs text-[#586572]"><input type="checkbox" checked={selected.includes(option.id)} onChange={() => onChange(selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id])} className="accent-[#118dff]" />{option.name}</label>)}{!visible.length && <p className="text-xs text-[#78838e]">Нічого не знайдено</p>}</div>
    </div>
  </details>;
}

export function ProductAvailabilityAnalysis() {
  const [month, setMonth] = useState(todayMonth);
  const [count, setCount] = useState(6);
  const [categories, setCategories] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [promotion, setPromotion] = useState("all");
  const [analysis, setAnalysis] = useState<"monthly" | "daily">("monthly");
  const [data, setData] = useState<AvailabilityReport | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const scope = JSON.stringify({ month, count, categories, brands, promotion, analysis });
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch("/api/products/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: scope, signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Не вдалося завантажити аналіз");
        if (!controller.signal.aborted) { setData(result); setLoadedScope(scope); }
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Помилка завантаження"); });
    return () => controller.abort();
  }, [scope, retry]);
  const ready = scope === loadedScope && !error;
  const latest = ready ? data?.months.slice().reverse().find(item => item.counts !== null) : null;
  const button = (active: boolean) => `rounded-lg border px-3 py-2 text-xs font-bold ${active ? "border-[#118dff] bg-[#118dff] text-white" : "border-[#dfe4ea] bg-white text-[#586572]"}`;
  const reset = () => { setCategories([]); setBrands([]); setPromotion("all"); };
  const dailyMetrics = [
    { key: "observedDays", label: "Днів зі спостереженнями" },
    { key: "expectedDays", label: "Календарних днів у періоді" },
    { key: "averageActive", label: "Середня кількість активних SKU за день" },
    { key: "averageInactive", label: "Середня кількість неактивних SKU за день" },
    { key: "alwaysActive", label: "Активні в усіх своїх спостереженнях" },
    { key: "alwaysInactive", label: "Неактивні в усіх своїх спостереженнях" },
    { key: "mixed", label: "SKU зі змінами активності" },
    { key: "activeSkuDays", label: "Активних SKU-днів" },
    { key: "inactiveSkuDays", label: "Неактивних SKU-днів" },
    { key: "activeShare", label: "Частка активних SKU-днів, %" },
  ] as const;
  const rows = analysis === "monthly" ? metrics.map(metric => ({ ...metric, values: data?.months.map(item => item.counts?.[metric.key] ?? null) || [] })) : dailyMetrics.map(metric => ({ ...metric, values: data?.months.map(item => item.daily?.observedDays ? item.daily[metric.key] : null) || [] }));
  const formatValue = (value: number | null) => value == null ? "—" : value.toLocaleString("uk-UA", { maximumFractionDigits: analysis === "daily" ? 1 : 0 });
  function download() {
    if (!ready || !data) return;
    const exportRows = [["Показник", ...data.months.map(item => monthName(item.month))], ["Дата знімка", ...data.months.map(item => item.date || "Немає знімка")], ...rows.map(row => [row.label, ...row.values.map(value => value ?? "")])];
    const url = URL.createObjectURL(new Blob([salesCsv(exportRows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `product-availability-${month}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="space-y-4">
    <section className="space-y-3 rounded-2xl border border-[#dfe4ea] bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-bold text-[#586572]">Місяць до<input type="month" aria-label="Місяць до" value={month} min="2000-01" max={todayMonth()} onChange={event => { if (event.target.value) setMonth(event.target.value); }} className="ml-2 h-9 rounded-lg border border-[#d8dde3] px-3 text-xs" /></label>
        <div role="group" aria-label="Період" className="flex gap-2">{[3, 6, 12].map(value => <button key={value} type="button" aria-pressed={count === value} onClick={() => setCount(value)} className={button(count === value)}>{value} місяців</button>)}</div>
        <label className="text-xs font-bold text-[#586572]">Акційність<select aria-label="Акційність" value={promotion} onChange={event => setPromotion(event.target.value)} className="ml-2 h-9 rounded-lg border border-[#d8dde3] bg-white px-3 text-xs"><option value="all">Усі товари</option><option value="promo">Акційні товари</option><option value="regular">Неакційні товари</option></select></label>
        <button type="button" onClick={reset} disabled={!categories.length && !brands.length && promotion === "all"} className="ml-auto text-xs font-bold text-[#118dff] disabled:text-gray-400">Скинути фільтри</button>
      </div>
      <div className="flex flex-wrap items-start gap-3"><MultiFilter title="Категорії" options={data?.facets.categories || []} selected={categories} onChange={setCategories} /><MultiFilter title="Бренди" options={(data?.facets.brands || []).map(name => ({ id: name, name }))} selected={brands} onChange={setBrands} /></div>
      <p className="text-[11px] text-[#78838e]">Активні — статус «В наявності», без архівних товарів. За місяць зберігається останній зафіксований стан; поточний місяць оновлюється після синхронізації.</p>
    </section>
    <div role="group" aria-label="Аналіз наявності" className="flex flex-wrap gap-2">{([["monthly", "Стан місяця"], ["daily", "Наявність протягом місяця"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={analysis === value} onClick={() => setAnalysis(value)} className={button(analysis === value)}>{label}</button>)}</div>
    <section aria-label="Загальний аналіз наявності" aria-busy={!ready && !error}>
      <h2 className="mb-3 text-sm font-bold text-[#27313c]">Загальний аналіз{latest?.date ? <span className="ml-2 text-xs font-normal text-[#78838e]">станом на {latest.date.split("-").reverse().join(".")}</span> : null}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([["total", "Усі SKU"], ["active", "Активні · В наявності"], ["inactive", "Неактивні"], ["promo", "Акційні SKU"]] as const).map(([key, label]) => <article key={key} className="rounded-2xl border border-[#dfe4ea] bg-white p-5"><div className="text-xs text-[#78838e]">{label}</div><strong className={`mt-3 block text-3xl font-black ${key === "active" ? "text-[#087a55]" : key === "inactive" ? "text-[#c63f3f]" : "text-[#26313d]"}`}>{number(latest?.counts?.[key])}</strong>{key === "promo" && latest?.counts && <p className="mt-2 text-[11px] text-[#78838e]">{number(latest.counts.promoActive)} активних · {number(latest.counts.promoInactive)} неактивних</p>}</article>)}</div>
    </section>
    <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 p-5"><h2 className="text-sm font-bold text-[#27313c]">{analysis === "daily" ? "Наявність за щоденними знімками" : "Кількість SKU за місяцями"}</h2><button type="button" onClick={download} disabled={!ready || !data?.months.some(item => item.counts)} className="rounded-lg border border-[#dfe4ea] px-3 py-2 text-xs font-bold text-[#087a55] disabled:opacity-40">↓ CSV · Місяці</button></header>
      {analysis === "daily" && <p className="px-5 pb-4 text-[11px] text-[#78838e]">Останній стан кожного дня. Пропущені дні та відсутність товару у знімку не вважаються неактивністю. SKU-день — один товар в одному щоденному знімку.</p>}
      {error ? <div role="alert" className="p-5 text-sm text-red-700">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-3 underline">Повторити</button></div> : !ready ? <p role="status" className="p-5 text-sm text-[#78838e]">Завантаження аналізу наявності…</p> : <div className="overflow-x-auto"><table className="w-full border-collapse text-xs"><thead className="bg-[#f3f7f6] text-[#687c72]"><tr><th className="sticky left-0 min-w-[210px] bg-[#f3f7f6] p-3 text-left">Показник</th>{data?.months.map(item => <th key={item.month} className="min-w-[150px] p-3 text-right"><span className="block capitalize">{monthName(item.month)}</span><span className="mt-1 block text-[10px] font-normal">{item.date ? `на ${item.date.split("-").reverse().join(".")}` : "Немає знімка"}</span></th>)}</tr></thead><tbody>{rows.map(metric => <tr key={metric.key} className="border-t border-[#edf0ef]"><th className="sticky left-0 bg-white p-3 text-left font-semibold text-[#40584a]">{metric.label}</th>{data?.months.map((item, index) => <td key={item.month} className={`p-3 text-right font-bold tabular-nums ${metric.key === "active" || metric.key === "promoActive" ? "text-[#087a55]" : "text-[#586572]"}`}>{formatValue(metric.values[index])}</td>)}</tr>)}</tbody></table></div>}
    </section>
  </div>;
}
