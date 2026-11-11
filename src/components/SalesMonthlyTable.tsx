"use client";

import { useEffect, useMemo, useState } from "react";
import SalesDimensionSelect from "@/components/SalesDimensionSelect";
import { fetchApiJson } from "@/lib/read-api-json";
import { revenueChange, salesCsv, sortMonthlyRows, type MonthlySort } from "@/lib/sales-monthly";
import type { SalesChannel } from "@/lib/sales-order-origin";

import type { PromotionPeriodSummary } from "@/lib/promotion-monthly";

type Bucket = { label: string; revenue: number; docs: number; goods: number };
type Month = { from: string; to: string; current: Bucket[]; previous: Bucket[] };
const money = (value: number) => value.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" });

export default function SalesMonthlyTable({ dimension, from, to, channel, compare, refresh, measure, segment, statuses, metric, selected, onSelectionChange, promotion = false, pricePosition = "all", format: layout = "table", query = "" }: {
  from?: string; promotion?: boolean; pricePosition?: string; format?: "table" | "rows"; query?: string;
  dimension: "brands" | "categories"; to: string; channel: SalesChannel; compare: boolean; refresh: number;
  selected: string[]; onSelectionChange: (values: string[]) => void;
  metric: "docs" | "goods" | "revenue"; measure: "received" | "shipped"; segment: string; statuses: string[];
}) {
  const unit = metric === "docs" ? "замовлення" : metric === "goods" ? "шт." : "грн";
  const format = (value: number) => metric === "revenue" ? money(value) : value.toLocaleString("uk-UA", { maximumFractionDigits: 3 });
  const [selectedSegment, setSelectedSegment] = useState(segment);
  const [sort, setSort] = useState<MonthlySort>("total");
  const needsPrevious = compare || sort === "growth" || sort === "decline";
  const [count, setCount] = useState(6);
  const [months, setMonths] = useState<Month[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const statusKey = JSON.stringify(statuses);
  const dataQuery = promotion ? "" : query.trim();
  const windowSize = count === 12 ? Number(to.slice(5, 7)) : count;
  useEffect(() => {
    const controller = new AbortController();
    setMonths(null); setError(null);
    const params = new URLSearchParams({ to, count: String(windowSize), channel, dimension, measure, segment: selectedSegment, compare: needsPrevious ? "1" : "0" });
    (JSON.parse(statusKey) as string[]).forEach(value => params.append("status", value));
    if (dataQuery) params.set("search", dataQuery);
    if (promotion) params.set("price_position", pricePosition);
    fetchApiJson<Month[]>(`${promotion ? "/api/promotions/monthly" : "/api/sales/monthly"}?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(value => { if (!controller.signal.aborted) setMonths(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не вдалося завантажити помісячні продажі"); });
    return () => controller.abort();
  }, [to, windowSize, channel, needsPrevious, refresh, measure, selectedSegment, statusKey, dimension, retry, promotion, pricePosition, dataQuery]);
  const allRows = useMemo(() => {
    if (!months) return [];
    const labels = new Set(months.flatMap(month => [...month.current, ...month.previous].map(item => item.label)));
    return [...labels].map(label => {
      const values = months.map(month => ({ current: month.current.find(item => item.label === label)?.[metric] || 0, previous: month.previous.find(item => item.label === label)?.[metric] || 0 }));
      const lastMonth = months[months.length - 1];
      const monthValue = lastMonth?.current.find(item => item.label === label)?.[metric] || 0;
      const previousMonthValue = lastMonth?.previous.find(item => item.label === label)?.[metric] || 0;
      return { label, values, monthValue, previousMonthValue, total: values.reduce((sum, value) => sum + value.current, 0), previous: values.reduce((sum, value) => sum + value.previous, 0) };
    }).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "uk"));
  }, [months, metric]);
  const normalizedQuery = query.trim().toLocaleLowerCase("uk-UA");
  const rows = sortMonthlyRows(allRows.filter(row => (!selected.length || selected.includes(row.label)) && (!promotion || !normalizedQuery || row.label.toLocaleLowerCase("uk-UA").includes(normalizedQuery))), sort);
  const [calendarSummary, setCalendarSummary] = useState<{ scope: string; value: PromotionPeriodSummary } | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const summaryScope = JSON.stringify({ from: from || `${to.slice(0, 7)}-01`, to, dimension, channel, measure, segment: selectedSegment, price_position: pricePosition, selected, search: query.trim() });
  useEffect(() => {
    if (!promotion) return;
    const controller = new AbortController();
    setSummaryError("");
    const timer = window.setTimeout(() => {
      fetch("/api/promotions/monthly", { method: "POST", headers: { "Content-Type": "application/json" }, body: summaryScope, signal: controller.signal })
        .then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error || "Не вдалося завантажити показники"); if (!controller.signal.aborted) setCalendarSummary({ scope: summaryScope, value }); })
        .catch(reason => { if (!controller.signal.aborted) setSummaryError(reason instanceof Error ? reason.message : "Помилка показників"); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [summaryScope, promotion, retry]);
  const summary = calendarSummary?.scope === summaryScope && !summaryError ? calendarSummary.value : null;
  function download() {
    if (!months) return;
    const headers = [dimension === "brands" ? "Бренд" : "Категорія", ...months.flatMap(month => [`${monthLabel(month.from)}, ${unit}`, ...(compare ? ["Минулий рік", "Зміна, %"] : [])]), `Разом, ${unit}`, ...(compare ? ["Разом минулий рік", "Зміна разом, %"] : [])];
    const csv = salesCsv([headers, ...rows.map(row => [row.label, ...row.values.flatMap(value => [value.current, ...(compare ? [value.previous, revenueChange(value.current, value.previous) ?? ""] : [])]), row.total, ...(compare ? [row.previous, revenueChange(row.total, row.previous) ?? ""] : [])])]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${promotion ? "promotion" : "sales"}-${dimension}-${measure}-${metric}-${selectedSegment}-${to}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  function cell(current: number, previous: number) {
    const change = revenueChange(current, previous);
    return <><div className="font-bold text-[#168354]">{format(current)}</div>{compare && <div className="mt-2 flex items-center justify-end gap-2 text-[10px]"><span className="text-[#85918d]">{format(previous)}</span><span className={`rounded px-1 ${change === null ? "text-gray-500" : change >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{change === null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}</span></div>}</>;
  }
  return <>
    {promotion && <div aria-label="Показники знайдених позицій" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      [dimension === "brands" ? "Брендів" : "Категорій", summary ? summary.count.toLocaleString("uk-UA") : "—"],
      ["Замовлень", summary ? summary.docs.toLocaleString("uk-UA") : "—"],
      ["Кількість товарів", summary ? summary.goods.toLocaleString("uk-UA", { maximumFractionDigits: 3 }) : "—"],
      ["Сума продажів", summary ? `${money(summary.revenue)} ₴` : "—"],
    ].map(([label, value]) => <article key={label} className="rounded-2xl border border-[#dfe4ea] bg-white p-5"><div className="text-[10px] font-bold text-[#78838e]">{label}</div><strong className="mt-3 block text-2xl font-black text-[#26313d]">{value}</strong></article>)}</div>}
    {promotion && summaryError && <div role="alert" className="mb-4 text-xs text-red-700">{summaryError}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-2 underline">Повторити</button></div>}
    <section className="mb-5 overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 p-5">
      <div><h2 className="text-sm font-bold text-[#27313c]">Помісячні продажі за {dimension === "brands" ? "брендами" : "категоріями"}</h2></div>
      <div className="flex flex-wrap gap-2">{[[3, "3 місяці"], [6, "6 місяців"], [12, "Весь рік"]].map(([value, label]) => <button type="button" key={value} aria-pressed={count === value} onClick={() => setCount(Number(value))} className={`rounded-lg border px-3 py-2 text-xs font-bold ${count === value ? "bg-[#168354] text-white" : "text-[#586572]"}`}>{label}</button>)}<button type="button" disabled={!months || !rows.length} onClick={download} className="rounded-lg border px-3 py-2 text-xs font-bold text-[#168354] disabled:opacity-40">↓ CSV · Місяці</button></div>
    </div>
    <div className="mx-5 mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs font-bold text-[#40584a]">Сортування</span>
      <div role="group" aria-label="Сортування" className="flex flex-wrap gap-2">
        {([["total", "За підсумком періоду"], ["decline", "Топ падіння"], ["growth", "Топ зростання"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={sort === value} onClick={() => setSort(value)} className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168354] focus-visible:ring-offset-2 ${sort === value ? "border-[#168354] bg-[#168354] text-white" : "border-[#dfe4ea] bg-white text-[#586572] hover:bg-[#f3f7f6]"}`}>{label}</button>)}
      </div>
      <span className="ml-2 text-xs font-bold text-[#40584a]">Сегмент</span>
      <div role="group" aria-label="Сегмент продажів" className="flex flex-wrap gap-2">
        {["Усі", "Плитка", "Сантехніка", "Підлогові покриття", "Будівельна хімія"].map(value => <button key={value} type="button" aria-pressed={selectedSegment === value} onClick={() => setSelectedSegment(value)} className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#168354] focus-visible:ring-offset-2 ${selectedSegment === value ? "border-[#168354] bg-[#168354] text-white" : "border-[#dfe4ea] bg-white text-[#586572] hover:bg-[#f3f7f6]"}`}>{value}</button>)}
      </div>
      {sort !== "total" && <span className="text-[10px] text-[#687784]">{to.slice(0, 7)} · до {to}</span>}
    </div>
    {months && <SalesDimensionSelect dimension={dimension} options={allRows.map(row => row.label)} selected={selected} onChange={onSelectionChange} />}
    {error ? <div role="alert" className="p-5 text-sm text-red-700">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-3 underline">Повторити</button></div> : !months ? <p role="status" className="p-5 text-sm text-[#687784]">Завантаження помісячних продажів…</p> : !rows.length ? <p className="p-5 text-sm text-[#687784]">За цей період продажів немає.</p> : layout === "rows" ? <div className="max-h-[620px] overflow-auto">{rows.map(row => <details key={row.label} className="border-t border-[#edf0ef]">
      <summary className="cursor-pointer px-5 py-3"><span className="inline-flex w-[calc(100%-20px)] flex-wrap items-center justify-between gap-3"><b className="text-xs text-[#40584a]">{row.label}</b><span className="min-w-[140px] text-right text-xs">{cell(row.total, row.previous)}</span></span></summary>
      <div className="grid gap-3 bg-[#f7f9fb] p-4 sm:grid-cols-3">{row.values.map((value, index) => <div key={index} className="rounded-lg border border-[#dfe4ea] bg-white p-3 text-right text-xs"><div className="mb-2 text-[10px] capitalize text-[#78838e]">{monthLabel(months[index].from)}</div>{cell(value.current, value.previous)}</div>)}</div>
    </details>)}</div> : <div className="max-h-[620px] overflow-auto"><table className="w-full border-collapse text-xs"><thead className="sticky top-0 z-20 bg-[#f3f7f6] text-[#687c72]"><tr><th className="sticky left-0 z-30 min-w-[180px] bg-[#f3f7f6] p-3 text-left">{dimension === "brands" ? "Бренд" : "Категорія"}</th>{months.map(month => <th key={month.from} className="min-w-[160px] p-3 text-right capitalize">{monthLabel(month.from)}</th>)}<th className="min-w-[170px] p-3 text-right">Разом</th></tr></thead><tbody>{rows.map(row => <tr key={row.label} className="border-t border-[#edf0ef]"><th scope="row" className="sticky left-0 z-10 bg-white p-3 text-left font-semibold text-[#40584a]">{row.label}</th>{row.values.map((value, index) => <td key={index} className="p-3 text-right tabular-nums">{cell(value.current, value.previous)}</td>)}<td className="bg-[#f3faf6] p-3 text-right tabular-nums">{cell(row.total, row.previous)}</td></tr>)}</tbody></table></div>}
  </section></>;
}
