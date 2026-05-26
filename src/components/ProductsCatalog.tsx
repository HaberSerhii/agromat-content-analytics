"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Card } from "@/components/ui";
import { IS_DEV } from "@/lib/constants";
import type {
  ProductLite,
  ProductFull,
  SyncState,
  ChangeEvent,
} from "@/lib/products-store";
import type {
  ApiBrand,
  ApiCategoryNode,
  ApiStatus,
} from "@/lib/products-api";

// ── Local types ──────────────────────────────────────────────────────────────
interface FacetOption { id: number; name: string; count: number }
interface SnapshotInfo { date: string; syncedAt: string | null }
interface ListResponse {
  items: ProductLite[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  syncedAt: string | null;
  syncState: SyncState;
  availableCategories: FacetOption[];
  availableBrands: FacetOption[];
  priceMax: number;
  stockMax: number;
  notFoundCodes: number[];
  notFoundRefs: number[];
  asOf: string | null;
  stats: {
    totalAll: number;
    newCount24h: number;
    newCount7d: number;
    statusChanged7d: number;
    noImages: number;
    noAttributes: number;
    noReviews: number;
    noSku: number;
  };
}

interface CategorySummary {
  categoryId: number;
  categoryName: string;
  categoryPath: string;
  total: number;
  withImages: number;
  withAttributes: number;
  withReviews: number;
  withSku: number;
  avgRating: number | null;
  avgImages: number;
  avgReviews: number;
  avgAttributes: number;
  inStock: number;
  outOfStock: number;
  newLast7d: number;
  statusChangedLast7d: number;
  requiredAttrIds: number[];
}

interface FiltersResp {
  categories: ApiCategoryNode[];
  statuses: ApiStatus[];
  brands: ApiBrand[];
  syncedAt: string | null;
  message?: string;
}

type PresetTab = "all" | "new7" | "changed7" | "noImg" | "noAttr" | "noRev";

// UI-only pseudo-status id for archived (deleted) products. Mirror of the
// constant in /api/products/route.ts.
const ARCHIVE_STATUS_ID = -1;

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("uk-UA");
}
function fmtPrice(p: number | null, currency: string): string {
  if (p == null) return "—";
  return `${p.toLocaleString("uk-UA")} ${currency}`;
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("uk-UA", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
function statusColor(id: number): string {
  switch (id) {
    case 5: return "#107c10";    // В наявності
    case 1: return "#d13438";    // Немає в наявності
    case 2: return "#e66c37";    // Очікується поставка
    case 3: return "#118dff";    // Під замовлення
    case 4: return "#a19f9d";    // Знято з виробництва
    default: return "var(--text-dim)";
  }
}
function percent(n: number, total: number): number {
  return total ? Math.round((n / total) * 100) : 0;
}

// ── Export helpers (CSV / Excel / Regex / Cube) ─────────────────────────────
// Copy text to clipboard with a fallback for non-secure-context (HTTP).
// navigator.clipboard.writeText silently rejects on plain HTTP; the legacy
// document.execCommand('copy') still works there. We accept either path.
async function _copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("no document"));
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* fallthrough */ }
    document.body.removeChild(ta);
    ok ? resolve() : reject(new Error("execCommand copy failed"));
  });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadIdsCsv(ids: (string | number)[], filename: string) {
  // UTF-8 BOM keeps Cyrillic correct when opened in Excel
  const content = "﻿" + ids.filter(Boolean).join("\n");
  triggerDownload(new Blob([content], { type: "text/csv;charset=utf-8;" }), filename);
}

