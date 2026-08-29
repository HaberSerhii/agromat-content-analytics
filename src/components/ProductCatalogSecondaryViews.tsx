"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";

export type ProductCatalogSecondaryMode = "analytics" | "timeline" | "prices";
export type ProductCatalogBulkFilter = { ids: number[]; rawText: string };

interface FiltersResp {
  statuses: { id: number; name: string }[];
  syncedAt: string | null;
}

const ARCHIVE_STATUS_ID = -1;
const DEFAULT_STATUSES = [
  { id: 1, name: "Немає в наявності" },
  { id: 2, name: "Очікується поставка" },
  { id: 3, name: "Під замовлення" },
  { id: 4, name: "Знято з виробництва" },
  { id: 5, name: "В наявності" },
];
const MAX_GET_QUERY_LENGTH = 1800;

function fetchParserPricesQuery(query: string, init?: RequestInit) {
  if (query.length <= MAX_GET_QUERY_LENGTH) {
    return fetch(`/api/parser/prices?${query}`, init);
  }
  const rest = { ...(init || {}) };
  delete rest.cache;
  const headers = new Headers(rest.headers);
  headers.set("Content-Type", "application/json");
  return fetch("/api/parser/prices", {
    ...rest,
    method: "POST",
    headers,
    body: JSON.stringify({ queryString: query }),
  });
}

function fetchProductAnalyticsQuery(query: string, init?: RequestInit) {
  if (query.length <= MAX_GET_QUERY_LENGTH) {
    return fetch(`/api/products/analytics?${query}`, init);
  }
  const rest = { ...(init || {}) };
  delete rest.cache;
  const headers = new Headers(rest.headers);
  headers.set("Content-Type", "application/json");
  return fetch("/api/products/analytics", {
    ...rest,
    method: "POST",
    headers,
    body: JSON.stringify({ queryString: query }),
  });
}

function fmtNum(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("uk-UA");
}

function fmtPrice(value: number | null, currency: string): string {
  return value == null ? "—" : `${value.toLocaleString("uk-UA")} ${currency}`;
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusColor(id: number): string {
  switch (id) {
    case 5: return "#107c10";
    case 1: return "#d13438";
    case 2: return "#e66c37";
    case 3: return "#118dff";
    case 4: return "#a19f9d";
    default: return "var(--text-dim)";
  }
}

function percent(value: number, total: number): number {
  return total ? Math.round((value / total) * 100) : 0;
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("no document"));
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch {}
    document.body.removeChild(textarea);
    if (copied) resolve();
    else reject(new Error("execCommand copy failed"));
  });
}

// ── Changes timeline view ───────────────────────────────────────────────────
// Cross-product change history. Pulls from /api/products/changes which reads
// per-group sorted sets populated by sync. Splits events into 5 sub-tabs.
type TimelineGroupKey = "photos" | "attributes" | "reviews" | "sku" | "prices";

interface TimelineEventResp {
  at: string;
  productId: number;
  productName: string;
  productUrl: string;
  categoryId: number;
  categoryName: string;
  statusId: number;
  statusName: string;
  firstSeenAt: string;
  group: TimelineGroupKey;
  fromCount?: number;
  toCount?: number;
  addedUrls?: string[];
  removedUrls?: string[];
  attrAdded?: number;
  attrRemoved?: number;
  attrChanged?: number;
  fromSku?: string | null;
  toSku?: string | null;
  fromPrice?: number | null;
  toPrice?: number | null;
  currency?: string;
  fromRating?: number | null;
  toRating?: number | null;
}

interface TimelineResponse {
  group: TimelineGroupKey;
  events: TimelineEventResp[];
  total: number;
  counts: Record<TimelineGroupKey, number>;
  limit: number;
  offset: number;
  sort: "asc" | "desc";
  syncedAt: string | null;
}

