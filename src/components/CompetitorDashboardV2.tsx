"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

type ViewMode = "overview" | "competing" | "vtm-competing" | "changed" | "vtm-changed";

interface MetricValues {
  tile: number;
  sanitary: number;
  deltaTile: number;
  deltaSanitary: number;
}

interface Competitor {
  id: number;
  name: string;
  adapter_name: string;
}

interface PriceCell {
  price: number | null;
  observedPrice: number | null;
  status: string | null;
  url: string | null;
  confidence: string | null;
  foundBrand: string | null;
  reviewReason: string | null;
}

interface PriceRow {
  productId: number;
  code: number | null;
  goodsRef: number | null;
  sku: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  ourPrice: number | null;
  ourUrl: string | null;
  status: string | null;
  byCompetitor: Record<number, PriceCell>;
}

interface DashboardResponse {
  prototype: boolean;
  currentDate: string | null;
  previousDate: string | null;
  overview: {
    feed: MetricValues;
    matched: MetricValues;
    vtmFeed: MetricValues;
    vtmMatched: MetricValues;
    agromatLower: MetricValues;
    agromatHigher: MetricValues;
  };
  competitors: Competitor[];
  categories: string[];
  brands: string[];
  updates: Array<{
    competitorId: number;
    competitor: string;
    adapter: string;
    updatedAt: string | null;
    changedPrices: number | null;
    durationMinutes: number | null;
    manual: boolean;
  }>;
  progress: { completed: number; total: number; elapsedMinutes: number | null };
  violations: Array<{ competitorId: number; competitor: string; count: number }>;
  rows: PriceRow[];
  total: number;
  page: number;
  limit: number;
  error?: string;
}

const VIEW_ITEMS: Array<{ id: ViewMode; label: string; hint: string }> = [
  { id: "overview", label: "Огляд", hint: "Головна сторінка" },
  { id: "competing", label: "Конкуруюча ціна", hint: "Товари зі співпадінням" },
  { id: "vtm-competing", label: "ВТМ з ціною", hint: "ВТМ зі співпадінням" },
  { id: "changed", label: "Змінили ціну", hint: "Зміни у конкурентів" },
  { id: "vtm-changed", label: "ВТМ змінили ціну", hint: "Зміни ВТМ" },
];

const METRICS: Array<{ key: keyof DashboardResponse["overview"]; label: string; symbol: string; tone: string }> = [
  { key: "feed", label: "Товарів у фіді Агромат", symbol: "A", tone: "#118dff" },
  { key: "matched", label: "Знайдено співпадіння", symbol: "✓", tone: "#0f9d72" },
  { key: "vtmFeed", label: "Товарів ВТМ у фіді", symbol: "V", tone: "#6d5bd0" },
  { key: "vtmMatched", label: "ВТМ зі співпадінням", symbol: "◇", tone: "#2867d8" },
  { key: "agromatLower", label: "Ціна Агромат нижча", symbol: "↓", tone: "#0f9d72" },
  { key: "agromatHigher", label: "Ціна Агромат вища", symbol: "!", tone: "#d14343" },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("uk-UA").format(value || 0);
}