// xlsx (~400KB minified) is loaded on-demand only when the user triggers
// an Excel export — keeps it out of the initial bundle.
async function downloadIdsXlsx(ids: (string | number)[], filename: string, columnHeader: string) {
  const XLSX = await import("xlsx");
  const rows = [[columnHeader], ...ids.filter(Boolean).map((id) => [id])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, columnHeader);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  triggerDownload(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

// Full-catalog Excel export — every visible column from the table
async function downloadProductsXlsx(items: ProductLite[], filename: string) {
  const XLSX = await import("xlsx");
  const rows = items.map((p) => ({
    "Код товара": p.code,
    "goods_ref": p.goodsRef,
    "Артикул": p.sku ?? "",
    "Назва": p.name,
    "Категорія": p.categoryName,
    "Шлях категорії": p.categoryPath,
    "Бренд": p.brand,
    "Ціна": p.price ?? "",
    "Ціна базова": p.priceBase ?? "",
    "Знижка %": p.discountPct ?? "",
    "Валюта": p.currency,
    "Залишок": p.stockQty ?? "",
    "Статус": p.deleted ? `Архів · ${p.statusName}` : p.statusName,
    "Архів": p.deleted ? "так" : "ні",
    "Кіл-ть фото": p.imagesCount,
    "Кіл-ть відгуків": p.reviewsCount,
    "Кіл-ть атрибутів": p.attributesCount,
    "Сер. рейтинг": p.ratingAvg ?? "",
    "URL": p.url,
    "Створено в API": p.createdAt,
    "Оновлено в API": p.updatedAt,
    "Вперше у нас": p.firstSeenAt,
    "Зміна статусу": p.statusChangedAt ?? "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Товари");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  triggerDownload(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

// Category-attributes Excel export — long format, one row per (category, attribute).
// The "Обов'язковий" column marks which attributes are currently flagged as
// required (★) so commerce/SEO specialists can review the full list and advise
// which others should be added.
async function downloadRequiredAttrsXlsx(
  rows: { category: string; path: string; attribute: string; filled: number; total: number; required: boolean }[],
  filename: string,
) {
  const XLSX = await import("xlsx");
  const sheetRows = rows.map((r) => ({
    "Категорія": r.category,
    "Шлях": r.path,
    "Атрибут": r.attribute,
    "Обов'язковий": r.required ? "★" : "",
    "Заповнено": r.filled,
    "Всього": r.total,
    "%": r.total > 0 ? Math.round((r.filled / r.total) * 100) : 0,
  }));
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Атрибути");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  triggerDownload(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

// Pill-shaped action button used for CSV / Regex / Cube exports. Toggles into a
// "✓ Скопійовано" state for 1.5s after a successful clipboard write.
function ExportPill({ label, color, bg, busy, onClick, title }: {
  label: string;
  color: string;
  bg: string;
  busy?: boolean;
  onClick: () => void | Promise<void>;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  const click = async () => {
    await onClick();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={click}
      title={title}
      disabled={busy}
      className="text-xs px-3 py-1.5 rounded-lg cursor-pointer border-0 disabled:opacity-50 whitespace-nowrap"
      style={{ background: copied ? bg.replace("0.12", "0.22") : bg, color }}
    >{busy ? "…" : copied ? "✓ Скопійовано" : label}</button>
  );
}

// ── Click-outside hook (for popovers) ───────────────────────────────────────
function useClickOutside<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, onClose]);
  return ref;
}

// ── Searchable single-select dropdown (popover with filter input) ──────────
function SearchSelect({ value, onChange, options, placeholder, width = 220 }: {
  value: number | "";
  onChange: (v: number | "") => void;
  options: FacetOption[];
  placeholder: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  const filtered = useMemo(() => {
    if (!q.trim()) return options;
    const l = q.toLowerCase();
    return options.filter((o) => o.name.toLowerCase().includes(l));
  }, [options, q]);

  const selected = value !== "" ? options.find((o) => o.id === value) : null;
  const btnLabel = selected ? `${selected.name}${selected.count ? ` (${selected.count})` : ""}` : placeholder;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs rounded-lg cursor-pointer border whitespace-nowrap overflow-hidden text-ellipsis"
        style={{
          background: "var(--bg-input)",
          borderColor: selected ? "#118dff" : "var(--border2)",
          color: selected ? "var(--text)" : "var(--text-dim)",
          padding: "5px 24px 5px 10px",
          minWidth: width,
          maxWidth: width,
          textAlign: "left",
        }}
      >
        {btnLabel}
        <span style={{ position: "absolute", right: 8, color: "var(--text-dim)" }}>▾</span>
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 rounded-lg shadow-lg"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            width: Math.max(width, 280),
            maxHeight: 360,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div className="p-2 border-b flex gap-1 items-center" style={{ borderColor: "var(--border)" }}>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Пошук…"
              autoFocus
              className="flex-1 rounded px-2 py-1 text-xs border outline-none"
              style={{ background: "var(--bg-input)", color: "var(--text)", borderColor: "var(--border2)" }}
            />
            {selected && (
              <button
                onClick={() => { onChange(""); setQ(""); setOpen(false); }}
                className="text-[10px] px-2 py-1 rounded cursor-pointer border-0"
                style={{ background: "#d1343811", color: "#d13438" }}
              >✕ Скинути</button>
            )}
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
            {filtered.length === 0 ? (
              <div className="text-xs p-3 text-center" style={{ color: "var(--text-dim)" }}>Нічого не знайдено</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  onClick={() => { onChange(o.id); setOpen(false); setQ(""); }}
                  className="w-full text-left px-3 py-1.5 text-xs cursor-pointer border-0 flex items-center justify-between"
                  style={{
                    background: o.id === value ? "#118dff22" : "transparent",
                    color: o.id === value ? "#118dff" : "var(--text-mid)",
                  }}
                >
                  <span className="truncate">{o.name}</span>
                  <span className="text-[10px] ml-2 tabular-nums" style={{ color: "var(--text-dim)" }}>{o.count}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Price range popover ─────────────────────────────────────────────────────
// Live-apply (debounced) — no "Apply" button needed. Quick presets above
// the inputs cover the most common slices; manual inputs handle the rest.
function PriceFilter({ min, max, priceMax, count, onChange }: {
  min: number | null;
  max: number | null;
  priceMax: number;
  count: number;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [localMin, setLocalMin] = useState<string>(min != null ? String(min) : "");
  const [localMax, setLocalMax] = useState<string>(max != null ? String(max) : "");
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  // Sync external prop changes (e.g. reset) into local state
  useEffect(() => { setLocalMin(min != null ? String(min) : ""); }, [min]);
  useEffect(() => { setLocalMax(max != null ? String(max) : ""); }, [max]);

  // Debounced push of local inputs → onChange. Skips the initial mount.
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    const id = window.setTimeout(() => {
      const mn = localMin.trim() === "" ? null : Math.max(0, parseFloat(localMin) || 0);
      const mx = localMax.trim() === "" ? null : Math.max(0, parseFloat(localMax) || 0);
      if (mn !== min || mx !== max) onChange(mn, mx);
    }, 300);
    return () => window.clearTimeout(id);
  }, [localMin, localMax, min, max, onChange]);

  const active = min != null || max != null;
  const fmt = (n: number) => n.toLocaleString("uk-UA");
  const label = active
    ? `${min != null ? fmt(min) : 0}–${max != null ? fmt(max) : "∞"} ₴`
    : "Ціна: всі";

  // Quick presets — picked so they cover typical product price tiers
  const presets: { label: string; mn: number | null; mx: number | null }[] = [
    { label: "до 500",    mn: null, mx: 500 },
    { label: "500–2К",    mn: 500,  mx: 2000 },
    { label: "2К–10К",    mn: 2000, mx: 10000 },
    { label: "10К–50К",   mn: 10000, mx: 50000 },
    { label: "50К+",      mn: 50000, mx: null },
  ];
  const isPresetActive = (p: { mn: number | null; mx: number | null }) =>
    (p.mn ?? null) === (min ?? null) && (p.mx ?? null) === (max ?? null);

  const setPreset = (mn: number | null, mx: number | null) => {
    setLocalMin(mn != null ? String(mn) : "");
    setLocalMax(mx != null ? String(mx) : "");
    onChange(mn, mx);
  };

  const reset = () => {
    setLocalMin(""); setLocalMax("");
    onChange(null, null);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs rounded-lg cursor-pointer border whitespace-nowrap"
        style={{
          background: "var(--bg-input)",
          borderColor: active ? "#118dff" : "var(--border2)",
          color: active ? "var(--text)" : "var(--text-dim)",
          padding: "5px 24px 5px 10px",
          minWidth: 170,
          textAlign: "left",
          position: "relative",
        }}
      >
        {label}
        <span style={{ position: "absolute", right: 8, color: "var(--text-dim)" }}>▾</span>
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 rounded-lg shadow-lg p-3"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)", width: 320 }}
        >
          {/* Header: total + reset */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] tabular-nums" style={{ color: "var(--text-dim)" }}>
              макс. у каталозі: <b style={{ color: "var(--text-mid)" }}>{fmt(priceMax)} ₴</b>
            </span>
            {active && (
              <button onClick={reset}
                className="text-[10px] cursor-pointer border-0 bg-transparent"
                style={{ color: "#d13438" }}
              >✕ Скинути</button>
            )}
          </div>

          {/* Quick presets */}
          <div className="flex gap-1 flex-wrap mb-2">
            {presets.map((p) => {
              const on = isPresetActive(p);
              return (
                <button key={p.label}
                  onClick={() => setPreset(p.mn, p.mx)}
                  className="text-[11px] px-2 py-0.5 rounded cursor-pointer border-0 whitespace-nowrap"
                  style={{
                    background: on ? "#118dff" : "var(--bg-input)",
                    color: on ? "#fff" : "var(--text-mid)",
                    fontWeight: on ? 700 : 500,
                  }}
                >{p.label}</button>
              );
            })}
          </div>

          {/* Manual inputs */}
          <div className="flex gap-2 items-center mb-1">
            <input
              type="number"
              value={localMin}
              onChange={(e) => setLocalMin(e.target.value)}
              placeholder="від 0"
              min={0}
              className="flex-1 rounded px-2 py-1 text-xs border outline-none tabular-nums"
              style={{ background: "var(--bg-input)", color: "var(--text)", borderColor: "var(--border2)" }}
            />
            <span className="text-xs" style={{ color: "var(--text-dim)" }}>–</span>
            <input
              type="number"
              value={localMax}
              onChange={(e) => setLocalMax(e.target.value)}
              placeholder={`до ${fmt(priceMax)}`}
              min={0}
              className="flex-1 rounded px-2 py-1 text-xs border outline-none tabular-nums"
              style={{ background: "var(--bg-input)", color: "var(--text)", borderColor: "var(--border2)" }}
            />
          </div>

          {/* Live count */}
          <div className="text-[11px] mt-2 text-right tabular-nums" style={{ color: active ? "#107c10" : "var(--text-dim)" }}>
            {active ? `✓ ${count.toLocaleString("uk-UA")} товарів` : "оберіть діапазон ↑"}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stock range popover ─────────────────────────────────────────────────────
// Same pattern as PriceFilter — quick presets for the common buckets
// (нема / мало / достатньо / багато) + manual range. Debounced live-apply.
function StockFilter({ min, max, stockMax, count, onChange }: {
  min: number | null;
  max: number | null;
  stockMax: number;
  count: number;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [localMin, setLocalMin] = useState<string>(min != null ? String(min) : "");
  const [localMax, setLocalMax] = useState<string>(max != null ? String(max) : "");
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  useEffect(() => { setLocalMin(min != null ? String(min) : ""); }, [min]);
  useEffect(() => { setLocalMax(max != null ? String(max) : ""); }, [max]);

  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    const id = window.setTimeout(() => {
      const mn = localMin.trim() === "" ? null : Math.max(0, parseInt(localMin, 10) || 0);
      const mx = localMax.trim() === "" ? null : Math.max(0, parseInt(localMax, 10) || 0);
      if (mn !== min || mx !== max) onChange(mn, mx);
    }, 300);
    return () => window.clearTimeout(id);
  }, [localMin, localMax, min, max, onChange]);

  const active = min != null || max != null;
  const fmt = (n: number) => n.toLocaleString("uk-UA");
  const label = active
    ? `${min != null ? min : 0}–${max != null ? max : "∞"} шт`
    : "Залишок: всі";

  // Each preset = a stock-level bucket with its own colour. Active preset
  // is highlighted by its own colour rather than a generic blue accent.
  const presets: { label: string; sub: string; mn: number | null; mx: number | null; color: string }[] = [
    { label: "Немає",  sub: "0",    mn: 0,  mx: 0,    color: "#d13438" },
    { label: "Мало",   sub: "1–5",  mn: 1,  mx: 5,    color: "#e66c37" },
    { label: "Середн.",sub: "6–19", mn: 6,  mx: 19,   color: "#d9b300" },
    { label: "Багато", sub: "20+",  mn: 20, mx: null, color: "#107c10" },
    { label: "Є",      sub: "≥1",   mn: 1,  mx: null, color: "#118dff" },
  ];
  const isPresetActive = (p: { mn: number | null; mx: number | null }) =>
    (p.mn ?? null) === (min ?? null) && (p.mx ?? null) === (max ?? null);

  const setPreset = (mn: number | null, mx: number | null) => {
    setLocalMin(mn != null ? String(mn) : "");
    setLocalMax(mx != null ? String(mx) : "");
    onChange(mn, mx);
  };
  const reset = () => {
    setLocalMin(""); setLocalMax("");
    onChange(null, null);
  };

  // Pick the trigger button colour to match the active preset (if any)
  const triggerColor = active
    ? presets.find(isPresetActive)?.color ?? "#118dff"
    : "var(--text-dim)";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs rounded-lg cursor-pointer border whitespace-nowrap font-semibold"
        style={{
          background: "var(--bg-input)",
          borderColor: active ? triggerColor : "var(--border2)",
          color: active ? triggerColor : "var(--text-dim)",
          padding: "5px 24px 5px 10px",
          minWidth: 160,
          textAlign: "left",
          position: "relative",
        }}
      >
        {active && <span style={{ marginRight: 4 }}>●</span>}
        {label}
        <span style={{ position: "absolute", right: 8, color: "var(--text-dim)" }}>▾</span>
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 rounded-xl shadow-xl"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)", width: 360 }}
        >
          {/* Header: max + reset */}
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
            <span className="text-[11px]" style={{ color: "var(--text-dim)" }}>
              макс. у каталозі: <b className="tabular-nums" style={{ color: "var(--text-mid)" }}>{fmt(stockMax)} шт</b>
            </span>
            {active && (
              <button onClick={reset}
                className="text-[10px] font-semibold cursor-pointer border-0 bg-transparent"
                style={{ color: "#d13438" }}
              >✕ Скинути</button>
            )}
          </div>

          {/* Presets — coloured chips in one row */}
          <div className="grid grid-cols-5 gap-1 p-2.5 pb-1.5">
            {presets.map((p) => {
              const on = isPresetActive(p);
              return (
                <button key={p.label}
                  onClick={() => setPreset(p.mn, p.mx)}
                  className="rounded-lg py-1.5 cursor-pointer border transition-all flex flex-col items-center gap-0.5"
                  style={{
                    background: on ? `${p.color}18` : "transparent",
                    borderColor: on ? p.color : "var(--border2)",
                    color: on ? p.color : "var(--text-mid)",
                  }}
                >
                  <span className="text-[11px] font-bold leading-none">{p.label}</span>
                  <span className="text-[10px] leading-none tabular-nums" style={{ opacity: 0.7 }}>{p.sub}</span>
                </button>
              );
            })}
          </div>

          {/* Manual range */}
          <div className="px-3 pt-2 pb-3">
            <div className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-dim)" }}>
              Власний діапазон
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                value={localMin}
                onChange={(e) => setLocalMin(e.target.value)}
                placeholder="від 0"
                min={0}
                className="flex-1 rounded-lg px-2 py-1.5 text-xs border outline-none tabular-nums"
                style={{ background: "var(--bg-input)", color: "var(--text)", borderColor: "var(--border2)" }}
              />
              <span className="text-xs" style={{ color: "var(--text-dim)" }}>–</span>
              <input
                type="number"
                value={localMax}
                onChange={(e) => setLocalMax(e.target.value)}
                placeholder={`до ${fmt(stockMax)}`}
                min={0}
                className="flex-1 rounded-lg px-2 py-1.5 text-xs border outline-none tabular-nums"
                style={{ background: "var(--bg-input)", color: "var(--text)", borderColor: "var(--border2)" }}
              />
            </div>
          </div>

          {/* Live count footer */}
          <div className="px-3 py-2 text-[11px] text-center tabular-nums border-t"
            style={{
              color: active ? "#107c10" : "var(--text-dim)",
              borderColor: "var(--border)",
              background: active ? "rgba(16,124,16,0.05)" : "transparent",
              borderRadius: "0 0 12px 12px",
              fontWeight: active ? 700 : 500,
            }}>
            {active
              ? `✓ ${count.toLocaleString("uk-UA")} товарів у вибірці`
              : "оберіть діапазон ↑"}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bulk-id filter modal ────────────────────────────────────────────────────
// Paste a list of code or goods_ref values (any whitespace/comma separator) →
// apply as an exact-match filter to the table.
function BulkFilterModal({ initialType, initialText, onApply, onClose }: {
  initialType: "code" | "ref";
  initialText: string;
  onApply: (type: "code" | "ref", ids: number[], rawText: string) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<"code" | "ref">(initialType);
  const [text, setText] = useState(initialText);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  // Tolerant parser: splits on any whitespace, commas, semicolons, vertical bars,
  // tabs, newlines. Filters out blanks and non-numbers, deduplicates.
  const parsed = useMemo(() => {
    const raw = text.split(/[\s,;|]+/).map((s) => s.trim()).filter(Boolean);
    const nums: number[] = [];
    const seen = new Set<number>();
    for (const s of raw) {
      const n = parseInt(s, 10);
      if (Number.isFinite(n) && !seen.has(n)) { seen.add(n); nums.push(n); }
    }
    return nums;
  }, [text]);

  const apply = () => {
    if (parsed.length === 0) return;
    onApply(type, parsed, text);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="rounded-2xl flex flex-col" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", width: "100%", maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>📋 Набір товарів</div>
          <button onClick={onClose} className="px-3 py-1 rounded-lg text-xs cursor-pointer border-0" style={{ background: "var(--bg-input)", color: "var(--text-mid)" }}>✕</button>
        </div>

        <div className="p-4 space-y-3">
          {/* Type chooser */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-dim)" }}>Фільтрувати за</div>
            <div className="flex gap-1 rounded-lg p-0.5 w-fit" style={{ background: "var(--bg-input)", border: "1px solid var(--border2)" }}>
              {[
                { v: "code" as const, label: "Код товара" },
                { v: "ref"  as const, label: "goods_ref" },
              ].map((o) => (
                <button key={o.v} onClick={() => setType(o.v)}
                  className="px-3 py-1 rounded text-xs font-semibold cursor-pointer border-0"
                  style={type === o.v ? { background: "#118dff", color: "#fff" } : { background: "transparent", color: "var(--text-dim)" }}
                >{o.label}</button>
              ))}
            </div>
          </div>

          {/* Paste field */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-dim)" }}>
              Вставте список ({type === "code" ? "коди товару" : "goods_ref"})
              <span className="font-normal ml-2" style={{ color: "var(--text-dim2)" }}>
                — через пробіл, кому, табуляцію або новий рядок
              </span>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="2177, 8633, 8656&#10;186313 186805 186818&#10;..."
              rows={8}
              autoFocus
              className="w-full rounded-lg px-3 py-2 text-xs border outline-none tabular-nums"
              style={{ background: "var(--bg-input)", color: "var(--text)", borderColor: "var(--border2)", resize: "vertical", fontFamily: "monospace" }}
            />
            <div className="text-[11px] mt-1 tabular-nums" style={{ color: parsed.length > 0 ? "#107c10" : "var(--text-dim)" }}>
              {parsed.length > 0 ? `✓ Розпізнано ${parsed.length} унікальних ID` : "Вставте ID-шники щоб продовжити"}
            </div>
          </div>
        </div>

        <div className="p-4 border-t flex items-center justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs cursor-pointer border-0"
            style={{ background: "var(--bg-input)", color: "var(--text-mid)" }}>Скасувати</button>
          <button onClick={apply} disabled={parsed.length === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer border-0 disabled:opacity-50"
            style={{ background: "#118dff", color: "#fff" }}>
            Застосувати ({parsed.length})
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Snapshot date picker ────────────────────────────────────────────────────
// Lists available daily snapshots (newest first). Selecting a date pins the
// dashboard to that day's frozen state. "Поточний" returns to live data.
function SnapshotPicker({ snapshots, value, onChange }: {
  snapshots: SnapshotInfo[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  const label = value ? `🕐 ${value}` : "🕐 Поточний";
  const active = value != null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs rounded-lg cursor-pointer border whitespace-nowrap"
        style={{
          background: "var(--bg-input)",
          borderColor: active ? "#e66c37" : "var(--border2)",
          color: active ? "#e66c37" : "var(--text-mid)",
          padding: "5px 24px 5px 10px",
          minWidth: 160,
          textAlign: "left",
          position: "relative",
          fontWeight: active ? 700 : 500,
        }}
      >
        {label}
        <span style={{ position: "absolute", right: 8, color: "var(--text-dim)" }}>▾</span>
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 rounded-lg shadow-lg right-0"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)", minWidth: 280, maxHeight: 360, display: "flex", flexDirection: "column" }}
        >
          <div className="text-[10px] uppercase tracking-wide px-3 py-2 border-b" style={{ color: "var(--text-dim)", borderColor: "var(--border)" }}>
            Стан каталогу на дату
          </div>
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-xs cursor-pointer border-0 border-b"
            style={{
              background: value == null ? "#107c1022" : "transparent",
              color: value == null ? "#107c10" : "var(--text-mid)",
              borderColor: "var(--border)",
              fontWeight: value == null ? 700 : 500,
            }}
          >
            ● Поточний (live, оновлюється при синку)
          </button>
          <div className="overflow-y-auto">
            {snapshots.length === 0 ? (
              <div className="text-xs p-3 text-center" style={{ color: "var(--text-dim)" }}>
                Знімки з’являться після наступних синхронізацій
              </div>
            ) : snapshots.map((s) => (
              <button
                key={s.date}
                onClick={() => { onChange(s.date); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs cursor-pointer border-0 flex items-center justify-between"
                style={{
                  background: s.date === value ? "#e66c3722" : "transparent",
                  color: s.date === value ? "#e66c37" : "var(--text-mid)",
                  fontWeight: s.date === value ? 700 : 500,
                }}
              >
                <span>{s.date}</span>
                {s.syncedAt && (
                  <span className="text-[10px] ml-2" style={{ color: "var(--text-dim)" }}>
                    sync {new Date(s.syncedAt).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Settings modal ──────────────────────────────────────────────────────────
// Single entry-point for sync, snapshot picker, required-attrs and the latest
// sync report. Gated by a session-stored password to prevent accidental clicks.

const SETTINGS_PASSWORD = "Agromat";
const SETTINGS_SESSION_KEY = "products-settings-unlocked";

function SettingsModal({
  onClose, snapshots, asOf, onAsOfChange,
  syncState, syncedAt, onSynced, onOpenRequired,
}: {
  onClose: () => void;
  snapshots: SnapshotInfo[];
  asOf: string | null;
  onAsOfChange: (v: string | null) => void;
  syncState: SyncState;
  syncedAt: string | null;
  onSynced: () => void;
  onOpenRequired: () => void;
}) {
  const [unlocked, setUnlocked] = useState(() => {
    if (typeof sessionStorage === "undefined") return false;
    return sessionStorage.getItem(SETTINGS_SESSION_KEY) === "1";
  });
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState(false);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const submitPw = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw === SETTINGS_PASSWORD) {
      sessionStorage.setItem(SETTINGS_SESSION_KEY, "1");
      setUnlocked(true);
    } else {
      setPwErr(true);
      setPw("");
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="rounded-2xl flex flex-col" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", width: "100%", maxWidth: 520, maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>⚙ Налаштування каталогу</div>
          <button onClick={onClose} className="px-3 py-1 rounded-lg text-xs cursor-pointer border-0" style={{ background: "var(--bg-input)", color: "var(--text-mid)" }}>✕</button>
        </div>

        {!unlocked ? (
          <form onSubmit={submitPw} className="p-6 flex flex-col gap-3">
            <div className="text-xs" style={{ color: "var(--text-dim)" }}>Введіть пароль для доступу до налаштувань</div>
            <input
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => { setPw(e.target.value); setPwErr(false); }}
              placeholder="Пароль"
              className="rounded-lg px-3 py-2 text-sm border outline-none"
              style={{
                background: "var(--bg-input)",
                color: "var(--text)",
                borderColor: pwErr ? "#d13438" : "var(--border2)",
              }}
            />
            {pwErr && <span className="text-xs" style={{ color: "#d13438" }}>Невірний пароль</span>}
            <button type="submit" className="px-3 py-2 rounded-lg text-sm font-bold cursor-pointer border-0" style={{ background: "#118dff", color: "#fff" }}>
              Увійти
            </button>
          </form>
        ) : (
          <>
            <div className="p-4 space-y-4 overflow-y-auto">
              {/* Sync */}
              <Section title="Синхронізація з API">
                <SyncButton syncState={syncState} syncedAt={syncedAt} onSynced={onSynced} />
              </Section>

              {/* Snapshots */}
              <Section title="Перегляд стану на дату">
                <SnapshotPicker snapshots={snapshots} value={asOf} onChange={onAsOfChange} />
                <div className="text-[10px] mt-1" style={{ color: "var(--text-dim)" }}>
                  Знімки створюються щодня автоматично після успішного синку. Зберігається останні 14 днів.
                </div>
              </Section>

              {/* Required attrs */}
              <Section title="Обов&apos;язкові атрибути по категоріях">
                <button
                  onClick={() => { onOpenRequired(); onClose(); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer border-0"
                  style={{ background: "var(--bg-input)", color: "var(--text-mid)" }}
                >
                  ⚙ Відкрити налаштування
                </button>
              </Section>
            </div>

            {/* Footer: last sync summary */}
            <div className="p-4 border-t" style={{ borderColor: "var(--border)" }}>
              <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--text-dim)" }}>Останній синк</div>
              <div className="text-xs mb-1" style={{ color: "var(--text)" }}>
                {syncedAt ? fmtDateTime(syncedAt) : "ніколи"}
              </div>
              {syncState.stats && (
                <div className="text-[11px] flex items-center gap-2 flex-wrap" style={{ color: "var(--text-dim)" }}>
                  <span>{fmtNum(syncState.stats.total)} товарів · {syncState.stats.newCount} нових · {syncState.stats.statusChanges} змін статусу</span>
                  <button onClick={() => setShowReport(true)}
                    className="cursor-pointer border-0 bg-transparent underline text-[11px] font-semibold"
                    style={{ color: "#118dff" }}
                  >Звіт ↗</button>
                </div>
              )}
            </div>
          </>
        )}
        {showReport && <SyncReportModal state={syncState} onClose={() => setShowReport(false)} />}
      </div>
    </div>
  );
}

// ── Sync report modal ───────────────────────────────────────────────────────
function SyncReportModal({ state, onClose }: { state: SyncState; onClose: () => void }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);
  const durationMin = state.stats ? Math.round(state.stats.durationMs / 600) / 100 : null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="rounded-2xl" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", width: "100%", maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>Звіт останнього синку</div>
          <button onClick={onClose} className="px-3 py-1 rounded-lg text-xs cursor-pointer border-0" style={{ background: "var(--bg-input)", color: "var(--text-mid)" }}>✕</button>
        </div>
        <div className="p-4 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <Cell label="Стан">
              <span style={{ color: state.state === "ok" ? "#107c10" : state.state === "error" ? "#d13438" : "#118dff", fontWeight: 700 }}>
                {state.state === "ok" ? "✓ Успішно" : state.state === "error" ? "✗ Помилка" : state.state === "running" ? "↻ Виконується" : "—"}
              </span>
            </Cell>
            <Cell label="Тривалість">{durationMin != null ? `${durationMin} хв` : "—"}</Cell>
            <Cell label="Старт">{fmtDateTime(state.startedAt)}</Cell>
            <Cell label="Кінець">{fmtDateTime(state.finishedAt)}</Cell>
          </div>
          {state.stats && (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>Статистика</div>
              <div className="grid grid-cols-2 gap-2">
                <Cell label="Сторінок оброблено">{state.stats.pages} / {state.progress?.totalPages ?? "—"}</Cell>
                <Cell label="Товарів отримано">{fmtNum(state.stats.total)}</Cell>
                <Cell label="Нових (вперше у нас)">
                  <span style={{ color: state.stats.newCount > 0 ? "#107c10" : "var(--text)" }}>{fmtNum(state.stats.newCount)}</span>
                </Cell>
                <Cell label="Змінили статус">
                  <span style={{ color: state.stats.statusChanges > 0 ? "#118dff" : "var(--text)" }}>{fmtNum(state.stats.statusChanges)}</span>
                </Cell>
              </div>
            </>
          )}
          {state.error && (
            <div className="rounded-lg p-2 text-xs" style={{ background: "#d1343811", color: "#d13438", border: "1px solid #d1343844" }}>
              <div className="font-semibold mb-1">Попередження</div>
              <div>{state.error}</div>
            </div>
          )}
          {!state.stats && !state.error && (
            <div className="text-xs" style={{ color: "var(--text-dim)" }}>Синк ще не запускався або деталі недоступні.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sync button + sync status pill ──────────────────────────────────────────
function SyncButton({ syncState, syncedAt, onSynced }: {
  syncState: SyncState;
  syncedAt: string | null;
  onSynced: () => void;
}) {
  const [showReport, setShowReport] = useState(false);
  const [live, setLive] = useState<SyncState | null>(null);
  const [err, setErr] = useState("");

  const current = live ?? syncState;
  const isRunning = current.state === "running";

  // On mount: hit the status endpoint once, bypassing the 60s server-side cache
  // baked into /api/products. Without this, a sync started by another tab or
  // cron is invisible until the cache expires.
  useEffect(() => {
    fetch("/api/products/sync/status", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((s: SyncState | null) => { if (s) setLive(s); })
      .catch(() => {});
  }, []);

  // Poll the status endpoint while a sync is running (whether started here or
  // by Vercel cron / another tab). Stops automatically when state changes.
  useEffect(() => {
    if (!isRunning) return;
    let alive = true;
    let lastTerminal: SyncState["state"] | null = null;

    const tick = async () => {
      if (!alive) return;
      try {
        const r = await fetch("/api/products/sync/status", { cache: "no-store" });
        if (!r.ok) return;
        const s = (await r.json()) as SyncState;
        if (!alive) return;
        setLive(s);
        if (s.state === "ok" || s.state === "error") {
          if (lastTerminal !== s.state) {
            lastTerminal = s.state;
            onSynced();
          }
        }
      } catch { /* keep polling */ }
    };

    void tick();
    const id = window.setInterval(tick, 2000);
    return () => { alive = false; window.clearInterval(id); };
  }, [isRunning, onSynced]);

  const click = async () => {
    if (isRunning) return;
    setErr("");
    // Optimistically flip into "running" so polling starts immediately
    setLive({ state: "running", startedAt: new Date().toISOString(), finishedAt: null });
    // Fire and forget — the request blocks until full sync completes (~3-5 min),
    // longer than browsers happily wait. We rely on polling for the actual status.
    fetch("/api/products/sync", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.NEXT_PUBLIC_DASHBOARD_SECRET || ""}` },
    })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          // 409 = sync is already running (started by another tab / cron / VPS).
          // Treat it as an info note, not an error — keep the running indicator
          // and let polling pick up the live progress.
          if (r.status === 409) {
            setErr("");
            // refresh state from server so the progress bar appears immediately
            fetch("/api/products/sync/status", { cache: "no-store" })
              .then((s) => s.ok ? s.json() : null)
              .then((s: SyncState | null) => { if (s) setLive(s); })
              .catch(() => {});
            return;
          }
          setErr(j.error || `HTTP ${r.status}`);
          setLive(null);
        }
      })
      .catch(() => { /* network drop — polling will keep tracking */ });
  };

  const stateLabel: Record<SyncState["state"], string> = {
    idle: "—",
    running: "синхронізую…",
    ok: "ОК",
    error: "помилка",
  };
  const stateColor: Record<SyncState["state"], string> = {
    idle: "var(--text-dim)",
    running: "#118dff",
    ok: "#107c10",
    error: "#d13438",
  };

  const prog = current.progress;
  const pct = prog && prog.totalPages > 0 ? Math.round((prog.pages / prog.totalPages) * 100) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={click}
          disabled={isRunning}
          className="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer border-0 disabled:opacity-60"
          style={{ background: "#118dff", color: "#fff" }}
        >
          {isRunning ? "Синхронізую…" : "Sync now"}
        </button>
        <span className="text-[10px] font-semibold" style={{ color: stateColor[current.state] }}>
          {stateLabel[current.state]}
        </span>
        {err && <span className="text-[10px] font-semibold" style={{ color: "#d13438" }}>{err}</span>}
      </div>

      {isRunning && prog && (
        <div className="flex items-center gap-2 min-w-[260px]">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
            <div className="h-full transition-all" style={{ width: `${pct}%`, background: "#118dff" }} />
          </div>
          <span className="text-[10px] tabular-nums whitespace-nowrap" style={{ color: "var(--text-mid)" }}>
            {prog.pages}/{prog.totalPages} · {pct}% · {fmtNum(prog.products)} тов.
          </span>
        </div>
      )}

      {/* Last-sync summary + report link live in SettingsModal footer — no dup here */}
    </div>
  );
}

// ── KPI row ─────────────────────────────────────────────────────────────────
function KpiRow({ stats, total }: { stats: ListResponse["stats"]; total: number }) {
  // KPIs reflect the *filtered* set so they react to active filters.
  // The first card also shows the unfiltered catalog size for context.
  const filtered = total < stats.totalAll;
  const items = [
    {
      label: filtered ? `Товарів (з ${fmtNum(stats.totalAll)})` : "Всього товарів",
      value: fmtNum(total),
      color: filtered ? "#118dff" : "var(--text)",
    },
    { label: "Нових за 24г", value: fmtNum(stats.newCount24h), color: "#107c10" },
    { label: "Нових за 7д", value: fmtNum(stats.newCount7d), color: "#107c10" },
    { label: "Зміни статусу 7д", value: fmtNum(stats.statusChanged7d), color: "#118dff" },
    { label: "Без фото", value: fmtNum(stats.noImages), color: "#e66c37" },
    { label: "Без атрибутів", value: fmtNum(stats.noAttributes), color: "#e66c37" },
    { label: "Без відгуків", value: fmtNum(stats.noReviews), color: "#a19f9d" },
    { label: "Без артикулу", value: fmtNum(stats.noSku), color: "#e66c37" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
      {items.map((i) => (
        <div key={i.label} className="rounded-xl p-3 text-center"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
          <div className="text-base font-bold" style={{ color: i.color }}>{i.value}</div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>{i.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Category summary panel (collapsible) ────────────────────────────────────
type SummaryPreset =
  | "all" | "noImages" | "noAttrs" | "noReviews" | "noSku"
  | "inStock" | "outOfStock" | "new" | "changed";

function CategorySummaryPanel({ onFilter }: {
  onFilter: (categoryId: number, preset: SummaryPreset) => void;
}) {
  const [rows, setRows] = useState<CategorySummary[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!expanded || rows !== null) return;
    fetch("/api/products/summary")
      .then((r) => r.json())
      .then((d: { categories: CategorySummary[] }) => setRows(d.categories));
  }, [expanded, rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.toLowerCase().trim();
    return q ? rows.filter((r) => r.categoryName.toLowerCase().includes(q) || r.categoryPath.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  // Reusable "clickable cell" wrapper — applies cursor + hover underline so
  // users understand the cell is a drill-down into the main table.
  const Drill = ({ onClick, color, title, children }: {
    onClick: () => void;
    color: string;
    title: string;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      title={title}
      className="px-2 py-1.5 cursor-pointer border-0 bg-transparent hover:underline text-left w-full text-xs"
      style={{ color }}
    >{children}</button>
  );

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-bold" style={{ color: "var(--text)" }}>
          Зведення по категоріях
          {rows && <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-dim)" }}>{rows.length}</span>}
        </div>
        <div className="flex items-center gap-2">
          {expanded && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Пошук категорії…"
              className="rounded-lg px-2 py-1 text-xs border outline-none"
              style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)", width: 200 }}
            />
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="px-3 py-1 rounded-lg text-xs font-bold cursor-pointer border-0"
            style={{ background: "var(--bg-input)", color: "var(--text-mid)" }}
          >
            {expanded ? "Згорнути" : "Розгорнути"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 overflow-x-auto">
          {!rows ? (
            <div className="text-xs py-4 text-center" style={{ color: "var(--text-dim)" }}>Завантаження…</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Категорія", "Всього", "% з фото", "% з атриб.", "% з відг.", "% з арт.", "Ср. фото", "Ср. відг.", "Ср. атриб.", "Ср. рейтинг", "В наявн.", "Немає", "Нові товари", "Зміна статусу товара", "Обов'язк. атриб."].map((h) => (
                    <th key={h} className="text-left px-2 py-1.5 font-semibold text-[11px]" style={{ color: "var(--text-dim2)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const imgPct = percent(r.withImages, r.total);
                  const attrPct = percent(r.withAttributes, r.total);
                  const revPct = percent(r.withReviews, r.total);
                  const skuPct = percent(r.withSku, r.total);
                  const imgColor = imgPct >= 90 ? "#107c10" : imgPct >= 70 ? "#e66c37" : "#d13438";
                  const attrColor = attrPct >= 90 ? "#107c10" : attrPct >= 70 ? "#e66c37" : "#d13438";
                  const skuColor = skuPct >= 90 ? "#107c10" : skuPct >= 70 ? "#e66c37" : "#d13438";
                  return (
                    <tr key={r.categoryId} className="border-b" style={{ borderColor: "var(--border)" }}>
                      <td title={r.categoryPath} style={{ padding: 0 }}>
                        <Drill onClick={() => onFilter(r.categoryId, "all")} color="var(--text)" title="Показати всі товари категорії">
                          {r.categoryName}
                        </Drill>
                      </td>
                      <td className="px-2 py-1.5" style={{ color: "var(--text-mid)" }}>{r.total}</td>
                      <td style={{ padding: 0 }}>
                        <Drill onClick={() => onFilter(r.categoryId, "noImages")} color={imgColor} title={`Показати товари без фото в категорії "${r.categoryName}"`}>
                          {imgPct}%
                        </Drill>
                      </td>
                      <td style={{ padding: 0 }}>
                        <Drill onClick={() => onFilter(r.categoryId, "noAttrs")} color={attrColor} title={`Показати товари без атрибутів в категорії "${r.categoryName}"`}>
                          {attrPct}%
                        </Drill>
                      </td>
                      <td style={{ padding: 0 }}>
                        <Drill onClick={() => onFilter(r.categoryId, "noReviews")} color="var(--text-mid)" title={`Показати товари без відгуків в категорії "${r.categoryName}"`}>
                          {revPct}%
                        </Drill>
                      </td>
                      <td style={{ padding: 0 }}>
                        <Drill onClick={() => onFilter(r.categoryId, "noSku")} color={skuColor} title={`Показати товари без артикулу в категорії "${r.categoryName}"`}>
                          {skuPct}%
                        </Drill>
                      </td>
                      <td className="px-2 py-1.5" style={{ color: "var(--text-mid)" }}>{r.avgImages}</td>
                      <td className="px-2 py-1.5" style={{ color: "var(--text-mid)" }}>{r.avgReviews}</td>
                      <td className="px-2 py-1.5" style={{ color: "var(--text-mid)" }}>{r.avgAttributes}</td>
                      <td className="px-2 py-1.5" style={{ color: "var(--text-mid)" }}>{r.avgRating ?? "—"}</td>
                      <td style={{ padding: 0 }}>
                        <Drill onClick={() => onFilter(r.categoryId, "inStock")} color="#107c10" title={`Товари в наявності в категорії "${r.categoryName}"`}>
                          {r.inStock}
                        </Drill>
                      </td>
                      <td style={{ padding: 0 }}>
                        <Drill onClick={() => onFilter(r.categoryId, "outOfStock")} color="#d13438" title={`Товари без наявності в категорії "${r.categoryName}"`}>
                          {r.outOfStock}
                        </Drill>
                      </td>
                      <td style={{ padding: 0 }}>
                        <Drill onClick={() => onFilter(r.categoryId, "new")} color={r.newLast7d > 0 ? "#107c10" : "var(--text-dim)"} title={`Нові товари (7 днів) в категорії "${r.categoryName}"`}>
                          {r.newLast7d}
                        </Drill>
                      </td>
                      <td style={{ padding: 0 }}>
                        <Drill onClick={() => onFilter(r.categoryId, "changed")} color={r.statusChangedLast7d > 0 ? "#118dff" : "var(--text-dim)"} title={`Зміни статусу (7 днів) в категорії "${r.categoryName}"`}>
                          {r.statusChangedLast7d}
                        </Drill>
                      </td>
                      <td className="px-2 py-1.5" style={{ color: r.requiredAttrIds.length > 0 ? "var(--text-mid)" : "var(--text-dim)" }}>
                        {r.requiredAttrIds.length > 0 ? `${r.requiredAttrIds.length} налаштовано` : "не задано"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Drill-down modal ────────────────────────────────────────────────────────
function ProductModal({ id, seed, onClose }: {
  id: number;
  seed?: ProductLite;
  onClose: () => void;
}) {
  // Render the lite snapshot immediately (already in memory from the table),
  // then replace with the full record (with images/attrs/reviews) once it arrives.
  const [data, setData] = useState<ProductFull | null>(seed ? { ...seed, images: [], attributes: [], reviews: [] } : null);
  const [loadingFull, setLoadingFull] = useState(true);
  const [err, setErr] = useState("");
  const [required, setRequired] = useState<Record<string, number[]>>({});
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  useEffect(() => {
    setLoadingFull(true);
    fetch(`/api/products/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ProductFull) => setData(d))
      .catch((e) => setErr(e.message))
      .finally(() => setLoadingFull(false));
    fetch("/api/products/required-attrs").then((r) => r.json()).then(setRequired).catch(() => {});
  }, [id]);

  const requiredForCat = data ? required[String(data.categoryId)] ?? [] : [];
  const presentRequired = new Set(data?.attributes.map((a) => a.id));
  const missingRequired = requiredForCat.filter((aid) => !presentRequired.has(aid));

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-y-auto" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", maxHeight: "90vh", width: "100%", maxWidth: 1100 }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between p-4 border-b" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
          <div>
            <div className="text-sm font-bold" style={{ color: "var(--text)" }}>{data?.name || `Товар #${id}`}</div>
            {data && (
              <div className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                {data.categoryPath} · <span style={{ color: data.deleted ? "#a19f9d" : statusColor(data.statusId) }}>
                  {data.deleted ? `Архів · ${data.statusName}` : data.statusName}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(true)}
              className="px-3 py-1 rounded-lg text-xs font-bold cursor-pointer border-0"
              style={{ background: "#118dff", color: "#fff" }}
              title="Переглянути всі зміни цього товару — ціна, статус, залишок, атрибути, фото, артикул"
            >📜 Історія змін</button>
            <button onClick={onClose} className="px-3 py-1 rounded-lg text-xs cursor-pointer border-0" style={{ background: "var(--bg-input)", color: "var(--text-mid)" }}>✕ Закрити</button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {err && <div className="text-xs" style={{ color: "#d13438" }}>{err}</div>}
          {!data && !err && <div className="text-xs" style={{ color: "var(--text-dim)" }}>Завантаження…</div>}
          {data && (
            <>
              {/* Identifiers */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Cell label="ID">{data.id}</Cell>
                <Cell label="goods_ref">{data.goodsRef}</Cell>
                <Cell label="code">{data.code}</Cell>
                <Cell label="артикул (sku)">{data.sku ?? "—"}</Cell>
                <Cell label="бренд">{data.brand || "—"}</Cell>
                <Cell label="ціна">{fmtPrice(data.price, data.currency)} {data.discountPct ? `(-${data.discountPct}%)` : ""}</Cell>
                <Cell label="залишок">{data.stockQty ?? "—"}</Cell>
                <Cell label="перший раз бачили">{fmtDate(data.firstSeenAt)}</Cell>
                <Cell label="створено">{fmtDate(data.createdAt)}</Cell>
                <Cell label="оновлено в API">{fmtDate(data.updatedAt)}</Cell>
                <Cell label="статус змінено">{fmtDateTime(data.statusChangedAt)}</Cell>
                <Cell label="посилання"><a href={data.url} target="_blank" rel="noopener noreferrer" style={{ color: "#118dff" }}>відкрити →</a></Cell>
              </div>

              {/* Photos */}
              <Section title={`Фото (${loadingFull ? "…" : data.images.length})`}>
                {loadingFull ? <Empty>завантаження…</Empty> : data.images.length === 0 ? <Empty>немає</Empty> : (
                  <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-2">
                    {[...data.images].sort((a, b) => a.sort - b.sort).map((img, i) => (
                      <a key={i} href={img.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border" style={{ borderColor: img.main ? "#107c10" : "var(--border)" }}>
                        <img src={img.url} alt={`photo ${i + 1}`} className="w-full h-24 object-cover" loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </Section>

              {/* Attributes */}
              <Section title={`Атрибути (${loadingFull ? "…" : data.attributes.length})`}>
                {loadingFull ? <Empty>завантаження…</Empty> : data.attributes.length === 0 ? <Empty>немає</Empty> : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {data.attributes.map((a) => {
                      const isReq = requiredForCat.includes(a.id);
                      return (
                        <div key={a.id} className="rounded-lg px-2 py-1 text-xs flex items-start gap-2"
                          style={{ background: "var(--bg-input)", border: `1px solid ${isReq ? "#107c1066" : "var(--border)"}` }}>
                          {isReq && <span style={{ color: "#107c10" }}>★</span>}
                          <div>
                            <span style={{ color: "var(--text-dim)" }}>{a.name}:</span>{" "}
                            <span style={{ color: "var(--text)" }}>{a.values.join(", ")}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {missingRequired.length > 0 && (
                  <div className="mt-2 text-xs px-2 py-1.5 rounded-lg" style={{ background: "#d1343811", color: "#d13438", border: "1px solid #d1343844" }}>
                    Не вистачає обов&apos;язкових атрибутів (за конфігом для цієї категорії): {missingRequired.join(", ")}
                  </div>
                )}
              </Section>

              {/* Reviews */}
              <Section title={`Відгуки (${loadingFull ? "…" : data.reviews.length}${data.ratingAvg ? ` · ср. ${data.ratingAvg}★` : ""})`}>
                {loadingFull ? <Empty>завантаження…</Empty> : data.reviews.length === 0 ? <Empty>немає</Empty> : (
                  <div className="space-y-2">
                    {data.reviews.map((r, i) => (
                      <div key={i} className="rounded-lg p-2 text-xs" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
                        <div className="flex items-center justify-between mb-1">
                          <span style={{ color: "var(--text)" }}>{r.author || "—"}</span>
                          <span style={{ color: "#e6a817" }}>{"★".repeat(r.rating)}{"☆".repeat(Math.max(0, 5 - r.rating))}</span>
                          <span style={{ color: "var(--text-dim)" }}>{fmtDate(r.date)}</span>
                        </div>
                        {r.text && <div style={{ color: "var(--text-mid)" }}>{r.text}</div>}
                        {r.advantage && <div className="mt-1"><span style={{ color: "#107c10" }}>+ </span><span style={{ color: "var(--text-mid)" }}>{r.advantage}</span></div>}
                        {r.disadvantage && <div><span style={{ color: "#d13438" }}>− </span><span style={{ color: "var(--text-mid)" }}>{r.disadvantage}</span></div>}
                        <div className="mt-1" style={{ color: "var(--text-dim)" }}>👍 {r.likes} · 👎 {r.dislikes}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Status history */}
              {data.statusHistory.length > 0 && (
                <Section title={`Історія статусів (${data.statusHistory.length})`}>
                  <div className="space-y-1 text-xs">
                    {data.statusHistory.map((h, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span style={{ color: "var(--text-dim)" }}>{fmtDateTime(h.at)}:</span>
                        <span style={{ color: statusColor(h.from) }}>статус #{h.from}</span>
                        <span style={{ color: "var(--text-dim)" }}>→</span>
                        <span style={{ color: statusColor(h.to) }}>статус #{h.to}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
      {showHistory && (
        <ChangeHistoryModal
          id={id}
          productName={data?.name || `Товар #${id}`}
          currency={data?.currency || "UAH"}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

// ── Change-history modal ────────────────────────────────────────────────────
// Tabs over change-event groups returned by /api/products/:id/history.
// Each tab renders newest-first list of "from → to" rows; attributes and
// images get richer layouts since they're not single scalar values.
type HistoryBucket = "price" | "status" | "stock" | "sku" | "attributes" | "images";
interface HistoryResponse {
  productId: number;
  total: number;
  groups: Record<HistoryBucket, ChangeEvent[]>;
}

function ChangeHistoryModal({ id, productName, currency, onClose }: {
  id: number;
  productName: string;
  currency: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<HistoryBucket>("price");

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/products/${id}/history`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: HistoryResponse) => setData(d))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Pick the first non-empty tab on first load so the user sees something
  // immediately instead of a default-empty pane.
  useEffect(() => {
    if (!data) return;
    const order: HistoryBucket[] = ["price", "status", "stock", "sku", "attributes", "images"];
    const firstWithData = order.find((b) => data.groups[b].length > 0);
    if (firstWithData) setTab(firstWithData);
  }, [data]);

  const tabs: { key: HistoryBucket; label: string; color: string }[] = [
    { key: "price",      label: "Ціни",      color: "#118dff" },
    { key: "status",     label: "Статус",    color: "#107c10" },
    { key: "stock",      label: "Залишок",   color: "#e66c37" },
    { key: "sku",        label: "Артикул",   color: "#8e44ad" },
    { key: "attributes", label: "Атрибути",  color: "#d9b300" },
    { key: "images",     label: "Фото",      color: "#d13438" },
  ];

  const events = data?.groups[tab] ?? [];

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="rounded-2xl flex flex-col"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)", width: "100%", maxWidth: 900, maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div>
            <div className="text-sm font-bold" style={{ color: "var(--text)" }}>📜 Історія змін</div>
            <div className="text-xs mt-0.5 truncate" style={{ color: "var(--text-dim)", maxWidth: 720 }}>
              {productName}
            </div>
          </div>
          <button onClick={onClose} className="px-3 py-1 rounded-lg text-xs cursor-pointer border-0" style={{ background: "var(--bg-input)", color: "var(--text-mid)" }}>✕ Закрити</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 pb-0 border-b overflow-x-auto" style={{ borderColor: "var(--border)" }}>
          {tabs.map((t) => {
            const count = data?.groups[t.key].length ?? 0;
            const active = t.key === tab;
            return (
              <button key={t.key}
                onClick={() => setTab(t.key)}
                className="px-3 py-2 rounded-t-lg text-xs font-semibold cursor-pointer border-0 whitespace-nowrap flex items-center gap-1.5"
                style={{
                  background: active ? "var(--bg-input)" : "transparent",
                  color: active ? t.color : "var(--text-dim)",
                  borderBottom: active ? `2px solid ${t.color}` : "2px solid transparent",
                }}
              >
                {t.label}
                <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full"
                  style={{ background: active ? `${t.color}22` : "var(--bg-input)", color: active ? t.color : "var(--text-dim)" }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto flex-1">
          {loading && <div className="text-xs" style={{ color: "var(--text-dim)" }}>Завантаження…</div>}
          {err && <div className="text-xs" style={{ color: "#d13438" }}>{err}</div>}
          {!loading && !err && data && data.total === 0 && (
            <div className="text-xs p-6 text-center" style={{ color: "var(--text-dim)" }}>
              Поки що змін не зафіксовано. Історія наповнюється після кожного синку (раз на годину).
            </div>
          )}
          {!loading && !err && data && events.length === 0 && data.total > 0 && (
            <div className="text-xs p-6 text-center" style={{ color: "var(--text-dim)" }}>
              У цій категорії змін немає. Перевірте інші вкладки.
            </div>
          )}
          {events.length > 0 && (
            <div className="space-y-2">
              {events.map((e, i) => <HistoryEventRow key={i} event={e} currency={currency} />)}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t text-[10px]" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
          Дані оновлюються раз на годину (по cron-розкладу синку). Зберігаються до 200 останніх змін на товар, 180 днів.
        </div>
      </div>
    </div>
  );
}

function fmtMoney(v: number | null, currency: string): string {
  if (v == null) return "—";
  return `${v.toLocaleString("uk-UA")} ${currency}`;
}

function HistoryEventRow({ event, currency }: { event: ChangeEvent; currency: string }) {
  const date = (
    <span className="text-[10px] tabular-nums whitespace-nowrap" style={{ color: "var(--text-dim)" }}>
      {fmtDateTime(event.at)}
    </span>
  );

  const wrap = (label: string, body: React.ReactNode, accent: string) => (
    <div className="rounded-lg p-2.5" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-wide font-bold" style={{ color: accent }}>{label}</span>
        {date}
      </div>
      <div className="text-xs" style={{ color: "var(--text)" }}>{body}</div>
    </div>
  );

  const arrow = <span style={{ color: "var(--text-dim)", margin: "0 6px" }}>→</span>;

  switch (event.field) {
    case "price":
      return wrap("Ціна", (
        <span><span style={{ color: "var(--text-dim)" }}>{fmtMoney(event.from, currency)}</span>{arrow}<b>{fmtMoney(event.to, currency)}</b></span>
      ), "#118dff");
    case "priceBase":
      return wrap("Базова ціна", (
        <span><span style={{ color: "var(--text-dim)" }}>{fmtMoney(event.from, currency)}</span>{arrow}<b>{fmtMoney(event.to, currency)}</b></span>
      ), "#118dff");
    case "discountPct":
      return wrap("Знижка", (
        <span>
          <span style={{ color: "var(--text-dim)" }}>{event.from != null ? `${event.from}%` : "—"}</span>
          {arrow}
          <b>{event.to != null ? `${event.to}%` : "—"}</b>
        </span>
      ), "#118dff");
    case "status":
      return wrap("Статус", (
        <span>
          <span style={{ color: statusColor(event.from.id) }}>{event.from.name || `#${event.from.id}`}</span>
          {arrow}
          <b style={{ color: statusColor(event.to.id) }}>{event.to.name || `#${event.to.id}`}</b>
        </span>
      ), "#107c10");
    case "stock":
      return wrap("Залишок", (
        <span>
          <span style={{ color: "var(--text-dim)" }}>{event.from ?? "—"} шт</span>
          {arrow}
          <b>{event.to ?? "—"} шт</b>
        </span>
      ), "#e66c37");
    case "sku":
      return wrap("Артикул", (
        <span>
          <span style={{ color: "var(--text-dim)" }}>{event.from || "—"}</span>
          {arrow}
          <b style={{ fontFamily: "monospace" }}>{event.to || "—"}</b>
        </span>
      ), "#8e44ad");
    case "attributes":
      return wrap("Атрибути", (
        <div className="space-y-1">
          {event.added.map((a) => (
            <div key={`a-${a.id}`} className="text-xs">
              <span style={{ color: "#107c10", fontWeight: 700 }}>+ додано</span>{" "}
              <span style={{ color: "var(--text-dim)" }}>{a.name}:</span>{" "}
              <b>{a.values.join(", ")}</b>
            </div>
          ))}
          {event.removed.map((a) => (
            <div key={`r-${a.id}`} className="text-xs">
              <span style={{ color: "#d13438", fontWeight: 700 }}>− видалено</span>{" "}
              <span style={{ color: "var(--text-dim)" }}>{a.name}:</span>{" "}
              <span style={{ textDecoration: "line-through", color: "var(--text-dim)" }}>{a.values.join(", ")}</span>
            </div>
          ))}
          {event.changed.map((a) => (
            <div key={`c-${a.id}`} className="text-xs">
              <span style={{ color: "#118dff", fontWeight: 700 }}>~ змінено</span>{" "}
              <span style={{ color: "var(--text-dim)" }}>{a.name}:</span>{" "}
              <span style={{ color: "var(--text-dim)", textDecoration: "line-through" }}>{a.from.join(", ")}</span>
              {arrow}
              <b>{a.to.join(", ")}</b>
            </div>
          ))}
        </div>
      ), "#d9b300");
    case "images":
      return wrap("Фото", (
        <div>
          <div className="text-xs mb-1.5">
            <span style={{ color: "var(--text-dim)" }}>{event.fromCount} шт</span>{arrow}<b>{event.toCount} шт</b>
          </div>
          {event.addedUrls.length > 0 && (
            <div className="mb-1">
              <div className="text-[10px] font-bold mb-1" style={{ color: "#107c10" }}>+ Додано ({event.addedUrls.length})</div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1">
                {event.addedUrls.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="block rounded overflow-hidden border" style={{ borderColor: "#107c10aa" }}>
                    <img src={u} alt="" className="w-full h-16 object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            </div>
          )}
          {event.removedUrls.length > 0 && (
            <div>
              <div className="text-[10px] font-bold mb-1" style={{ color: "#d13438" }}>− Видалено ({event.removedUrls.length})</div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1">
                {event.removedUrls.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="block rounded overflow-hidden border opacity-60" style={{ borderColor: "#d13438aa" }}>
                    <img src={u} alt="" className="w-full h-16 object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      ), "#d13438");
  }
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>{label}</div>
      <div style={{ color: "var(--text)" }}>{children}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--text-dim)" }}>{title}</div>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs py-1" style={{ color: "var(--text-dim)" }}>{children}</div>;
}

// ── Required-attrs config modal ─────────────────────────────────────────────
// Reads a pre-computed category × attribute fill aggregate from the server
// (single request, instant clicks) instead of doing live drill-down scans.
interface CategoryAggregate {
  id: number;
  productCount: number;
  attributes: { id: number; name: string; filledCount: number }[];
}
function RequiredAttrsModal({ categories, onClose }: {
  categories: ApiCategoryNode[];
  onClose: () => void;
}) {
  const [config, setConfig] = useState<Record<string, number[]>>({});
  const [agg, setAgg] = useState<CategoryAggregate[] | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [showExcluded, setShowExcluded] = useState(false);
  const [catId, setCatId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSel, setExportSel] = useState<Set<number>>(new Set());
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch("/api/products/required-attrs").then((r) => r.json()),
      fetch("/api/products/category-attributes").then((r) => r.json()),
    ])
      .then(([cfg, data]: [Record<string, number[]>, { categories: CategoryAggregate[]; excluded: number[] }]) => {
        if (cancelled) return;
        setConfig(cfg || {});
        setAgg(data.categories || []);
        setExcluded(new Set(data.excluded || []));
      })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const aggById = new Map<number, CategoryAggregate>();
  for (const c of agg ?? []) aggById.set(c.id, c);

  const nameById = new Map<number, { name: string; path: string }>();
  for (const c of categories) nameById.set(c.id, { name: c.name, path: c.path });

  const visibleCategories = (agg ?? [])
    .filter((c) => c.productCount > 0)
    .filter((c) => showExcluded ? excluded.has(c.id) : !excluded.has(c.id))
    .map((c) => ({ ...c, _meta: nameById.get(c.id) }))
    .filter((c) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (c._meta?.name || "").toLowerCase().includes(q)
        || (c._meta?.path || "").toLowerCase().includes(q);
    })
    .sort((a, b) => b.productCount - a.productCount);

  const selectedCat = catId != null ? aggById.get(catId) : null;
  const selectedAttrIds = catId != null ? config[String(catId)] ?? [] : [];

  const toggleAttr = (id: number) => {
    if (catId == null) return;
    const cur = new Set(selectedAttrIds);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    setConfig({ ...config, [String(catId)]: [...cur] });
  };

  const toggleExclude = (id: number) => {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExcluded(next);
    if (catId === id) setCatId(null);
  };

  const toggleExport = (id: number) => {
    const next = new Set(exportSel);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExportSel(next);
  };

  const exportXlsx = async () => {
    setExporting(true); setErr("");
    try {
      const rows: { category: string; path: string; attribute: string; filled: number; total: number; required: boolean }[] = [];
      for (const id of exportSel) {
        const cat = aggById.get(id);
        if (!cat) continue;
        const meta = nameById.get(id);
        const required = new Set(config[String(id)] ?? []);
        // Sort: required (★) attributes first, then by fill count descending —
        // makes the file easy to skim for specialists reviewing candidates.
        const sorted = [...cat.attributes].sort((a, b) => {
          const ra = required.has(a.id) ? 1 : 0;
          const rb = required.has(b.id) ? 1 : 0;
          if (ra !== rb) return rb - ra;
          return b.filledCount - a.filledCount;
        });
        for (const a of sorted) {
          rows.push({
            category: meta?.name || `#${id}`,
            path: meta?.path || "",
            attribute: a.name,
            filled: a.filledCount,
            total: cat.productCount,
            required: required.has(a.id),
          });
        }
      }
      if (rows.length === 0) {
        setErr("У вибраних категоріях немає атрибутів");
        return;
      }
      const date = new Date().toISOString().slice(0, 10);
      await downloadRequiredAttrsXlsx(rows, `category-attrs-${date}.xlsx`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export error");
    } finally {
      setExporting(false);
    }
  };

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const headers = {
        "content-type": "application/json",
        "x-dashboard-secret": process.env.NEXT_PUBLIC_DASHBOARD_SECRET || "",
      };
      const r1 = await fetch("/api/products/required-attrs", { method: "POST", headers, body: JSON.stringify(config) });
      if (!r1.ok) throw new Error(`required-attrs HTTP ${r1.status}`);
      const r2 = await fetch("/api/products/category-attributes", {
        method: "POST", headers, body: JSON.stringify({ excluded: [...excluded] }),
      });
      if (!r2.ok) throw new Error(`excluded HTTP ${r2.status}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const fmtPct = (filled: number, total: number) =>
    total === 0 ? "0%" : `${Math.round((filled / total) * 100)}%`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="rounded-2xl flex flex-col" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", maxHeight: "85vh", width: "100%", maxWidth: 1000 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>Обов&apos;язкові атрибути по категоріях</div>
          <button onClick={onClose} className="px-3 py-1 rounded-lg text-xs cursor-pointer border-0" style={{ background: "var(--bg-input)", color: "var(--text-mid)" }}>✕</button>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto">
          {/* Left: category list */}
          <div className="flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="text-xs font-semibold" style={{ color: "var(--text-dim)" }}>
                Категорія {visibleCategories.length > 0 && <span style={{ color: "var(--text-dim)" }}>({visibleCategories.length})</span>}
              </div>
              <div className="flex items-center gap-1">
                {!showExcluded && exportSel.size > 0 && (
                  <button
                    onClick={() => setExportSel(new Set())}
                    className="text-[10px] px-2 py-0.5 rounded cursor-pointer border-0"
                    style={{ background: "var(--bg-input)", color: "var(--text-mid)" }}
                  >
                    Очистити ({exportSel.size})
                  </button>
                )}
                <button
                  onClick={() => setShowExcluded((v) => !v)}
                  className="text-[10px] px-2 py-0.5 rounded cursor-pointer border-0"
                  style={{ background: showExcluded ? "#d1343822" : "var(--bg-input)", color: showExcluded ? "#d13438" : "var(--text-mid)" }}
                >
                  {showExcluded ? `← Назад (приховано: ${excluded.size})` : `Приховані (${excluded.size})`}
                </button>
              </div>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Пошук категорії…"
              className="px-2 py-1.5 rounded-lg text-xs mb-2 border-0 outline-none"
              style={{ background: "var(--bg-input)", color: "var(--text)" }}
            />
            <div className="max-h-[55vh] overflow-y-auto rounded-lg" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
              {loading && (
                <div className="text-xs p-4 text-center" style={{ color: "var(--text-dim)" }}>
                  Завантаження агрегату по 31 000 товарів…
                  <div className="mt-1 text-[10px]" style={{ color: "var(--text-dim)" }}>
                    Перший раз ~3-5с, далі миттєво (кешується до наступної синхронізації)
                  </div>
                </div>
              )}
              {!loading && visibleCategories.length === 0 && (
                <div className="text-xs p-4 text-center" style={{ color: "var(--text-dim)" }}>
                  {showExcluded ? "Немає прихованих категорій" : "Немає категорій з товарами"}
                </div>
              )}
              {visibleCategories.map((c) => {
                const reqCount = (config[String(c.id)] ?? []).length;
                const isSel = c.id === catId;
                const inExport = exportSel.has(c.id);
                return (
                  <div key={c.id}
                    className="w-full flex items-center justify-between border-b last:border-b-0"
                    style={{ borderColor: "var(--border)", background: isSel ? "#118dff22" : "transparent" }}>
                    {!showExcluded && (
                      <input
                        type="checkbox"
                        checked={inExport}
                        onChange={() => toggleExport(c.id)}
                        title="Вибрати для експорту в Excel"
                        className="ml-2 cursor-pointer"
                        style={{ accentColor: "#107c10" }}
                      />
                    )}
                    <button onClick={() => setCatId(c.id)}
                      className="flex-1 text-left px-2 py-1.5 text-xs cursor-pointer border-0 flex items-center justify-between min-w-0"
                      style={{ background: "transparent", color: isSel ? "#118dff" : "var(--text-mid)" }}
                      title={c._meta?.path || ""}>
                      <span className="truncate">{c._meta?.name || `#${c.id}`}</span>
                      <span className="text-[10px] ml-2 flex-shrink-0" style={{ color: "var(--text-dim)" }}>
                        {c.productCount} тов.
                        {reqCount > 0 && <span className="ml-1 font-bold" style={{ color: "#107c10" }}>· {reqCount}★</span>}
                      </span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExclude(c.id); }}
                      title={showExcluded ? "Відновити" : "Сховати категорію"}
                      className="px-2 py-1.5 text-[11px] cursor-pointer border-0"
                      style={{ background: "transparent", color: showExcluded ? "#107c10" : "var(--text-dim)" }}
                    >
                      {showExcluded ? "↺" : "✕"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: attributes for selected category */}
          <div className="flex flex-col min-h-0">
            <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-dim)" }}>
              {catId == null
                ? "Виберіть категорію →"
                : `Атрибути (${selectedCat?.attributes.length ?? 0}) · вибрано: ${selectedAttrIds.length} · товарів: ${selectedCat?.productCount ?? 0}`}
            </div>
            <div className="max-h-[60vh] overflow-y-auto rounded-lg" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
              {catId == null && (
                <div className="text-xs p-4 text-center" style={{ color: "var(--text-dim)" }}>
                  Оберіть категорію зліва щоб побачити її атрибути
                </div>
              )}
              {catId != null && selectedCat && selectedCat.attributes.length === 0 && (
                <div className="text-xs p-4 text-center" style={{ color: "var(--text-dim)" }}>
                  У товарів цієї категорії немає заповнених атрибутів
                </div>
              )}
              {catId != null && selectedCat?.attributes.map((a) => {
                const isSel = selectedAttrIds.includes(a.id);
                const total = selectedCat.productCount;
                const pct = total > 0 ? (a.filledCount / total) * 100 : 0;
                return (
                  <button key={a.id} onClick={() => toggleAttr(a.id)}
                    className="w-full text-left px-2 py-1.5 text-xs cursor-pointer border-0 flex items-center gap-2 border-b last:border-b-0"
                    style={{ background: isSel ? "#107c1022" : "transparent", color: isSel ? "#107c10" : "var(--text-mid)", borderColor: "var(--border)" }}>
                    <span className="flex-shrink-0">{isSel ? "★" : "☆"}</span>
                    <span className="truncate flex-1">{a.name}</span>
                    <span className="text-[10px] flex-shrink-0 tabular-nums" style={{ color: "var(--text-dim)" }}>
                      {a.filledCount}/{total} · {fmtPct(a.filledCount, total)}
                    </span>
                    <div className="h-1 w-12 rounded flex-shrink-0 overflow-hidden" style={{ background: "var(--border)" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: pct >= 80 ? "#107c10" : pct >= 40 ? "#f7a11a" : "#d13438" }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-4 border-t flex items-center justify-between gap-2" style={{ borderColor: "var(--border)" }}>
          {err && <span className="text-xs" style={{ color: "#d13438" }}>{err}</span>}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={exportXlsx}
              disabled={exporting || exportSel.size === 0}
              title={exportSel.size === 0 ? "Виберіть категорії чекбоксами зліва" : `Вивантажити ${exportSel.size} категорій у Excel`}
              className="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer border-0 disabled:opacity-50"
              style={{ background: "var(--bg-input)", color: "var(--text)" }}
            >
              {exporting ? "Готую…" : `↓ Excel (${exportSel.size})`}
            </button>
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs cursor-pointer border-0" style={{ background: "var(--bg-input)", color: "var(--text-mid)" }}>Скасувати</button>
            <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer border-0 disabled:opacity-60" style={{ background: "#107c10", color: "#fff" }}>
              {saving ? "Зберігаю…" : "Зберегти"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
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
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  // Date range — default: last 7 days. Both endpoints inclusive.
  const today = new Date().toISOString().slice(0, 10);
  const sevenAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const [since, setSince] = useState<string>(sevenAgo);
  const [until, setUntil] = useState<string>(today);
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setPage(1); }, [group, sort, since, until]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("group", group);
    params.set("limit", String(limit));
    params.set("offset", String((page - 1) * limit));
    params.set("sort", sort);
    if (since) params.set("since", `${since}T00:00:00.000Z`);
    if (until) params.set("until", `${until}T23:59:59.999Z`);
    setLoading(true); setError("");
    fetch(`/api/products/changes?${params.toString()}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: TimelineResponse) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [group, sort, since, until, page, limit]);

  const tabs: { key: TimelineGroupKey; label: string; color: string }[] = [
    { key: "photos",     label: "Фото",      color: "#d13438" },
    { key: "attributes", label: "Атрибути",  color: "#d9b300" },
    { key: "reviews",    label: "Відгуки",   color: "#107c10" },
    { key: "sku",        label: "Артикул",   color: "#8e44ad" },
    { key: "prices",     label: "Ціни",      color: "#118dff" },
  ];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <Card>
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
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>Період:</span>
        <input type="date" value={since} max={until || undefined} onChange={(e) => setSince(e.target.value)}
          className="rounded-lg px-2 py-1 text-xs border outline-none tabular-nums"
          style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }} />
        <span style={{ color: "var(--text-dim)" }}>—</span>
        <input type="date" value={until} min={since || undefined} onChange={(e) => setUntil(e.target.value)}
          className="rounded-lg px-2 py-1 text-xs border outline-none tabular-nums"
          style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }} />
        <button onClick={() => setSort(sort === "desc" ? "asc" : "desc")}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border"
          style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}
          title="Перемкнути порядок сортування за датою">
          📅 {sort === "desc" ? "Новіші першими" : "Старіші першими"}
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
        const parts: React.ReactNode[] = [];
        if (added) parts.push(<span key="a" style={{ color: "#107c10" }}>+{added} додано</span>);
        if (removed) parts.push(<span key="r" style={{ color: "#d13438" }}>−{removed} видалено</span>);
        return parts.length ? <span className="flex gap-2 flex-wrap">{parts}</span> : <span style={{ color: "var(--text-dim)" }}>пересортовано</span>;
      }
      case "attributes": {
        const parts: React.ReactNode[] = [];
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
interface PricesCell { price: number | null; status: string | null; url: string | null }
interface PricesRow {
  productId: number;
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
  rows: PricesRow[];
  total: number;
  page: number;
  limit: number;
}

// Mass-reparse job status returned by /api/parser/job/<id>. Mirrors Flask's
// _jobs payload shape from Agromat_Parcer/app.py. On completion `result`
// carries a flattened orchestrator summary — Flask collapses list fields
// to their length before serializing, so e.g. `errors` is a count not array.
interface ParserJobResult {
  total_products?: number;
  total_processed?: number;
  total_found?: number;
  errors?: number;
  new_finds?: number;
  price_changes?: number;
  price_dist?: { higher?: number; lower?: number; equal?: number };
  mode?: string;
  competitor_filter?: string | null;
}
interface ParserJob {
  ok: boolean;
  job_id?: string;
  action?: string;
  status?: "starting" | "running" | "done" | "error";
  current?: number;
  total?: number;
  label?: string;
  started_at?: number;
  finished_at?: number | null;
  error?: string | null;
  result?: ParserJobResult | null;
}

function CompetitorPricesView() {
  const [data, setData] = useState<PricesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
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

  useEffect(() => { setPage(1); }, [searchDebounced]);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(limit));
    if (searchDebounced) p.set("search", searchDebounced);
    setLoading(true); setError("");
    fetch(`/api/parser/prices?${p.toString()}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: PricesResponse) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [page, limit, searchDebounced]);

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
                      status: json.status ?? r.byCompetitor[competitorId]?.status ?? null,
                      url: r.byCompetitor[competitorId]?.url ?? null,
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

  // Mass-reparse: start the job, then poll its status every 5s until done.
  // Auto-refetches the table when the job finishes.
  const startBulkSantechshara = useCallback(async () => {
    setBulkStarting(true);
    setError("");
    try {
      const resp = await fetch("/api/parser/run/prices-santechshara", { method: "POST" });
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
      setJob({ ok: true, job_id: json.job_id, status: "starting", current: 0, total: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
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
          if (j.status === "done") load(); // Reload table to show fresh prices
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
        {data?.snapshotDate && (
          <span className="text-[11px]" style={{ color: "var(--text-dim)" }}>
            Знімок цін за <b style={{ color: "var(--text-mid)" }}>{data.snapshotDate}</b>
          </span>
        )}
        <button
          onClick={startBulkSantechshara}
          disabled={bulkStarting || (job?.status === "running" || job?.status === "starting")}
          className="ml-auto px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border disabled:opacity-60"
          style={{ background: "#8e44ad11", color: "#8e44ad", borderColor: "#8e44ad55" }}
          title="Запустити фоновий live-парсинг усіх товарів у Сантехшарі через headless Chrome. ~45 хв.">
          {bulkStarting ? "Стартую…" : "↻↻ Оновити всю Сантехшару live"}
        </button>
        <button onClick={load}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border"
          style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}
          title="Перезавантажити таблицю з БД">↻ Оновити</button>
      </div>

      {/* Mass-reparse progress bar — visible while a job is in-flight or
          just finished. Dismissible after completion. */}
      {job && (
        <BulkProgressBar job={job} onDismiss={() => setJob(null)} />
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
  const failed = job.status === "error";

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

  const bg = failed ? "#d1343811" : done ? "#107c1011" : "#8e44ad11";
  const border = failed ? "#d13438aa" : done ? "#107c10aa" : "#8e44ad55";
  const accent = failed ? "#d13438" : done ? "#107c10" : "#8e44ad";

  // Flattened orchestrator summary (only meaningful when status === "done").
  const r = job.result || null;

  return (
    <div className="mb-3 p-3 rounded-lg" style={{ background: bg, border: `1px solid ${border}` }}>
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        <span className="text-xs font-semibold" style={{ color: accent }}>
          {failed
            ? `❌ Помилка: ${job.error || "unknown"}`
            : done
              ? `✓ Завершено: оброблено ${current}${total ? ` / ${total}` : ""} товарів`
              : `↻↻ Live-парсинг Сантехшари ${job.label ? `· ${job.label}` : ""}`}
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
      {/* Summary breakdown on completion. Flask collapses orchestrator list
          fields to their lengths, so `errors`, `new_finds`, `price_changes`
          are counts. price_dist tells us how many came out cheaper / equal /
          higher than our price — useful for a quick "who wins" glance. */}
      {done && r && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] tabular-nums">
          <Stat label="Знайдено цін" value={r.total_found} color="#107c10" />
          <Stat label="Нових (раніше не було ціни)" value={r.new_finds} color="#118dff" />
          <Stat label="Ціна змінилась" value={r.price_changes} color="#e66c37" />
          <Stat label="Помилок" value={r.errors} color="#d13438" />
          {r.price_dist && (r.price_dist.lower || r.price_dist.higher || r.price_dist.equal) && (
            <span style={{ color: "var(--text-dim)" }}>
              · <span style={{ color: "#d13438" }}>{r.price_dist.lower ?? 0} дешевше</span>
              {" · "}
              <span style={{ color: "var(--text-mid)" }}>{r.price_dist.equal ?? 0} ≈</span>
              {" · "}
              <span style={{ color: "#107c10" }}>{r.price_dist.higher ?? 0} дорожче нас</span>
            </span>
          )}
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

// ── Main section ────────────────────────────────────────────────────────────
export function ProductsCatalog() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [filters, setFilters] = useState<FiltersResp | null>(null);

  const [tab, setTab] = useState<PresetTab>("all");
  const [search, setSearch] = useState("");
  // Debounced search — avoids hitting /api/products on every keystroke
  const [searchDebounced, setSearchDebounced] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setSearchDebounced(search), 300);
    return () => window.clearTimeout(id);
  }, [search]);
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [brandId, setBrandId] = useState<number | "">("");
  // Default: only "В наявності" (statusId=5). User can clear or toggle others.
  const [statusIds, setStatusIds] = useState<number[]>([5]);
  const [minPrice, setMinPrice] = useState<number | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [minStock, setMinStock] = useState<number | null>(null);
  const [maxStock, setMaxStock] = useState<number | null>(null);
  // Bulk filter — null when not active. Stores the raw text too, so reopening
  // the modal pre-fills the textarea for further editing.
  const [bulk, setBulk] = useState<{ type: "code" | "ref"; ids: number[]; rawText: string } | null>(null);
  const [openBulk, setOpenBulk] = useState(false);
  // Snapshot date — null = live data, "YYYY-MM-DD" = frozen state of that day
  const [asOf, setAsOf] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  // "" all · "true" з фото · "false" без фото · "lt2|lt3|lt5" — менше N фото
  const [hasImages, setHasImages] = useState<"" | "true" | "false" | "lt2" | "lt3" | "lt5">("");
  const [hasAttrs, setHasAttrs] = useState<"" | "true" | "false" | "lt2" | "lt3" | "lt5">("");
  const [hasReviews, setHasReviews] = useState<"" | "true" | "false">("");
  const [hasSku, setHasSku] = useState<"" | "true" | "false">("");
  const [sortBy, setSortBy] = useState("firstSeenAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [openItem, setOpenItem] = useState<ProductLite | null>(null);
  const [openReq, setOpenReq] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // View mode — "catalog" (table of products) vs "timeline" (cross-product
  // change history grouped by Фото/Атрибути/Відгуки/Артикул/Ціни) vs
  // "prices" (Vencon/Теплорадість/Сантехшара side-by-side from parser DB).
  const [mode, setMode] = useState<"catalog" | "timeline" | "prices">("catalog");

  // Reset to page 1 when any filter changes
  useEffect(() => { setPage(1); }, [tab, searchDebounced, categoryId, brandId, statusIds, minPrice, maxPrice, minStock, maxStock, bulk, hasImages, hasAttrs, hasReviews, hasSku, sortBy, sortDir, limit, asOf]);

  const buildQuery = useCallback((): string => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(limit));
    if (searchDebounced) p.set("search", searchDebounced);
    if (categoryId !== "") p.set("category_ids", String(categoryId));
    if (brandId !== "") p.set("brand_ids", String(brandId));
    if (statusIds.length) p.set("status_ids", statusIds.join(","));
    if (minPrice != null) p.set("min_price", String(minPrice));
    if (maxPrice != null) p.set("max_price", String(maxPrice));
    if (minStock != null) p.set("min_stock", String(minStock));
    if (maxStock != null) p.set("max_stock", String(maxStock));
    if (bulk && bulk.ids.length > 0) {
      p.set(bulk.type === "code" ? "codes_in" : "refs_in", bulk.ids.join(","));
    }
    if (asOf) p.set("as_of", asOf);
    if (hasImages === "true" || hasImages === "false") p.set("has_images", hasImages);
    else if (hasImages === "lt2") p.set("max_images", "2");
    else if (hasImages === "lt3") p.set("max_images", "3");
    else if (hasImages === "lt5") p.set("max_images", "5");
    if (hasAttrs === "true" || hasAttrs === "false") p.set("has_attributes", hasAttrs);
    else if (hasAttrs === "lt2") p.set("max_attributes", "2");
    else if (hasAttrs === "lt3") p.set("max_attributes", "3");
    else if (hasAttrs === "lt5") p.set("max_attributes", "5");
    if (hasReviews) p.set("has_reviews", hasReviews);
    if (hasSku) p.set("has_sku", hasSku);
    p.set("sort_by", sortBy);
    p.set("sort_dir", sortDir);

    // Preset tab translates into derived filters
    if (tab === "new7") p.set("only_new_since_sync", "true");
    if (tab === "changed7") p.set("only_status_changed_days", "7");
    if (tab === "noImg") p.set("has_images", "false");
    if (tab === "noAttr") p.set("has_attributes", "false");
    if (tab === "noRev") p.set("has_reviews", "false");
    return p.toString();
  }, [page, limit, searchDebounced, categoryId, brandId, statusIds, minPrice, maxPrice, minStock, maxStock, bulk, hasImages, hasAttrs, hasReviews, hasSku, sortBy, sortDir, tab, asOf]);

  const loadList = useCallback(() => {
    setLoading(true); setError("");
    fetch(`/api/products?${buildQuery()}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: ListResponse) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [buildQuery]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    fetch("/api/products/filters").then((r) => r.json()).then(setFilters).catch(() => {});
  }, []);

  // Load list of available snapshot dates — refetched after each sync
  const loadSnapshots = useCallback(() => {
    fetch("/api/products/snapshots", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { dates: SnapshotInfo[] }) => setSnapshots(d.dates || []))
      .catch(() => {});
  }, []);
  useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

  const resetFilters = () => {
    // Reset to defaults — status defaults to "В наявності" (matches initial mount)
    setSearch(""); setCategoryId(""); setBrandId(""); setStatusIds([5]);
    setMinPrice(null); setMaxPrice(null);
    setMinStock(null); setMaxStock(null);
    setBulk(null);
    setHasImages(""); setHasAttrs(""); setHasReviews(""); setHasSku("");
    setSortBy("firstSeenAt"); setSortDir("desc"); setTab("all");
  };

  // True if filters differ from defaults — drives the "Скинути" button visibility
  const isDefaultStatusFilter = statusIds.length === 1 && statusIds[0] === 5;

  const toggleStatus = (id: number) => {
    setStatusIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  // Pulls every product matching the current filters (single big page) for
  // CSV / Regex / Cube exports. Capped at 10 000 — practical exports never hit it.
  const [exportBusy, setExportBusy] = useState(false);
  const fetchAllFiltered = useCallback(async (): Promise<ProductLite[]> => {
    setExportBusy(true);
    try {
      const p = new URLSearchParams(buildQuery());
      p.set("page", "1");
      // 50K covers the whole catalog (~31K) so exports never get truncated
      p.set("limit", "50000");
      const r = await fetch(`/api/products?${p.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as ListResponse;
      return d.items;
    } finally {
      setExportBusy(false);
    }
  }, [buildQuery]);

  const today = () => new Date().toISOString().slice(0, 10);

  const exportGoodsRefsCsv = async () => {
    const items = await fetchAllFiltered();
    const refs = items.map((i) => i.goodsRef).filter(Boolean);
    downloadIdsCsv(refs, `goods_ref-${today()}.csv`);
    setToast(`CSV: ${refs.length} goods_ref`);
  };
  const exportGoodsRefsXlsx = async () => {
    const items = await fetchAllFiltered();
    const refs = items.map((i) => i.goodsRef).filter(Boolean);
    await downloadIdsXlsx(refs, `goods_ref-${today()}.xlsx`, "goods_ref");
    setToast(`Excel: ${refs.length} goods_ref`);
  };
  const exportGoodsRefsRegex = async () => {
    try {
      const items = await fetchAllFiltered();
      const refs = items.map((i) => i.goodsRef).filter(Boolean).join("|");
      await _copyText(refs);
      setToast(`Regex: ${items.length} goods_ref скопійовано`);
    } catch (e) {
      setToast(`Помилка копіювання: ${e instanceof Error ? e.message : "невідомо"}`);
    }
  };
  // "IDD" exports use product `code` (a.k.a. "Код товара") — consistent across
  // CSV / Excel / Regex / Cube. Cube wraps it in the MDX `[Код товару]` member.
  const exportIddCsv = async () => {
    const items = await fetchAllFiltered();
    const codes = items.map((i) => i.code).filter(Boolean);
    downloadIdsCsv(codes, `kod-tovara-${today()}.csv`);
    setToast(`CSV: ${codes.length} кодів товару`);
  };
  const exportIddXlsx = async () => {
    const items = await fetchAllFiltered();
    const codes = items.map((i) => i.code).filter(Boolean);
    await downloadIdsXlsx(codes, `kod-tovara-${today()}.xlsx`, "Код товара");
    setToast(`Excel: ${codes.length} кодів товару`);
  };
  const exportIddRegex = async () => {
    try {
      const items = await fetchAllFiltered();
      const codes = items.map((i) => i.code).filter(Boolean).join("|");
      await _copyText(codes);
      setToast(`Regex: ${items.length} кодів товару скопійовано`);
    } catch (e) {
      setToast(`Помилка копіювання: ${e instanceof Error ? e.message : "невідомо"}`);
    }
  };
  const exportIddCube = async () => {
    try {
      const items = await fetchAllFiltered();
      const lines = items
        .map((i) => i.code)
        .filter(Boolean)
        .map((code) => `[Товар].[Код товару].&[${code}]`)
        .join(",\n");
      await _copyText(`{\n${lines}\n}`);
      setToast(`Cube: ${items.length} кодів товару скопійовано`);
    } catch (e) {
      setToast(`Помилка копіювання: ${e instanceof Error ? e.message : "невідомо"}`);
    }
  };
  const exportFullXlsx = async () => {
    const items = await fetchAllFiltered();
    await downloadProductsXlsx(items, `products-full-${today()}.xlsx`);
    setToast(`Excel повна аналітика: ${items.length} товарів`);
  };

  // Tiny copy-to-clipboard helper with toast feedback. Used by the
  // code / goods_ref / sku cells in the table.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(id);
  }, [toast]);
  const copy = useCallback(async (value: string | number | null, label: string) => {
    if (value == null || value === "" || value === 0) return;
    const text = String(value);
    try {
      await _copyText(text);
      setToast(`${label}: ${text} — скопійовано`);
    } catch {
      setToast(`Не вдалося скопіювати ${label}`);
    }
  }, []);

  // Drill-down from Category Summary → set filters on the main table.
  // Resets unrelated filters so the drill-down is precise (no leftover bias).
  const applyCategoryFilter = useCallback((catId: number, preset: SummaryPreset) => {
    setSearch(""); setBrandId(""); setMinPrice(null); setMaxPrice(null);
    setCategoryId(catId);
    setHasImages(""); setHasAttrs(""); setHasReviews(""); setHasSku("");
    setStatusIds([]);  // start from blank so preset-specific status can be set
    setTab("all");
    switch (preset) {
      case "noImages":    setHasImages("false"); break;
      case "noAttrs":     setHasAttrs("false"); break;
      case "noReviews":   setHasReviews("false"); break;
      case "noSku":       setHasSku("false"); break;
      case "inStock":     setStatusIds([5]); break;
      case "outOfStock":  setStatusIds([1]); break;
      case "new":         setTab("new7"); break;
      case "changed":     setTab("changed7"); break;
      case "all":         setStatusIds([5]); break; // default in-stock view
    }
    // Defer scroll until React commits the filter change → table re-renders
    setTimeout(() => {
      document.getElementById("products-table-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }, []);

  // Dropdown options come from the *filtered* product set (self-exclude per facet)
  // so they only show categories/brands that actually exist among the loaded items
  // and react to other active filters. Falls back to /filters cache while loading.
  const categoryOptions = data?.availableCategories ?? [];
  const brandOptions = data?.availableBrands
    ?? (filters?.brands || []).map((b) => ({ id: b.id, name: b.name, count: 0 }));

  // Status-id → human name (used by the "Зміна" column in changed7 tab)
  const statusName = useCallback((id: number) => {
    return filters?.statuses.find((s) => s.id === id)?.name ?? `Статус #${id}`;
  }, [filters]);

  const selStyle: React.CSSProperties = {
    background: "var(--bg-input)",
    border: "1px solid var(--border2)",
    borderRadius: 8,
    color: "var(--text)",
    padding: "5px 10px",
    fontSize: 12,
    cursor: "pointer",
  };

  return (
    <>
      {/* Header */}
      <Card style={{ borderColor: "#118dff44" }} className="mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>
            Картка товару. {mode === "catalog" ? "Каталог." : mode === "timeline" ? "Хронологія змін." : "Ціни конкурентів."}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Mode toggle: Каталог / Хронологія змін / Ціни конкурентів */}
            <div className="flex gap-1 rounded-xl p-0.5" style={{ background: "var(--bg-input)", border: "1px solid var(--border2)" }}>
              {([
                ["catalog",  "Каталог"],
                ["timeline", "Хронологія змін"],
                ["prices",   "Ціни конкурентів"],
              ] as ["catalog" | "timeline" | "prices", string][]).map(([m, l]) => (
                <button key={m} onClick={() => setMode(m)}
                  className="px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer border-0"
                  style={mode === m ? { background: "#118dff", color: "#fff" } : { background: "transparent", color: "var(--text-dim)" }}
                >{l}</button>
              ))}
            </div>
            {/* Inline "as of" pill so it's still visible when a snapshot is pinned */}
            {asOf && mode === "catalog" && (
              <button
                onClick={() => setAsOf(null)}
                className="text-xs font-semibold px-2 py-1 rounded-lg cursor-pointer border whitespace-nowrap"
                style={{ background: "#e66c3711", color: "#e66c37", borderColor: "#e66c3744" }}
                title="Повернутись до поточного стану"
              >
                🕐 {asOf} ✕
              </button>
            )}
            <button
              onClick={() => setOpenSettings(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer border-0"
              style={{ background: "#118dff", color: "#fff" }}
            >
              ⚙ Налаштування
            </button>
          </div>
        </div>

        {/* "As of" banner — visible only when looking at a historical snapshot */}
        {asOf && mode === "catalog" && (
          <div className="mb-3 px-3 py-2 rounded-lg flex items-center justify-between gap-2 flex-wrap"
            style={{ background: "#e66c3711", border: "1px solid #e66c3744", color: "#e66c37" }}>
            <span className="text-xs font-semibold">
              🕐 Перегляд стану каталогу за <b>{asOf}</b>
              {data?.syncedAt && <span style={{ color: "var(--text-mid)", fontWeight: 400 }}> · sync: {fmtDateTime(data.syncedAt)}</span>}
              {data?.total != null && <span style={{ color: "var(--text-mid)", fontWeight: 400 }}> · {fmtNum(data.total)} товарів</span>}
            </span>
            <button onClick={() => setAsOf(null)}
              className="text-xs font-bold px-2 py-1 rounded cursor-pointer border-0"
              style={{ background: "#e66c37", color: "#fff" }}
            >✕ Повернутись до поточного</button>
          </div>
        )}

        {mode === "catalog" && data && <KpiRow stats={data.stats} total={data.total} />}
      </Card>

      {mode === "timeline" && <ChangesTimelineView />}
      {mode === "prices" && <CompetitorPricesView />}

      {mode === "catalog" && <>
      <CategorySummaryPanel onFilter={applyCategoryFilter} />

      <div id="products-table-anchor" />
      <Card>
        {/* Preset tabs + Bulk-filter trigger */}
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          <div className="flex gap-1 flex-wrap rounded-xl p-0.5" style={{ background: "var(--bg-input)", border: "1px solid var(--border2)" }}>
            {([
              ["all",      "Всі"],
              ["new7",     "Нові товари"],
              ["changed7", "Зміна статусу товара"],
              ["noImg",    "Без фото"],
              ["noAttr",   "Без атрибутів"],
              ["noRev",    "Без відгуків"],
            ] as [PresetTab, string][]).map(([t, l]) => (
              <button key={t} onClick={() => setTab(t)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border-0"
                style={tab === t ? { background: "#118dff", color: "#fff" } : { background: "transparent", color: "var(--text-dim)" }}
              >{l}</button>
            ))}
          </div>
          <button
            onClick={() => setOpenBulk(true)}
            title="Завантажити список кодів товару або goods_ref для точкової фільтрації"
            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border"
            style={{
              background: bulk ? "#118dff" : "var(--bg-input)",
              color: bulk ? "#fff" : "var(--text-mid)",
              borderColor: bulk ? "#118dff" : "var(--border2)",
            }}
          >
            📋 Набір товарів{bulk ? ` (${bulk.ids.length})` : ""}
          </button>
          {bulk && (
            <button
              onClick={() => setBulk(null)}
              title="Скинути набір"
              className="text-xs px-2 py-1 rounded-lg cursor-pointer border-0"
              style={{ background: "#d1343811", color: "#d13438" }}
            >✕</button>
          )}
        </div>

        {/* Bulk-filter banner — visible when a set is active. Shows hit/miss stats
            and offers a copy-to-clipboard of the not-found IDs in the same format. */}
        {bulk && data && (
          (() => {
            const notFound = bulk.type === "code" ? data.notFoundCodes : data.notFoundRefs;
            const requested = bulk.ids.length;
            const found = requested - notFound.length;
            const copyMissing = async () => {
              if (!notFound.length) return;
              // Reuse the original separator style — if user pasted with commas
              // we keep commas; otherwise newlines. Detected from the raw text.
              const sep = bulk.rawText.includes(",") ? ", " : "\n";
              try {
                await _copyText(notFound.join(sep));
                setToast(`Скопійовано ${notFound.length} не знайдених ${bulk.type === "code" ? "кодів" : "goods_ref"}`);
              } catch (e) {
                setToast(`Помилка копіювання: ${e instanceof Error ? e.message : "невідомо"}`);
              }
            };
            return (
              <div className="mb-3 px-3 py-2 rounded-lg flex items-center justify-between gap-2 flex-wrap"
                style={{ background: "#118dff11", border: "1px solid #118dff44", color: "#118dff" }}>
                <span className="text-xs font-semibold tabular-nums">
                  📋 Набір {bulk.type === "code" ? "за кодом товара" : "за goods_ref"}:
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
                  <button onClick={() => setOpenBulk(true)}
                    className="text-xs px-2 py-1 rounded cursor-pointer border-0"
                    style={{ background: "transparent", color: "#118dff", textDecoration: "underline" }}
                  >Редагувати</button>
                </div>
              </div>
            );
          })()
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук: назва, code, sku, goods_ref, id…"
            className="rounded-lg px-2 py-1 text-xs border outline-none"
            style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: search ? "#118dff" : "var(--border2)", minWidth: 280 }}
          />
          <SearchSelect
            value={categoryId}
            onChange={setCategoryId}
            options={categoryOptions}
            placeholder="Всі категорії"
            width={240}
          />
          <SearchSelect
            value={brandId}
            onChange={setBrandId}
            options={brandOptions}
            placeholder="Всі бренди"
            width={200}
          />
          <PriceFilter
            min={minPrice}
            max={maxPrice}
            priceMax={data?.priceMax ?? 0}
            count={data?.total ?? 0}
            onChange={(mn, mx) => { setMinPrice(mn); setMaxPrice(mx); }}
          />
          <StockFilter
            min={minStock}
            max={maxStock}
            stockMax={data?.stockMax ?? 0}
            count={data?.total ?? 0}
            onChange={(mn, mx) => { setMinStock(mn); setMaxStock(mx); }}
          />
          {/* Status — multi-select chips. ARCHIVE_STATUS_ID (-1) is a UI-only
              pseudo-status that maps to API field `deleted=true`. */}
          <div className="flex items-center gap-1 flex-wrap rounded-lg p-0.5"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border2)" }}>
            {[...(filters?.statuses || []), { id: ARCHIVE_STATUS_ID, name: "Архів" }].map((s) => {
              const active = statusIds.includes(s.id);
              const color = s.id === ARCHIVE_STATUS_ID ? "#a19f9d" : statusColor(s.id);
              return (
                <button key={s.id} onClick={() => toggleStatus(s.id)} title={s.name}
                  className="px-2 py-0.5 rounded text-xs font-semibold cursor-pointer border-0 whitespace-nowrap"
                  style={active ? { background: color, color: "#fff" } : { background: "transparent", color }}
                >● {s.name}</button>
              );
            })}
          </div>
          <select value={hasImages} onChange={(e) => setHasImages(e.target.value as typeof hasImages)} style={selStyle}>
            <option value="">Фото: всі</option>
            <option value="false">Без фото (0)</option>
            <option value="lt2">Менше 2</option>
            <option value="lt3">Менше 3</option>
            <option value="lt5">Менше 5</option>
            <option value="true">Тільки з фото</option>
          </select>
          <select value={hasAttrs} onChange={(e) => setHasAttrs(e.target.value as typeof hasAttrs)} style={selStyle}>
            <option value="">Атриб.: всі</option>
            <option value="false">Без атриб. (0)</option>
            <option value="lt2">Менше 2</option>
            <option value="lt3">Менше 3</option>
            <option value="lt5">Менше 5</option>
            <option value="true">З атриб.</option>
          </select>
          <select value={hasReviews} onChange={(e) => setHasReviews(e.target.value as typeof hasReviews)} style={selStyle}>
            <option value="">Відгуки: всі</option>
            <option value="true">З відгук.</option>
            <option value="false">Без відгук.</option>
          </select>
          <select value={hasSku} onChange={(e) => setHasSku(e.target.value as typeof hasSku)} style={selStyle}>
            <option value="">Артикул: всі</option>
            <option value="true">З артикулом</option>
            <option value="false">Без артикулу</option>
          </select>
          {(search || categoryId !== "" || brandId !== "" || !isDefaultStatusFilter || minPrice != null || maxPrice != null || minStock != null || maxStock != null || hasImages || hasAttrs || hasReviews || hasSku || tab !== "all") && (
            <button onClick={resetFilters} className="text-xs px-2 py-1 rounded-lg cursor-pointer border-0"
              style={{ background: "#d1343811", color: "#d13438" }}>✕ Скинути</button>
          )}
        </div>

        {/* Analytics block — exports operate on the currently filtered set */}
        <div
          className="rounded-xl p-3 mb-3"
          style={{
            border: "1px solid #93c5fd",         // softly darker blue border
            background: "#eff6ff",               // ніжно-блакитний (tailwind blue-50)
            boxShadow: "inset 0 0 0 1px rgba(147,197,253,0.2)",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "#1e40af" }}>
              ⬢ Аналітика
            </div>
            <span className="text-[10px] tabular-nums" style={{ color: "#3b82f6" }}>
              {data ? `${fmtNum(data.total)} товарів у вибірці` : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#1e3a8a" }}>Goods_ref:</span>
            <ExportPill label="↓ CSV" color="#107c10" bg="rgba(16,185,129,0.12)" busy={exportBusy}
              onClick={exportGoodsRefsCsv} title="Завантажити goods_ref у CSV (поточна вибірка)" />
            <ExportPill label="↓ Excel" color="#107c10" bg="rgba(16,185,129,0.12)" busy={exportBusy}
              onClick={exportGoodsRefsXlsx} title="Завантажити goods_ref у XLSX (поточна вибірка)" />
            <ExportPill label="Regex" color="#e66c37" bg="rgba(245,158,11,0.12)" busy={exportBusy}
              onClick={exportGoodsRefsRegex} title="Скопіювати goods_ref у форматі id1|id2|…" />

            <span className="text-[10px] font-bold uppercase tracking-wider ml-3" style={{ color: "#1e3a8a" }}>IDD:</span>
            <ExportPill label="↓ CSV" color="#107c10" bg="rgba(16,185,129,0.12)" busy={exportBusy}
              onClick={exportIddCsv} title="Завантажити IDD у CSV (поточна вибірка)" />
            <ExportPill label="↓ Excel" color="#107c10" bg="rgba(16,185,129,0.12)" busy={exportBusy}
              onClick={exportIddXlsx} title="Завантажити IDD у XLSX (поточна вибірка)" />
            <ExportPill label="Regex" color="#e66c37" bg="rgba(245,158,11,0.12)" busy={exportBusy}
              onClick={exportIddRegex} title="Скопіювати IDD у форматі id1|id2|…" />
            <ExportPill label="Cube" color="#6366f1" bg="rgba(99,102,241,0.12)" busy={exportBusy}
              onClick={exportIddCube} title="Скопіювати IDD у форматі MDX-куба" />

            <span className="text-[10px] font-bold uppercase tracking-wider ml-3" style={{ color: "#1e3a8a" }}>Повна аналітика:</span>
            <ExportPill label="↓ Excel" color="#3730a3" bg="rgba(99,102,241,0.18)" busy={exportBusy}
              onClick={exportFullXlsx} title="Excel-файл з усіма полями (код, goods_ref, артикул, назва, категорія, бренд, ціна, залишок, статус, фото, відгуки, атрибути, дати)" />
          </div>
        </div>

        {/* Table */}
        {error && <div className="text-xs py-2" style={{ color: "#d13438" }}>{error}</div>}
        {loading && !data && <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>Завантаження…</div>}
        {data && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    {(([
                      ["", null],
                      ["Код товара", null],
                      ["goods_ref", null],
                      ["Артикул", null],
                      ["Назва", "name"],
                      ["Категорія", "category"],
                      ["Бренд", "brand"],
                      ["Ціна", "price"],
                      ["Залишок", "stockQty"],
                      ["Статус", null],
                      ...(tab === "changed7" ? [["Було → стало", null]] as [string, string | null][] : []),
                      ["Фото", "imagesCount"],
                      ["Відгук.", "reviewsCount"],
                      ["Атриб.", "attributesCount"],
                      // In the "Зміна статусу" preset the "first seen" column is
                      // replaced with the date of the *previous* status change —
                      // so you can see the chain of transitions, not when we
                      // first met the product.
                      tab === "changed7"
                        ? ["Попередня зміна", null]
                        : ["Уперше у нас", "firstSeenAt"],
                      ["Зміна ст.", "statusChangedAt"],
                    ]) as [string, string | null][]).map(([h, sk], i) => (
                      <th key={i} className="text-left px-2 py-2 font-semibold text-[11px] whitespace-nowrap" style={{ color: "var(--text-dim2)" }}>
                        {sk ? (
                          <button
                            onClick={() => {
                              if (sortBy === sk) setSortDir(sortDir === "asc" ? "desc" : "asc");
                              else { setSortBy(sk); setSortDir("desc"); }
                            }}
                            className="cursor-pointer border-0 bg-transparent text-[11px] font-semibold"
                            style={{ color: sortBy === sk ? "#118dff" : "var(--text-dim2)" }}
                          >{h}{sortBy === sk ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</button>
                        ) : h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((p) => {
                    // "New" = appeared in the last sync (firstSeenAt timestamp
                    // exactly matches the latest sync). Matches the "Нові товари" tab.
                    const isNew = !!data.syncedAt && p.firstSeenAt === data.syncedAt;
                    // Soft green tint for the whole row when the product is new.
                    // Hover state is brighter; left border stripe makes it scannable.
                    const rowBg = isNew ? "rgba(16,124,16,0.06)" : "transparent";
                    const rowHoverBg = isNew ? "rgba(16,124,16,0.12)" : "var(--bg-input)";
                    return (
                      <tr key={p.id} className="border-b cursor-pointer" style={{
                        borderColor: "var(--border)",
                        background: rowBg,
                        boxShadow: isNew ? "inset 3px 0 0 0 #107c10" : undefined,
                      }}
                        onClick={() => setOpenItem(p)}
                        onMouseEnter={(e) => (e.currentTarget.style.background = rowHoverBg)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
                      >
                        <td className="px-2 py-1.5">
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title={isNew ? "Новий товар (з'явився в останньому синку) — відкрити на сайті" : "Відкрити на сайті"}
                            className="inline-flex items-center gap-0.5 text-[10px] font-bold no-underline hover:underline whitespace-nowrap"
                            style={{ color: isNew ? "#107c10" : "var(--text-dim)" }}
                          >
                            {isNew ? "NEW ↗" : "↗"}
                          </a>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <button
                            onClick={(e) => { e.stopPropagation(); copy(p.code, "Код товара"); }}
                            title={`Копіювати код ${p.code}`}
                            className="cursor-pointer border-0 bg-transparent text-xs hover:underline tabular-nums"
                            style={{ color: "var(--text-mid)" }}
                          >{p.code}</button>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {p.goodsRef ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); copy(p.goodsRef, "goods_ref"); }}
                              title={`Копіювати goods_ref ${p.goodsRef}`}
                              className="cursor-pointer border-0 bg-transparent text-xs hover:underline tabular-nums"
                              style={{ color: "var(--text-mid)" }}
                            >{p.goodsRef}</button>
                          ) : <span style={{ color: "var(--text-dim)" }}>—</span>}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {p.sku ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); copy(p.sku, "Артикул"); }}
                              title={`Копіювати артикул ${p.sku}`}
                              className="cursor-pointer border-0 bg-transparent text-xs hover:underline"
                              style={{ color: "var(--text-dim)" }}
                            >{p.sku}</button>
                          ) : <span style={{ color: "var(--text-dim)" }}>—</span>}
                        </td>
                        <td
                          className="px-2 py-1.5 max-w-[280px] truncate hover:underline"
                          title={`${p.name} — клік відкриває картку товару`}
                          style={{ color: "var(--text)" }}
                        >{p.name}</td>
                        <td className="px-2 py-1.5 max-w-[180px] truncate" title={`${p.categoryPath} — клік: фільтрувати`}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setCategoryId(p.categoryId); }}
                            className="cursor-pointer border-0 bg-transparent text-xs hover:underline truncate text-left max-w-full"
                            style={{ color: "var(--text-mid)" }}
                          >{p.categoryName}</button>
                        </td>
                        <td className="px-2 py-1.5 max-w-[120px] truncate" title={`${p.brand} — клік: фільтрувати`}>
                          {p.brandId != null ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); setBrandId(p.brandId!); }}
                              className="cursor-pointer border-0 bg-transparent text-xs hover:underline truncate text-left max-w-full"
                              style={{ color: "var(--text-dim)" }}
                            >{p.brand}</button>
                          ) : <span style={{ color: "var(--text-dim)" }}>{p.brand || "—"}</span>}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: "var(--text-mid)" }}>{fmtPrice(p.price, p.currency)}</td>
                        <td className="px-2 py-1.5 text-center font-semibold tabular-nums" style={{
                          color: p.stockQty == null ? "var(--text-dim)"
                            : p.stockQty === 0 ? "#d13438"
                            : p.stockQty >= 10 ? "#107c10"
                            : "#e66c37",
                        }}>{p.stockQty != null ? p.stockQty : "—"}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap" title="Клік: фільтрувати за цим статусом">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setStatusIds([p.deleted ? ARCHIVE_STATUS_ID : p.statusId]);
                            }}
                            className="cursor-pointer border-0 bg-transparent text-xs hover:underline whitespace-nowrap"
                            style={{ color: p.deleted ? "#a19f9d" : statusColor(p.statusId) }}
                          >● {p.deleted ? `Архів · ${p.statusName}` : p.statusName}</button>
                        </td>
                        {tab === "changed7" && (
                          <td className="px-2 py-1.5 whitespace-nowrap text-[11px]">
                            {p.statusHistory[0] ? (
                              <>
                                <span style={{ color: statusColor(p.statusHistory[0].from) }}>● {statusName(p.statusHistory[0].from)}</span>
                                <span style={{ color: "var(--text-dim)" }}> → </span>
                                <span style={{ color: statusColor(p.statusHistory[0].to) }}>● {statusName(p.statusHistory[0].to)}</span>
                              </>
                            ) : <span style={{ color: "var(--text-dim)" }}>—</span>}
                          </td>
                        )}
                        <td className="px-2 py-1.5 text-center font-semibold" style={{ color: p.imagesCount === 0 ? "#d13438" : p.imagesCount >= 3 ? "#107c10" : "#e66c37" }}>{p.imagesCount}</td>
                        <td className="px-2 py-1.5 text-center font-semibold" style={{ color: p.reviewsCount === 0 ? "var(--text-dim)" : "#107c10" }}>{p.reviewsCount}</td>
                        <td className="px-2 py-1.5 text-center font-semibold" style={{ color: p.attributesCount === 0 ? "#d13438" : p.attributesCount >= 5 ? "#107c10" : "#e66c37" }}>{p.attributesCount}</td>
                        {tab === "changed7" ? (() => {
                          // Previous-change date: take statusHistory[1] if available, else firstSeenAt.
                          // statusHistory is ordered newest-first, so [0] is the latest change (== statusChangedAt)
                          // and [1] is the one before it.
                          const prevAt = p.statusHistory[1]?.at ?? p.firstSeenAt;
                          const curAt = p.statusChangedAt ?? p.statusHistory[0]?.at ?? null;
                          let deltaText = "";
                          if (prevAt && curAt) {
                            const days = Math.round(
                              (new Date(curAt).getTime() - new Date(prevAt).getTime()) / 86400000
                            );
                            if (days >= 0) {
                              const word = days === 0 ? "сьогодні" : days === 1 ? "день" : days < 5 ? "дні" : "днів";
                              deltaText = days === 0 ? word : `${days} ${word}`;
                            }
                          }
                          const prevStatus = p.statusHistory[1]?.to ?? p.statusHistory[0]?.from ?? null;
                          return (
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              <div style={{ color: "var(--text-mid)" }}>{fmtDate(prevAt)}</div>
                              <div className="text-[10px] flex items-center gap-1" style={{ color: "var(--text-dim2)" }}>
                                {prevStatus != null && <span style={{ color: statusColor(prevStatus) }}>●</span>}
                                <span>{deltaText}</span>
                              </div>
                            </td>
                          );
                        })() : (
                          <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: "var(--text-dim)" }}>{fmtDate(p.firstSeenAt)}</td>
                        )}
                        <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: "var(--text-dim)" }}>{fmtDate(p.statusChangedAt)}</td>
                      </tr>
                    );
                  })}
                  {data.items.length === 0 && (
                    <tr><td colSpan={tab === "changed7" ? 16 : 15} className="text-center text-xs py-6" style={{ color: "var(--text-dim)" }}>
                      {data.stats.totalAll === 0
                        ? "Немає даних. Запустіть Sync щоб завантажити каталог."
                        : "Нічого не знайдено за фільтрами"}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center flex-wrap gap-2 mt-4 justify-between">
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
                <span>Рядків:</span>
                {[50, 100, 200, 500].map((n) => (
                  <button key={n} onClick={() => setLimit(n)}
                    className="px-2 py-0.5 rounded text-xs font-semibold cursor-pointer border-0"
                    style={limit === n ? { background: "#118dff", color: "#fff" } : { background: "var(--bg-input)", color: "var(--text-dim)" }}
                  >{n}</button>
                ))}
              </div>

              {data.totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button disabled={page <= 1} onClick={() => setPage(1)} className="px-2 py-1 rounded-lg text-xs cursor-pointer border disabled:opacity-30"
                    style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}>«</button>
                  <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2.5 py-1 rounded-lg text-xs cursor-pointer border disabled:opacity-30"
                    style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}>← Поп.</button>
                  <span className="text-xs px-2" style={{ color: "var(--text-mid)" }}>{page} / {data.totalPages}</span>
                  <button disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} className="px-2.5 py-1 rounded-lg text-xs cursor-pointer border disabled:opacity-30"
                    style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}>Наст. →</button>
                  <button disabled={page >= data.totalPages} onClick={() => setPage(data.totalPages)} className="px-2 py-1 rounded-lg text-xs cursor-pointer border disabled:opacity-30"
                    style={{ background: "var(--bg-input)", color: "var(--text-mid)", borderColor: "var(--border2)" }}>»</button>
                </div>
              )}

              <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                {data.total === 0 ? "0" : `${(page - 1) * limit + 1}–${Math.min(page * limit, data.total)}`} з {data.total}
              </span>
            </div>
          </>
        )}
      </Card>
      </>}

      {openBulk && (
        <BulkFilterModal
          initialType={bulk?.type ?? "code"}
          initialText={bulk?.rawText ?? ""}
          onApply={(t, ids, raw) => setBulk({ type: t, ids, rawText: raw })}
          onClose={() => setOpenBulk(false)}
        />
      )}
      {openItem != null && <ProductModal id={openItem.id} seed={openItem} onClose={() => setOpenItem(null)} />}
      {openReq && filters && <RequiredAttrsModal categories={filters.categories} onClose={() => { setOpenReq(false); loadList(); }} />}
      {openSettings && data && (
        <SettingsModal
          onClose={() => setOpenSettings(false)}
          snapshots={snapshots}
          asOf={asOf}
          onAsOfChange={setAsOf}
          syncState={data.syncState}
          syncedAt={data.syncedAt}
          onSynced={() => { loadList(); loadSnapshots(); }}
          onOpenRequired={() => setOpenReq(true)}
        />
      )}

      {/* Clipboard toast — auto-dismisses in 1.8s via useEffect */}
      {toast && (
        <div
          className="fixed z-[300] px-4 py-2 rounded-lg text-xs font-semibold shadow-lg"
          style={{
            bottom: 24, right: 24,
            background: "#107c10", color: "#fff",
            animation: "fadeIn 0.15s ease-out",
          }}
          role="status"
          aria-live="polite"
        >
          ✓ {toast}
        </div>
      )}

      {IS_DEV && data?.syncState.error && (
        <div className="mt-3 text-xs p-2 rounded-lg" style={{ background: "#d1343811", color: "#d13438", border: "1px solid #d1343844" }}>
          Sync error: {data.syncState.error}
        </div>
      )}
    </>
  );
}
