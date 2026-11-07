"use client";

import { useEffect, useState } from "react";
import { availabilityYearChange, type AvailabilityCounts, type AvailabilityReport } from "@/lib/product-availability";
import { salesCsv } from "@/lib/sales-monthly";

const metrics: Array<{ key: keyof AvailabilityCounts; label: string }> = [
  { key: "active", label: "Активні · В наявності" },
  { key: "inactive", label: "Неактивні" },
  { key: "preorder", label: "Під замовлення" },
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
  const [selection, setSelection] = useState<{ status: "active" | "inactive"; period: "current" | "previous"; mode: "total" | "changes" } | null>(null);
  const [products, setProducts] = useState<Array<{ id: number; name: string; sku: string; category: string; brand: string; url: string; change: string }> | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [page, setPage] = useState(0);
  const [changeFilter, setChangeFilter] = useState("all");
  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    setProducts(null); setSelectionError(""); setPage(0); setChangeFilter("all");
    fetch("/api/products/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...JSON.parse(scope), analysis: "monthly", selection }), signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); if (!controller.signal.aborted) setProducts(result.products); })
      .catch(reason => { if (!controller.signal.aborted) setSelectionError(reason.message); });
    return () => controller.abort();
  }, [scope, selection]);
  const visibleProducts = products?.filter(product => changeFilter === "all" || product.change === changeFilter) || [];
  const ready = scope === loadedScope && !error;
  const current = ready ? data?.months.find(item => item.month === month) : null;
  const previousMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const previous = ready ? data?.months.find(item => item.month === previousMonth) : null;
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
  const yearComparison = (key: string, index: number) => {
    const item = data?.months[index];
    const yearMonth = item ? `${Number(item.month.slice(0, 4)) - 1}${item.month.slice(4)}` : "";
    const baseline = data?.previousYear?.find(entry => entry.month === yearMonth)?.counts?.[key as keyof AvailabilityCounts];
    const value = rows.find(row => row.key === key)?.values[index];
    const change = availabilityYearChange(value, baseline);
    const text = value == null ? "Немає даних" : baseline == null ? "Немає даних за минулий рік" : baseline === 0 && value > 0 ? "База минулого року: 0" : change == null ? "—" : `${change > 0 ? "+" : ""}${change.toLocaleString("uk-UA", { maximumFractionDigits: 1 })}% р/р`;
    return { text, change };
  };
  function download() {
    if (!ready || !data) return;
    const exportRows = [["Показник", ...data.months.map(item => monthName(item.month))], ["Дата знімка", ...data.months.map(item => item.date || "Немає знімка")], ...rows.flatMap(row => [[row.label, ...row.values.map(value => value ?? "")], ...(analysis === "monthly" ? [[`${row.label} · % р/р`, ...row.values.map((_, index) => yearComparison(row.key, index).text)]] : [])])];
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
      <h2 className="mb-3 text-sm font-bold text-[#27313c]">Загальний аналіз<span className="ml-2 text-xs font-normal text-[#78838e]">{monthName(month)}</span></h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([
        { key: "active", label: "Активні товари · В наявності", period: "current" },
        { key: "inactive", label: "Неактивні товари · Інші статуси", period: "current" },
        { key: "active", label: "Активні товари · В наявності", period: "previous" },
        { key: "inactive", label: "Неактивні товари · Інші статуси", period: "previous" },
      ] as const).map(({ key, label, period }) => {
        const snapshot = period === "current" ? current : previous;
        const delta = current?.counts && previous?.counts ? current.counts[key] - previous.counts[key] : null;
        return <article key={`${period}-${key}`} className="rounded-2xl border border-[#dfe4ea] bg-white p-5">
          <div className="text-xs text-[#78838e]">{label}</div>
          <p className="mt-1 text-[11px] text-[#78838e]">{period === "current" ? "Поточний місяць" : "На кінець попереднього місяця"} · {monthName(period === "current" ? month : previousMonth)}</p>
          <button type="button" disabled={!ready || !snapshot?.counts} onClick={() => setSelection({ status: key, period, mode: "total" })} aria-label={`${label}: показати товари, ${period === "current" ? month : previousMonth}`} className={`mt-3 block text-left text-3xl font-black hover:underline disabled:cursor-default ${key === "active" ? "text-[#087a55]" : "text-[#c63f3f]"}`}>{number(snapshot?.counts?.[key])}</button>
          {period === "current" && <button type="button" disabled={!ready || delta == null} onClick={() => setSelection({ status: key, period, mode: "changes" })} className="mt-2 text-left text-xs text-[#586572] hover:underline disabled:cursor-default">{delta == null ? "Зміна: —" : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${number(Math.abs(delta))}`} за місяць</button>}
          <p className="mt-2 text-[11px] text-[#78838e]">{snapshot?.date ? `Знімок на ${snapshot.date.split("-").reverse().join(".")}` : "Немає знімка за цей місяць"}</p>
        </article>;
      })}</div>
    </section>
    {selection && <section aria-label="Відібрані товари" className="rounded-2xl border border-[#dfe4ea] bg-white p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-bold">{selection.status === "active" ? "Активні товари" : "Неактивні товари"} · {monthName(selection.period === "current" ? month : previousMonth)} · {selection.mode === "changes" ? "Зміни за місяць" : "Усі товари"}{products && ` (${number(products.length)})`}</h2><button type="button" onClick={() => setSelection(null)} className="text-sm text-[#118dff]">Закрити</button></div>
      {selection.mode === "changes" && <><p className="my-3 text-xs text-[#78838e]">Різниця — додані мінус вибулі. Список містить усі товари, що увійшли до вибірки (+) або вибули (−). Назви й артикули — з поточного каталогу.</p><div className="my-3 flex gap-2">{[["all", "Усі зміни"], ["+", "Додалися"], ["−", "Вибули"]].map(([value, label]) => <button key={value} type="button" onClick={() => { setChangeFilter(value); setPage(0); }} className={button(changeFilter === value)}>{label}{products ? ` (${products.filter(product => value === "all" || product.change === value).length})` : ""}</button>)}</div></>}
      {selectionError ? <p role="alert" className="mt-3 text-sm text-red-700">{selectionError}</p> : !products ? <p role="status" className="mt-3 text-sm">Завантаження товарів…</p> : <>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Зміна", "ID", "Артикул", "Товар", "Бренд", "Категорія"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{visibleProducts.slice(page * 50, (page + 1) * 50).map(product => <tr key={product.id} className="border-t border-[#edf0ef]"><td className="p-2">{product.change || "—"}</td><td className="p-2">{product.id}</td><td className="p-2">{product.sku || "—"}</td><td className="p-2">{/^https?:\/\//i.test(product.url) ? <a href={product.url} target="_blank" rel="noopener noreferrer" className="text-[#118dff] hover:underline">{product.name}</a> : product.name}</td><td className="p-2">{product.brand}</td><td className="p-2">{product.category}</td></tr>)}</tbody></table>{!visibleProducts.length && <p className="p-3 text-xs">Товарів немає</p>}</div>
        <div className="mt-3 flex items-center gap-3 text-xs"><button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)} className={button(false)}>Назад</button><span>{page + 1} / {Math.max(1, Math.ceil(visibleProducts.length / 50))} · {number(visibleProducts.length)} товарів</span><button type="button" disabled={(page + 1) * 50 >= visibleProducts.length} onClick={() => setPage(value => value + 1)} className={button(false)}>Далі</button></div>
      </>}
    </section>}
    <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 p-5"><h2 className="text-sm font-bold text-[#27313c]">{analysis === "daily" ? "Наявність за щоденними знімками" : "Кількість SKU за місяцями"}</h2><button type="button" onClick={download} disabled={!ready || !data?.months.some(item => item.counts)} className="rounded-lg border border-[#dfe4ea] px-3 py-2 text-xs font-bold text-[#087a55] disabled:opacity-40">↓ CSV · Місяці</button></header>
      {analysis === "monthly" && <p className="px-5 pb-4 text-[11px] text-[#78838e]">Під замовлення — неархівні товари зі статусом «Під замовлення»; вони також входять до неактивних. % р/р — зміна до того самого місяця попереднього року за однаковими фільтрами. Порівнюються останні знімки місяців; поточний місяць ще не завершено. Для старих знімків без розподілу статусів кількість під замовлення недоступна.</p>}
      {analysis === "daily" && <p className="px-5 pb-4 text-[11px] text-[#78838e]">Останній стан кожного дня. Пропущені дні та відсутність товару у знімку не вважаються неактивністю. SKU-день — один товар в одному щоденному знімку.</p>}
      {error ? <div role="alert" className="p-5 text-sm text-red-700">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-3 underline">Повторити</button></div> : !ready ? <p role="status" className="p-5 text-sm text-[#78838e]">Завантаження аналізу наявності…</p> : <div className="overflow-x-auto"><table className="w-full border-collapse text-xs"><thead className="bg-[#f3f7f6] text-[#687c72]"><tr><th className="sticky left-0 min-w-[210px] bg-[#f3f7f6] p-3 text-left">Показник</th>{data?.months.map(item => <th key={item.month} className="min-w-[150px] p-3 text-right"><span className="block capitalize">{monthName(item.month)}</span><span className="mt-1 block text-[10px] font-normal">{item.date ? `на ${item.date.split("-").reverse().join(".")}` : "Немає знімка"}</span></th>)}</tr></thead><tbody>{rows.map(metric => <tr key={metric.key} className="border-t border-[#edf0ef]"><th className="sticky left-0 bg-white p-3 text-left font-semibold text-[#40584a]">{metric.label}</th>{data?.months.map((item, index) => <td key={item.month} className={`p-3 text-right font-bold tabular-nums ${metric.key === "active" || metric.key === "promoActive" ? "text-[#087a55]" : "text-[#586572]"}`}>{formatValue(metric.values[index])}{analysis === "monthly" && <span className={`mt-1 block text-[10px] font-normal ${yearComparison(metric.key, index).change == null ? "text-[#78838e]" : yearComparison(metric.key, index).change! > 0 ? "text-[#087a55]" : yearComparison(metric.key, index).change! < 0 ? "text-[#c63f3f]" : "text-[#78838e]"}`}>{yearComparison(metric.key, index).text}</span>}</td>)}</tr>)}</tbody></table></div>}
    </section>
  </div>;
}
