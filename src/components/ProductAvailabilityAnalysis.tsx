"use client";

import { chartMonthChange } from "@/lib/chart-month-change";
import { ChartTrendSeries } from "@/components/ChartTrendSeries";

import { useEffect, useState, type CSSProperties } from "react";
import type { MovementReport } from "@/lib/product-availability-movement-report";
import type { MovementMetric } from "@/lib/product-availability-movements";
import { salesCsv } from "@/lib/sales-monthly";

const metrics: Array<{ key: MovementMetric; label: string }> = [
  { key: "active", label: "Активні товари · В наявності" },
  { key: "inactive", label: "Неактивні товари · Інші статуси" },
  { key: "promoActive", label: "Активні акційні товари · В наявності" },
  { key: "promoInactive", label: "Неактивні акційні товари · Інші статуси" },
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
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [chartMetric, setChartMetric] = useState<MovementMetric>("active");
  useEffect(() => { const timer = setTimeout(() => setQuery(queryDraft.trim()), 300); return () => clearTimeout(timer); }, [queryDraft]);
  const [data, setData] = useState<MovementReport | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const scope = JSON.stringify({ month, count, categories, brands, promotion, query, report: "movements" });
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
  const [selection, setSelection] = useState<{ metric: MovementMetric; mode: "total" | "added" | "removed" } | null>(null);
  const [products, setProducts] = useState<Array<{ id: number; name: string; sku: string; category: string; brand: string; url: string; change: string }> | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    setProducts(null); setSelectionError(""); setPage(0);
    fetch("/api/products/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...JSON.parse(scope), selection }), signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); if (!controller.signal.aborted) setProducts(result.products); })
      .catch(reason => { if (!controller.signal.aborted) setSelectionError(reason.message); });
    return () => controller.abort();
  }, [scope, selection]);
  const visibleProducts = products || [];
  const ready = scope === loadedScope && !error;
  const current = ready ? data?.months.find(item => item.month === month) : null;
  const button = (active: boolean) => `rounded-lg border px-3 py-2 text-xs font-bold ${active ? "border-[#118dff] bg-[#118dff] text-white" : "border-[#dfe4ea] bg-white text-[#586572]"}`;
  const reset = () => { setCategories([]); setBrands([]); setPromotion("all"); setQueryDraft(""); };
  const rows = metrics.map(metric => ({ ...metric, values: data?.months.map(item => item.counts?.[metric.key] ?? null) || [] }));
  const comparison = (key: MovementMetric, index: number) => {
    const current = data?.months[index]?.counts?.[key];
    const baseline = (index ? data?.months[index - 1] : data?.previous)?.counts?.[key];
    if (current == null || baseline == null) return "Немає даних для порівняння";
    if (!baseline) return current ? "Попередній місяць: 0" : "0% м/м";
    const change = (current - baseline) / baseline * 100;
    return `${change > 0 ? "+" : ""}${change.toLocaleString("uk-UA", { maximumFractionDigits: 1 })}% м/м`;
  };
  function download() {
    if (!ready || !data) return;
    const exportRows = [["Показник", ...data.months.map(item => monthName(item.month))], ["Дата знімка", ...data.months.map(item => item.date || "Немає знімка")], ...rows.flatMap(row => [[row.label, ...row.values.map(value => value ?? "")], [`${row.label} · % м/м`, ...row.values.map((_, index) => comparison(row.key, index))]])];
    const url = URL.createObjectURL(new Blob([salesCsv(exportRows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `product-availability-${month}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="space-y-4">
    <section className="space-y-3 rounded-2xl border border-[#dfe4ea] bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-bold text-[#586572]">Місяць до<input type="month" aria-label="Місяць до" value={month} min="2000-01" max={todayMonth()} onChange={event => { if (event.target.value) setMonth(event.target.value); }} className="ml-2 h-9 rounded-lg border border-[#d8dde3] px-3 text-xs" /></label>
        <div role="group" aria-label="Період" className="flex gap-2">{[3, 6, 12].map(value => <button key={value} type="button" aria-pressed={count === value} onClick={() => setCount(value)} className={button(count === value)}>{value} місяців</button>)}</div>
        <label className="text-xs font-bold text-[#586572]">Акційність<select aria-label="Акційність" value={promotion} onChange={event => setPromotion(event.target.value)} className="ml-2 h-9 rounded-lg border border-[#d8dde3] bg-white px-3 text-xs"><option value="all">Усі товари</option><option value="promo">Акційні товари</option><option value="regular">Неакційні товари</option></select></label>
        <button type="button" onClick={reset} disabled={!categories.length && !brands.length && promotion === "all" && !queryDraft} className="ml-auto text-xs font-bold text-[#118dff] disabled:text-gray-400">Скинути фільтри</button>
      </div>
      <div className="flex flex-wrap items-start gap-3"><MultiFilter title="Категорії" options={data?.facets.categories || []} selected={categories} onChange={setCategories} /><MultiFilter title="Бренди" options={(data?.facets.brands || []).map(name => ({ id: name, name }))} selected={brands} onChange={setBrands} /></div>
      <p className="text-[11px] text-[#78838e]">Активні — усі товари «В наявності», без архівних. Неактивні — лише вимкнені протягом місяця та ще не ввімкнені знову; на початку кожного місяця лічильник починається з нуля.</p>
    </section>
    <section className="rounded-2xl border border-[#dfe4ea] bg-white p-4"><label className="block text-xs font-bold text-[#586572]">Пошук товарів<input type="search" value={queryDraft} onChange={event => setQueryDraft(event.target.value)} placeholder="Код, ID, артикул, бренд, назва…" className="mt-2 w-full rounded-lg border border-[#d8dde3] px-3 py-2 text-sm" /></label><p className="mt-2 text-[11px] text-[#78838e]">Пошук у поточному каталозі застосовується до всього аналізу та історії знайдених товарів.</p></section>
    <section aria-label="Загальний аналіз наявності" aria-busy={!ready && !error}>
      <h2 className="mb-3 text-sm font-bold text-[#27313c]">Загальний аналіз<span className="ml-2 text-xs font-normal text-[#78838e]">{monthName(month)}</span></h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ key, label }) => {
        const changes = current?.changes?.[key];
        const value = current?.counts?.[key];
        return <article key={key} className="rounded-2xl border border-[#dfe4ea] bg-white p-5">
          <div className="text-xs text-[#78838e]">{label}</div>
          <p className="mt-1 text-[11px] text-[#78838e]">{key === "inactive" || key === "promoInactive" ? "Вимкнені за цей місяць" : "Усього активних"}</p>
          <button type="button" disabled={!ready || value == null} onClick={() => setSelection({ metric: key, mode: "total" })} className={`mt-3 block text-left text-3xl font-black hover:underline ${key === "active" || key === "promoActive" ? "text-[#087a55]" : "text-[#c63f3f]"}`}>{number(value)}</button>
          <div className="mt-2 flex gap-3 text-xs">{(["added", "removed"] as const).map(mode => <button type="button" key={mode} disabled={!ready || !changes} onClick={() => setSelection({ metric: key, mode })} className="text-[#586572] hover:underline">{mode === "added" ? "+" : "−"}{number(changes?.[mode])}</button>)}<span className="text-[#78838e]">за місяць</span></div>
          <p className="mt-2 text-[11px] text-[#78838e]">{current?.date ? `Знімок на ${current.date.split("-").reverse().join(".")}` : "Немає знімка"}</p>
          {ready && !current?.baselineDate && <p className="mt-2 text-[11px] text-[#78838e]">Немає знімка на кінець попереднього місяця для обліку вимкнень.</p>}
        </article>;
      })}</div>
    </section>
    <AvailabilityChart month={month} days={ready ? current?.days || [] : []} metric={chartMetric} onMetric={setChartMetric} loading={!ready} />
    {selection && <section aria-label="Відібрані товари" className="rounded-2xl border border-[#dfe4ea] bg-white p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-bold">{metrics.find(metric => metric.key === selection.metric)?.label} · {monthName(month)} · {selection.mode === "total" ? "Усі товари вибірки" : selection.mode === "added" ? "Додалися за місяць" : "Вибули за місяць"}{products && ` (${number(products.length)})`}</h2><button type="button" onClick={() => setSelection(null)} className="text-sm text-[#118dff]">Закрити</button></div>
      {selectionError ? <p role="alert" className="mt-3 text-sm text-red-700">{selectionError}</p> : !products ? <p role="status" className="mt-3 text-sm">Завантаження товарів…</p> : <>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Зміна", "ID", "Артикул", "Товар", "Бренд", "Категорія"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{visibleProducts.slice(page * 50, (page + 1) * 50).map((product, index) => <tr key={`${product.id}-${index}`} className="border-t border-[#edf0ef]"><td className="p-2">{product.change || "—"}</td><td className="p-2">{product.id}</td><td className="p-2">{product.sku || "—"}</td><td className="p-2">{/^https?:\/\//i.test(product.url) ? <a href={product.url} target="_blank" rel="noopener noreferrer" className="text-[#118dff] hover:underline">{product.name}</a> : product.name}</td><td className="p-2">{product.brand}</td><td className="p-2">{product.category}</td></tr>)}</tbody></table>{!visibleProducts.length && <p className="p-3 text-xs">Товарів немає</p>}</div>
        <div className="mt-3 flex items-center gap-3 text-xs"><button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)} className={button(false)}>Назад</button><span>{page + 1} / {Math.max(1, Math.ceil(visibleProducts.length / 50))} · {number(visibleProducts.length)} товарів</span><button type="button" disabled={(page + 1) * 50 >= visibleProducts.length} onClick={() => setPage(value => value + 1)} className={button(false)}>Далі</button></div>
      </>}
    </section>}
    <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 p-5"><h2 className="text-sm font-bold text-[#27313c]">Кількість товарів за місяцями</h2><button type="button" onClick={download} disabled={!ready || !data?.months.some(item => item.counts)} className="rounded-lg border border-[#dfe4ea] px-3 py-2 text-xs font-bold text-[#087a55] disabled:opacity-40">↓ CSV · Місяці</button></header>
      <p className="px-5 pb-4 text-[11px] text-[#78838e]">Неактивні — вимкнені в межах відповідного місяця, які не повернулися в наявність. % м/м — порівняння з попереднім календарним місяцем. Неповний поточний місяць порівнюється з останнім знімком попереднього. Без необхідної історії показуємо «—».</p>
      {error ? <div role="alert" className="p-5 text-sm text-red-700">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-3 underline">Повторити</button></div> : !ready ? <p role="status" className="p-5 text-sm text-[#78838e]">Завантаження аналізу наявності…</p> : <div className="overflow-x-auto"><table className="w-full border-collapse text-xs"><thead className="bg-[#f3f7f6] text-[#687c72]"><tr><th className="sticky left-0 min-w-[210px] bg-[#f3f7f6] p-3 text-left">Показник</th>{data?.months.map(item => <th key={item.month} className="min-w-[150px] p-3 text-right"><span className="block capitalize">{monthName(item.month)}</span><span className="mt-1 block text-[10px] font-normal">{item.date ? `на ${item.date.split("-").reverse().join(".")}` : "Немає знімка"}</span></th>)}</tr></thead><tbody>{rows.map(metric => <tr key={metric.key} className="border-t border-[#edf0ef]"><th className="sticky left-0 bg-white p-3 text-left font-semibold text-[#40584a]">{metric.label}</th>{data?.months.map((item, index) => <td key={item.month} className={`p-3 text-right font-bold tabular-nums ${metric.key === "active" || metric.key === "promoActive" ? "text-[#087a55]" : "text-[#586572]"}`}>{number(metric.values[index])}<span className="mt-1 block text-[10px] font-normal text-[#78838e]">{comparison(metric.key, index)}</span></td>)}</tr>)}</tbody></table></div>}
    </section>
  </div>;
}

function AvailabilityChart({ month, days, metric, onMetric, loading }: { month: string; days: NonNullable<MovementReport["months"][number]>["days"]; metric: MovementMetric; onMetric: (metric: MovementMetric) => void; loading: boolean }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const values = days.flatMap(day => day.counts?.[metric] == null ? [] : [day.counts[metric] as number]);
  const first = days.find(day => day.counts?.[metric] != null);
  const last = days.slice().reverse().find(day => day.counts?.[metric] != null);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const padding = Math.max(1, (high - low) * .25);
  const min = Math.max(0, low - padding), max = high + padding;
  const x = (index: number) => 56 + index / Math.max(1, days.length - 1) * 894;
  const y = (value: number) => 215 - (value - min) / Math.max(1, max - min) * 170;
  const selected = days.find(day => day.date === selectedDate && day.counts?.[metric] != null);
  const baseline = first?.counts?.[metric];
  const changeText = (value: number | null | undefined) => {
    const change = chartMonthChange(value, baseline);
    if (change == null) return baseline === 0 ? "База: 0 · % не визначено" : "Немає бази для порівняння";
    return `${change > 0 ? "+" : ""}${change.toLocaleString("uk-UA", { maximumFractionDigits: 2 })}%`;
  };
  const color = metric === "inactive" || metric === "promoInactive" ? "#ef7d22" : metric === "promoActive" ? "#16aa76" : "#118dff";
  const shortLabels = { active: "Активні", inactive: "Неактивні", promoActive: "Акційні · активні", promoInactive: "Акційні · неактивні" };
  const dateLabel = (date: string) => date.split("-").reverse().join(".");
  const selectedIndex = selected ? days.indexOf(selected) : -1;
  const tooltipX = Math.max(58, Math.min(710, x(selectedIndex) - 90));
  return <section aria-label="Щоденна динаміка наявності" className="analytics-chart-card px-5 py-6 sm:px-7">
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div><h2 className="text-xs font-bold text-[#78838e]">Динаміка за днями · {monthName(month)}</h2>
        <div className="mt-2 flex flex-wrap items-baseline gap-3"><strong className="text-4xl font-black tracking-tight text-[#27313c]">{loading ? "—" : number(last?.counts?.[metric])}</strong>{!loading && last && <span className="text-xs font-bold" style={{ color }}>{changeText(last.counts?.[metric])}</span>}</div>
        <p className="mt-2 text-[11px] text-[#78838e]">{metrics.find(item => item.key === metric)?.label}</p>
      </div>
      <div role="group" aria-label="Показник графіка" className="analytics-chart-controls flex flex-wrap gap-1" style={{ "--chart-accent": color } as CSSProperties}>{metrics.map(item => <button type="button" key={item.key} aria-pressed={metric === item.key} onClick={() => { onMetric(item.key); setSelectedDate(null); }} className="px-3 py-1.5 text-[11px] font-bold text-[#78838e]">{shortLabels[item.key]}</button>)}</div>
    </div>
    <p className="mt-4 text-[11px] text-[#8b949e]">{first ? `${first.date.endsWith("-01") ? "База на початок місяця" : "База: перший доступний знімок"} · ${dateLabel(first.date)} · ${number(baseline)}. ` : ""}Пунктир — база. Наведіть на точку для значення та зміни у %. Майбутні дні й пропуски порожні.</p>
    {loading ? <p role="status" className="py-10 text-sm text-[#78838e]">Завантаження графіка…</p> : <>
      {!values.length && <p className="mt-3 text-xs text-[#78838e]">Немає достатніх знімків для цього показника.</p>}
      <div className="mt-2 overflow-x-auto"><svg role="group" aria-label={`${metrics.find(item => item.key === metric)?.label}, ${monthName(month)}`} viewBox="0 0 980 255" className="mx-auto w-full min-w-[650px] max-w-[1200px]" onMouseLeave={() => setSelectedDate(null)}>
        {[0,1,2].map(step => { const value = min + (max - min) * step / 2; return <g key={step}><line x1="56" x2="950" y1={y(value)} y2={y(value)} stroke="#f1f4f6" /><text x="44" y={y(value) + 4} textAnchor="end" fill="#9aa3ac" fontSize="10">{Math.round(value).toLocaleString("uk-UA")}</text></g>; })}
        {baseline != null && <line x1="56" x2="950" y1={y(baseline)} y2={y(baseline)} stroke="#a4adb7" strokeWidth="1.5" strokeDasharray="1 4" strokeLinecap="round"><title>База на початок місяця: {number(baseline)}</title></line>}
        <ChartTrendSeries points={days.map((day, index) => day.counts?.[metric] == null ? null : { x: x(index), y: y(day.counts[metric] as number) })} baseline={220} color={color} />
        {days.map((day, index) => {
          const value = day.counts?.[metric];
          return <g key={day.date}>
            <text x={x(index)} y="244" textAnchor="middle" fill="#8b949e" fontSize="10">{index + 1}</text>
            {value != null && <g role="button" tabIndex={0} aria-label={`${dateLabel(day.date)}: ${number(value)}, ${changeText(value)}`} onMouseEnter={() => setSelectedDate(day.date)} onFocus={() => setSelectedDate(day.date)} onBlur={() => setSelectedDate(null)} onClick={() => setSelectedDate(day.date)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedDate(day.date); } if (event.key === "Escape") setSelectedDate(null); }} className="cursor-pointer outline-none">
              <circle cx={x(index)} cy={y(value)} r={selectedDate === day.date ? 5 : 3.5} fill="#fff" stroke={color} strokeWidth="2" />
              <circle cx={x(index)} cy={y(value)} r="13" fill="transparent" />
            </g>}
          </g>;
        })}
        {selected && <g role="tooltip" pointerEvents="none" aria-label={`${dateLabel(selected.date)}: ${number(selected.counts?.[metric])}, ${changeText(selected.counts?.[metric])}`}>
          <line x1={x(selectedIndex)} x2={x(selectedIndex)} y1="35" y2="220" stroke={color} strokeOpacity=".2" strokeDasharray="3 4" />
          <rect x={tooltipX} y="8" width="256" height="104" rx="12" fill="#fff" stroke="#e2e8ee" />
          <text x={tooltipX + 14} y="29" fontSize="11" fontWeight="700" fill="#27313c">{dateLabel(selected.date)}</text>
          <text x={tooltipX + 14} y="51" fontSize="13" fontWeight="700" fill={color}>{number(selected.counts?.[metric])} товарів</text>
          <text x={tooltipX + 14} y="72" fontSize="11" fill={color}>{changeText(selected.counts?.[metric])}{chartMonthChange(selected.counts?.[metric], baseline) == null ? "" : first?.date.endsWith("-01") ? " від початку місяця" : " від першого знімка"}</text>
          <text x={tooltipX + 14} y="95" fontSize="10" fill="#78838e">База {first ? dateLabel(first.date) : "—"}: {number(baseline)}</text>
        </g>}
      </svg></div>
    </>}
  </section>;
}