function ChangesTimelineView() {
  const [group, setGroup] = useState<TimelineGroupKey>("photos");
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [filters, setFilters] = useState<FiltersResp | null>(null);
  const [statusIds, setStatusIds] = useState<number[]>([]);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/products/filters?view=compact").then((r) => r.json()).then(setFilters).catch(() => {});
  }, []);

  useEffect(() => {
    if (!filters?.syncedAt || since || until) return;
    const lastUpdateDay = filters.syncedAt.slice(0, 10);
    setSince(lastUpdateDay);
    setUntil(lastUpdateDay);
  }, [filters?.syncedAt, since, until]);

  useEffect(() => { setPage(1); }, [group, since, until, statusIds]);

  useEffect(() => {
    if (!since || !until) return;
    const params = new URLSearchParams();
    params.set("group", group);
    params.set("limit", String(limit));
    params.set("offset", String((page - 1) * limit));
    params.set("since", `${since}T00:00:00.000Z`);
    params.set("until", `${until}T23:59:59.999Z`);
    if (statusIds.length) params.set("status_ids", statusIds.join(","));
    setLoading(true); setError("");
    fetch(`/api/products/changes?${params.toString()}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: TimelineResponse) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [group, since, until, page, limit, statusIds]);

  const tabs: { key: TimelineGroupKey; label: string; color: string }[] = [
    { key: "photos",     label: "Фото",      color: "#d13438" },
    { key: "attributes", label: "Атрибути",  color: "#d9b300" },
    { key: "reviews",    label: "Відгуки",   color: "#107c10" },
    { key: "sku",        label: "Артикул",   color: "#8e44ad" },
    { key: "prices",     label: "Ціни",      color: "#118dff" },
  ];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;
  const toggleTimelineStatus = (id: number) => {
    setStatusIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  const shiftPeriod = (days: number) => {
    const shift = (value: string) => {
      const date = new Date(`${value}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    setSince(shift(since));
    setUntil(shift(until));
  };
  const onSinceChange = (value: string) => {
    setSince(value);
    if (value > until) setUntil(value);
  };
  const onUntilChange = (value: string) => {
    setUntil(value);
    if (value < since) setSince(value);
  };

  return (
    <Card>
      {/* Common status filter */}
      <div className="flex items-center gap-1 flex-wrap rounded-lg p-0.5 mb-3 w-fit max-w-full"
        style={{ background: "var(--bg-input)", border: "1px solid var(--border2)" }}>
        <button
          onClick={() => setStatusIds([])}
          className="px-2 py-0.5 rounded text-xs font-semibold cursor-pointer border-0 whitespace-nowrap"
          style={statusIds.length === 0 ? { background: "#118dff", color: "#fff" } : { background: "transparent", color: "var(--text-dim)" }}
          title="Показати всі статуси">
          Усі статуси
        </button>
        {(filters?.statuses?.length ? filters.statuses : DEFAULT_STATUSES).map((s) => {
          const active = statusIds.includes(s.id);
          const color = statusColor(s.id);
          return (
            <button key={s.id} onClick={() => toggleTimelineStatus(s.id)} title={s.name}
              className="px-2 py-0.5 rounded text-xs font-semibold cursor-pointer border-0 whitespace-nowrap"
              style={active ? { background: color, color: "#fff" } : { background: "transparent", color }}
            >● {s.name}</button>
          );
        })}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-3 flex-wrap rounded-xl p-0.5" style={{ background: "var(--bg-input)", border: "1px solid var(--border2)" }}>
        {tabs.map((t) => {
          const active = t.key === group;
          const count = data?.counts[t.key] ?? 0;
          return (
            <button key={t.key} onClick={() => setGroup(t.key)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border-0 flex items-center gap-1.5"
              style={active ? { background: t.color, color: "#fff" } : { background: "transparent", color: "var(--text-dim)" }}
            >
              {t.label}
              <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full"
                style={{ background: active ? "rgba(255,255,255,0.25)" : "var(--bg-card)", color: active ? "#fff" : "var(--text-dim)" }}>
                {fmtNum(count)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button type="button" onClick={() => shiftPeriod(-1)} disabled={!since || !until}
          className="rounded-lg w-8 h-8 text-base font-bold border cursor-pointer disabled:opacity-30"
          style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}
          title="Попередній день" aria-label="Попередній день">
          ←
        </button>
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>Дата від:</span>
        <input type="date" value={since} max={until || undefined} onChange={(e) => onSinceChange(e.target.value)}
          className="rounded-lg px-2 py-1 text-xs border outline-none tabular-nums"
          style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }} />
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>Дата до:</span>
        <input type="date" value={until} min={since || undefined} onChange={(e) => onUntilChange(e.target.value)}
          className="rounded-lg px-2 py-1 text-xs border outline-none tabular-nums"
          style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }} />
        <button type="button" onClick={() => shiftPeriod(1)} disabled={!since || !until}
          className="rounded-lg w-8 h-8 text-base font-bold border cursor-pointer disabled:opacity-30"
          style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}
          title="Наступний день" aria-label="Наступний день">
          →
        </button>
        <div className="text-[10px] ml-auto" style={{ color: "var(--text-dim)" }}>
          Без товарів, які щойно з&apos;явилися в каталозі ·{" "}
          {data?.syncedAt && <>останній sync: {fmtDateTime(data.syncedAt)}</>}
        </div>
      </div>

      {/* Body */}
      {loading && !data && <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>Завантаження…</div>}
      {error && <div className="text-xs p-3 rounded-lg" style={{ background: "#d1343811", color: "#d13438" }}>{error}</div>}
      {!loading && !error && data && data.events.length === 0 && (
        <div className="text-xs p-6 text-center" style={{ color: "var(--text-dim)" }}>
          У цій категорії за обраний період змін не зафіксовано.
          <div className="mt-1 text-[10px]">Хронологія наповнюється після кожного синку (раз на годину).</div>
        </div>
      )}
      {data && data.events.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left" style={{ color: "var(--text-dim)" }}>
                <th className="px-2 py-2 whitespace-nowrap">Дата</th>
                <th className="px-2 py-2">Товар</th>
                <th className="px-2 py-2 whitespace-nowrap">Категорія</th>
                <th className="px-2 py-2 whitespace-nowrap">Статус</th>
                <th className="px-2 py-2 whitespace-nowrap text-right">Було → Стало</th>
                <th className="px-2 py-2">Деталі</th>
                <th className="px-2 py-2 whitespace-nowrap text-right">Сайт</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e, i) => (
                <TimelineRow key={`${e.productId}-${e.at}-${i}`} event={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pager */}
      {data && data.total > limit && (
        <div className="flex items-center justify-end gap-2 mt-3">
          <button disabled={page <= 1} onClick={() => setPage(1)}
            className="px-2 py-1 rounded-lg text-xs cursor-pointer border disabled:opacity-30"
            style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}>«</button>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            className="px-2.5 py-1 rounded-lg text-xs cursor-pointer border disabled:opacity-30"
            style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}>← Попер.</button>
          <span className="text-xs tabular-nums" style={{ color: "var(--text-dim)" }}>
            {page} / {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
            className="px-2.5 py-1 rounded-lg text-xs cursor-pointer border disabled:opacity-30"
            style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}>Наст. →</button>
          <button disabled={page >= totalPages} onClick={() => setPage(totalPages)}
            className="px-2 py-1 rounded-lg text-xs cursor-pointer border disabled:opacity-30"
            style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}>»</button>
          <span className="text-xs ml-2" style={{ color: "var(--text-dim)" }}>
            {`${(page - 1) * limit + 1}–${Math.min(page * limit, data.total)}`} з {fmtNum(data.total)}
          </span>
        </div>
      )}
    </Card>
  );
}

function TimelineRow({ event }: { event: TimelineEventResp }) {
  const arrow = <span style={{ color: "var(--text-dim)", margin: "0 4px" }}>→</span>;

  const beforeAfter = (() => {
    switch (event.group) {
      case "photos":
      case "attributes":
      case "reviews":
        return (
          <span className="tabular-nums">
            <span style={{ color: "var(--text-dim)" }}>{event.fromCount ?? 0}</span>
            {arrow}
            <b>{event.toCount ?? 0}</b>
          </span>
        );
      case "sku":
        return (
          <span className="tabular-nums">
            <span style={{ color: "var(--text-dim)" }}>{event.fromSku || "—"}</span>
            {arrow}
            <b style={{ fontFamily: "monospace" }}>{event.toSku || "—"}</b>
          </span>
        );
      case "prices":
        return (
          <span className="tabular-nums">
            <span style={{ color: "var(--text-dim)" }}>{event.fromPrice != null ? fmtPrice(event.fromPrice, event.currency || "UAH") : "—"}</span>
            {arrow}
            <b>{event.toPrice != null ? fmtPrice(event.toPrice, event.currency || "UAH") : "—"}</b>
          </span>
        );
    }
  })();

  const details = (() => {
    switch (event.group) {
      case "photos": {
        const added = event.addedUrls?.length ?? 0;
        const removed = event.removedUrls?.length ?? 0;
        const parts: ReactNode[] = [];
        if (added) parts.push(<span key="a" style={{ color: "#107c10" }}>+{added} додано</span>);
        if (removed) parts.push(<span key="r" style={{ color: "#d13438" }}>−{removed} видалено</span>);
        return parts.length ? <span className="flex gap-2 flex-wrap">{parts}</span> : <span style={{ color: "var(--text-dim)" }}>пересортовано</span>;
      }
      case "attributes": {
        const parts: ReactNode[] = [];
        if (event.attrAdded)   parts.push(<span key="a" style={{ color: "#107c10" }}>+{event.attrAdded}</span>);
        if (event.attrRemoved) parts.push(<span key="r" style={{ color: "#d13438" }}>−{event.attrRemoved}</span>);
        if (event.attrChanged) parts.push(<span key="c" style={{ color: "#118dff" }}>~{event.attrChanged}</span>);
        return parts.length ? <span className="flex gap-2 flex-wrap">{parts}</span> : <span style={{ color: "var(--text-dim)" }}>—</span>;
      }
      case "reviews": {
        const delta = (event.toCount ?? 0) - (event.fromCount ?? 0);
        const ratingChanged = event.fromRating !== event.toRating;
        return (
          <span className="flex gap-2 flex-wrap items-center">
            <span style={{ color: delta > 0 ? "#107c10" : delta < 0 ? "#d13438" : "var(--text-dim)" }}>
              {delta > 0 ? `+${delta}` : delta}
            </span>
            {ratingChanged && (
              <span style={{ color: "var(--text-dim)" }} className="tabular-nums">
                ★ {event.fromRating?.toFixed(1) ?? "—"}{arrow}<b>{event.toRating?.toFixed(1) ?? "—"}</b>
              </span>
            )}
          </span>
        );
      }
      case "sku":
        return event.fromSku
          ? <span style={{ color: "var(--text-dim)" }}>оновлено</span>
          : <span style={{ color: "#107c10" }}>+ артикул додано</span>;
      case "prices": {
        const from = event.fromPrice ?? 0;
        const to = event.toPrice ?? 0;
        if (!from || !to) return <span style={{ color: "var(--text-dim)" }}>—</span>;
        const pct = Math.round(((to - from) / from) * 100);
        return (
          <span style={{ color: pct > 0 ? "#d13438" : pct < 0 ? "#107c10" : "var(--text-dim)" }} className="tabular-nums">
            {pct > 0 ? "+" : ""}{pct}%
          </span>
        );
      }
    }
  })();

  return (
    <tr className="border-t hover:bg-[var(--bg-input)]" style={{ borderColor: "var(--border)" }}>
      <td className="px-2 py-2 tabular-nums whitespace-nowrap" style={{ color: "var(--text-dim)" }}>{fmtDateTime(event.at)}</td>
      <td className="px-2 py-2" style={{ color: "var(--text)" }}>
        <div className="truncate" style={{ maxWidth: 360 }} title={event.productName}>{event.productName}</div>
        <div className="text-[10px] tabular-nums" style={{ color: "var(--text-dim)" }}>id: {event.productId}</div>
      </td>
      <td className="px-2 py-2 truncate" style={{ color: "var(--text-mid)", maxWidth: 220 }} title={event.categoryName}>{event.categoryName}</td>
      <td className="px-2 py-2 whitespace-nowrap" style={{ color: statusColor(event.statusId) }}>● {event.statusName || `#${event.statusId}`}</td>
      <td className="px-2 py-2 text-right whitespace-nowrap">{beforeAfter}</td>
      <td className="px-2 py-2">{details}</td>
      <td className="px-2 py-2 text-right">
        <a href={event.productUrl} target="_blank" rel="noopener noreferrer"
          className="text-xs font-semibold no-underline whitespace-nowrap"
          style={{ color: "#118dff" }}
          title="Відкрити товар на сайті agromat.ua">↗ сайт</a>
      </td>
    </tr>
  );
}

