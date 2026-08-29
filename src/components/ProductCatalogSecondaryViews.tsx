"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";

export type ProductCatalogSecondaryMode = "analytics" | "timeline";
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
  return (
    <ProductAnalyticsDashboard
      bulk={bulk}
      onOpenBulk={onOpenBulk}
      onClearBulk={onClearBulk}
      onToast={onToast}
    />
  );
}
