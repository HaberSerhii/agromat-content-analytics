"use client";

import { useEffect, useMemo, useState } from "react";
import SalesDimensionSelect from "@/components/SalesDimensionSelect";
import { fetchApiJson } from "@/lib/read-api-json";
import { revenueChange, salesCsv, sortMonthlyRows, type MonthlySort } from "@/lib/sales-monthly";
import type { SalesChannel } from "@/lib/sales-order-origin";

type Bucket = { label: string; revenue: number; docs: number; goods: number };
type Month = { from: string; to: string; current: Bucket[]; previous: Bucket[] };
const money = (value: number) => value.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" });

export default function SalesMonthlyTable({ dimension, to, channel, compare, refresh, measure, segment, statuses, metric, selected, onSelectionChange }: {
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
  const windowSize = count === 12 ? Number(to.slice(5, 7)) : count;
  useEffect(() => {
    const controller = new AbortController();
    setMonths(null); setError(null);
    const params = new URLSearchParams({ to, count: String(windowSize), channel, dimension, measure, segment: selectedSegment, compare: needsPrevious ? "1" : "0" });
    (JSON.parse(statusKey) as string[]).forEach(value => params.append("status", value));
    fetchApiJson<Month[]>(`/api/sales/monthly?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(value => { if (!controller.signal.aborted) setMonths(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не вдалося завантажити помісячні продажі"); });
    return () => controller.abort();
  }, [to, windowSize, channel, needsPrevious, refresh, measure, selectedSegment, statusKey, dimension, retry]);
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
  const rows = sortMonthlyRows(selected.length ? allRows.filter(row => selected.includes(row.label)) : allRows, sort);
  function download() {
    if (!months) return;
    const headers = [dimension === "brands" ? "Бренд" : "Категорія", ...months.flatMap(month => [`${monthLabel(month.from)}, ${unit}`, ...(compare ? ["Минулий рік", "Зміна, %"] : [])]), `Разом, ${unit}`, ...(compare ? ["Разом минулий рік", "Зміна разом, %"] : [])];
    const csv = salesCsv([headers, ...rows.map(row => [row.label, ...row.values.flatMap(value => [value.current, ...(compare ? [value.previous, revenueChange(value.current, value.previous) ?? ""] : [])]), row.total, ...(compare ? [row.previous, revenueChange(row.total, row.previous) ?? ""] : [])])]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `sales-${dimension}-${measure}-${metric}-${selectedSegment}-${to}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  function cell(current: number, previous: number) {
    const change = revenueChange(current, previous);
    return <><div className="font-bold text-[#168354]">{format(current)}</div>{compare && <div className="mt-2 flex items-center justify-end gap-2 text-[10px]"><span className="text-[#85918d]">{format(previous)}</span><span className={`rounded px-1 ${change === null ? "text-gray-500" : change >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{change === null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}</span></div>}</>;
  }
  return <section className="mb-5 overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
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
    {error ? <div role="alert" className="p-5 text-sm text-red-700">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-3 underline">Повторити</button></div> : !months ? <p role="status" className="p-5 text-sm text-[#687784]">Завантаження помісячних продажів…</p> : !rows.length ? <p className="p-5 text-sm text-[#687784]">За цей період продажів немає.</p> : <div className="max-h-[620px] overflow-auto"><table className="w-full border-collapse text-xs"><thead className="sticky top-0 z-20 bg-[#f3f7f6] text-[#687c72]"><tr><th className="sticky left-0 z-30 min-w-[180px] bg-[#f3f7f6] p-3 text-left">{dimension === "brands" ? "Бренд" : "Категорія"}</th>{months.map(month => <th key={month.from} className="min-w-[160px] p-3 text-right capitalize">{monthLabel(month.from)}</th>)}<th className="min-w-[170px] p-3 text-right">Разом</th></tr></thead><tbody>{rows.map(row => <tr key={row.label} className="border-t border-[#edf0ef]"><th scope="row" className="sticky left-0 z-10 bg-white p-3 text-left font-semibold text-[#40584a]">{row.label}</th>{row.values.map((value, index) => <td key={index} className="p-3 text-right tabular-nums">{cell(value.current, value.previous)}</td>)}<td className="bg-[#f3faf6] p-3 text-right tabular-nums">{cell(row.total, row.previous)}</td></tr>)}</tbody></table></div>}
  </section>;
}
