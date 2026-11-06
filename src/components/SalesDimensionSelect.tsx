"use client";

import { useMemo, useState } from "react";

export default function SalesDimensionSelect({ dimension, options, selected, onChange }: {
  dimension: "brands" | "categories";
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const labels = useMemo(() => [...new Set([...options, ...selected])].sort((a, b) => a.localeCompare(b, "uk")), [options, selected]);
  const visible = labels.filter(label => label.toLocaleLowerCase("uk-UA").includes(query.trim().toLocaleLowerCase("uk-UA")));
  const title = dimension === "brands" ? "Бренди" : "Категорії";
  return <details className="group mx-5 mb-4 rounded-lg border border-[#dfe4ea] bg-white">
    <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-[#40584a]">{title}: {selected.length ? `обрано ${selected.length}` : "усі"}</summary>
    <div className="border-t border-[#edf0ef] p-3">
      <div className="mb-3 flex flex-wrap items-center gap-3"><input type="search" aria-label={`Пошук: ${title}`} placeholder={dimension === "brands" ? "Знайти бренд…" : "Знайти категорію…"} value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-[#dfe4ea] px-3 py-2 text-xs" /><button type="button" onClick={() => onChange([])} disabled={!selected.length} className="text-xs font-bold text-[#118dff] disabled:text-gray-400">Скинути вибір</button></div>
      <div className="grid max-h-56 gap-2 overflow-auto sm:grid-cols-2 xl:grid-cols-3">{visible.map(label => <label key={label} className="flex cursor-pointer items-center gap-2 rounded-md p-1 text-xs text-[#40584a]"><input type="checkbox" checked={selected.includes(label)} onChange={() => onChange(selected.includes(label) ? selected.filter(value => value !== label) : [...selected, label])} className="accent-[#118dff]" /><span>{label}</span></label>)}{!visible.length && <p className="text-xs text-[#687784]">Нічого не знайдено</p>}</div>
      {!!selected.length && <div className="mt-3 flex flex-wrap gap-2">{selected.map(label => <button key={label} type="button" aria-label={`Прибрати ${label}`} onClick={() => onChange(selected.filter(value => value !== label))} className="rounded-full bg-[#eef7ff] px-2 py-1 text-[10px] text-[#16649c]">{label} ×</button>)}</div>}
    </div>
  </details>;
}
