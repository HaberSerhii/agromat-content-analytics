"use client";

import { useEffect, useMemo, useState } from "react";
import { PromotionSalesDashboard } from "@/components/PromotionSalesDashboard";
import { PromotionWebFunnelDashboard } from "@/components/PromotionWebFunnelDashboard";
import type {
  PromotionCatalogRow,
  PromotionsCatalogResponse,
} from "@/lib/promotions-types";

type Section = "catalog" | "web" | "sales";
type SetFilter = Set<string> | null;
type KpiFilter =
  | "all"
  | "promotions"
  | "new_promotions"
  | "disabled_promotions"
  | "products"
  | "linked"
  | "not_site"
  | "no_photo"
  | "missing_attributes"
  | "no_reviews"
  | "no_sku";

const PAGE_SIZE = 100;
const UNLINKED = "__unlinked__";

function formatMoney(value: number | null): string {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(value)} UAH`;
}

function formatDate(value: string | null): string {
  if (!value) return "безстроково";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function shiftIsoDate(value: string, days: number): string {
  if (!value) return value;
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("Не вдалося скопіювати");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function uniqueIds(values: (string | number | null)[]): (string | number)[] {
  return [...new Set(values.filter((value): value is string | number => value != null && value !== "" && value !== 0))];
}

function downloadIdsCsv(ids: (string | number)[], filename: string) {
  triggerDownload(
    new Blob([`﻿${ids.join("\n")}`], { type: "text/csv;charset=utf-8;" }),
    filename,
  );
}

async function downloadIdsXlsx(ids: (string | number)[], filename: string, columnHeader: string) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([[columnHeader], ...ids.map((id) => [id])]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, columnHeader);
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  triggerDownload(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
  );
}

async function downloadPromotionsXlsx(rows: PromotionCatalogRow[], filename: string) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet(rows.map((row) => ({
    "Зміна": row.change ? row.change.toUpperCase() : "",
    "Код товара": row.code,
    "goods_ref": row.goodsRef,
    "Артикул": row.sku ?? "",
    "Назва": row.name,
    "Категорія": row.categoryName,
    "Бренд": row.brand,
    "Базова ціна": row.basePrice ?? "",
    "Акційна ціна": row.promoPrice ?? "",
    "% знижки": row.discountPct ?? "",
    "Залишок": row.stockQty ?? "",
    "Статус": row.statusName,
    "Фото": row.imagesCount,
    "Відгуки": row.reviewsCount,
    "Незаповнені обов'язкові атрибути": row.missingRequiredAttrsCount,
    "ID акції": row.promotionId,
    "IDINC акції": row.promotionIdinc,
    "Назва акції P2": row.promotionName,
    "Тип акції": row.promotionType,
    "Початок акції": row.promotionStartDate ?? "",
    "Кінець акції": row.promotionEndDate ?? "",
    "Попередня акція": row.previousPromotions.map((promotion) => `${promotion.idinc} · ${promotion.name}`).join(", "),
    "Назва прив'язаної акції": row.linkedPromotions.map((promotion) => promotion.name).join(", "),
    "URL акції": row.linkedPromotions.map((promotion) => promotion.url).join(", "),
    "URL товару": row.productUrl,
  })));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Акційні товари");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  triggerDownload(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
  );
}

function ExportPill({
  label,
  color,
  bg,
  busy,
  onClick,
  title,
  successLabel = "✓ Готово",
}: {
  label: string;
  color: string;
  bg: string;
  busy: boolean;
  onClick: () => void | Promise<void>;
  title: string;
  successLabel?: string;
}) {
  const [completed, setCompleted] = useState(false);
  const click = async () => {
    try {
      await onClick();
      setCompleted(true);
      window.setTimeout(() => setCompleted(false), 1500);
    } catch {
      setCompleted(false);
    }
  };
  return (
    <button
      type="button"
      onClick={click}
      title={title}
      disabled={busy}
      className="rounded-lg border-0 px-3 py-1.5 text-xs whitespace-nowrap disabled:opacity-50"
      style={{ background: bg, color }}
    >
      {busy ? "…" : completed ? successLabel : label}
    </button>
  );
}

function statusColor(name: string, stockQty: number | null): string {
  const normalized = name.toLowerCase();
  if (
    stockQty === 0
    || normalized.includes("немає")
    || normalized.includes("відсут")
    || normalized.includes("нет в наличии")
  ) return "#d13438";
  if (normalized.includes("наяв")) return "#107c10";
  if (normalized.includes("замов")) return "#118dff";
  if (normalized.includes("очіку")) return "#f7630c";
  if (normalized.includes("знято") || normalized.includes("архів")) return "#8a8886";
  return "#d13438";
}

function changeStyle(change: PromotionCatalogRow["change"]) {
  if (change === "add") return { color: "#107c10", bg: "#f1faf1", border: "#107c10", label: "ADD ↗" };
  if (change === "delete") return { color: "#d13438", bg: "#fff4f4", border: "#d13438", label: "DELETE" };
  if (change === "switch") return { color: "#8a6500", bg: "#fff9df", border: "#e0a800", label: "SWITCH" };
  return { color: "#8a8886", bg: "#fff", border: "#e1dfdd", label: "—" };
}

function Select({
  value,
  onChange,
  children,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      title={title}
      className="h-9 w-full min-w-0 rounded-lg border px-3 text-xs outline-none sm:w-auto"
      style={{ background: "var(--bg-input)", borderColor: "var(--border2)", color: "var(--text-mid)" }}
    >
      {children}
    </select>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string; hint?: string }[];
  selected: SetFilter;
  onChange: (value: SetFilter) => void;
}) {
  const allSelected = selected === null;
  const count = allSelected ? options.length : selected.size;
  const toggle = (value: string) => {
    const next = new Set(allSelected ? options.map((option) => option.value) : selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next.size === options.length ? null : next);
  };

  return (
    <details className="relative w-full sm:w-auto">
      <summary
        className="flex h-9 w-full min-w-0 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border px-3 text-xs sm:min-w-[220px] sm:max-w-[330px]"
        style={{ background: "var(--bg-input)", borderColor: "var(--border2)", color: "var(--text-mid)" }}
      >
        <span className="truncate">{label}: {allSelected ? "усі" : count}</span>
        <span style={{ color: "var(--text-muted)" }}>▾</span>
      </summary>
      <div
        className="absolute left-0 z-50 mt-1 w-[min(390px,calc(100vw-2rem))] rounded-xl border p-2 shadow-xl"
        style={{ background: "#fff", borderColor: "var(--border2)" }}
      >
        <div className="flex gap-2 border-b pb-2 mb-1" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-md px-2 py-1 text-[11px] font-semibold"
            style={{ background: "#e8f4ff", color: "#0078d4" }}
          >
            Вибрати всі
          </button>
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="rounded-md px-2 py-1 text-[11px] font-semibold"
            style={{ background: "var(--bg-input)", color: "var(--text-dim)" }}
          >
            Очистити
          </button>
        </div>
        <div className="max-h-72 overflow-auto">
          {options.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={allSelected || selected.has(option.value)}
                onChange={() => toggle(option.value)}
                className="mt-0.5"
              />
              <span className="min-w-0 text-xs" style={{ color: "var(--text-mid)" }}>
                <span className="block truncate">{option.label}</span>
                {option.hint && <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>{option.hint}</span>}
              </span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

function SummaryCard({
  value,
  label,
  detail,
  color,
  active,
  onClick,
}: {
  value: number;
  label: string;
  detail?: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="min-w-0 rounded-xl border px-3 py-4 text-center transition-colors"
      style={{
        background: active ? `${color}12` : "#f7f7f7",
        borderColor: active ? color : "var(--border2)",
        boxShadow: active ? `inset 0 0 0 1px ${color}33` : "none",
      }}
    >
      <div className="text-base font-extrabold tabular-nums" style={{ color }}>
        {new Intl.NumberFormat("uk-UA").format(value)}
      </div>
      <div className="mt-1 text-[10px] leading-4" style={{ color: "var(--text-dim)" }}>
        {label}
      </div>
      {detail && (
        <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>
          {detail}
        </div>
      )}
    </button>
  );
}

export function PromotionsDashboard() {
  const [section, setSection] = useState<Section>("catalog");
  const [data, setData] = useState<PromotionsCatalogResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [brand, setBrand] = useState("all");
  const [price, setPrice] = useState("all");
  const [stock, setStock] = useState("all");
  const [photo, setPhoto] = useState("all");
  const [attributes, setAttributes] = useState("all");
  const [reviews, setReviews] = useState("all");
  const [sku, setSku] = useState("all");
  const [statuses, setStatuses] = useState<SetFilter>(null);
  const [selectedPromotions, setSelectedPromotions] = useState<SetFilter>(null);
  const [selectedLinks, setSelectedLinks] = useState<SetFilter>(null);
  const [page, setPage] = useState(1);
  const [exportBusy, setExportBusy] = useState(false);
  const [kpiFilter, setKpiFilter] = useState<KpiFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/promotions/catalog", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити акції");
        if (!cancelled) {
          const nextData = payload as PromotionsCatalogResponse;
          setData(nextData);
          setDateFrom((current) => current || nextData.today);
          setDateTo((current) => current || nextData.today);
          setError("");
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Не вдалося завантажити акції");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const facets = useMemo(() => {
    const items = data?.items ?? [];
    const categories = new Map<number, string>();
    const brands = new Set<string>();
    const statusMap = new Map<number, string>();
    for (const item of items) {
      if (item.categoryId != null) categories.set(item.categoryId, item.categoryName);
      if (item.brand !== "—") brands.add(item.brand);
      statusMap.set(item.statusId, item.statusName);
    }
    return {
      categories: [...categories.entries()].sort((a, b) => a[1].localeCompare(b[1], "uk")),
      brands: [...brands].sort((a, b) => a.localeCompare(b, "uk")),
      statuses: [...statusMap.entries()].sort((a, b) => a[1].localeCompare(b[1], "uk")),
    };
  }, [data]);

  const promotionOptions = useMemo(() => (data?.promotions ?? []).map((promotion) => ({
    value: String(promotion.idinc),
    label: `${promotion.idinc} · ${promotion.name}`,
    hint: `${promotion.type} · ${promotion.productCount} товарів · ${formatDate(promotion.startDate)}–${formatDate(promotion.endDate)}`,
  })), [data]);

  const linkOptions = useMemo(() => [
    { value: UNLINKED, label: "Без прив’язки до URL", hint: "Акційна ціна є, сторінки акції на сайті немає" },
    ...(data?.linkedPromotions ?? []).map((promotion) => ({
      value: String(promotion.idinc),
      label: `${promotion.idinc} · ${promotion.name}`,
      hint: promotion.url,
    })),
  ], [data]);

  const baseFiltered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (data?.items ?? []).filter((item) => {
      if (dateTo && item.promotionStartDate && item.promotionStartDate > dateTo) return false;
      if (dateFrom && item.promotionEndDate && item.promotionEndDate < dateFrom) return false;
      if (normalizedSearch && ![
        item.name,
        item.sku ?? "",
        String(item.code),
        String(item.goodsRef),
        String(item.productId),
        item.promotionName,
        String(item.promotionId),
        String(item.promotionIdinc),
      ].some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch))) return false;
      if (category !== "all" && item.categoryId !== Number(category)) return false;
      if (brand !== "all" && item.brand !== brand) return false;
      if (price === "under1000" && !(item.promoPrice != null && item.promoPrice < 1000)) return false;
      if (price === "1000to5000" && !(item.promoPrice != null && item.promoPrice >= 1000 && item.promoPrice <= 5000)) return false;
      if (price === "over5000" && !(item.promoPrice != null && item.promoPrice > 5000)) return false;
      if (stock === "positive" && !(item.stockQty != null && item.stockQty > 0)) return false;
      if (stock === "zero" && item.stockQty !== 0) return false;
      if (photo === "none" && (!item.onSite || item.imagesCount !== 0)) return false;
      if (photo === "lt2" && (!item.onSite || item.imagesCount >= 2)) return false;
      if (attributes === "none" && item.attributesCount !== 0) return false;
      if (attributes === "missing" && item.missingRequiredAttrsCount === 0) return false;
      if (reviews === "yes" && item.reviewsCount === 0) return false;
      if (reviews === "no" && item.reviewsCount > 0) return false;
      if (sku === "yes" && !item.sku) return false;
      if (sku === "no" && item.sku) return false;
      if (statuses !== null && !statuses.has(String(item.statusId))) return false;
      if (selectedPromotions !== null && !selectedPromotions.has(String(item.promotionIdinc))) return false;
      if (selectedLinks !== null) {
        if (item.linkedPromotions.length === 0 && !selectedLinks.has(UNLINKED)) return false;
        if (item.linkedPromotions.length > 0 && !item.linkedPromotions.some((link) => selectedLinks.has(String(link.idinc)))) return false;
      }
      return true;
    });
  }, [
    attributes, brand, category, data, dateFrom, dateTo, photo, price, reviews, search,
    selectedLinks, selectedPromotions, sku, statuses, stock,
  ]);

  const summary = useMemo(() => {
    const currentRows = baseFiltered.filter((item) => item.change !== "delete");
    const countUnique = (predicate: (item: PromotionCatalogRow) => boolean) =>
      new Set(currentRows.filter(predicate).map((item) => item.productId)).size;
    const representedPromotions = new Set(currentRows.map((item) => item.promotionIdinc));
    const representedOptions = (data?.promotions ?? []).filter((promotion) =>
      representedPromotions.has(promotion.idinc),
    );
    return {
      promotions: representedPromotions.size,
      products: countUnique(() => true),
      positions: currentRows.length,
      linkedProducts: countUnique((item) => item.linkedPromotions.length > 0),
      notOnSite: countUnique((item) => item.onSite === false),
      newPromotions: representedOptions.filter((promotion) => promotion.isNew).length,
      disabledPromotions: representedOptions.filter((promotion) => !promotion.active).length,
      noPhoto: countUnique((item) => item.onSite && item.imagesCount === 0),
      missingAttributes: countUnique((item) =>
        item.onSite && item.missingRequiredAttrsCount > 0),
      noReviews: countUnique((item) => item.onSite && item.reviewsCount === 0),
      noSku: countUnique((item) => item.onSite && !item.sku),
    };
  }, [baseFiltered, data]);

  const filtered = useMemo(() => {
    if (kpiFilter === "all") return baseFiltered;
    const promotions = new Map((data?.promotions ?? []).map((promotion) => [promotion.idinc, promotion]));
    return baseFiltered.filter((item) => {
      if (item.change === "delete") return false;
      const promotion = promotions.get(item.promotionIdinc);
      switch (kpiFilter) {
        case "promotions":
        case "products":
          return true;
        case "new_promotions":
          return promotion?.isNew === true;
        case "disabled_promotions":
          return promotion?.active === false;
        case "linked":
          return item.linkedPromotions.length > 0;
        case "not_site":
          return item.onSite === false;
        case "no_photo":
          return item.onSite && item.imagesCount === 0;
        case "missing_attributes":
          return item.onSite && item.missingRequiredAttrsCount > 0;
        case "no_reviews":
          return item.onSite && item.reviewsCount === 0;
        case "no_sku":
          return item.onSite && !item.sku;
        default:
          return true;
      }
    });
  }, [baseFiltered, data, kpiFilter]);

  useEffect(() => { setPage(1); }, [
    attributes, brand, category, dateFrom, dateTo, photo, price, reviews, search,
    selectedLinks, selectedPromotions, sku, statuses, stock, kpiFilter,
  ]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const exportDate = () => new Date().toISOString().slice(0, 10);
  const withExportBusy = async (action: () => void | Promise<void>) => {
    setExportBusy(true);
    try {
      await action();
    } finally {
      setExportBusy(false);
    }
  };
  const goodsRefs = () => uniqueIds(filtered.map((item) => item.goodsRef));
  const productCodes = () => uniqueIds(filtered.map((item) => item.code));

  const clearFilters = () => {
    setSearch("");
    setCategory("all");
    setBrand("all");
    setPrice("all");
    setStock("all");
    setPhoto("all");
    setAttributes("all");
    setReviews("all");
    setSku("all");
    setStatuses(null);
    setSelectedPromotions(null);
    setSelectedLinks(null);
    setKpiFilter("all");
    setDateFrom(data?.today ?? "");
    setDateTo(data?.today ?? "");
  };
  const toggleKpiFilter = (value: KpiFilter) => {
    setKpiFilter((current) => current === value ? "all" : value);
  };
  const changeDateFrom = (value: string) => {
    setDateFrom(value);
    if (dateTo && value > dateTo) setDateTo(value);
  };
  const changeDateTo = (value: string) => {
    setDateTo(value);
    if (dateFrom && value < dateFrom) setDateFrom(value);
  };
  const shiftDateRange = (days: number) => {
    setDateFrom((current) => shiftIsoDate(current, days));
    setDateTo((current) => shiftIsoDate(current, days));
  };

  return (
    <div className="space-y-3">
      <div
        className="rounded-2xl border p-3 sm:p-5"
        style={{ background: "var(--bg-card)", borderColor: "#118dff44", boxShadow: "var(--shadow-sm)" }}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>
            Акційні пропозиції. {section === "catalog"
              ? "Каталог."
              : section === "web"
                ? "Веб-метрики."
                : "Продажі."}
          </div>
          <div
            className="grid w-full grid-cols-3 gap-1 rounded-xl border p-0.5 lg:w-auto"
            style={{ background: "var(--bg-input)", borderColor: "var(--border2)" }}
          >
            {([
              ["catalog", "Аналіз каталогу", "Каталог"],
              ["web", "Аналіз веб-метрик", "Веб-метрики"],
              ["sales", "Аналіз продажів", "Продажі"],
            ] as [Section, string, string][]).map(([value, label, shortLabel]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSection(value)}
                className="min-w-0 rounded-lg border-0 px-1.5 py-1.5 text-[11px] font-semibold sm:px-3 sm:text-xs"
                style={section === value
                  ? { background: "#118dff", color: "#fff" }
                  : { background: "transparent", color: "var(--text-dim)" }}
              >
                <span className="sm:hidden">{shortLabel}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {section === "catalog" && (
          <>
            <div className="mt-3 grid w-full grid-cols-[36px_minmax(0,1fr)_minmax(0,1fr)_36px] items-end justify-end gap-2 sm:flex">
            <button
              type="button"
              aria-label="Попередній день"
              title="Зсунути період на день назад"
              onClick={() => shiftDateRange(-1)}
              disabled={!dateFrom || !dateTo}
              className="mb-0.5 h-9 w-9 rounded-lg border text-lg font-bold disabled:opacity-40"
              style={{ background: "var(--bg-input)", borderColor: "var(--border2)", color: "var(--text-mid)" }}
            >
              ←
            </button>
            <label className="block min-w-0">
              <span className="mb-1 block text-[9px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>
                Дата від
              </span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(event) => changeDateFrom(event.target.value)}
                className="h-9 w-full min-w-0 rounded-lg border px-2 text-xs font-semibold sm:px-3"
                style={{ background: "var(--bg-input)", borderColor: "var(--border2)", color: "var(--text)" }}
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[9px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>
                Дата до
              </span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(event) => changeDateTo(event.target.value)}
                className="h-9 w-full min-w-0 rounded-lg border px-2 text-xs font-semibold sm:px-3"
                style={{ background: "var(--bg-input)", borderColor: "var(--border2)", color: "var(--text)" }}
              />
            </label>
            <button
              type="button"
              aria-label="Наступний день"
              title="Зсунути період на день вперед"
              onClick={() => shiftDateRange(1)}
              disabled={!dateFrom || !dateTo}
              className="mb-0.5 h-9 w-9 rounded-lg border text-lg font-bold disabled:opacity-40"
              style={{ background: "var(--bg-input)", borderColor: "var(--border2)", color: "var(--text-mid)" }}
            >
              →
            </button>
          </div>

            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
              <SummaryCard
                value={summary.promotions}
                label="Кількість акцій"
                detail="Актуальні за датами"
                color="#118dff"
                active={kpiFilter === "promotions"}
                onClick={() => toggleKpiFilter("promotions")}
              />
              <SummaryCard
                value={summary.newPromotions}
                label="Нові акції"
                detail="Після стартового baseline"
                color="#118dff"
                active={kpiFilter === "new_promotions"}
                onClick={() => toggleKpiFilter("new_promotions")}
              />
              <SummaryCard
                value={summary.disabledPromotions}
                label="Вимкнені акції"
                detail="active=false у P2"
                color="#d13438"
                active={kpiFilter === "disabled_promotions"}
                onClick={() => toggleKpiFilter("disabled_promotions")}
              />
              <SummaryCard
                value={summary.products}
                label="Товарів в акції / акціях"
                detail={`${new Intl.NumberFormat("uk-UA").format(summary.positions)} акційних позицій`}
                color="#118dff"
                active={kpiFilter === "products"}
                onClick={() => toggleKpiFilter("products")}
              />
              <SummaryCard
                value={summary.linkedProducts}
                label="Товарів у прив’язаних акціях"
                detail="Є discount URL"
                color="#107c10"
                active={kpiFilter === "linked"}
                onClick={() => toggleKpiFilter("linked")}
              />
              <SummaryCard
                value={summary.notOnSite}
                label="Товарів немає на сайті"
                detail="deleted або немає даних"
                color="#d13438"
                active={kpiFilter === "not_site"}
                onClick={() => toggleKpiFilter("not_site")}
              />
              <SummaryCard
                value={summary.noPhoto}
                label="Без фото"
                detail="Серед товарів на сайті"
                color="#e66c37"
                active={kpiFilter === "no_photo"}
                onClick={() => toggleKpiFilter("no_photo")}
              />
              <SummaryCard
                value={summary.missingAttributes}
                label="Незаповнені обов’язкові атрибути"
                detail="Серед товарів на сайті"
                color="#e66c37"
                active={kpiFilter === "missing_attributes"}
                onClick={() => toggleKpiFilter("missing_attributes")}
              />
              <SummaryCard
                value={summary.noReviews}
                label="Без відгуків"
                detail="Серед товарів на сайті"
                color="#8a8886"
                active={kpiFilter === "no_reviews"}
                onClick={() => toggleKpiFilter("no_reviews")}
              />
              <SummaryCard
                value={summary.noSku}
                label="Без артикулу"
                detail="Серед товарів на сайті"
                color="#e66c37"
                active={kpiFilter === "no_sku"}
                onClick={() => toggleKpiFilter("no_sku")}
              />
            </div>
          </>
        )}
      </div>

      {section === "web" && (
        <PromotionWebFunnelDashboard
          suggestedUrls={(data?.linkedPromotions ?? []).map((promotion) => ({
            name: promotion.name,
            url: promotion.url,
          }))}
        />
      )}
      {section === "sales" && <PromotionSalesDashboard />}

      {section === "catalog" && (
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}
        >
          <div className="p-3 border-b space-y-2" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs font-bold" style={{ color: "var(--text-mid)" }}>
                {data ? `${filtered.length} товарних позицій` : "Завантаження…"}
              </span>
              <span className="ml-auto text-[11px]" style={{ color: "var(--text-muted)" }}>
                {data ? `${summary.promotions} акцій у періоді · baseline ${formatDate(data.baselineCapturedAt.slice(0, 10))}` : ""}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Пошук: назва, code, sku, goods_ref, ID акції…"
                className="col-span-2 h-9 w-full min-w-0 flex-1 rounded-lg border px-3 text-xs outline-none sm:col-span-1 sm:min-w-[290px]"
                style={{ background: "var(--bg-input)", borderColor: "var(--border2)" }}
              />
              <Select value={category} onChange={setCategory}>
                <option value="all">Всі категорії</option>
                {facets.categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </Select>
              <Select value={brand} onChange={setBrand}>
                <option value="all">Всі бренди</option>
                {facets.brands.map((name) => <option key={name} value={name}>{name}</option>)}
              </Select>
              <Select value={price} onChange={setPrice}>
                <option value="all">Ціна: всі</option>
                <option value="under1000">до 1 000 UAH</option>
                <option value="1000to5000">1 000–5 000 UAH</option>
                <option value="over5000">понад 5 000 UAH</option>
              </Select>
              <Select value={stock} onChange={setStock}>
                <option value="all">Залишок: всі</option>
                <option value="positive">Є залишок</option>
                <option value="zero">Нульовий</option>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <MultiSelect
                label="Акції P2"
                options={promotionOptions}
                selected={selectedPromotions}
                onChange={setSelectedPromotions}
              />
              <MultiSelect
                label="Прив’язані акції / URL"
                options={linkOptions}
                selected={selectedLinks}
                onChange={setSelectedLinks}
              />
              <MultiSelect
                label="Статуси"
                options={facets.statuses.map(([id, name]) => ({ value: String(id), label: name }))}
                selected={statuses}
                onChange={setStatuses}
              />
              <Select value={photo} onChange={setPhoto}>
                <option value="all">Фото: всі</option>
                <option value="none">Без фото</option>
                <option value="lt2">Менше 2 фото</option>
              </Select>
              <Select value={attributes} onChange={setAttributes}>
                <option value="all">Атрибути: всі</option>
                <option value="none">Без атрибутів</option>
                <option value="missing">Не заповнені обов’язкові</option>
              </Select>
              <Select value={reviews} onChange={setReviews}>
                <option value="all">Відгуки: всі</option>
                <option value="yes">Є відгуки</option>
                <option value="no">Без відгуків</option>
              </Select>
              <Select value={sku} onChange={setSku}>
                <option value="all">Артикул: всі</option>
                <option value="yes">Є артикул</option>
                <option value="no">Без артикулу</option>
              </Select>
              <button
                type="button"
                onClick={clearFilters}
                className="h-9 w-full rounded-lg border px-3 text-xs font-semibold sm:w-auto"
                style={{ borderColor: "var(--border2)", color: "var(--text-dim)" }}
              >
                Скинути
              </button>
            </div>
          </div>

          <div
            className="m-3 rounded-xl p-3"
            style={{
              border: "1px solid #93c5fd",
              background: "#eff6ff",
              boxShadow: "inset 0 0 0 1px rgba(147,197,253,0.2)",
            }}
          >
            <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "#1e40af" }}>
                ● Аналітика
              </div>
              <span className="text-[10px] tabular-nums" style={{ color: "#3b82f6" }}>
                {filtered.length} товарних позицій у вибірці
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#1e3a8a" }}>Goods_ref:</span>
              <ExportPill
                label="↓ CSV"
                color="#107c10"
                bg="rgba(16,185,129,0.12)"
                busy={exportBusy}
                successLabel="✓ Завантажено"
                onClick={() => withExportBusy(() => downloadIdsCsv(goodsRefs(), `promo-goods_ref-${exportDate()}.csv`))}
                title="Завантажити унікальні goods_ref поточної вибірки у CSV"
              />
              <ExportPill
                label="↓ Excel"
                color="#107c10"
                bg="rgba(16,185,129,0.12)"
                busy={exportBusy}
                successLabel="✓ Завантажено"
                onClick={() => withExportBusy(() => downloadIdsXlsx(goodsRefs(), `promo-goods_ref-${exportDate()}.xlsx`, "goods_ref"))}
                title="Завантажити унікальні goods_ref поточної вибірки у Excel"
              />
              <ExportPill
                label="Regex"
                color="#e66c37"
                bg="rgba(245,158,11,0.12)"
                busy={exportBusy}
                successLabel="✓ Скопійовано"
                onClick={() => withExportBusy(() => copyText(goodsRefs().join("|")))}
                title="Скопіювати goods_ref у форматі id1|id2|…"
              />

              <span className="w-full text-[10px] font-bold uppercase tracking-wider sm:ml-3 sm:w-auto" style={{ color: "#1e3a8a" }}>IDD:</span>
              <ExportPill
                label="↓ CSV"
                color="#107c10"
                bg="rgba(16,185,129,0.12)"
                busy={exportBusy}
                successLabel="✓ Завантажено"
                onClick={() => withExportBusy(() => downloadIdsCsv(productCodes(), `promo-kod-tovara-${exportDate()}.csv`))}
                title="Завантажити унікальні коди товарів поточної вибірки у CSV"
              />
              <ExportPill
                label="↓ Excel"
                color="#107c10"
                bg="rgba(16,185,129,0.12)"
                busy={exportBusy}
                successLabel="✓ Завантажено"
                onClick={() => withExportBusy(() => downloadIdsXlsx(productCodes(), `promo-kod-tovara-${exportDate()}.xlsx`, "Код товара"))}
                title="Завантажити унікальні коди товарів поточної вибірки у Excel"
              />
              <ExportPill
                label="Regex"
                color="#e66c37"
                bg="rgba(245,158,11,0.12)"
                busy={exportBusy}
                successLabel="✓ Скопійовано"
                onClick={() => withExportBusy(() => copyText(productCodes().join("|")))}
                title="Скопіювати коди товарів у форматі id1|id2|…"
              />

              <span className="w-full text-[10px] font-bold uppercase tracking-wider sm:ml-3 sm:w-auto" style={{ color: "#1e3a8a" }}>Повна аналітика:</span>
              <ExportPill
                label="↓ Excel"
                color="#3730a3"
                bg="rgba(99,102,241,0.18)"
                busy={exportBusy}
                successLabel="✓ Завантажено"
                onClick={() => withExportBusy(() => downloadPromotionsXlsx(filtered, `promotions-full-${exportDate()}.xlsx`))}
                title="Excel з усіма товарами, цінами, акціями та URL поточної вибірки"
              />
            </div>
          </div>

          {loading && (
            <div className="px-6 py-16 text-center text-sm font-semibold" style={{ color: "var(--text-dim)" }}>
              Завантажуємо актуальні акції та порівнюємо зі стартовим складом…
            </div>
          )}
          {!loading && error && (
            <div className="px-6 py-12 text-center">
              <div className="font-bold" style={{ color: "#d13438" }}>Не вдалося завантажити дані</div>
              <div className="mt-2 text-xs" style={{ color: "var(--text-dim)" }}>{error}</div>
            </div>
          )}
          {!loading && !error && (
            <>
              <div className="divide-y lg:hidden" style={{ borderColor: "var(--border)" }}>
                {visibleItems.map((item) => {
                  const style = changeStyle(item.change);
                  const isMissing = kpiFilter === "not_site";
                  return (
                    <article
                      key={item.key}
                      className="p-3"
                      style={{
                        background: isMissing ? "#fff6f6" : style.bg,
                        borderColor: "var(--border)",
                        borderLeft: `3px solid ${isMissing ? "#d13438" : style.border}`,
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-[10px] font-extrabold" style={{ color: isMissing ? "#d13438" : style.color }}>
                          {isMissing ? "НЕМАЄ НА САЙТІ" : style.label}
                        </span>
                        <span className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                          goods_ref: {item.goodsRef || "—"}
                        </span>
                        <span
                          className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                          style={(item.stockQty ?? 0) > 0
                            ? { background: "#e5f3e5", color: "#107c10" }
                            : { background: "#fde8e8", color: "#a4262c" }}
                        >
                          Залишок: {item.stockQty ?? "—"}
                        </span>
                      </div>

                      <div className="mt-2 flex items-start gap-2">
                        <span className="shrink-0 text-xs font-extrabold" style={{ color: "#0078d4" }}>
                          {item.code || `ID ${item.productId}`}
                        </span>
                        <div className="min-w-0 text-xs font-semibold leading-4">
                          {item.productUrl && !isMissing ? (
                            <a href={item.productUrl} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--text)" }}>
                              {item.name}
                            </a>
                          ) : (
                            <span style={{ color: "var(--text-mid)" }}>{item.name || "Дані товару відсутні"}</span>
                          )}
                        </div>
                      </div>

                      {!isMissing && (
                        <>
                          <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg p-2 text-[10px]" style={{ background: "rgba(255,255,255,.72)" }}>
                            <div>
                              <span style={{ color: "var(--text-muted)" }}>Ціна</span>
                              <div className="font-bold" style={{ color: "var(--text)" }}>{formatMoney(item.basePrice)}</div>
                            </div>
                            <div className="text-right">
                              <span style={{ color: "var(--text-muted)" }}>Акційна</span>
                              <div className="font-extrabold" style={{ color: "#d13438" }}>
                                {formatMoney(item.promoPrice)}{item.discountPct == null ? "" : ` · −${item.discountPct}%`}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <span style={{ color: "var(--text-muted)" }}>Категорія / бренд</span>
                              <div className="truncate font-semibold" title={`${item.categoryName} · ${item.brand}`}>
                                {[item.categoryName, item.brand].filter(Boolean).join(" · ") || "—"}
                              </div>
                            </div>
                            <div className="text-right">
                              <span style={{ color: "var(--text-muted)" }}>Статус</span>
                              <div className="truncate font-semibold" style={{ color: statusColor(item.statusName, item.stockQty) }}>
                                ● {item.statusName}
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      <div className="mt-2 border-t pt-2 text-[10px] leading-4" style={{ borderColor: "var(--border)" }}>
                        <div className="font-semibold" style={{ color: "var(--text)" }}>
                          {item.promotionId} / {item.promotionIdinc} · {item.promotionName}
                        </div>
                        <div style={{ color: "var(--text-muted)" }}>
                          {item.promotionType} · {formatDate(item.promotionStartDate)}–{formatDate(item.promotionEndDate)}
                        </div>
                        {item.linkedPromotions.map((promotion) => (
                          <a
                            key={promotion.idinc}
                            href={promotion.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block truncate font-semibold hover:underline"
                            style={{ color: "#0078d4" }}
                          >
                            {promotion.name} ↗
                          </a>
                        ))}
                      </div>
                    </article>
                  );
                })}
                {visibleItems.length === 0 && (
                  <div className="px-4 py-12 text-center text-sm" style={{ color: "var(--text-dim)" }}>
                    За вибраними фільтрами товарів немає.
                  </div>
                )}
              </div>

              <div className="hidden overflow-auto lg:block" style={{ maxHeight: "calc(100vh - 300px)" }}>
                <table className="w-full min-w-[2050px] border-collapse text-xs">
                  <thead className="sticky top-0 z-10" style={{ background: "#fafafa" }}>
                    <tr style={{ color: "var(--text-dim)" }}>
                      {[
                        "Зміна", "IDD / Код товара", "goods_ref", "Артикул", "Назва", "Категорія", "Бренд",
                        "Базова ціна", "Акційна ціна", "% знижки", "Залишок", "Статус", "Фото",
                        "Відгук.", "Атриб.", "ID / IDINC акції", "Назва акції P2", "URL акції",
                      ].map((heading) => (
                        <th key={heading} className="border-b px-2 py-2 text-left font-semibold whitespace-nowrap" style={{ borderColor: "var(--border2)" }}>
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => {
                      const style = changeStyle(item.change);
                      if (kpiFilter === "not_site") {
                        return (
                          <tr
                            key={item.key}
                            style={{ background: "#fff6f6", borderLeft: "3px solid #d13438" }}
                          >
                            <td className="border-b px-2 py-2" style={{ borderColor: "var(--border)" }}>—</td>
                            <td className="border-b px-2 py-2 font-extrabold whitespace-nowrap" style={{ borderColor: "var(--border)", color: item.code ? "var(--text)" : "#d13438" }}>
                              {item.code || `IDD немає · ID ${item.productId}`}
                            </td>
                            {Array.from({ length: 13 }, (_, index) => (
                              <td key={index} className="border-b px-2 py-2" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>—</td>
                            ))}
                            <td className="border-b px-2 py-2 whitespace-nowrap" style={{ borderColor: "var(--border)" }}>
                              <span className="font-bold">{item.promotionId}</span>
                              <span style={{ color: "var(--text-muted)" }}> / {item.promotionIdinc}</span>
                            </td>
                            <td className="border-b px-2 py-2 min-w-[290px]" style={{ borderColor: "var(--border)" }}>
                              <span className="block font-semibold">{item.promotionName}</span>
                              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                                {item.promotionType} · {formatDate(item.promotionStartDate)}–{formatDate(item.promotionEndDate)}
                              </span>
                            </td>
                            <td className="border-b px-2 py-2" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>—</td>
                          </tr>
                        );
                      }
                      return (
                        <tr
                          key={item.key}
                          style={{ background: style.bg, borderLeft: `3px solid ${style.border}` }}
                          className="hover:brightness-[0.985]"
                        >
                          <td className="border-b px-2 py-2 font-extrabold whitespace-nowrap" style={{ borderColor: "var(--border)", color: style.color }}>
                            {style.label}
                          </td>
                          <td className="border-b px-2 py-2 whitespace-nowrap" style={{ borderColor: "var(--border)" }}>{item.code}</td>
                          <td className="border-b px-2 py-2 whitespace-nowrap" style={{ borderColor: "var(--border)" }}>{item.goodsRef}</td>
                          <td className="border-b px-2 py-2 max-w-[130px] truncate" style={{ borderColor: "var(--border)" }}>{item.sku ?? "—"}</td>
                          <td className="border-b px-2 py-2 max-w-[330px]" style={{ borderColor: "var(--border)" }}>
                            <a href={item.productUrl} target="_blank" rel="noreferrer" className="block truncate no-underline hover:underline" style={{ color: "var(--text)" }} title={item.name}>
                              {item.name}
                            </a>
                          </td>
                          <td className="border-b px-2 py-2 max-w-[230px] truncate" title={item.categoryName} style={{ borderColor: "var(--border)" }}>{item.categoryName}</td>
                          <td className="border-b px-2 py-2 max-w-[150px] truncate" style={{ borderColor: "var(--border)" }}>{item.brand}</td>
                          <td className="border-b px-2 py-2 whitespace-nowrap" style={{ borderColor: "var(--border)" }}>{formatMoney(item.basePrice)}</td>
                          <td className="border-b px-2 py-2 font-bold whitespace-nowrap" style={{ borderColor: "var(--border)", color: "#d13438" }}>{formatMoney(item.promoPrice)}</td>
                          <td className="border-b px-2 py-2 font-bold whitespace-nowrap" style={{ borderColor: "var(--border)", color: item.discountPct ? "#107c10" : "var(--text-dim)" }}>
                            {item.discountPct == null ? "—" : `${item.discountPct}%`}
                          </td>
                          <td className="border-b px-2 py-2 text-center font-bold" style={{ borderColor: "var(--border)", color: (item.stockQty ?? 0) > 0 ? "#107c10" : "#d13438" }}>
                            {item.stockQty ?? "—"}
                          </td>
                          <td className="border-b px-2 py-2 whitespace-nowrap font-semibold" style={{ borderColor: "var(--border)", color: statusColor(item.statusName, item.stockQty) }}>
                            ● {item.statusName}
                          </td>
                          <td className="border-b px-2 py-2 text-center" style={{ borderColor: "var(--border)", color: item.imagesCount === 0 ? "#d13438" : "#107c10" }}>{item.imagesCount}</td>
                          <td className="border-b px-2 py-2 text-center" style={{ borderColor: "var(--border)" }}>{item.reviewsCount}</td>
                          <td
                            className="border-b px-2 py-2 text-center"
                            title={item.missingRequiredAttrsCount ? `Не заповнено обов’язкових: ${item.missingRequiredAttrsCount}` : `${item.attributesCount} атрибутів`}
                            style={{ borderColor: "var(--border)", color: item.missingRequiredAttrsCount ? "#d13438" : "#107c10" }}
                          >
                            {item.missingRequiredAttrsCount || 0}
                          </td>
                          <td className="border-b px-2 py-2 whitespace-nowrap" style={{ borderColor: "var(--border)" }}>
                            <span className="font-bold">{item.promotionId}</span>
                            <span style={{ color: "var(--text-muted)" }}> / {item.promotionIdinc}</span>
                          </td>
                          <td className="border-b px-2 py-2 min-w-[290px]" style={{ borderColor: "var(--border)" }}>
                            {item.change === "switch" && item.previousPromotions.length > 0 && (
                              <span className="block text-[10px] font-semibold" style={{ color: "#8a6500" }}>
                                {item.previousPromotions.map((promotion) => `${promotion.idinc} · ${promotion.name}`).join(", ")} →
                              </span>
                            )}
                            <span className="block font-semibold">{item.promotionName}</span>
                            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                              {item.promotionType} · {formatDate(item.promotionStartDate)}–{formatDate(item.promotionEndDate)}
                            </span>
                          </td>
                          <td className="border-b px-2 py-2 min-w-[250px]" style={{ borderColor: "var(--border)" }}>
                            {item.linkedPromotions.length === 0 ? (
                              <span style={{ color: "var(--text-muted)" }}>Не прив’язана</span>
                            ) : item.linkedPromotions.map((promotion) => (
                              <a
                                key={promotion.idinc}
                                href={promotion.url}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate no-underline hover:underline"
                                style={{ color: "#0078d4" }}
                                title={promotion.url}
                              >
                                {promotion.idinc} · {promotion.name} ↗
                              </a>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {visibleItems.length === 0 && (
                  <div className="px-6 py-12 text-center text-sm" style={{ color: "var(--text-dim)" }}>
                    За вибраними фільтрами товарів немає.
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 border-t px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
                <span>Показано {visibleItems.length} із {filtered.length} товарних позицій</span>
                <div className="flex items-center justify-between gap-2 sm:justify-start">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    className="rounded-md border px-2 py-1 disabled:opacity-40"
                    style={{ borderColor: "var(--border2)" }}
                  >
                    ←
                  </button>
                  <span>{page} / {pageCount}</span>
                  <button
                    type="button"
                    disabled={page >= pageCount}
                    onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                    className="rounded-md border px-2 py-1 disabled:opacity-40"
                    style={{ borderColor: "var(--border2)" }}
                  >
                    →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