// ── Competitor prices view ──────────────────────────────────────────────────
// Reads from /api/parser/prices (joins Supabase products + competitors +
// price_snapshots). "↻" button per cell hits /api/parser/reparse which
// forwards to the legacy Flask scraper (Agromat_Parcer).
interface PricesCompetitor { id: number; name: string; adapter_name: string }
interface PricesCell {
  price: number | null;
  observedPrice: number | null;
  status: string | null;
  url: string | null;
  confidence: string | null;
  foundBrand: string | null;
  reviewReason: "out_of_stock" | "partial_match" | "brand_missing" | "brand_mismatch" | "availability_unknown" | "parse_error" | null;
}
interface PricesRow {
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
  byCompetitor: Record<number, PricesCell>;
}
interface PricesResponse {
  snapshotDate: string | null;
  competitors: PricesCompetitor[];
  // competitorId → ISO of the most recent price write for that competitor
  // (latest created_at in price_snapshots). Powers the per-button "last updated".
  lastUpdated: Record<number, string | null>;
  // competitorId → how many products' price changed in the latest run vs the
  // previous run (null = couldn't compute / no prior run). Shown under each button.
  priceChanges: Record<number, number | null>;
  rows: PricesRow[];
  total: number;
  page: number;
  limit: number;
  notFoundIds: number[];
}

type ParserSegment = "all" | "sanitary" | "tile";

// Mass-reparse job status returned by /api/parser/job/<id>. Mirrors Flask's
// _jobs payload shape from Agromat_Parcer/app.py. On completion `result`
// carries a flattened orchestrator summary — Flask collapses list fields
// to their length before serializing, so e.g. `errors` is a count not array.
// Field names match orchestrator.run()'s return verbatim: { total, found,
// new_finds, price_changes, errors }.
interface ParserJobResult {
  total?: number;
  found?: number;
  errors?: number;
  new_finds?: number;
  price_changes?: number;
  blocked?: number;
}
interface ParserJob {
  ok: boolean;
  job_id?: string;
  action?: string;
  status?: "starting" | "running" | "blocked" | "done" | "error";
  current?: number;
  total?: number;
  label?: string;
  started_at?: number;
  finished_at?: number | null;
  error?: string | null;
  result?: ParserJobResult | null;
}

// Per-competitor button styling, keyed by adapter_name. Anything not listed
// (a freshly added competitor) falls back to a neutral grey button, so the UI
// never breaks when the DB gains a new competitor before this map is updated.
const COMPETITOR_BTN_META: Record<string, { color: string; title?: string }> = {
  vencon:       { color: "#118dff", title: "Live-парсинг усіх товарів у Vencon (~45 хв через REQUEST_DELAY 1.5с)" },
  teploradost:  { color: "#107c10", title: "Live-парсинг усіх товарів у Теплорадості (~45 хв)" },
  santechshara: { color: "#8e44ad", title: "Локальний браузерний запуск через Agromat local runner" },
  drop:         { color: "#e8590c", title: "Live-перепарсинг усіх товарів у Drop" },
  depoint:      { color: "#0b7285", title: "Live-перепарсинг усіх товарів у Depoint" },
  vannaja:      { color: "#9c36b5", title: "Локальний браузерний запуск через Agromat local runner" },
  plitka:       { color: "#0b7285", title: "Швидкий HTTP-парсинг plitka.ua з JSON-LD Product/offers" },
  leoceramika:  { color: "#2f9e44", title: "Швидкий HTTP-парсинг leoceramika.com з meta price / #site_price" },
  kranok:       { color: "#b45309", title: "Live-оновлення цін Kranok за підтвердженими URL" },
  sanhub:       { color: "#0369a1", title: "Live-оновлення цін Sanhub за підтвердженими URL" },
  imperiia:     { color: "#7c3aed", title: "Live-оновлення цін Імперії сантехніки за підтвердженими URL" },
  rozetka:      { color: "#00a046", title: "Live-оновлення цін Rozetka за підтвердженими URL" },
};

const LOCAL_BROWSER_ADAPTERS = new Set(["santechshara", "vannaja"]);
const LOCAL_RUNNER_URL = "http://127.0.0.1:8765";

function canonicalParserAdapter(adapter: string): string {
  if (adapter === "plitka.ua") return "plitka";
  if (adapter === "leoceramika.com" || adapter === "leo-ceramika") return "leoceramika";
  return adapter;
}

