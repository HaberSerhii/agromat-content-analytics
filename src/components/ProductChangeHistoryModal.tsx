"use client";
/* eslint-disable @next/next/no-img-element -- history contains product CDN URLs */

import { useEffect, useState, type ReactNode } from "react";
import type { ChangeEvent } from "@/lib/products-store";

type HistoryBucket = "name" | "price" | "status" | "stock" | "sku" | "attributes" | "images";
type HistoryResponse = {
  productId: number;
  total: number;
  groups: Record<HistoryBucket, ChangeEvent[]>;
};

const TABS: Array<{ key: HistoryBucket; label: string; color: string }> = [
  { key: "name", label: "Назва", color: "#6556d8" },
  { key: "price", label: "Ціна", color: "#118dff" },
  { key: "status", label: "Статус", color: "#23a875" },
  { key: "stock", label: "Залишок", color: "#e66c37" },
  { key: "sku", label: "Артикул", color: "#8e44ad" },
  { key: "attributes", label: "Атрибути", color: "#d09b00" },
  { key: "images", label: "Фото", color: "#d13438" },
];

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function money(value: number | null, currency: string): string {
  return value == null ? "—" : `${value.toLocaleString("uk-UA")} ${currency}`;
}

function EventCard({ event, currency }: { event: ChangeEvent; currency: string }) {
  const arrow = <span className="mx-2 text-[#9aa3ac]">→</span>;
  const wrap = (label: string, color: string, body: ReactNode) => (
    <article className="rounded-xl border border-[#e2e6ea] bg-[#f7f9fb] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <b className="text-[9px] uppercase tracking-[.1em]" style={{ color }}>{label}</b>
        <time className="text-[9px] tabular-nums text-[#8a949e]">{dateTime(event.at)}</time>
      </div>
      <div className="text-[11px] leading-5 text-[#34404c]">{body}</div>
    </article>
  );

  switch (event.field) {
    case "name":
      return wrap("Назва", "#6556d8", <><span className="text-[#8a949e]">{event.from || "—"}</span>{arrow}<b>{event.to || "—"}</b></>);
    case "price":
      return wrap("Ціна", "#118dff", <><span className="text-[#8a949e]">{money(event.from, currency)}</span>{arrow}<b>{money(event.to, currency)}</b></>);
    case "priceBase":
      return wrap("Базова ціна", "#118dff", <><span className="text-[#8a949e]">{money(event.from, currency)}</span>{arrow}<b>{money(event.to, currency)}</b></>);
    case "discountPct":
      return wrap("Знижка", "#118dff", <><span className="text-[#8a949e]">{event.from == null ? "—" : `${event.from}%`}</span>{arrow}<b>{event.to == null ? "—" : `${event.to}%`}</b></>);
    case "status":
      return wrap("Статус", "#23a875", <><span className="text-[#8a949e]">{event.from.name || `#${event.from.id}`}</span>{arrow}<b>{event.to.name || `#${event.to.id}`}</b></>);
    case "stock":
      return wrap("Залишок", "#e66c37", <><span className="text-[#8a949e]">{event.from ?? "—"}</span>{arrow}<b>{event.to ?? "—"}</b></>);
    case "sku":
      return wrap("Артикул", "#8e44ad", <><span className="text-[#8a949e]">{event.from || "—"}</span>{arrow}<b>{event.to || "—"}</b></>);
    case "attributes":
      return wrap("Атрибути", "#d09b00", <div className="space-y-1">
        {event.added.map((item) => <div key={`a-${item.id}`}><b className="text-[#087a55]">+ Додано:</b> {item.name} — {item.values.join(", ")}</div>)}
        {event.removed.map((item) => <div key={`r-${item.id}`}><b className="text-[#bd3b3b]">− Видалено:</b> {item.name} — {item.values.join(", ")}</div>)}
        {event.changed.map((item) => <div key={`c-${item.id}`}><b className="text-[#118dff]">~ {item.name}:</b> <span className="text-[#8a949e]">{item.from.join(", ")}</span>{arrow}<b>{item.to.join(", ")}</b></div>)}
      </div>);
    case "images":
      return wrap("Фото", "#d13438", <div>
        <div className="mb-2"><span className="text-[#8a949e]">{event.fromCount} шт.</span>{arrow}<b>{event.toCount} шт.</b></div>
        {event.addedUrls.length > 0 && <div className="mb-2"><b className="text-[#087a55]">+ Додано ({event.addedUrls.length})</b><div className="mt-1 grid grid-cols-4 gap-1 sm:grid-cols-6">{event.addedUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-[#a7d8bd]"><img src={url} alt="" className="h-16 w-full object-cover" loading="lazy" /></a>)}</div></div>}
        {event.removedUrls.length > 0 && <div><b className="text-[#bd3b3b]">− Видалено ({event.removedUrls.length})</b><div className="mt-1 grid grid-cols-4 gap-1 sm:grid-cols-6">{event.removedUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-[#efb5b5] opacity-60"><img src={url} alt="" className="h-16 w-full object-cover" loading="lazy" /></a>)}</div></div>}
      </div>);
    case "reviews":
      return null;
  }
}

export function ProductChangeHistoryModal({ id, productName, currency = "UAH", onClose }: {
  id: number;
  productName: string;
  currency?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [tab, setTab] = useState<HistoryBucket>("name");
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    fetch(`/api/products/${id}/history`)
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then((value: HistoryResponse) => {
        setData(value);
        const first = TABS.find((item) => value.groups[item.key]?.length)?.key;
        if (first) setTab(first);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Не вдалося завантажити історію"));
  }, [id]);

  const events = data?.groups[tab] || [];
  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-[#111827b8] p-3 sm:p-5" onMouseDown={onClose}>
      <div className="flex max-h-[88dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b border-[#e4e8ec] px-5 py-4">
          <div className="min-w-0"><div className="text-[9px] font-black uppercase tracking-[.16em] text-[#6556d8]">Історія змін</div><h3 className="mt-1 truncate text-sm font-black text-[#26313d]">{productName}</h3></div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg bg-[#f0f3f5] px-3 py-2 text-[10px] font-bold text-[#58636d]">× Закрити</button>
        </header>
        <div className="flex gap-1 overflow-x-auto border-b border-[#e4e8ec] px-4 pt-3">
          {TABS.map((item) => { const active = item.key === tab; return <button key={item.key} type="button" onClick={() => setTab(item.key)} className="flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-2 text-[10px] font-black" style={{ color: active ? item.color : "#7d8791", background: active ? "#f3f5f7" : "transparent", borderBottom: active ? `2px solid ${item.color}` : "2px solid transparent" }}>{item.label}<span className="rounded-full bg-white px-1.5 py-0.5 text-[8px]">{data?.groups[item.key]?.length || 0}</span></button>; })}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!data && !error && <div className="p-8 text-center text-xs text-[#8a949e]">Завантажуємо історію…</div>}
          {error && <div className="rounded-xl border border-[#efb5b5] bg-[#fff1f1] p-3 text-xs text-[#bd3b3b]">{error}</div>}
          {data && data.total === 0 && <div className="p-8 text-center text-xs text-[#8a949e]">Змін ще не зафіксовано. Журнал наповнюється після синхронізації API.</div>}
          {data && data.total > 0 && events.length === 0 && <div className="p-8 text-center text-xs text-[#8a949e]">У цій категорії змін немає.</div>}
          <div className="space-y-2">{events.map((event, index) => <EventCard key={`${event.at}:${event.field}:${index}`} event={event} currency={currency} />)}</div>
        </div>
        <footer className="border-t border-[#e4e8ec] px-4 py-2 text-[9px] text-[#8a949e]">Фіксуються зміни після кожної синхронізації API. Зберігаються до 200 останніх подій за 180 днів.</footer>
      </div>
    </div>
  );
}
