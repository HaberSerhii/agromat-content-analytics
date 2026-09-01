"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONTENT_REVIEW_MANAGERS,
  type ContentReviewManager,
} from "@/lib/content-review-types";
import type {
  SearchAnalyticsResponse,
  SearchAnalyticsRow,
  SearchQueryExclusionReason,
  SearchQueryProduct,
  SearchQueryProcessing,
  SearchQueryStatus,
} from "@/lib/search-analytics-types";

const EMPTY_RESPONSE: SearchAnalyticsResponse = {
  rows: [],
  total: 0,
  page: 1,
  limit: 25,
  totalPages: 1,
  updatedAt: "",
  periodFrom: "",
  periodTo: "",
  testMode: false,
  stats: {
    uniqueQueries: 0,
    searchEvents: 0,
    pendingQueries: 0,
    processedQueries: 0,
    garbageQueries: 0,
    involvedProducts: 0,
    productsInStock: 0,
    productsOutOfStock: 0,
  },
  sourceStats: {
    bigQueryQueries: 0,
    bigQueryEvents: 0,
    multisearchFoundQueries: 0,
    multisearchFoundEvents: 0,
    multisearchNoResultsQueries: 0,
    multisearchNoResultsEvents: 0,
    sheetMappings: 0,
  },
  warnings: [],
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("uk-UA").format(value || 0);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function formatMonth(value: string): string {
  const label = new Intl.DateTimeFormat("uk-UA", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}-01T12:00:00`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const STATUS_META: Record<
  SearchQueryStatus,
  { label: string; color: string; background: string }
> = {
  new: { label: "Новий", color: "#0b6fc2", background: "#eaf5ff" },
  processed: {
    label: "Опрацьовано",
    color: "#087a55",
    background: "#eaf7f1",
  },
  garbage: {
    label: "Ідентифікатор / сміття",
    color: "#68737e",
    background: "#eef1f3",
  },
  deleted: {
    label: "Видалено",
    color: "#b23a46",
    background: "#fff0f1",
  },
  "brand-not-found": {
    label: "Бренд не знайдено",
    color: "#a56a0b",
    background: "#fff6e5",
  },
};

const SOURCE_META = {
  bigquery: { label: "BQ", tone: "#6d5bd0" },
  "multisearch-found": { label: "MS є", tone: "#159b6c" },
  "multisearch-no-results": { label: "MS 0", tone: "#dc5a64" },
  "google-sheet": { label: "Sheets", tone: "#168a55" },
} as const;

function applyProcessingToRow(
  row: SearchAnalyticsRow,
  processing: SearchQueryProcessing,
): SearchAnalyticsRow {
  return {
    ...row,
    queryUk: processing.queryUk,
    queryRu: processing.queryRu,
    aliases: [...new Set([
      ...row.aliases,
      processing.originalQuery,
      processing.queryUk,
      processing.queryRu,
    ].filter(Boolean))],
    sources: row.sources.includes("google-sheet")
      ? row.sources
      : [...row.sources, "google-sheet"],
    status: "processed",
    manager: processing.manager,
    products: processing.products,
    sheetSynced: processing.sheetSynced,
    sheetRow: processing.sheetRow ?? null,
    processedAt: processing.processedAt,
    updatedAt: processing.updatedAt,
  };
}

function QueryProcessingModal({
  row,
  onClose,
  onSaved,
}: {
  row: SearchAnalyticsRow;
  onClose: () => void;
  onSaved: (processing: SearchQueryProcessing) => void;
}) {
  const [manager, setManager] = useState<ContentReviewManager | "">(
    row.manager || "",
  );
  const [queryUk, setQueryUk] = useState(row.queryUk || row.query);
  const [queryRu, setQueryRu] = useState(row.queryRu || row.query);
  const [iddText, setIddText] = useState(
    row.products.map((product) => product.code).join(", "),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sheetResult, setSheetResult] = useState<{
    row: string[];
    action: "created" | "updated";
    rowNumber: number;
  } | null>(null);
  const idds = useMemo(
    () =>
      [...new Set(
        iddText
          .split(/[^0-9]+/)
          .filter(Boolean)
          .map(Number)
          .filter((value) => Number.isSafeInteger(value) && value > 0),
      )],
    [iddText],
  );

  const save = async () => {
    setError("");
    setSheetResult(null);
    const missing: string[] = [];
    if (!manager) missing.push("менеджера");
    if (!queryUk.trim()) missing.push("запит uk");
    if (!queryRu.trim()) missing.push("запит ru");
    if (!idds.length) missing.push("хоча б один IDD");
    if (missing.length) {
      setError(`Щоб зберегти дані, вкажіть ${missing.join(", ")}.`);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/products/search-analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: row.query, queryUk, queryRu, manager, idds }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        sheetRow?: string[];
        sheetAction?: "created" | "updated";
        sheetRowNumber?: number;
        processing?: SearchQueryProcessing;
      };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (!payload.processing)
        throw new Error("Сервер не повернув збережені дані дашборда");
      if (payload.sheetRow && payload.sheetAction && payload.sheetRowNumber)
        setSheetResult({
          row: payload.sheetRow,
          action: payload.sheetAction,
          rowNumber: payload.sheetRowNumber,
        });
      onSaved(payload.processing);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17212bcc]/70 p-3 backdrop-blur-sm">
      <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#e8edf1] p-5">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.16em] text-[#118dff]">
              Обробка пошукового запиту
            </div>
            <h3 className="mt-1 text-xl font-black text-[#27313c]">{row.query}</h3>
            <div className="mt-2 flex flex-wrap gap-2 text-[9px] font-bold text-[#68737e]">
              <span>BQ: {formatNumber(row.bigQueryCount)}</span>
              <span>MS є: {formatNumber(row.multisearchFoundCount)}</span>
              <span>MS без результату: {formatNumber(row.multisearchNoResultsCount)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#eef1f3] px-3 py-2 text-xs font-black text-[#596571]"
          >
            ✕
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <div className="mb-2 text-[10px] font-black text-[#45515d]">
              Динаміка за останні 3 місяці
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {row.monthly.map((month) => (
                <div key={month.month} className="rounded-xl border border-[#dfe4ea] bg-[#fbfcfd] p-3">
                  <div className="text-[9px] font-black text-[#596571]">{formatMonth(month.month)}</div>
                  <div className="mt-1 text-lg font-black text-[#27313c]">{formatNumber(month.totalSearches)}</div>
                  <div className="mt-1 text-[8px] leading-4 text-[#7d8892]">
                    BQ {formatNumber(month.bigQueryCount)} · MS 0 {formatNumber(month.multisearchNoResultsCount)} · MS є {formatNumber(month.multisearchFoundCount)}
                  </div>
                  <div className="mt-1 text-[7px] text-[#a0a8af]">{formatDate(month.from)} — {formatDate(month.to)}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[10px] font-black text-[#45515d]">Менеджер</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {CONTENT_REVIEW_MANAGERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setManager(item)}
                  className="rounded-xl border px-4 py-3 text-left text-xs font-black"
                  style={
                    manager === item
                      ? { borderColor: "#118dff", background: "#edf6ff", color: "#0b6fc2" }
                      : { borderColor: "#dfe4ea", background: "white", color: "#596571" }
                  }
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-[10px] font-black text-[#45515d]">
              Запит uk
              <input
                value={queryUk}
                onChange={(event) => setQueryUk(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[#d8dde3] px-3 py-3 text-xs font-semibold outline-none focus:border-[#118dff]"
              />
            </label>
            <label className="text-[10px] font-black text-[#45515d]">
              Запит ru
              <input
                value={queryRu}
                onChange={(event) => setQueryRu(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[#d8dde3] px-3 py-3 text-xs font-semibold outline-none focus:border-[#118dff]"
              />
            </label>
          </div>
          <label className="block text-[10px] font-black text-[#45515d]">
            Список IDD
            <textarea
              value={iddText}
              onChange={(event) => setIddText(event.target.value)}
              rows={5}
              placeholder="Вставте IDD через кому, пробіл або з нового рядка"
              className="mt-2 w-full resize-y rounded-xl border border-[#d8dde3] px-3 py-3 font-mono text-xs outline-none focus:border-[#118dff]"
            />
          </label>
          <div className="rounded-xl border border-[#d7e8f7] bg-[#f3f9ff] p-3 text-[10px] leading-5 text-[#4e6578]">
            Розпізнано IDD: <b>{idds.length}</b>. Після перевірки вони будуть
            перетворені на goods_ref. Існуючий рядок Google Sheets буде оновлено,
            а якщо запиту ще немає — створено новий.
          </div>
          {error && (
            <div className="rounded-xl border border-[#f0b6b6] bg-[#fff1f1] p-3 text-[10px] font-bold text-[#b73535]">
              {error}
            </div>
          )}
          {sheetResult && (
            <div className="rounded-xl border border-[#aedfc9] bg-[#effaf5] p-3">
              <b className="text-[10px] text-[#087a55]">
                {sheetResult.action === "updated" ? "Оновлено" : "Створено"} рядок {sheetResult.rowNumber} у Google Sheets
              </b>
              <div className="mt-2 break-all font-mono text-[9px] leading-5 text-[#496259]">
                {sheetResult.row.join(" | ")}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[#d8dde3] px-4 py-2.5 text-[10px] font-black text-[#68737e]"
            >
              Закрити
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-xl bg-[#118dff] px-5 py-2.5 text-[10px] font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Зберігаємо…" : "Зберегти в Google Sheets"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OutOfStockProductsModal({
  row,
  onClose,
  onOpenProduct,
}: {
  row: SearchAnalyticsRow;
  onClose: () => void;
  onOpenProduct: (product: SearchQueryProduct) => void;
}) {
  const products = row.products.filter((product) => (product.stockQty || 0) <= 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17212bcc]/70 p-3 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#e8edf1] p-5">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.16em] text-[#dc5a64]">Товари без залишків</div>
            <h3 className="mt-1 text-lg font-black text-[#27313c]">{row.query}</h3>
            <div className="mt-1 text-[9px] text-[#7d8892]">Знайдено: {products.length}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg bg-[#eef1f3] px-3 py-2 text-xs font-black text-[#596571]">✕</button>
        </div>
        <div className="divide-y divide-[#edf0f2]">
          {products.map((product) => (
            <div key={product.goodsRef} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <button type="button" onClick={() => onOpenProduct(product)} className="text-left text-[10px] font-black text-[#27313c] hover:text-[#118dff] hover:underline">{product.name}</button>
                <div className="mt-1 text-[8px] text-[#7d8892]">
                  IDD: <b>{product.code}</b> · goods_ref: {product.goodsRef} · {product.statusName || "Статус не вказано"}
                </div>
              </div>
              {product.url && (
                <a href={product.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border border-[#bcd8f1] bg-[#edf6ff] px-3 py-2 text-[9px] font-black text-[#0b6fc2]">
                  Відкрити товар ↗
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SearchAnalyticsPanel({ onOpenProduct }: { onOpenProduct: (product: SearchQueryProduct) => void }) {
  const [data, setData] = useState<SearchAnalyticsResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("new");
  const [source, setSource] = useState("all");
  const [result, setResult] = useState("no-results");
  const [manager, setManager] = useState("all");
  const [minCount, setMinCount] = useState("");
  const [selected, setSelected] = useState<SearchAnalyticsRow | null>(null);
  const [stockDetails, setStockDetails] = useState<SearchAnalyticsRow | null>(null);
  const [excludingKey, setExcludingKey] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "25",
        search,
        status,
        source,
        result,
        manager,
        minCount,
      });
      const response = await fetch(`/api/products/search-analytics?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as
        | SearchAnalyticsResponse
        | { error?: string };
      if (!response.ok)
        throw new Error("error" in payload ? payload.error || `HTTP ${response.status}` : `HTTP ${response.status}`);
      setData(payload as SearchAnalyticsResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити запити");
    } finally {
      setLoading(false);
    }
  }, [manager, minCount, page, result, search, source, status]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setPage(1), [manager, minCount, result, search, source, status]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = searchDraft.trim();
      setSearch(nextSearch);
      if (nextSearch) {
        setStatus("all");
        setResult("all");
        setSource("all");
        setMinCount("");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const applySearch = () => {
    const nextSearch = searchDraft.trim();
    setSearch(nextSearch);
    if (nextSearch) {
      setStatus("all");
      setResult("all");
      setSource("all");
      setMinCount("");
    }
  };

  const exclude = async (
    row: SearchAnalyticsRow,
    reason: SearchQueryExclusionReason,
  ) => {
    const confirmed = window.confirm(
      reason === "brand-not-found"
        ? `Позначити «${row.query}» як бренд, якого немає на сайті? Запит зникне з черги, але залишиться у відповідному фільтрі.`
        : `Перемістити запит «${row.query}» до видалених? Рядок у Google Sheets видалено не буде.`,
    );
    if (!confirmed) return;
    setExcludingKey(`${row.key}:${reason}`);
    setError("");
    try {
      const response = await fetch("/api/products/search-analytics", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: row.query,
          aliases: [...row.aliases, row.queryUk, row.queryRu],
          reason,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося приховати запит");
    } finally {
      setExcludingKey("");
    }
  };

  const kpis = [
    { label: "Унікальних запитів", value: data.stats.uniqueQueries, note: `${formatNumber(data.stats.searchEvents)} пошуків за період`, tone: "#118dff" },
    { label: "До обробки", value: data.stats.pendingQueries, note: `${formatNumber(data.sourceStats.multisearchNoResultsEvents)} пошуків без результатів у MS`, tone: "#e05c68" },
    { label: "Опрацьовано", value: data.stats.processedQueries, note: `${formatNumber(data.sourceStats.sheetMappings)} імпортовано з Sheets`, tone: "#23a875" },
    { label: "Залучено товарів", value: data.stats.involvedProducts, note: `${formatNumber(data.stats.productsInStock)} із залишком · ${formatNumber(data.stats.productsOutOfStock)} без`, tone: "#f39c4a" },
  ];

  return (
    <div className="space-y-4">
      {selected && (
        <QueryProcessingModal
          row={selected}
          onClose={() => setSelected(null)}
          onSaved={(processing) => {
            const savedRow = applyProcessingToRow(selected, processing);
            setSelected(savedRow);
            setData((current) => ({
              ...current,
              rows: current.rows.map((item) =>
                item.key === selected.key ? savedRow : item,
              ),
            }));
            void load();
          }}
        />
      )}
      {stockDetails && <OutOfStockProductsModal row={stockDetails} onClose={() => setStockDetails(null)} onOpenProduct={onOpenProduct} />}
      <div className="flex flex-col gap-3 rounded-2xl border border-[#b9dfcf] bg-[#f0faf6] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[.15em] text-[#087a55]">Синхронізація активна</div>
          <div className="mt-1 text-[11px] font-bold text-[#496259]">
            Збереження створює або оновлює відповідний рядок у Google Sheets Multisearch.
          </div>
        </div>
        <div className="text-[9px] text-[#5d766c]">
          Дані таблиці: <b>{formatDate(data.periodFrom)} — {formatDate(data.periodTo)}</b> · останні 30 завершених днів
        </div>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {kpis.map((item) => (
          <article key={item.label} className="rounded-2xl border border-[#dfe4ea] bg-white p-4">
            <div className="text-[9px] font-black uppercase tracking-[.12em] text-[#82909d]">{item.label}</div>
            <div className="mt-2 text-2xl font-black" style={{ color: item.tone }}>{formatNumber(item.value)}</div>
            <div className="mt-1 text-[9px] text-[#7d8892]">{item.note}</div>
          </article>
        ))}
      </section>
      <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
        <div className="border-b border-[#e8edf1] bg-[#fbfcfd] p-4">
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-[9px] font-black uppercase tracking-[.14em] text-[#118dff]">Об’єднана черга</div>
              <h2 className="mt-1 text-sm font-black text-[#27313c]">Пошукові запити з BigQuery та Multisearch</h2>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="self-start rounded-xl border border-[#bcd8f1] bg-[#edf6ff] px-3 py-2 text-[10px] font-black text-[#0b6fc2] disabled:opacity-50"
            >
              {loading ? "Оновлюємо…" : "Оновити"}
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              applySearch();
            }}
            className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.5fr)_repeat(4,minmax(145px,1fr))_170px]"
          >
            <div className="flex min-w-0">
              <input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Знайти запит у всьому дашборді…"
                className="min-w-0 flex-1 rounded-l-xl border border-r-0 border-[#d8dde3] bg-white px-3 py-2.5 text-[10px] outline-none focus:border-[#118dff]"
              />
              <button type="submit" className="rounded-r-xl bg-[#118dff] px-3 text-[9px] font-black text-white">
                Знайти
              </button>
            </div>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[10px] font-bold text-[#596571]">
              <option value="new">До обробки</option>
              <option value="deleted">До обробки · Видалені</option>
              <option value="brand-not-found">До обробки · Не знайдений бренд</option>
              <option value="processed">Опрацьовані</option>
              <option value="garbage">Ідентифікатори / сміття</option>
              <option value="all">Усі статуси</option>
            </select>
            <select value={result} onChange={(event) => setResult(event.target.value)} className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[10px] font-bold text-[#596571]">
              <option value="no-results">Без результатів</option>
              <option value="found">З результатами</option>
              <option value="all">Усі результати</option>
            </select>
            <select value={source} onChange={(event) => setSource(event.target.value)} className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[10px] font-bold text-[#596571]">
              <option value="all">Усі джерела</option>
              <option value="bigquery">BigQuery</option>
              <option value="multisearch-found">MS з результатами</option>
              <option value="multisearch-no-results">MS без результатів</option>
              <option value="google-sheet">Google Sheets</option>
            </select>
            <select value={manager} onChange={(event) => setManager(event.target.value)} className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[10px] font-bold text-[#596571]">
              <option value="all">Усі менеджери</option>
              {CONTENT_REVIEW_MANAGERS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <label className="flex items-center gap-2 rounded-xl border border-[#d8dde3] bg-white px-3 text-[9px] font-bold text-[#7d8892]">
              Мін. к-сть
              <input
                type="number"
                min="0"
                value={minCount}
                onChange={(event) => setMinCount(event.target.value)}
                placeholder="0"
                className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-[10px] font-black text-[#45515d] outline-none"
              />
            </label>
          </form>
        </div>
        {error && <div className="border-b border-[#f0b6b6] bg-[#fff1f1] p-3 text-[10px] font-bold text-[#b73535]">{error}</div>}
        {data.warnings.map((warning) => <div key={warning} className="border-b border-[#f0d4a5] bg-[#fff8eb] px-4 py-2 text-[9px] text-[#9a6616]">{warning}</div>)}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-[#f6f8f9] text-[8px] font-black uppercase tracking-[.12em] text-[#8b949e]">
              <tr>
                <th className="px-4 py-3">Пошуковий запит</th>
                <th className="px-3 py-3">Джерела</th>
                <th className="px-3 py-3 text-center" title="Загальна кількість виконаних пошуків за вибраний період">К-сть пошукових запитів</th>
                <th className="px-3 py-3">Перша поява</th>
                <th className="px-3 py-3">Менеджер</th>
                <th className="px-3 py-3 text-center">Товари</th>
                <th className="px-4 py-3">Статус</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const meta = STATUS_META[row.status];
                const inStock = row.products.filter((product) => (product.stockQty || 0) > 0).length;
                return (
                  <tr key={row.key} className="border-b border-[#edf0f2] last:border-0 hover:bg-[#fbfcfd]">
                    <td className="min-w-[280px] px-4 py-3">
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          disabled={row.status === "garbage"}
                          onClick={() => setSelected(row)}
                          className="min-w-0 text-left text-[11px] font-black text-[#27313c] hover:text-[#118dff] disabled:cursor-default disabled:text-[#707b85]"
                        >
                          {row.query}
                        </button>
                        <button
                          type="button"
                          title="Бренду немає на сайті"
                          aria-label={`Бренду немає на сайті: ${row.query}`}
                          disabled={Boolean(excludingKey)}
                          onClick={() => void exclude(row, "brand-not-found")}
                          className="ml-auto shrink-0 rounded-md border border-[#eed49f] bg-[#fff8e8] px-2 py-1 text-[8px] font-black text-[#a56a0b] hover:bg-[#fff1cf] disabled:opacity-40"
                        >
                          {excludingKey === `${row.key}:brand-not-found` ? "…" : "Бренд 0"}
                        </button>
                        <button
                          type="button"
                          title="Перемістити до видалених"
                          aria-label={`Видалити запит ${row.query}`}
                          disabled={Boolean(excludingKey)}
                          onClick={() => void exclude(row, "deleted")}
                          className="shrink-0 rounded-md border border-[#f0c6ca] bg-[#fff4f5] px-2 py-1 text-[9px] font-black text-[#c64753] hover:bg-[#ffe9eb] disabled:opacity-40"
                        >
                          {excludingKey === `${row.key}:deleted` ? "…" : "✕"}
                        </button>
                      </div>
                      {(row.queryUk !== row.queryRu || row.aliases.length > 1) && (
                        <div className="mt-1 max-w-[360px] truncate text-[8px] text-[#929ca5]">UK: {row.queryUk} · RU: {row.queryRu}</div>
                      )}
                      {row.garbageReason && <div className="mt-1 text-[8px] font-bold text-[#8a949d]">{row.garbageReason}</div>}
                    </td>
                    <td className="min-w-[150px] px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.sources.map((sourceName) => {
                          const sourceMeta = SOURCE_META[sourceName];
                          return <span key={sourceName} className="rounded-full px-2 py-1 text-[8px] font-black text-white" style={{ background: sourceMeta.tone }}>{sourceMeta.label}</span>;
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <b className="text-[11px] text-[#34404c]">{formatNumber(row.totalSearches)}</b>
                      <div className="mt-1 text-[8px] text-[#929ca5]">BQ {formatNumber(row.bigQueryCount)} · MS {formatNumber(row.multisearchFoundCount)}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[10px] font-semibold text-[#596571]">{formatDate(row.firstSeenAt)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-[9px] font-black text-[#45515d]">{row.manager || "—"}</td>
                    <td className="px-3 py-3 text-center">
                      <b className="text-[11px] text-[#34404c]">{row.products.length}</b>
                      {row.products.length > 0 && (
                        <div className="mt-1 text-[8px] text-[#929ca5]">
                          {inStock} є · {row.products.length - inStock > 0 ? (
                            <button type="button" onClick={() => setStockDetails(row)} className="font-black text-[#dc5a64] underline decoration-dotted underline-offset-2">
                              {row.products.length - inStock} немає
                            </button>
                          ) : "0 немає"}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex rounded-full px-2.5 py-1 text-[8px] font-black" style={{ color: meta.color, background: meta.background }}>{meta.label}</span>
                      {row.status === "processed" && !row.sheetSynced && <div className="mt-1 text-[7px] font-bold text-[#b97716]">Тест · не в Sheets</div>}
                    </td>
                  </tr>
                );
              })}
              {!loading && !data.rows.length && (
                <tr><td colSpan={7} className="p-12 text-center text-xs text-[#82909d]">Запитів за вибраними умовами не знайдено</td></tr>
              )}
              {loading && !data.rows.length && (
                <tr><td colSpan={7} className="p-12 text-center text-xs text-[#82909d]">Завантажуємо BigQuery, Multisearch та Google Sheets…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 border-t border-[#e8edf1] bg-[#fbfcfd] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[9px] text-[#7d8892]">Показано {data.rows.length} з {formatNumber(data.total)}</div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[9px] font-black text-[#596571] disabled:opacity-40">← Поп.</button>
            <span className="text-[9px] font-black text-[#596571]">{page} / {data.totalPages}</span>
            <button type="button" disabled={page >= data.totalPages || loading} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[9px] font-black text-[#596571] disabled:opacity-40">Наст. →</button>
          </div>
        </div>
      </section>
    </div>
  );
}
