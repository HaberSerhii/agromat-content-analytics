"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  PromotionSalesBucket,
  PromotionSalesDailySummary,
  PromotionSalesDataset,
  PromotionSalesProductSummary,
  PromotionSalesPromotionSummary,
} from "@/lib/promotion-sales-types";
import type { PromotionPricePosition } from "@/lib/promotion-price-position";

export type PromotionPerformanceView = "overview" | "promotions" | "brands" | "categories";
type Segment = "all" | "tile" | "plumbing";

const numberFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const moneyFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthRange() {
  const now = new Date();
  return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(now) };
}

function shiftYear(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function shiftDay(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fmtMoney(value: number) {
  return `${moneyFmt.format(value)} ₴`;
}

function fmtDate(value: string | null) {
  if (!value) return "Безстроково";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("uk-UA", { timeZone: "UTC" });
}

function segmentBucket(day: PromotionSalesDailySummary, segment: Segment) {
  return segment === "tile" ? day.tile : segment === "plumbing" ? day.plumbing : day.total;
}

function SegmentControl({ value, onChange }: { value: Segment; onChange: (value: Segment) => void }) {
  return <div className="inline-flex rounded-lg border border-[#d8dde3] bg-[#f2f5f7] p-0.5">
    {([['all', 'Усі'], ['tile', 'Плитка'], ['plumbing', 'Сантехніка']] as Array<[Segment, string]>).map(([key, label]) => <button key={key} type="button" onClick={() => onChange(key)} className={`rounded-md px-3 py-2 text-[10px] font-black transition ${value === key ? "bg-white text-[#0b6fc2] shadow-sm" : "text-[#68737e]"}`}>{label}</button>)}
  </div>;
}

function DateToolbar({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (value: string) => void; onTo: (value: string) => void }) {
  const setDay = (value: string) => { onFrom(value); onTo(value); };
  const currentMonth = () => { const range = monthRange(); onFrom(range.from); onTo(range.to); };
  const shiftMonth = (direction: number) => {
    const date = new Date(`${from}T12:00:00Z`);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + direction);
    const nextFrom = date.toISOString().slice(0, 10);
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    onFrom(nextFrom);
    onTo(date.toISOString().slice(0, 10));
  };
  const today = isoDate(new Date());
  return <section className="rounded-2xl border border-[#dfe4ea] bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-end gap-2">
      <button type="button" aria-label="Попередній місяць" onClick={() => shiftMonth(-1)} className="h-9 rounded-lg border border-[#d8dde3] bg-[#f7f9fb] px-3 text-sm font-black text-[#586572]">←</button>
      <label className="min-w-[145px] flex-1 sm:max-w-[190px]"><span className="mb-1.5 block text-[9px] font-black uppercase tracking-[.12em] text-[#84909b]">Дата від</span><input type="date" value={from} max={to} onChange={(event) => onFrom(event.target.value)} className="h-9 w-full rounded-lg border border-[#d8dde3] bg-white px-3 text-[11px] outline-none" /></label>
      <label className="min-w-[145px] flex-1 sm:max-w-[190px]"><span className="mb-1.5 block text-[9px] font-black uppercase tracking-[.12em] text-[#84909b]">Дата до</span><input type="date" value={to} min={from} onChange={(event) => onTo(event.target.value)} className="h-9 w-full rounded-lg border border-[#d8dde3] bg-white px-3 text-[11px] outline-none" /></label>
      <button type="button" aria-label="Наступний місяць" onClick={() => shiftMonth(1)} className="h-9 rounded-lg border border-[#d8dde3] bg-[#f7f9fb] px-3 text-sm font-black text-[#586572]">→</button>
      <button type="button" onClick={currentMonth} className="h-9 rounded-lg bg-[#118dff] px-3 text-[10px] font-black text-white">Поточний місяць</button>
      <button type="button" onClick={() => setDay(today)} className="h-9 rounded-lg border border-[#d8dde3] bg-[#f7f9fb] px-3 text-[10px] font-bold text-[#586572]">Сьогодні</button>
      <button type="button" onClick={() => setDay(shiftDay(today, -1))} className="h-9 rounded-lg border border-[#d8dde3] bg-[#f7f9fb] px-3 text-[10px] font-bold text-[#586572]">Вчора</button>
      <button type="button" onClick={() => setDay(shiftDay(today, 1))} className="h-9 rounded-lg border border-[#d8dde3] bg-[#f7f9fb] px-3 text-[10px] font-bold text-[#586572]">Завтра</button>
    </div>
  </section>;
}

function Kpi({ eyebrow, value, meta, delta, color }: { eyebrow: string; value: string; meta: string; delta?: number | null; color: string }) {
  return <article className="relative overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white p-5 shadow-[0_1px_2px_rgba(20,32,50,.04)]">
    <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
    <div className="text-[9px] font-black uppercase tracking-[.14em] text-[#8a949e]">{eyebrow}</div>
    <div className="mt-3 flex items-end justify-between gap-3"><strong className="text-2xl font-black tracking-tight text-[#202a35] sm:text-3xl">{value}</strong>{delta != null && <span className={`rounded-full px-2 py-1 text-[10px] font-black ${delta >= 0 ? "bg-[#e6f6ef] text-[#087a55]" : "bg-[#fcebea] text-[#c63f3f]"}`}>{delta >= 0 ? "+" : ""}{numberFmt.format(delta)} за день</span>}</div>
    <div className="mt-2 text-[10px] text-[#78838e]">{meta}</div>
  </article>;
}

function SalesChart({ current, previous, segment }: { current: PromotionSalesDailySummary[]; previous: PromotionSalesDailySummary[]; segment: Segment }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 1040, height = 300, left = 58, right = 22, top = 32, bottom = 42;
  const currentValues = current.map((day) => segmentBucket(day, segment).revenue);
  const previousValues = previous.map((day) => segmentBucket(day, segment).revenue);
  const max = Math.max(1, ...currentValues, ...previousValues) * 1.08;
  const x = (index: number) => left + (index / Math.max(1, current.length - 1)) * (width - left - right);
  const y = (value: number) => top + (height - top - bottom) * (1 - value / max);
  const path = (values: number[]) => values.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join(" ");
  const selected = hover == null ? null : current[hover];
  const prior = hover == null ? null : previous[hover];
  return <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white shadow-sm">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5e8eb] px-5 py-4"><div><h2 className="text-sm font-black text-[#26313d]">Ефективність продажів за днями</h2><p className="mt-1 text-[10px] text-[#8a939c]">Поточний період проти відповідного періоду минулого року</p></div><div className="flex gap-4 text-[10px] font-bold"><span className="text-[#118dff]">● Поточний період</span><span className="text-[#f0763d]">┄ Минулий рік</span></div></header>
    <div className="relative p-4"><svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Порівняння продажів рік до року">
      {Array.from({ length: 5 }, (_, index) => { const yy = top + index * ((height - top - bottom) / 4); return <g key={index}><line x1={left} x2={width - right} y1={yy} y2={yy} stroke="#e8ebef" /><text x={left - 9} y={yy + 4} textAnchor="end" fontSize="10" fill="#8a949e">{numberFmt.format(max * (1 - index / 4))}</text></g>; })}
      <path d={path(previousValues)} fill="none" stroke="#f0763d" strokeWidth="3" strokeDasharray="8 7" />
      <path d={path(currentValues)} fill="none" stroke="#118dff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {currentValues.map((value, index) => <g key={current[index].date}><circle cx={x(index)} cy={y(value)} r="4" fill="#fff" stroke="#118dff" strokeWidth="3" /><circle cx={x(index)} cy={y(value)} r="14" fill="transparent" className="cursor-pointer" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} /></g>)}
      {current.map((day, index) => index % Math.max(1, Math.ceil(current.length / 7)) === 0 ? <text key={`label-${day.date}`} x={x(index)} y={height - 12} textAnchor="middle" fontSize="10" fill="#7f8993">{day.date.slice(5).split("-").reverse().join(".")}</text> : null)}
    </svg>{selected && <div className="pointer-events-none absolute right-6 top-6 min-w-52 rounded-xl border border-[#bcd8f1] bg-white p-3 shadow-xl"><b className="text-xs text-[#26313d]">{fmtDate(selected.date)}</b><div className="mt-2 grid grid-cols-3 gap-2 text-[9px] text-[#7b8691]"><span>Замовлення<b className="block text-xs text-[#34404c]">{segmentBucket(selected, segment).docs}</b></span><span>Товари<b className="block text-xs text-[#34404c]">{numberFmt.format(segmentBucket(selected, segment).qty)}</b></span><span>Продажі<b className="block text-xs text-[#118dff]">{fmtMoney(segmentBucket(selected, segment).revenue)}</b></span></div>{prior && <div className="mt-2 border-t border-[#e5e8eb] pt-2 text-[9px] font-bold text-[#c85f31]">{fmtDate(prior.date)}: {fmtMoney(segmentBucket(prior, segment).revenue)}</div>}</div>}</div>
  </section>;
}

function PromotionTable({ items, query, segment }: { items: PromotionSalesPromotionSummary[]; query: string; segment: Segment }) {
  const visible = items.filter((item) => (!query || `${item.id} ${item.idinc} ${item.name}`.toLowerCase().includes(query.toLowerCase())) && (segment === "all" || item.segments.includes(segment)));
  const maxRevenue = Math.max(1, ...visible.map((item) => item.revenue));
  return <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[880px] border-collapse"><thead className="bg-[#f7f9fb] text-[9px] font-black uppercase tracking-[.12em] text-[#84909b]"><tr><th className="px-4 py-3 text-left">ID P2</th><th className="px-4 py-3 text-left">Акційна програма</th><th className="px-4 py-3 text-left">Період</th><th className="px-4 py-3 text-right">Товарів</th><th className="px-4 py-3 text-right">Продажів</th><th className="px-4 py-3 text-right">Дохід</th><th className="px-4 py-3 text-left">Внесок</th></tr></thead><tbody>{visible.map((item) => <tr key={item.idinc} className="border-t border-[#edf0f2] hover:bg-[#fbfcfd]"><td className="px-4 py-3 text-xs font-black text-[#118dff]">{item.idinc}<div className="text-[8px] font-semibold text-[#9aa2ab]">ID {item.id}</div></td><td className="max-w-[320px] px-4 py-3"><div className="truncate text-[11px] font-bold text-[#34404c]" title={item.name}>{item.name}</div><div className="mt-1 text-[8px] text-[#8b949e]">{item.segments.map((value) => value === "tile" ? "Плитка" : "Сантехніка").join(" · ") || "Без сегмента"}</div></td><td className="whitespace-nowrap px-4 py-3 text-[10px] text-[#596571]">{fmtDate(item.startDate)} — {fmtDate(item.endDate)}</td><td className="px-4 py-3 text-right text-xs font-black text-[#45515d]">{numberFmt.format(item.productCount)}</td><td className="px-4 py-3 text-right text-xs font-black text-[#45515d]">{numberFmt.format(item.docs)}</td><td className="px-4 py-3 text-right text-xs font-black text-[#087a55]">{fmtMoney(item.revenue)}</td><td className="w-40 px-4 py-3"><div className="h-2 overflow-hidden rounded-full bg-[#edf0f3]"><div className="h-full rounded-full bg-[#118dff]" style={{ width: `${item.revenue / maxRevenue * 100}%` }} /></div></td></tr>)}</tbody></table></div>{!visible.length && <div className="p-12 text-center text-xs text-[#82909d]">Акцій за вибраними умовами не знайдено</div>}</section>;
}

function DimensionTable({ type, items, from, to, pricePosition }: { type: "brand" | "category"; items: PromotionSalesBucket[]; from: string; to: string; pricePosition: PromotionPricePosition }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [products, setProducts] = useState<PromotionSalesProductSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const maxRevenue = Math.max(1, ...items.map((item) => item.revenue));
  useEffect(() => {
    if (!expanded) { setProducts([]); return; }
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/promotions/sales?${new URLSearchParams({ from, to, view: "products", price_position: pricePosition })}`, { signal: controller.signal })
      .then((response) => response.json() as Promise<{ products: PromotionSalesProductSummary[] }>)
      .then((payload) => setProducts(payload.products.filter((product) => type === "brand" ? product.brand === expanded : product.category === expanded)))
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setProducts([]); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [expanded, from, pricePosition, to, type]);
  return <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white shadow-sm"><div className="border-b border-[#e5e8eb] px-5 py-4"><h2 className="text-sm font-black text-[#26313d]">{type === "brand" ? "Акційний брендовий аналіз" : "Акційний категорійний аналіз"}</h2><p className="mt-1 text-[10px] text-[#8a939c]">Натисніть на рядок, щоб побачити товари</p></div><div>{items.map((item) => <div key={item.label} className="border-b border-[#edf0f2] last:border-0"><button type="button" onClick={() => setExpanded((value) => value === item.label ? null : item.label)} className="grid w-full items-center gap-3 px-5 py-3 text-left hover:bg-[#fbfcfd] sm:grid-cols-[minmax(180px,1fr)_110px_150px_1fr_24px]"><b className="truncate text-[11px] text-[#34404c]">{item.label}</b><span className="text-right text-[10px] font-bold text-[#68737e]">{numberFmt.format(item.productCount)} товарів</span><span className="text-right text-xs font-black text-[#087a55]">{fmtMoney(item.revenue)}</span><span className="h-2 overflow-hidden rounded-full bg-[#edf0f3]"><span className="block h-full rounded-full bg-[#118dff]" style={{ width: `${item.revenue / maxRevenue * 100}%` }} /></span><span className="text-center font-black text-[#118dff]">{expanded === item.label ? "−" : "+"}</span></button>{expanded === item.label && <div className="bg-[#f7f9fb] px-5 py-3">{loading ? <div className="py-4 text-center text-[10px] text-[#7f8993]">Завантаження товарів…</div> : <div className="grid gap-2">{products.map((product) => <a key={`${product.code}-${product.name}`} href={product.url} target="_blank" rel="noreferrer" className="grid gap-2 rounded-lg border border-[#dfe4ea] bg-white px-3 py-2 no-underline sm:grid-cols-[90px_1fr_90px_140px]"><b className="text-[10px] text-[#118dff]">{product.code}</b><span className="truncate text-[10px] font-semibold text-[#45515d]">{product.name}</span><span className="text-right text-[10px] text-[#68737e]">{numberFmt.format(product.qty)} шт.</span><b className="text-right text-[10px] text-[#087a55]">{fmtMoney(product.revenue)}</b></a>)}</div>}</div>}</div>)}</div></section>;
}

export function PromotionPerformanceDashboardV2({ view, pricePosition = "all" }: { view: PromotionPerformanceView; pricePosition?: PromotionPricePosition }) {
  const initial = useMemo(monthRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [segment, setSegment] = useState<Segment>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<PromotionSalesDataset | null>(null);
  const [previous, setPrevious] = useState<PromotionSalesDataset | null>(null);
  const [deltas, setDeltas] = useState<{ promotions: number; products: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      fetch(`/api/promotions/sales?${new URLSearchParams({ from, to, compact: "1", price_position: pricePosition })}`, { signal: controller.signal }),
      fetch(`/api/promotions/sales?${new URLSearchParams({ from: shiftYear(from), to: shiftYear(to), compact: "1", price_position: pricePosition })}`, { signal: controller.signal }),
    ]).then(async ([currentResponse, previousResponse]) => {
      if (!currentResponse.ok) throw new Error((await currentResponse.json()).error || "Не вдалося завантажити акційні продажі");
      setData(await currentResponse.json() as PromotionSalesDataset);
      setPrevious(previousResponse.ok ? await previousResponse.json() as PromotionSalesDataset : null);
      setError("");
    }).catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Помилка завантаження"); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [from, pricePosition, to]);

  useEffect(() => {
    fetch("/api/promotions/snapshots").then((response) => response.json()).then(async (payload: { dates?: string[] }) => { const dates = payload.dates ?? []; if (dates.length < 2) return; const response = await fetch(`/api/promotions/catalog?${new URLSearchParams({ view: "compact", from: dates.at(-2) ?? "", to: dates.at(-1) ?? "", page: "1", limit: "1" })}`); const catalog = await response.json() as { summary?: { newPromotions: number; disabledPromotions: number; addedProducts: number; deletedProducts: number } }; if (catalog.summary) setDeltas({ promotions: catalog.summary.newPromotions - catalog.summary.disabledPromotions, products: catalog.summary.addedProducts - catalog.summary.deletedProducts }); }).catch(() => undefined);
  }, []);

  if (loading && !data) return <div className="rounded-2xl border border-[#dfe4ea] bg-white px-6 py-20 text-center text-xs font-bold text-[#7f8993]">Завантаження нового дашборда…</div>;
  if (!data) return <div className="rounded-2xl border border-[#f0b6b6] bg-[#fff1f1] p-5 text-xs font-bold text-[#b73535]">{error || "Дані недоступні"}</div>;
  const selectedDaily = data.summary.daily.map((day) => ({ ...day }));
  const revenue = selectedDaily.reduce((sum, day) => sum + segmentBucket(day, segment).revenue, 0);
  const qty = selectedDaily.reduce((sum, day) => sum + segmentBucket(day, segment).qty, 0);
  const docs = selectedDaily.reduce((sum, day) => sum + segmentBucket(day, segment).docs, 0);

  return <div className="space-y-4">
    <DateToolbar from={from} to={to} onFrom={setFrom} onTo={setTo} />
    {view === "overview" && <><div className="flex justify-end"><SegmentControl value={segment} onChange={setSegment} /></div><div className="grid gap-3 md:grid-cols-3"><Kpi eyebrow="Активні акції на сайті" value={numberFmt.format(data.summary.activePromotions)} meta="Акційні програми з товарами у вибраній ціновій позиції" delta={pricePosition === "all" ? deltas?.promotions : null} color="#118dff" /><Kpi eyebrow="Унікальні акційні товари" value={numberFmt.format(data.summary.productCount)} meta="Без повторів між програмами" delta={pricePosition === "all" ? deltas?.products : null} color="#6d5bd0" /><Kpi eyebrow="Продажі акційних товарів" value={fmtMoney(revenue)} meta={`${numberFmt.format(qty)} шт. · ${numberFmt.format(docs)} замовлень`} color="#0f9d72" /></div><SalesChart current={selectedDaily} previous={previous?.summary.daily ?? []} segment={segment} /></>}
    {view === "promotions" && <><section className="rounded-2xl border border-[#dfe4ea] bg-white p-4 shadow-sm"><div className="flex flex-wrap items-end gap-3"><label className="min-w-[260px] flex-1"><span className="mb-1.5 block text-[9px] font-black uppercase tracking-[.12em] text-[#84909b]">Пошук акції</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID або назва акційної програми" className="h-9 w-full rounded-lg border border-[#d8dde3] bg-white px-3 text-[11px] outline-none" /></label><SegmentControl value={segment} onChange={setSegment} /></div></section><PromotionTable items={data.summary.promotions} query={query} segment={segment} /></>}
    {view === "brands" && <DimensionTable type="brand" items={data.summary.brands} from={from} to={to} pricePosition={pricePosition} />}
    {view === "categories" && <DimensionTable type="category" items={data.summary.categories} from={from} to={to} pricePosition={pricePosition} />}
    {error && <div className="rounded-xl border border-[#f0b6b6] bg-[#fff1f1] p-3 text-xs font-semibold text-[#b73535]">{error}</div>}
  </div>;
}