function CompetitorPricesView({
  bulk,
  onOpenBulk,
  onClearBulk,
  onToast,
}: {
  bulk: ProductCatalogBulkFilter | null;
  onOpenBulk: () => void;
  onClearBulk: () => void;
  onToast: (message: string) => void;
}) {
  const [data, setData] = useState<PricesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [segment, setSegment] = useState<ParserSegment>("all");
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  // per-cell loading state keyed by `${productId}:${competitorId}`
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Mass-reparse job state — null when no job running.
  const [job, setJob] = useState<ParserJob | null>(null);
  const [bulkStarting, setBulkStarting] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setSearchDebounced(search), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => { setPage(1); }, [searchDebounced, bulk, segment]);

  const buildPricesQuery = useCallback((nextPage: number, nextLimit: number) => {
    const p = new URLSearchParams();
    p.set("page", String(nextPage));
    p.set("limit", String(nextLimit));
    if (data?.snapshotDate) p.set("snapshot_date", data.snapshotDate);
    if (searchDebounced) p.set("search", searchDebounced);
    if (bulk && bulk.ids.length > 0) p.set("ids_in", bulk.ids.join(","));
    if (segment !== "all") p.set("segment", segment);
    return p;
  }, [bulk, data?.snapshotDate, searchDebounced, segment]);

  const load = useCallback((forceRefresh = false) => {
    setLoading(true); setError("");
    const query = buildPricesQuery(page, limit);
    if (forceRefresh) query.set("refresh", "1");
    fetchParserPricesQuery(query.toString(), forceRefresh ? { cache: "no-store" } : undefined)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: PricesResponse) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [buildPricesQuery, page, limit]);

  useEffect(() => { load(); }, [load]);

  const reparse = useCallback(async (productId: number, competitorId: number) => {
    const key = `${productId}:${competitorId}`;
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      const resp = await fetch("/api/parser/reparse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          competitor_id: competitorId,
          snapshot_date: data?.snapshotDate,
        }),
      });
      const json = await resp.json();
      if (!json.ok) {
        setError(`Reparse failed: ${json.error || "unknown"}`);
        return;
      }
      // Patch the cell in place so the user sees the new price immediately
      // without a full refetch.
      setData((cur) => {
        if (!cur) return cur;
        return {
          ...cur,
          rows: cur.rows.map((r) =>
            r.productId === productId
              ? {
                  ...r,
                  byCompetitor: {
                    ...r.byCompetitor,
                    [competitorId]: {
                      price: typeof json.price === "number" ? json.price : null,
                      observedPrice: typeof json.observed_price === "number" ? json.observed_price : null,
                      status: json.status ?? r.byCompetitor[competitorId]?.status ?? null,
                      url: r.byCompetitor[competitorId]?.url ?? null,
                      confidence: json.confidence ?? null,
                      foundBrand: json.found_brand ?? null,
                      reviewReason: json.review_reason ?? null,
                    },
                  },
                }
              : r,
          ),
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }, [data?.snapshotDate]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  // Mass-reparse: regular competitors run on the server. Cloudflare-sensitive
  // competitors run on the user's laptop via Agromat local runner.
  const startBulk = useCallback(async (rawAdapter: string) => {
    const adapter = canonicalParserAdapter(rawAdapter);
    setBulkStarting(true);
    setError("");
    try {
      if (LOCAL_BROWSER_ADAPTERS.has(adapter)) {
        const resp = await fetch(`${LOCAL_RUNNER_URL}/run/${adapter}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "agromat-dashboard" }),
        });
        const json = await resp.json().catch(() => ({ ok: false, error: "bad_local_runner_response" }));
        if (!json.ok) {
          setError(`Локальний runner не запустив ${adapter}: ${json.error || "unknown"}`);
          return;
        }
        setJob({
          ok: true,
          job_id: json.job_id,
          status: "done",
          current: 0,
          total: 0,
          action: `prices-${adapter}`,
          label: `${adapter}: команда відкрита в локальному терміналі`,
          result: null,
        });
        return;
      }

      const resp = await fetch(`/api/parser/run/prices-${adapter}`, { method: "POST" });
      const json = await resp.json();
      if (!json.ok) {
        if (json.error === "busy" && json.active_job_id) {
          // Parser already has another job running — pick it up and poll.
          setJob({ ok: true, job_id: json.active_job_id, status: "running" });
        } else {
          setError(`Не вдалось стартувати: ${json.error || "unknown"}`);
        }
        return;
      }
      setJob({
        ok: true, job_id: json.job_id, status: "starting",
        current: 0, total: 0,
        action: `prices-${adapter}`,
      });
    } catch (e) {
      if (LOCAL_BROWSER_ADAPTERS.has(adapter)) {
        setError(
          "Локальний runner не знайдено. На цьому ноутбуці відкрийте термінал у Agromat-Analytics і запустіть: npm run local-parser-runner",
        );
      } else {
        setError(e instanceof Error ? e.message : "network error");
      }
    } finally {
      setBulkStarting(false);
    }
  }, []);

  // Poll while a job is active. Flask returns the job dict; when status flips
  // to done/error we refetch the table to surface the new prices and stop polling.
  useEffect(() => {
    if (!job?.job_id) return;
    if (job.status === "done" || job.status === "error") return;
    const id = window.setInterval(async () => {
      try {
        const resp = await fetch(`/api/parser/job/${job.job_id}`);
        const j: ParserJob = await resp.json();
        if (!j.ok) return;
        setJob(j);
        if (j.status === "done" || j.status === "error") {
          window.clearInterval(id);
          if (j.status === "done") load(true); // Reload table and counters from fresh DB data
        }
      } catch { /* keep polling */ }
    }, 5_000);
    return () => window.clearInterval(id);
  }, [job?.job_id, job?.status, load]);

  return (
    <Card>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Пошук: назва або SKU…"
          className="rounded-lg px-2 py-1 text-xs border outline-none"
          style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: search ? "#118dff" : "var(--border2)", minWidth: 320 }}
        />
        <button
          onClick={onOpenBulk}
          title="Завантажити список кодів товару або goods_ref для точкової фільтрації парсерної аналітики"
          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border"
          style={{
            background: bulk ? "#118dff" : "var(--bg-input)",
            color: bulk ? "#fff" : "var(--text-mid)",
            borderColor: bulk ? "#118dff" : "var(--border2)",
          }}
        >
          📋 Набір товарів{bulk ? ` (${bulk.ids.length})` : ""}
        </button>
        <div className="inline-flex rounded-lg p-0.5 border" style={{ background: "var(--bg-input)", borderColor: "var(--border2)" }}>
          {([
            ["all", "Всі"],
            ["sanitary", "Сантехніка"],
            ["tile", "Плитка"],
          ] as [ParserSegment, string][]).map(([value, label]) => {
            const active = segment === value;
            return (
              <button
                key={value}
                onClick={() => setSegment(value)}
                className="px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer border-0 whitespace-nowrap"
                style={{
                  background: active ? "#118dff" : "transparent",
                  color: active ? "#fff" : "var(--text-mid)",
                }}
                title={`Швидкий фільтр аналітики парсера: ${label}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {bulk && (
          <button
            onClick={onClearBulk}
            title="Скинути набір"
            className="text-xs px-2 py-1 rounded-lg cursor-pointer border-0"
            style={{ background: "#d1343811", color: "#d13438" }}
          >✕</button>
        )}
        {data?.snapshotDate && (
          <span className="text-[11px]" style={{ color: "var(--text-dim)" }}>
            Знімок цін за <b style={{ color: "var(--text-mid)" }}>{data.snapshotDate}</b>
          </span>
        )}
        {/* One mass-reparse button per competitor, derived from the DB list so
            new competitors show up automatically. Under each: when its prices
            were last refreshed + how many changed vs the previous run. Only one
            Flask job runs at a time (semaphored in app.py), so all are disabled
            while ANY job is in flight. The daily 03:00 Europe/Kyiv auto-run covers every
            competitor except Сантехшара/Vannaja, which run on the user's
            laptop through Agromat local runner. */}
        <div className="ml-auto flex gap-1 flex-wrap">
          {(data?.competitors ?? []).map((comp) => {
            const adapter = canonicalParserAdapter(comp.adapter_name);
            const meta = COMPETITOR_BTN_META[adapter] ?? { color: "#6b7280" };
            const ts = data?.lastUpdated?.[comp.id] ?? null;
            const changed = data?.priceChanges?.[comp.id] ?? null;
            return (
              <div key={comp.id} className="flex flex-col items-stretch gap-0.5">
                <button
                  onClick={() => startBulk(adapter)}
                  disabled={bulkStarting || (job?.status === "running" || job?.status === "starting")}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border disabled:opacity-60 whitespace-nowrap"
                  style={{ background: `${meta.color}11`, color: meta.color, borderColor: `${meta.color}55` }}
                  title={meta.title ?? `Live-перепарсинг усіх товарів у «${comp.name}»`}>
                  ↻↻ {comp.name}
                </button>
                <span
                  className="text-[9px] text-center tabular-nums whitespace-nowrap leading-tight"
                  style={{ color: "var(--text-dim)" }}
                  title="Час останнього оновлення цін + скільки товарів змінили ціну порівняно з попереднім прогоном (автопрогін щодня о 03:00 за Києвом, окрім Сантехшари/Vannaja)">
                  {ts ? `онов. ${fmtDateTime(ts)}` : "— ще не було"}
                  {changed != null && changed > 0 && (
                    <><br /><b style={{ color: "#d83b01" }}>змінено цін: {changed}</b></>
                  )}
                  {changed === 0 && ts && (
                    <><br /><span>без змін</span></>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <button onClick={() => load(true)}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border"
          style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}
          title="Перезавантажити таблицю з БД">↻ Оновити</button>
      </div>

      {/* Mass-reparse progress bar — visible while a job is in-flight or
          just finished. Dismissible after completion. */}
      {job && (
        <BulkProgressBar job={job} onDismiss={() => setJob(null)} />
      )}

      {bulk && data && (
        (() => {
          const notFound = data.notFoundIds || [];
          const requested = bulk.ids.length;
          const found = requested - notFound.length;
          const copyMissing = async () => {
            if (!notFound.length) return;
            const sep = bulk.rawText.includes(",") ? ", " : "\n";
            try {
              await copyText(notFound.join(sep));
              onToast(`Скопійовано ${notFound.length} не знайдених ID`);
            } catch (e) {
              onToast(`Помилка копіювання: ${e instanceof Error ? e.message : "невідомо"}`);
            }
          };
          return (
            <div className="mb-3 px-3 py-2 rounded-lg flex items-center justify-between gap-2 flex-wrap"
              style={{ background: "#118dff11", border: "1px solid #118dff44", color: "#118dff" }}>
              <span className="text-xs font-semibold tabular-nums">
                📋 Набір товарів у парсері:
                <span className="ml-1.5" style={{ color: "var(--text)" }}>
                  {found.toLocaleString("uk-UA")} / {requested.toLocaleString("uk-UA")}
                </span>
                <span className="ml-1" style={{ color: "var(--text-dim)", fontWeight: 400 }}>знайдено</span>
                {notFound.length > 0 && (
                  <span className="ml-2" style={{ color: "#d13438" }}>
                    · {notFound.length.toLocaleString("uk-UA")} не знайдено у знімку парсера
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {notFound.length > 0 && (
                  <button onClick={copyMissing}
                    className="text-xs font-semibold px-2 py-1 rounded cursor-pointer border-0"
                    style={{ background: "#d1343811", color: "#d13438" }}
                  >📋 Скопіювати не знайдені</button>
                )}
                <button onClick={onOpenBulk}
                  className="text-xs px-2 py-1 rounded cursor-pointer border-0"
                  style={{ background: "transparent", color: "#118dff", textDecoration: "underline" }}
                >Редагувати</button>
              </div>
            </div>
          );
        })()
      )}

      {error && (
        <div className="text-xs p-2 mb-2 rounded-lg" style={{ background: "#d1343811", color: "#d13438", border: "1px solid #d1343844" }}>{error}</div>
      )}
      {loading && !data && <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>Завантаження…</div>}
      {!loading && data && data.rows.length === 0 && (
        <div className="text-xs p-6 text-center" style={{ color: "var(--text-dim)" }}>
          Жодного товару з цінами конкурентів за цей знімок.
        </div>
      )}

      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left" style={{ color: "var(--text-dim)" }}>
                <th className="px-2 py-2">Товар</th>
                <th className="px-2 py-2 whitespace-nowrap text-right">Наша ціна</th>
                {data.competitors.map((c) => (
                  <th key={c.id} className="px-2 py-2 whitespace-nowrap text-right">{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.productId} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      {r.ourUrl
                        ? <a href={r.ourUrl} target="_blank" rel="noopener noreferrer" className="no-underline" style={{ color: "var(--text)" }}>
                            <span className="truncate inline-block align-middle" style={{ maxWidth: 360 }} title={r.name}>{r.name}</span>
                            <span className="ml-1" style={{ color: "#118dff" }}>↗</span>
                          </a>
                        : <span className="truncate inline-block align-middle" style={{ maxWidth: 360, color: "var(--text)" }} title={r.name}>{r.name}</span>}
                    </div>
                    <div className="text-[10px] tabular-nums" style={{ color: "var(--text-dim)" }}>
                      {r.sku ? <>SKU <b style={{ fontFamily: "monospace" }}>{r.sku}</b> · </> : null}
                      {r.brand ? <>{r.brand} · </> : null}
                      id {r.productId}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap" style={{ color: "var(--text)" }}>
                    {r.ourPrice != null ? fmtPrice(r.ourPrice, "UAH") : <span style={{ color: "var(--text-dim)" }}>—</span>}
                  </td>
                  {data.competitors.map((c) => {
                    const cell = r.byCompetitor[c.id];
                    const key = `${r.productId}:${c.id}`;
                    const cellBusy = busy[key];
                    return (
                      <td key={c.id} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                        <CompetitorCellView
                          cell={cell}
                          ourPrice={r.ourPrice}
                          busy={!!cellBusy}
                          onReparse={() => reparse(r.productId, c.id)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pager */}
      {data && data.total > limit && (
        <div className="flex items-center justify-end gap-2 mt-3">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            className="px-2.5 py-1 rounded-lg text-xs cursor-pointer border disabled:opacity-30"
            style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}>← Попер.</button>
          <span className="text-xs tabular-nums" style={{ color: "var(--text-dim)" }}>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
            className="px-2.5 py-1 rounded-lg text-xs cursor-pointer border disabled:opacity-30"
            style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}>Наст. →</button>
          <span className="text-xs ml-2" style={{ color: "var(--text-dim)" }}>
            {`${(page - 1) * limit + 1}–${Math.min(page * limit, data.total)}`} з {fmtNum(data.total)}
          </span>
        </div>
      )}
    </Card>
  );
}

function CompetitorCellView({ cell, ourPrice, busy, onReparse }: {
  cell: PricesCell | undefined;
  ourPrice: number | null;
  busy: boolean;
  onReparse: () => void;
}) {
  const has = cell && cell.price != null;
  const reviewMeta = cell?.reviewReason ? ({
    out_of_stock: { label: "Немає в наявності", color: "#a19f9d" },
    partial_match: { label: "Сумнівний матч", color: "#b45309" },
    brand_missing: { label: "Бренд не знайдено", color: "#b45309" },
    brand_mismatch: { label: "Інший бренд", color: "#d13438" },
    availability_unknown: { label: "Наявність не підтверджена", color: "#b45309" },
    parse_error: { label: "Помилка парсингу", color: "#d13438" },
  } as const)[cell.reviewReason] : null;
  let priceColor = "var(--text-mid)";
  let diffLabel: string | null = null;
  if (has && ourPrice != null && ourPrice > 0) {
    const diff = (cell!.price! - ourPrice) / ourPrice;
    if (diff <= -0.05) {
      priceColor = "#d13438";       // конкурент дешевший на >5% — ми програємо
      diffLabel = `${Math.round(diff * 100)}%`;
    } else if (diff >= 0.05) {
      priceColor = "#107c10";       // конкурент дорожчий на >5% — ми виграємо
      diffLabel = `+${Math.round(diff * 100)}%`;
    } else {
      priceColor = "var(--text-mid)";
      diffLabel = "≈";
    }
  }
  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      {has ? (
        <>
          {cell!.url
            ? <a href={cell!.url} target="_blank" rel="noopener noreferrer" className="no-underline" style={{ color: priceColor, fontWeight: 600 }}>
                {fmtPrice(cell!.price, "UAH")}
              </a>
            : <span style={{ color: priceColor, fontWeight: 600 }}>{fmtPrice(cell!.price, "UAH")}</span>}
          {diffLabel && <span className="text-[10px]" style={{ color: priceColor }}>{diffLabel}</span>}
        </>
      ) : reviewMeta ? (
        <span
          className="text-[10px] font-semibold"
          style={{ color: reviewMeta.color }}
          title={[
            cell?.status,
            cell?.foundBrand ? `Бренд конкурента: ${cell.foundBrand}` : null,
            cell?.observedPrice != null ? `Зчитана, але виключена ціна: ${fmtPrice(cell.observedPrice, "UAH")}` : null,
          ].filter(Boolean).join(" · ")}
        >
          {reviewMeta.label}
        </span>
      ) : <span style={{ color: "var(--text-dim)" }}>—</span>}
      <button onClick={onReparse} disabled={busy}
        className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-pointer border-0 disabled:opacity-60"
        style={{ background: busy ? "var(--bg-input)" : "#118dff11", color: "#118dff" }}
        title="Оновити ціну зараз (live-парсинг сайту конкурента)">
        {busy ? "…" : "↻"}
      </button>
    </span>
  );
}

function BulkProgressBar({ job, onDismiss }: { job: ParserJob; onDismiss: () => void }) {
  const current = job.current ?? 0;
  const total = job.total ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const done = job.status === "done";
  const blocked = job.status === "blocked";
  const failed = job.status === "error" || blocked;

  // Rough ETA: elapsed time ÷ items done × items left. Only meaningful once
  // we have any progress.
  let eta = "";
  if (!done && !failed && job.started_at && current > 0 && total > current) {
    const elapsedSec = Date.now() / 1000 - job.started_at;
    const ratePerSec = current / elapsedSec;
    const remainingSec = Math.round((total - current) / ratePerSec);
    const m = Math.floor(remainingSec / 60);
    const s = remainingSec % 60;
    eta = m > 0 ? `~${m} хв ${s} с` : `~${s} с`;
  }

  // Action is "prices-<adapter>"; map to a human label + colour matching the
  // table header so the user knows which competitor is being processed
  // without parsing strings themselves.
  const adapter = (job.action || "").replace(/^prices-/, "");
  const ADAPTERS: Record<string, { label: string; color: string }> = {
    vencon:       { label: "Vencon",       color: "#118dff" },
    teploradost:  { label: "Теплорадість", color: "#107c10" },
    santechshara: { label: "Сантехшара",   color: "#8e44ad" },
    vannaja:      { label: "Vannaja",      color: "#9c36b5" },
    plitka:       { label: "Plitka.ua",     color: "#0b7285" },
    leoceramika:  { label: "LeoCeramika",   color: "#2f9e44" },
  };
  const runColor = ADAPTERS[adapter]?.color || "#8e44ad";
  const runLabel = ADAPTERS[adapter]?.label || adapter || "—";

  const bg = failed ? "#d1343811" : done ? "#107c1011" : `${runColor}11`;
  const border = failed ? "#d13438aa" : done ? "#107c10aa" : `${runColor}55`;
  const accent = failed ? "#d13438" : done ? "#107c10" : runColor;

  // Flattened orchestrator summary (only meaningful when status === "done").
  const r = job.result || null;

  return (
    <div className="mb-3 p-3 rounded-lg" style={{ background: bg, border: `1px solid ${border}` }}>
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        <span className="text-xs font-semibold" style={{ color: accent }}>
          {failed
            ? blocked
              ? `Потрібна ручна браузерна сесія: ${job.error || "blocked"}`
              : `❌ Помилка: ${job.error || "unknown"}`
            : done
              ? job.label || `✓ ${runLabel} — оброблено ${current}${total ? ` / ${total}` : ""} товарів`
              : `↻↻ Парсинг ${runLabel} ${job.label ? `· ${job.label}` : ""}`}
        </span>
        <span className="text-[11px] tabular-nums" style={{ color: accent }}>
          {!done && !failed && total > 0 && <>{current} / {total} · {pct}%</>}
          {eta && <span style={{ marginLeft: 8 }}>ETA {eta}</span>}
          {(done || failed) && (
            <button onClick={onDismiss}
              className="ml-3 px-2 py-0.5 rounded cursor-pointer border-0 text-[10px] font-semibold"
              style={{ background: accent, color: "#fff" }}>✕ Закрити</button>
          )}
        </span>
      </div>
      {/* Progress bar — animated stripes while running */}
      <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
        <div
          className="h-full transition-all"
          style={{
            width: total > 0 ? `${pct}%` : "100%",
            background: accent,
            opacity: !done && !failed ? 0.6 : 1,
          }}
        />
      </div>
      {/* Summary breakdown on completion. Orchestrator returns
          { total, found, new_finds, price_changes, errors } where the last
          three are list-of-dicts that Flask collapses to lengths.
          - total       — products that were actually processed (not skipped)
          - found       — those where the parser returned a price
          - new_finds   — among `found`, those that had no price before today
          - price_changes — among `found`, those whose price differs from prev
          - errors      — products that failed AND had no previous snapshot */}
      {done && r && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] tabular-nums">
          <Stat label="Оброблено (без скіпів)" value={r.total} color="var(--text-mid)" />
          <Stat label="Знайдено ціни" value={r.found} color="#107c10" />
          <Stat label="Нових (раніше не було ціни)" value={r.new_finds} color="#118dff" />
          <Stat label="Ціна змінилась" value={r.price_changes} color="#e66c37" />
          <Stat label="Блокувань" value={r.blocked} color="#8e44ad" />
          <Stat label="Помилок" value={r.errors} color="#d13438" />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | undefined; color: string }) {
  if (value == null) return null;
  return (
    <span>
      <b style={{ color }}>{fmtNum(value)}</b>{" "}
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
    </span>
  );
}

interface ProductAnalyticsBucket {
  key: string;
  name: string;
  total: number;
  up: number;
  down: number;
  withoutDiscount: number;
  withDiscount: number;
}

interface ProductAnalyticsResponse {
  from: string;
  to: string;
  statusIds: number[];
  statuses: { id: number; name: string }[];
  syncedAt: string | null;
  newCount: number;
  disabledCount: number;
  repricedCount: number;
  repricedUpCount: number;
  repricedDownCount: number;
  withoutDiscountCount: number;
  withDiscountCount: number;
  categories: ProductAnalyticsBucket[];
  brands: ProductAnalyticsBucket[];
  notFoundIds: number[];
}

type ProductAnalyticsSortKey = keyof ProductAnalyticsBucket | "withoutDiscountPct";

const PRODUCT_ANALYTICS_COLUMNS: {
  key: ProductAnalyticsSortKey;
  label: string;
  align: "left" | "right";
}[] = [
  { key: "name", label: "Назва", align: "left" },
  { key: "up", label: "Переоцінено ↑", align: "right" },
  { key: "down", label: "Переоцінено ↓", align: "right" },
  { key: "withoutDiscount", label: "Без знижки", align: "right" },
  { key: "withDiscount", label: "Зі знижкою", align: "right" },
  { key: "total", label: "Всього", align: "right" },
  { key: "withoutDiscountPct", label: "% без знижки", align: "right" },
];

function ProductAnalyticsTable({
  title,
  rows,
  selectedKey,
  onSelect,
}: {
  title: string;
  rows: ProductAnalyticsBucket[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const [sortKey, setSortKey] = useState<ProductAnalyticsSortKey>("total");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const visibleRows = useMemo(() => {
    const value = (row: ProductAnalyticsBucket) => (
      sortKey === "withoutDiscountPct" ? percent(row.withoutDiscount, row.total) : row[sortKey]
    );
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const result = typeof av === "string"
        ? av.localeCompare(String(bv), "uk")
        : Number(av) - Number(bv);
      return sortDirection === "asc" ? result : -result;
    }).slice(0, 50);
  }, [rows, sortDirection, sortKey]);

  const onSort = (key: ProductAnalyticsSortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection(key === "name" ? "asc" : "desc");
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-sm font-bold" style={{ color: "var(--text)" }}>{title}</div>
        <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>
          Показано {fmtNum(visibleRows.length)} з {fmtNum(rows.length)}
        </div>
      </div>
      <div className="overflow-auto" style={{ maxHeight: 560 }}>
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10" style={{ color: "var(--text-dim)", background: "var(--bg-input)" }}>
            <tr>
              {PRODUCT_ANALYTICS_COLUMNS.map((column) => (
                <th key={column.key} className={`${column.align === "left" ? "text-left" : "text-right"} px-3 py-2 whitespace-nowrap`}>
                  <button
                    type="button"
                    onClick={() => onSort(column.key)}
                    className="w-full border-0 bg-transparent cursor-pointer font-semibold"
                    style={{ color: "inherit", textAlign: column.align }}
                    title={`Сортувати: ${column.label}`}
                  >
                    {column.label} {sortKey === column.key ? (sortDirection === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.key} className="border-t"
                style={{ borderColor: selectedKey === row.key ? "#118dff" : "var(--border)", background: selectedKey === row.key ? "#118dff12" : undefined }}>
                <td className="px-3 py-2 font-semibold">
                  <button type="button" onClick={() => onSelect(row.key)}
                    className="border-0 bg-transparent cursor-pointer font-semibold text-left"
                    style={{ color: selectedKey === row.key ? "#118dff" : "var(--text)" }}
                    title={selectedKey === row.key ? `Скинути фільтр: ${row.name}` : `Фільтрувати за: ${row.name}`}>
                    {selectedKey === row.key ? "✓ " : ""}{row.name}
                  </button>
                </td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: "#d13438" }}>{fmtNum(row.up)}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: "#107c10" }}>{fmtNum(row.down)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(row.withoutDiscount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(row.withDiscount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(row.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{percent(row.withoutDiscount, row.total)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ProductAnalyticsDashboard({
  bulk,
  onOpenBulk,
  onClearBulk,
  onToast,
}: {
  bulk: ProductCatalogBulkFilter | null;
  onOpenBulk: () => void;
  onClearBulk: () => void;
  onToast: (message: string) => void;
}) {
  const [from, setFrom] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [to, setTo] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [statusIds, setStatusIds] = useState<number[]>([5, 3]);
  const [statuses, setStatuses] = useState<{ id: number; name: string }[]>([]);
  const [categoryKey, setCategoryKey] = useState("");
  const [brandKey, setBrandKey] = useState("");
  const [data, setData] = useState<ProductAnalyticsResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!from || !to) return;
    setError("");
    setData(null);
    const statuses = statusIds.length ? statusIds.join(",") : "all";
    const params = new URLSearchParams({ from, to, status_ids: statuses });
    if (categoryKey) params.set("category_id", categoryKey);
    if (brandKey) params.set("brand_id", brandKey);
    if (bulk?.ids.length) params.set("ids_in", bulk.ids.join(","));
    fetchProductAnalyticsQuery(params.toString())
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((response: ProductAnalyticsResponse) => {
        setStatuses(response.statuses);
        setData(response);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [brandKey, bulk, categoryKey, from, statusIds, to]);

  const onFromChange = (value: string) => {
    if (!value) return;
    setFrom(value);
    if (value > to) setTo(value);
  };
  const onToChange = (value: string) => {
    if (!value) return;
    setTo(value);
    if (value < from) setFrom(value);
  };
  const shiftPeriod = (days: number) => {
    const shift = (value: string) => {
      const date = new Date(`${value}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    setFrom(shift(from));
    setTo(shift(to));
  };
  const toggleStatus = (id: number) => {
    setStatusIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]);
  };
  const selectedCategoryName = data?.categories.find((row) => row.key === categoryKey)?.name;
  const selectedBrandName = data?.brands.find((row) => row.key === brandKey)?.name;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>Аналітика карток товару</div>
          <div className="text-[10px] mt-1" style={{ color: "var(--text-dim)" }}>Останній sync: {fmtDateTime(data?.syncedAt)}</div>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => shiftPeriod(-1)}
            className="rounded-lg w-8 h-8 text-base font-bold border cursor-pointer"
            style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}
            title="Попередній день"
            aria-label="Попередній день"
          >
            ←
          </button>
          <label className="grid gap-1 text-[10px] font-semibold uppercase" style={{ color: "var(--text-dim)" }}>
            Дата від
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => onFromChange(event.target.value)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold border outline-none"
              style={{ background: "var(--bg-input)", color: "var(--text)", borderColor: "var(--border2)" }}
            />
          </label>
          <label className="grid gap-1 text-[10px] font-semibold uppercase" style={{ color: "var(--text-dim)" }}>
            Дата до
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) => onToChange(event.target.value)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold border outline-none"
              style={{ background: "var(--bg-input)", color: "var(--text)", borderColor: "var(--border2)" }}
            />
          </label>
          <button
            type="button"
            onClick={() => shiftPeriod(1)}
            className="rounded-lg w-8 h-8 text-base font-bold border cursor-pointer"
            style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}
            title="Наступний день"
            aria-label="Наступний день"
          >
            →
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={onOpenBulk}
          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer"
          style={{
            background: bulk ? "#118dff" : "var(--bg-input)",
            color: bulk ? "#fff" : "var(--text-mid)",
            borderColor: bulk ? "#118dff" : "var(--border2)",
          }}
          title="Завантажити список code / goods_ref для фільтрації аналітики"
        >
          📋 Набір товарів{bulk ? ` (${bulk.ids.length})` : ""}
        </button>
        {bulk && (
          <button
            type="button"
            onClick={onClearBulk}
            title="Скинути набір"
            className="text-xs px-2 py-1 rounded-lg cursor-pointer border-0"
            style={{ background: "#d1343811", color: "#d13438" }}
          >✕</button>
        )}
        <button
          type="button"
          onClick={() => setStatusIds([])}
          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer"
          style={{
            background: statusIds.length === 0 ? "#118dff" : "var(--bg-input)",
            color: statusIds.length === 0 ? "#fff" : "var(--text-mid)",
            borderColor: statusIds.length === 0 ? "#118dff" : "var(--border2)",
          }}
        >
          Усі статуси
        </button>
        {statuses.map((status) => {
          const active = statusIds.includes(status.id);
          const color = status.id === ARCHIVE_STATUS_ID ? "#a19f9d" : statusColor(status.id);
          return (
            <button
              key={status.id}
              type="button"
              onClick={() => toggleStatus(status.id)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer"
              style={{
                background: active ? `${color}20` : "var(--bg-input)",
                color: active ? color : "var(--text-mid)",
                borderColor: active ? color : "var(--border2)",
              }}
            >
              ● {status.name}
            </button>
          );
        })}
      </div>
      {(categoryKey || brandKey) && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span style={{ color: "var(--text-dim)" }}>Активні фільтри:</span>
          {categoryKey && (
            <button type="button" onClick={() => setCategoryKey("")}
              className="px-2.5 py-1 rounded-lg font-semibold border cursor-pointer"
              style={{ background: "#118dff12", color: "#118dff", borderColor: "#118dff" }}>
              Категорія: {selectedCategoryName || `#${categoryKey}`} ×
            </button>
          )}
          {brandKey && (
            <button type="button" onClick={() => setBrandKey("")}
              className="px-2.5 py-1 rounded-lg font-semibold border cursor-pointer"
              style={{ background: "#8e44ad12", color: "#8e44ad", borderColor: "#8e44ad" }}>
              Бренд: {selectedBrandName || (brandKey === "none" ? "Без бренду" : `#${brandKey}`)} ×
            </button>
          )}
          <button type="button" onClick={() => { setCategoryKey(""); setBrandKey(""); }}
            className="px-2.5 py-1 rounded-lg font-semibold border cursor-pointer"
            style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}>
            Скинути всі
          </button>
        </div>
      )}
      {bulk && data && (
        (() => {
          const notFound = data.notFoundIds || [];
          const requested = bulk.ids.length;
          const found = requested - notFound.length;
          const copyMissing = async () => {
            if (!notFound.length) return;
            const sep = bulk.rawText.includes(",") ? ", " : "\n";
            try {
              await copyText(notFound.join(sep));
              onToast(`Скопійовано ${notFound.length} не знайдених ID`);
            } catch (e) {
              onToast(`Помилка копіювання: ${e instanceof Error ? e.message : "невідомо"}`);
            }
          };
          return (
            <div className="px-3 py-2 rounded-lg flex items-center justify-between gap-2 flex-wrap"
              style={{ background: "#118dff11", border: "1px solid #118dff44", color: "#118dff" }}>
              <span className="text-xs font-semibold tabular-nums">
                📋 Набір товарів в аналітиці:
                <span className="ml-1.5" style={{ color: "var(--text)" }}>
                  {found.toLocaleString("uk-UA")} / {requested.toLocaleString("uk-UA")}
                </span>
                <span className="ml-1" style={{ color: "var(--text-dim)", fontWeight: 400 }}>знайдено</span>
                {notFound.length > 0 && (
                  <span className="ml-2" style={{ color: "#d13438" }}>
                    · {notFound.length.toLocaleString("uk-UA")} не знайдено
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {notFound.length > 0 && (
                  <button onClick={copyMissing}
                    className="text-xs font-semibold px-2 py-1 rounded cursor-pointer border-0"
                    style={{ background: "#d1343811", color: "#d13438" }}
                  >📋 Скопіювати не знайдені</button>
                )}
                <button onClick={onOpenBulk}
                  className="text-xs px-2 py-1 rounded cursor-pointer border-0"
                  style={{ background: "transparent", color: "#118dff", textDecoration: "underline" }}
                >Редагувати</button>
              </div>
            </div>
          );
        })()
      )}
      {error && <div className="text-xs" style={{ color: "#d13438" }}>{error}</div>}
      {!data && !error && <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>Завантаження…</div>}
      {data && (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              ["Додано нових карток", data.newCount, "#107c10"],
              ["Відключено карток", data.disabledCount, "#d13438"],
              ["Переоцінено товарів", data.repricedCount, "#118dff"],
              ["Переоцінка вгору", data.repricedUpCount, "#d13438"],
              ["Переоцінка вниз", data.repricedDownCount, "#107c10"],
              ["Без знижки", data.withoutDiscountCount, "#e66c37"],
              ["Зі знижкою", data.withDiscountCount, "#8e44ad"],
            ].map(([label, value, color]) => (
              <Card key={String(label)}>
                <div className="text-xs font-semibold" style={{ color: "var(--text-dim)" }}>{label}</div>
                <div className="text-2xl font-black mt-1 tabular-nums" style={{ color: String(color) }}>{fmtNum(Number(value))}</div>
              </Card>
            ))}
          </div>
          <ProductAnalyticsTable
            title="За категоріями"
            rows={data.categories}
            selectedKey={categoryKey}
            onSelect={(key) => setCategoryKey((current) => current === key ? "" : key)}
          />
          <ProductAnalyticsTable
            title="За брендами"
            rows={data.brands}
            selectedKey={brandKey}
            onSelect={(key) => setBrandKey((current) => current === key ? "" : key)}
          />
        </>
      )}
    </div>
  );
}



export function ProductCatalogSecondaryViews({
  mode,
  bulk,
  onOpenBulk,
  onClearBulk,
  onToast,
}: {
  mode: ProductCatalogSecondaryMode;
  bulk: ProductCatalogBulkFilter | null;
  onOpenBulk: () => void;
  onClearBulk: () => void;
  onToast: (message: string) => void;
}) {
  if (mode === "timeline") return <ChangesTimelineView />;
  if (mode === "analytics") {
    return (
      <ProductAnalyticsDashboard
        bulk={bulk}
        onOpenBulk={onOpenBulk}
        onClearBulk={onClearBulk}
        onToast={onToast}
      />
    );
  }
  return (
    <CompetitorPricesView
      bulk={bulk}
      onOpenBulk={onOpenBulk}
      onClearBulk={onClearBulk}
      onToast={onToast}
    />
  );
}
