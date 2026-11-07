"use client";

import { useState } from "react";
import SalesMonthlyTable from "@/components/SalesMonthlyTable";
import type { PromotionSalesChannel } from "@/lib/sales-order-origin";
import type { PromotionPricePosition } from "@/lib/promotion-price-position";

export function PromotionMonthlyAnalysis({ dimension, from, to, channel, pricePosition }: {
  dimension: "brands" | "categories"; from: string; to: string; channel: PromotionSalesChannel; pricePosition: PromotionPricePosition;
}) {
  const [format, setFormat] = useState<"table" | "rows">("table");
  const [metric, setMetric] = useState<"docs" | "goods" | "revenue">("revenue");
  const [measure, setMeasure] = useState<"received" | "shipped">("shipped");
  const [compare, setCompare] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const button = (active: boolean) => `rounded-lg border px-4 py-2 text-xs font-bold ${active ? "border-[#118dff] bg-[#118dff] text-white" : "border-[#dfe4ea] bg-white text-[#586572]"}`;
  return <div className="space-y-4">
    <div role="group" aria-label="Джерело показників" className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={measure === "received"} onClick={() => setMeasure("received")} className={button(measure === "received")}>Web-shop · Надходження</button>
      <button type="button" aria-pressed={measure === "shipped"} onClick={() => setMeasure("shipped")} className={button(measure === "shipped")}>Факт виконання · Відвантажені</button>
    </div>
    <section className="flex flex-wrap items-end gap-5 rounded-2xl border border-[#dfe4ea] bg-white p-4">
      <div><div className="mb-2 text-[10px] font-bold uppercase text-[#78838e]">Формат аналізу</div><div role="group" aria-label="Формат аналізу" className="flex gap-1">{([["table", "Табличний"], ["rows", "Рядковий"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={format === value} onClick={() => setFormat(value)} className={button(format === value)}>{label}</button>)}</div></div>
      <div><div className="mb-2 text-[10px] font-bold uppercase text-[#78838e]">Показник</div><div role="group" aria-label="Показник" className="flex flex-wrap gap-1">{([["docs", "Замовлення"], ["goods", "Кількість, шт."], ["revenue", "Сума, грн"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)} className={button(metric === value)}>{label}</button>)}</div></div>
      <label className="flex items-center gap-2 py-2 text-xs font-bold text-[#586572]"><input type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)} className="accent-[#118dff]" />Порівняти з минулим роком</label>
      <input type="search" aria-label={dimension === "brands" ? "Пошук брендів" : "Пошук категорій"} placeholder={dimension === "brands" ? "Знайти бренд…" : "Знайти категорію…"} value={query} onChange={event => setQuery(event.target.value)} className="h-9 min-w-[190px] flex-1 rounded-lg border border-[#d8dde3] bg-white px-3 text-xs outline-none focus:border-[#118dff]" />
    </section>
    <SalesMonthlyTable dimension={dimension} from={from} to={to} channel={channel} compare={compare} refresh={0} measure={measure} metric={metric} segment="Усі" statuses={[]} selected={selected} onSelectionChange={setSelected} promotion pricePosition={pricePosition} format={format} query={query} />
  </div>;
}