function formatPrice(value: number | null): string {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value)} ₴`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Ще не оновлювався";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function durationLabel(minutes: number | null): string {
  if (minutes == null) return "тривалість не зафіксована";
  if (minutes < 60) return `${minutes} хв`;
  return `${Math.floor(minutes / 60)} год ${minutes % 60} хв`;
}

function DeltaBadge({ value }: { value: number }) {
  const positive = value > 0;
  const neutral = value === 0;
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
      style={{
        color: neutral ? "#737b86" : positive ? "#087a55" : "#c63f3f",
        background: neutral ? "#f0f2f4" : positive ? "#e6f6ef" : "#fcebea",
      }}
    >
      {positive ? "+" : ""}{value}
    </span>
  );
}

function MetricCard({ label, symbol, tone, value }: {
  label: string;
  symbol: string;
  tone: string;
  value: MetricValues;
}) {
  return (
    <article className="rounded-2xl border border-[#dfe4ea] bg-white p-4 shadow-[0_1px_2px_rgba(20,32,50,.04)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <p className="text-xs font-semibold leading-5 text-[#66707b]">{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-black" style={{ color: tone, background: `${tone}14` }}>
          {symbol}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[.13em] text-[#9aa2ab]">Плитка</div>
          <div className="flex items-center gap-2">
            <strong className="text-2xl font-black tracking-tight text-[#202a35]">{formatNumber(value.tile)}</strong>
            <DeltaBadge value={value.deltaTile} />
          </div>
        </div>
        <div className="border-l border-[#e8ebef] pl-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[.13em] text-[#9aa2ab]">Сантехніка</div>
          <div className="flex items-center gap-2">
            <strong className="text-2xl font-black tracking-tight text-[#202a35]">{formatNumber(value.sanitary)}</strong>
            <DeltaBadge value={value.deltaSanitary} />
          </div>
        </div>
      </div>
    </article>
  );
}

function PriceValue({ price, ourPrice }: { price: number | null; ourPrice: number | null }) {
  if (price == null) return <span className="text-[#b2b8c0]">—</span>;
  const delta = ourPrice && ourPrice > 0 ? Math.round(((price - ourPrice) / ourPrice) * 100) : null;
  const color = delta == null ? "#27313c" : delta < -5 ? "#d14343" : delta > 5 ? "#087a55" : "#66707b";
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <strong className="whitespace-nowrap text-xs" style={{ color }}>{formatPrice(price)}</strong>
      {delta != null && <small className="text-[9px] font-bold" style={{ color }}>{delta > 0 ? "+" : ""}{delta}%</small>}
    </span>
  );
}

export function CompetitorDashboardV2() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<ViewMode>("overview");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [priceMode, setPriceMode] = useState("all");
  const [selectedCompetitors, setSelectedCompetitors] = useState<Set<number>>(new Set());
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [setModalOpen, setSetModalOpen] = useState(false);
  const [setDraft, setSetDraft] = useState("");
  const [productIds, setProductIds] = useState("");
  const [notice, setNotice] = useState("");
  const [localUrls, setLocalUrls] = useState<Record<string, string | null>>({});

  const selectedKey = [...selectedCompetitors].sort((a, b) => a - b).join(",");

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), limit: "20", view });
    if (category) query.set("category", category);
    if (brand) query.set("brand", brand);
    if (priceMode !== "all") query.set("price", priceMode);
    if (selectedKey) query.set("competitors", selectedKey);
    if (search) query.set("search", search);
    if (productIds) query.set("ids", productIds);
    setLoading(true);
    setError("");
    fetch(`/api/parser/dashboard-v2?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as DashboardResponse;
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        return body;
      })
      .then(setData)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Не вдалося завантажити прототип");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [brand, category, page, priceMode, productIds, search, selectedKey, view]);

  useEffect(() => setPage(1), [brand, category, priceMode, productIds, search, selectedKey, view]);

  const defaultCompetitors = useMemo(() => new Set((data?.competitors || []).slice(0, 4).map((item) => item.id)), [data?.competitors]);
  const visibleCompetitorIds = selectedCompetitors.size ? selectedCompetitors : defaultCompetitors;
  const visibleCompetitors = (data?.competitors || []).filter((competitor) => visibleCompetitorIds.has(competitor.id));
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / 20));

  function toggleCompetitor(id: number) {
    setSelectedCompetitors((current) => {
      const next = new Set(current.size ? current : defaultCompetitors);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function resetFilters() {
    setCategory("");
    setBrand("");
    setPriceMode("all");
    setSelectedCompetitors(new Set());
    setSearchDraft("");
    setSearch("");
    setProductIds("");
    setPage(1);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearch(searchDraft.trim());
  }

  function applyProductSet() {
    const normalized = setDraft.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean).join(",");
    setProductIds(normalized);
    setSetModalOpen(false);
    setNotice(normalized ? `Застосовано набір з ${normalized.split(",").length} IDD` : "Набір очищено");
  }

  function prototypeUrlAction(productId: number, competitorId: number, nextUrl: string | null) {
    setLocalUrls((current) => ({ ...current, [`${productId}:${competitorId}`]: nextUrl }));
    setNotice("Прототип: вигляд URL змінено локально. Запис у БД підключимо після затвердження дизайну.");
  }

  const latestUpdate = data?.updates.find((update) => update.updatedAt)?.updatedAt || null;
  const progressPct = data?.progress.total ? Math.round((data.progress.completed / data.progress.total) * 100) : 0;
  const activeView = VIEW_ITEMS.find((item) => item.id === view) || VIEW_ITEMS[0];

  return (
    <div className="min-h-[calc(100dvh-104px)] overflow-hidden rounded-2xl border border-[#dfe4ea] bg-[#f4f5f3] text-[#27313c] shadow-sm">
      <div className="grid min-h-[calc(100dvh-104px)] grid-cols-1 lg:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="bg-[#17202a] px-3 py-5 text-white lg:min-h-full">
          <div className="mb-7 flex items-center gap-3 px-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#118dff] text-lg font-black">A</span>
            <div>
              <div className="text-sm font-black tracking-[.12em]">АГРОМАТ</div>
              <div className="text-[9px] font-semibold uppercase tracking-[.2em] text-[#91a0af]">Price monitor</div>
            </div>
          </div>
          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {VIEW_ITEMS.map((item, index) => {
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className="min-w-[170px] rounded-xl border-0 px-3 py-3 text-left transition lg:min-w-0"
                  style={{ background: active ? "#25384d" : "transparent", boxShadow: active ? "inset 3px 0 #118dff" : "none" }}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-black" style={{ color: active ? "#fff" : "#82909e", background: active ? "#118dff" : "#222d38" }}>
                      {index + 1}
                    </span>
                    <div>
                      <div className="text-xs font-bold" style={{ color: active ? "#fff" : "#bac2ca" }}>{item.label}</div>
                      <div className="mt-0.5 text-[9px] text-[#758391]">{item.hint}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
          <div className="mt-8 hidden rounded-xl border border-[#304152] bg-[#1d2a36] p-3 lg:block">
            <div className="text-[10px] font-bold uppercase tracking-[.14em] text-[#7f90a0]">Тестовий режим</div>
            <p className="mt-2 text-[10px] leading-4 text-[#aab5bf]">Поточний дашборд і блок у картках товару не змінені.</p>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="flex flex-col gap-3 border-b border-[#e1e4e8] bg-white px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="text-xs text-[#8b949e]">Моніторинг цін&nbsp; / &nbsp;<b className="text-[#27313c]">{activeView.label}</b></div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-[#eef6ff] px-2.5 py-1.5 text-[10px] font-bold text-[#0b6fc2]">TEST · V2</span>
              <span className="rounded-lg border border-[#dfe4ea] bg-white px-3 py-1.5 text-[10px] text-[#68727d]">Останнє оновлення: <b className="text-[#27313c]">{formatDateTime(latestUpdate)}</b></span>
            </div>
          </header>

          <div className="p-4 sm:p-5 xl:p-6">
            <section className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="mb-1 text-[10px] font-black uppercase tracking-[.2em] text-[#118dff]">{data?.currentDate || "Актуальні дані"}</div>
                <h1 className="text-2xl font-black tracking-tight text-[#202a35] sm:text-3xl">Аналіз цін <span className="text-[#118dff]">конкурентів</span></h1>
                <p className="mt-1 text-xs text-[#737d87]">Єдиний простір огляду, фільтрації та моніторингу оновлень.</p>
              </div>
              <button onClick={() => window.location.reload()} className="rounded-xl border-0 bg-[#118dff] px-4 py-2.5 text-xs font-bold text-white shadow-[0_8px_18px_rgba(17,141,255,.2)]">↻ Оновити дані</button>
            </section>

            {notice && (
              <button onClick={() => setNotice("")} className="mb-4 w-full rounded-xl border border-[#9cccf6] bg-[#eef7ff] px-3 py-2 text-left text-xs text-[#175f9f]">{notice} <span className="float-right">×</span></button>
            )}
            {error && <div className="mb-4 rounded-xl border border-[#f0b6b6] bg-[#fff1f1] p-3 text-xs font-semibold text-[#b73535]">{error}</div>}

            <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {METRICS.map((item) => (
                <MetricCard key={item.key} label={item.label} symbol={item.symbol} tone={item.tone} value={data?.overview[item.key] || { tile: 0, sanitary: 0, deltaTile: 0, deltaSanitary: 0 }} />
              ))}
            </section>

            <section className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
                <div className="border-b border-[#e5e8eb] px-4 py-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-black text-[#26313d]">Основний дашборд моніторингу</h2>
                      <p className="mt-0.5 text-[10px] text-[#8a939c]">Показано {formatNumber(data?.total || 0)} товарів за вибраними умовами</p>
                    </div>
                    <button onClick={resetFilters} className="rounded-lg border border-[#cbd9e7] bg-[#f3f8fd] px-3 py-2 text-[10px] font-bold text-[#0b6fc2]">Скинути фільтри</button>
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[11px] outline-none focus:border-[#118dff]">
                      <option value="">Усі категорії</option>
                      {(data?.categories || []).map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                    <select value={brand} onChange={(event) => setBrand(event.target.value)} className="rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[11px] outline-none focus:border-[#118dff]">
                      <option value="">Усі бренди</option>
                      {(data?.brands || []).map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                    <select value={priceMode} onChange={(event) => setPriceMode(event.target.value)} className="rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[11px] outline-none focus:border-[#118dff]">
                      <option value="all">Будь-яка ціна Агромат</option>
                      <option value="lower">Агромат нижче</option>
                      <option value="higher">Агромат вище</option>
                    </select>
                    <details className="relative rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[11px]">
                      <summary className="cursor-pointer list-none font-semibold text-[#56616c]">Конкуренти · {visibleCompetitorIds.size}</summary>
                      <div className="absolute right-0 z-30 mt-3 max-h-64 min-w-56 overflow-auto rounded-xl border border-[#d8dde3] bg-white p-2 shadow-xl">
                        {(data?.competitors || []).map((competitor) => (
                          <label key={competitor.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-[#f3f7fb]">
                            <input type="checkbox" checked={visibleCompetitorIds.has(competitor.id)} onChange={() => toggleCompetitor(competitor.id)} className="accent-[#118dff]" />
                            <span>{competitor.name}</span>
                          </label>
                        ))}
                      </div>
                    </details>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <form onSubmit={submitSearch} className="flex min-w-0 flex-1">
                      <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Назва, бренд, артикул або IDD товару" className="min-w-0 flex-1 rounded-l-lg border border-r-0 border-[#d8dde3] px-3 py-2 text-xs outline-none focus:border-[#118dff]" />
                      <button className="rounded-r-lg border-0 bg-[#118dff] px-4 text-xs font-bold text-white">Пошук</button>
                    </form>
                    <button onClick={() => setSetModalOpen(true)} className="rounded-lg border border-[#bcd8f1] bg-[#edf6ff] px-4 py-2 text-xs font-bold text-[#0b6fc2]">Пошук набором {productIds ? `· ${productIds.split(",").length}` : ""}</button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] border-collapse text-left">
                    <thead className="bg-[#f7f8f8] text-[9px] font-black uppercase tracking-[.12em] text-[#8d969f]">
                      <tr>
                        <th className="px-3 py-3">Категорія / бренд</th>
                        <th className="px-3 py-3">Артикул</th>
                        <th className="min-w-64 px-3 py-3">Назва товару</th>
                        <th className="px-3 py-3 text-right">Агромат</th>
                        {visibleCompetitors.map((competitor) => <th key={competitor.id} className="min-w-36 px-3 py-3 text-right text-[#0b6fc2]">{competitor.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {loading && !data && (
                        <tr><td colSpan={4 + visibleCompetitors.length} className="px-4 py-16 text-center text-xs font-semibold text-[#82909d]">Завантаження нового дашборда…</td></tr>
                      )}
                      {!loading && data?.rows.length === 0 && (
                        <tr><td colSpan={4 + visibleCompetitors.length} className="px-4 py-16 text-center text-xs font-semibold text-[#82909d]">За цими фільтрами товарів не знайдено</td></tr>
                      )}
                      {(data?.rows || []).map((row) => (
                        <tr key={row.productId} className="border-t border-[#edf0f2] align-top hover:bg-[#fbfcfd]">
                          <td className="max-w-48 px-3 py-3">
                            <div className="truncate text-[11px] font-bold text-[#34404c]" title={row.category || ""}>{row.category || "Без категорії"}</div>
                            <div className="mt-1 text-[10px] text-[#8a949e]">{row.brand || "Без бренду"}</div>
                          </td>
                          <td className="px-3 py-3 text-[10px] font-semibold text-[#58636f]">
                            <div>{row.sku || "—"}</div>
                            <div className="mt-1 text-[9px] text-[#9aa2aa]">IDD {row.code || row.productId}</div>
                          </td>
                          <td className="px-3 py-3">
                            {row.ourUrl ? <a href={row.ourUrl} target="_blank" rel="noreferrer" className="line-clamp-2 text-[11px] font-semibold leading-4 text-[#26313d] no-underline hover:text-[#118dff]">{row.name}</a> : <span className="line-clamp-2 text-[11px] font-semibold leading-4">{row.name}</span>}
                          </td>
                          <td className="px-3 py-3 text-right text-xs font-black text-[#26313d]">{formatPrice(row.ourPrice)}</td>
                          {visibleCompetitors.map((competitor) => {
                            const cell = row.byCompetitor[competitor.id];
                            const key = `${row.productId}:${competitor.id}`;
                            const localUrl = Object.prototype.hasOwnProperty.call(localUrls, key) ? localUrls[key] : cell?.url;
                            return (
                              <td key={competitor.id} className="px-3 py-3 text-right">
                                <PriceValue price={cell?.price ?? null} ourPrice={row.ourPrice} />
                                <div className="mt-1.5 flex items-center justify-end gap-1">
                                  <button onClick={() => prototypeUrlAction(row.productId, competitor.id, localUrl || "https://")} className="rounded bg-[#edf6ff] px-1.5 py-1 text-[9px] font-bold text-[#0b6fc2]">{localUrl ? "URL ✎" : "+ URL"}</button>
                                  {localUrl && <button onClick={() => prototypeUrlAction(row.productId, competitor.id, null)} className="rounded bg-[#fff0f0] px-1.5 py-1 text-[9px] font-bold text-[#c64040]" title="Видалити URL">×</button>}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <footer className="flex items-center justify-between border-t border-[#e5e8eb] px-4 py-3">
                  <span className="text-[10px] text-[#8a949e]">Сторінка {data?.page || 1} з {totalPages}</span>
                  <div className="flex gap-2">
                    <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-[#d8dde3] bg-white px-3 py-1.5 text-[10px] font-bold disabled:opacity-30">← Назад</button>
                    <button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-[#bcd8f1] bg-[#edf6ff] px-3 py-1.5 text-[10px] font-bold text-[#0b6fc2] disabled:opacity-30">Далі →</button>
                  </div>
                </footer>
              </div>

              <aside className="space-y-4">
                <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
                  <header className="border-b border-[#e5e8eb] px-4 py-3">
                    <h3 className="text-xs font-black text-[#26313d]">Порушення за конкурентами</h3>
                    <p className="mt-0.5 text-[9px] text-[#8b949e]">Конкурент дешевше Агромат більш ніж на 5%</p>
                  </header>
                  <div className="space-y-3 p-4">
                    {(data?.violations || []).slice(0, 8).map((item, index) => {
                      const max = Math.max(1, data?.violations[0]?.count || 1);
                      return (
                        <div key={item.competitorId}>
                          <div className="mb-1 flex items-center justify-between text-[10px]"><span className="font-semibold text-[#59646f]">{index + 1}. {item.competitor}</span><b className="text-[#26313d]">{formatNumber(item.count)}</b></div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-[#edf0f3]"><div className="h-full rounded-full bg-[#118dff]" style={{ width: `${Math.max(3, Math.round((item.count / max) * 100))}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
                  <header className="flex items-start justify-between border-b border-[#e5e8eb] px-4 py-3">
                    <div><h3 className="text-xs font-black text-[#26313d]">Стан оновлення</h3><p className="mt-0.5 text-[9px] text-[#8b949e]">Дані за {data?.currentDate || "сьогодні"}</p></div>
                    <span className="rounded-full bg-[#e7f6ef] px-2 py-1 text-[9px] font-bold text-[#087a55]">Активно</span>
                  </header>
                  <div className="p-4">
                    <div className="mb-2 flex items-center justify-between text-[10px]"><b>{data?.progress.completed || 0}/{data?.progress.total || 0} конкурентів</b><span className="text-[#7d8791]">{durationLabel(data?.progress.elapsedMinutes ?? null)}</span></div>
                    <div className="mb-4 h-2 overflow-hidden rounded-full bg-[#e9edf1]"><div className="h-full rounded-full bg-[#118dff] transition-all" style={{ width: `${progressPct}%` }} /></div>
                    <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
                      {(data?.updates || []).map((update) => (
                        <div key={update.competitorId} className="rounded-xl bg-[#f7f9fb] p-3">
                          <div className="flex items-center justify-between gap-2"><b className="text-[10px] text-[#34404c]">{update.competitor}</b><span className="h-2 w-2 rounded-full" style={{ background: update.updatedAt?.startsWith(data?.currentDate || "") ? "#23a875" : "#c9cfd5" }} /></div>
                          <div className="mt-1 text-[9px] text-[#7d8791]">{formatDateTime(update.updatedAt)}</div>
                          <div className="mt-1 text-[9px] font-semibold text-[#52606d]">{update.changedPrices == null ? "Зміни ще не пораховані" : `${formatNumber(update.changedPrices)} товарів змінили ціну`}</div>
                          <div className="mt-1 text-[9px] text-[#9aa2aa]">{update.manual ? "Ручне оновлення" : durationLabel(update.durationMinutes)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </aside>
            </section>
          </div>
        </main>
      </div>

      {setModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#11182799] p-4" onMouseDown={() => setSetModalOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between"><div><h3 className="text-base font-black">Пошук набором IDD</h3><p className="mt-1 text-xs text-[#7c8792]">Вставте IDD, code або goods_ref через кому, пробіл чи з нового рядка.</p></div><button onClick={() => setSetModalOpen(false)} className="rounded-lg bg-[#f1f3f5] px-2 py-1 text-sm">×</button></div>
            <textarea value={setDraft} onChange={(event) => setSetDraft(event.target.value)} rows={9} placeholder={"473998\n59002\n10452180"} className="w-full resize-y rounded-xl border border-[#d8dde3] p-3 text-xs outline-none focus:border-[#118dff]" />
            <div className="mt-4 flex justify-end gap-2"><button onClick={() => { setSetDraft(""); setProductIds(""); setSetModalOpen(false); }} className="rounded-lg border border-[#d8dde3] bg-white px-4 py-2 text-xs font-bold">Очистити</button><button onClick={applyProductSet} className="rounded-lg border-0 bg-[#118dff] px-4 py-2 text-xs font-bold text-white">Застосувати набір</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
