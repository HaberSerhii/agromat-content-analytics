"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

type ViewMode = "overview" | "changed" | "vtm-changed" | "not-median" | "vtm-not-median";
type CabinetMode = "menu" | "sessions" | "logs" | null;
type ExportKind = "general-xlsx" | "segment-xlsx" | "general-pdf" | "segment-pdf";

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

interface FacetValue {
  value: string;
  count: number;
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
  categories: FacetValue[];
  brands: FacetValue[];
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

interface DashboardSession {
  id: string;
  device: string;
  ip: string;
  firstSeen: string;
  lastSeen: string;
}

interface DashboardChangeLog {
  id: number;
  at: string;
  action: "competitor_url_add" | "competitor_url_edit" | "competitor_url_delete";
  productId: number;
  competitorId: number;
  device: string;
  ip: string;
  competitor: string;
  product: string;
  productUrl: string | null;
  competitorUrl: string | null;
}

interface UrlEditorState {
  productId: number;
  competitorId: number;
  competitor: string;
  product: string;
  originalUrl: string | null;
  value: string;
}

interface CompactDashboardResponse {
  currentDate: string | null;
  competitors: Competitor[];
  rows: PriceRow[];
  total: number;
  page: number;
  limit: number;
  error?: string;
}

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

const VIEW_ITEMS: Array<{ id: ViewMode; label: string; hint: string }> = [
  { id: "overview", label: "Огляд", hint: "Головна сторінка" },
  { id: "changed", label: "Змінили ціну", hint: "Усі товари" },
  { id: "vtm-changed", label: "Змінили ціну", hint: "Тільки ВТМ" },
  { id: "not-median", label: "Ціна не в медіані", hint: "Усі товари" },
  { id: "vtm-not-median", label: "Ціна не в медіані", hint: "Тільки ВТМ" },
];

const CHART_COLORS = ["#118dff", "#4a6ee0", "#6d5bd0", "#16a085", "#f39c4a", "#e05c68", "#38a3a5", "#78909c", "#9b59b6", "#2d98da", "#7f8c8d"];
const ROWS_PER_PAGE = 15;
const COMPETITOR_SELECTION_STORAGE_KEY = "agromat.competitor-dashboard.selected-competitors.v2";
const LOCAL_BROWSER_ADAPTERS = new Set(["santechshara", "vannaja"]);

function canonicalParserAdapter(adapter: string): string {
  const normalized = adapter.trim().toLowerCase();
  if (normalized === "plitka.ua") return "plitka";
  if (normalized === "leoceramika.com" || normalized === "leo-ceramika") return "leoceramika";
  return normalized;
}

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

function changeActionLabel(action: DashboardChangeLog["action"]): string {
  if (action === "competitor_url_add") return "Додав URL";
  if (action === "competitor_url_edit") return "Відредагував URL";
  return "Видалив URL і ціну";
}

function paginationItems(current: number, total: number): Array<number | "ellipsis-left" | "ellipsis-right"> {
  if (total <= 8) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, 2, total - 1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
  const result: Array<number | "ellipsis-left" | "ellipsis-right"> = [];
  sorted.forEach((value, index) => {
    if (index && value - sorted[index - 1] > 1) result.push(value < current ? "ellipsis-left" : "ellipsis-right");
    result.push(value);
  });
  return result;
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
  let color = "#66707b";
  if (ourPrice && ourPrice > 0) {
    if ((ourPrice - price) / price >= 0.02) color = "#d14343";
    else if ((price - ourPrice) / ourPrice >= 0.02) color = "#087a55";
  }
  return (
    <span className="inline-flex items-center leading-tight">
      <strong className="whitespace-nowrap text-xs" style={{ color }}>{formatPrice(price)}</strong>
    </span>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function fetchAllDashboardRows(query: URLSearchParams): Promise<CompactDashboardResponse> {
  const firstQuery = new URLSearchParams(query);
  firstQuery.set("page", "1");
  firstQuery.set("limit", "100");
  firstQuery.set("compact", "1");
  const firstResponse = await fetch(`/api/parser/dashboard-v2?${firstQuery}`);
  const first = await firstResponse.json() as CompactDashboardResponse;
  if (!firstResponse.ok) throw new Error(first.error || `HTTP ${firstResponse.status}`);
  const pageCount = Math.ceil(first.total / first.limit);
  if (pageCount <= 1) return first;
  const pages = await Promise.all(Array.from({ length: pageCount - 1 }, async (_, index) => {
    const nextQuery = new URLSearchParams(firstQuery);
    nextQuery.set("page", String(index + 2));
    const response = await fetch(`/api/parser/dashboard-v2?${nextQuery}`);
    const body = await response.json() as CompactDashboardResponse;
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body.rows;
  }));
  return { ...first, rows: [first.rows, ...pages].flat() };
}

async function downloadLegacyReport(path: string, payload: Record<string, unknown>, fallbackName: string): Promise<void> {
  const response = await fetch(`/parcer/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error((await response.text()).slice(0, 240) || `HTTP ${response.status}`);
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  triggerDownload(await response.blob(), filename);
}

export function CompetitorDashboardV2() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<ViewMode>("overview");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [priceMode, setPriceMode] = useState("all");
  const [competitorPriceMode, setCompetitorPriceMode] = useState("all");
  const [selectedCompetitors, setSelectedCompetitors] = useState<Set<number>>(new Set());
  const [competitorSelectionReady, setCompetitorSelectionReady] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const [pageDraft, setPageDraft] = useState("1");
  const [setModalOpen, setSetModalOpen] = useState(false);
  const [setDraft, setSetDraft] = useState("");
  const [productIds, setProductIds] = useState("");
  const [notice, setNotice] = useState("");
  const [urlEditor, setUrlEditor] = useState<UrlEditorState | null>(null);
  const [urlSaving, setUrlSaving] = useState(false);
  const [cabinetMode, setCabinetMode] = useState<CabinetMode>(null);
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [changeLogs, setChangeLogs] = useState<DashboardChangeLog[]>([]);
  const [changeLogsLoading, setChangeLogsLoading] = useState(false);
  const [agromatUpdatedAt, setAgromatUpdatedAt] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState("");
  const [job, setJob] = useState<ParserJob | null>(null);
  const [localRunnerHelp, setLocalRunnerHelp] = useState(false);
  const [cellBusy, setCellBusy] = useState<Record<string, boolean>>({});
  const [refreshRequest, setRefreshRequest] = useState(0);
  const handledRefreshRequest = useRef(0);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [hoveredViolation, setHoveredViolation] = useState<number | null>(null);
  const [violationCompetitorId, setViolationCompetitorId] = useState(0);
  const [copiedKey, setCopiedKey] = useState("");

  const selectedKey = [...selectedCompetitors].sort((a, b) => a - b).join(",");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COMPETITOR_SELECTION_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      if (Array.isArray(parsed)) {
        setSelectedCompetitors(new Set(parsed
          .map((value) => Number(value))
          .filter((value) => Number.isSafeInteger(value) && value > 0)));
      }
    } catch {
      // A blocked or malformed localStorage must not prevent the dashboard.
    } finally {
      setCompetitorSelectionReady(true);
    }
  }, []);

  useEffect(() => {
    if (!competitorSelectionReady) return;
    try {
      window.localStorage.setItem(COMPETITOR_SELECTION_STORAGE_KEY, JSON.stringify([...selectedCompetitors]));
    } catch {
      // Persisting the preference is optional.
    }
  }, [competitorSelectionReady, selectedCompetitors]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), limit: String(ROWS_PER_PAGE), view });
    const forceRefresh = refreshRequest > handledRefreshRequest.current;
    if (forceRefresh) query.set("refresh", "1");
    if (category) query.set("category", category);
    if (brand) query.set("brand", brand);
    if (priceMode !== "all") query.set("price", priceMode);
    if (competitorPriceMode !== "all") query.set("competitor_price", competitorPriceMode);
    if (selectedKey) query.set("competitors", selectedKey);
    if (search) query.set("search", search);
    if (productIds) query.set("ids", productIds);
    if (violationCompetitorId) query.set("violation_competitor", String(violationCompetitorId));
    setLoading(true);
    setError("");
    fetch(`/api/parser/dashboard-v2?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as DashboardResponse;
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        return body;
      })
      .then((body) => {
        if (forceRefresh) handledRefreshRequest.current = refreshRequest;
        setData(body);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Не вдалося завантажити прототип");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [brand, category, competitorPriceMode, page, priceMode, productIds, refreshRequest, search, selectedKey, view, violationCompetitorId]);

  useEffect(() => setPage(1), [brand, category, competitorPriceMode, priceMode, productIds, search, selectedKey, view, violationCompetitorId]);

  useEffect(() => {
    if (category && data && !data.categories.some((item) => item.value === category)) setCategory("");
  }, [category, data]);

  useEffect(() => {
    if (brand && data && !data.brands.some((item) => item.value === brand)) setBrand("");
  }, [brand, data]);

  useEffect(() => {
    const heartbeat = () => fetch("/api/dashboard/sessions", { cache: "no-store" }).catch(() => undefined);
    heartbeat();
    const timer = window.setInterval(heartbeat, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleCompetitorIds = selectedCompetitors;
  const visibleCompetitors = (data?.competitors || []).filter((competitor) => visibleCompetitorIds.has(competitor.id));
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / ROWS_PER_PAGE));

  function toggleCompetitor(id: number) {
    setViolationCompetitorId(0);
    setSelectedCompetitors((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function resetFilters() {
    setCategory("");
    setBrand("");
    setPriceMode("all");
    setCompetitorPriceMode("all");
    setSelectedCompetitors(new Set());
    setSearchDraft("");
    setSearch("");
    setProductIds("");
    setViolationCompetitorId(0);
    setPagePickerOpen(false);
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

  function reportQuery(segmented: boolean): URLSearchParams {
    const query = new URLSearchParams({ view: segmented ? view : "overview" });
    if (!segmented) return query;
    if (category) query.set("category", category);
    if (brand) query.set("brand", brand);
    if (priceMode !== "all") query.set("price", priceMode);
    if (competitorPriceMode !== "all") query.set("competitor_price", competitorPriceMode);
    if (selectedKey) query.set("competitors", selectedKey);
    if (search) query.set("search", search);
    if (productIds) query.set("ids", productIds);
    if (violationCompetitorId) query.set("violation_competitor", String(violationCompetitorId));
    return query;
  }

  async function copyValue(value: string | number | null, key: string) {
    if (value == null || value === "") return;
    try {
      await navigator.clipboard.writeText(String(value));
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => current === key ? "" : current), 1400);
    } catch {
      setNotice("Браузер не дозволив скопіювати значення в буфер обміну.");
    }
  }

  function filterByViolation(competitorId: number, competitor: string) {
    const nextId = violationCompetitorId === competitorId ? 0 : competitorId;
    setViolationCompetitorId(nextId);
    setSelectedCompetitors(nextId ? new Set([competitorId]) : new Set());
    setPage(1);
    setNotice(nextId ? `Фільтр порушень: ${competitor}.` : "Фільтр порушень вимкнено.");
  }

  function openPagePicker() {
    setPageDraft(String(page));
    setPagePickerOpen(true);
  }

  function applyPagePicker(event: FormEvent) {
    event.preventDefault();
    const nextPage = Math.min(totalPages, Math.max(1, Number(pageDraft) || 1));
    setPage(nextPage);
    setPageDraft(String(nextPage));
    setPagePickerOpen(false);
  }

  async function exportExcel(segmented: boolean) {
    const kind: ExportKind = segmented ? "segment-xlsx" : "general-xlsx";
    if (exporting) return;
    setExporting(kind);
    setNotice("");
    try {
      const report = segmented ? await fetchAllDashboardRows(reportQuery(true)) : null;
      const payload = {
        scope: segmented ? "segmented" : "full",
        snapshot_date: data?.currentDate,
        show: "matched",
        competitor_ids: segmented ? [...visibleCompetitorIds] : [],
        competitor_dates: {},
        filters: segmented ? {
          search: "",
          price: "all",
          categories: [],
          brands: [],
          vtm: "",
          productSetIds: report?.rows.map((row) => row.productId) || [],
        } : {},
      };
      await downloadLegacyReport("export-prices", payload, `competitor-prices-${segmented ? "segmented" : "full"}-${data?.currentDate || "current"}.xlsx`);
      setNotice(`Excel-звіт у форматі поточного блока сформовано${report ? `: ${formatNumber(report.total)} товарів` : ""}.`);
    } catch (reason) {
      setNotice(`Не вдалося сформувати Excel: ${reason instanceof Error ? reason.message : "невідома помилка"}`);
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf(segmented: boolean) {
    const kind: ExportKind = segmented ? "segment-pdf" : "general-pdf";
    if (exporting) return;
    setExporting(kind);
    try {
      const report = segmented ? await fetchAllDashboardRows(reportQuery(true)) : null;
      const payload = {
        scope: segmented ? "segmented" : "full",
        snapshot_date: data?.currentDate,
        show: "matched",
        competitor_ids: segmented ? [...visibleCompetitorIds] : [],
        competitor_dates: {},
        filters: segmented ? {
          search: "",
          price: "all",
          categories: [],
          brands: [],
          vtm: "",
          productSetIds: report?.rows.map((row) => row.productId) || [],
        } : {},
      };
      await downloadLegacyReport("export-price-monitoring", payload, `price-monitoring-${segmented ? "segmented-" : ""}${data?.currentDate || "current"}.pptx`);
      setNotice(`Презентацію у форматі поточного блока сформовано${report ? `: ${formatNumber(report.total)} товарів` : ""}.`);
    } catch (reason) {
      setNotice(`Не вдалося сформувати презентацію: ${reason instanceof Error ? reason.message : "невідома помилка"}`);
    } finally {
      setExporting(null);
    }
  }

  async function openCabinet() {
    setCabinetMode("menu");
    try {
      const response = await fetch("/api/products/sync/status", { cache: "no-store" });
      const body = await response.json() as { syncedAt?: string | null };
      if (response.ok) setAgromatUpdatedAt(body.syncedAt || null);
    } catch {
      // The cabinet remains usable even if this auxiliary timestamp is unavailable.
    }
  }

  async function showSessions() {
    setCabinetMode("sessions");
    setSessionsLoading(true);
    try {
      const response = await fetch("/api/dashboard/sessions", { cache: "no-store" });
      const body = await response.json() as { sessions?: DashboardSession[]; error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setSessions(body.sessions || []);
    } catch (reason) {
      setNotice(`Не вдалося отримати сесії: ${reason instanceof Error ? reason.message : "невідома помилка"}`);
    } finally {
      setSessionsLoading(false);
    }
  }

  async function showChangeLogs() {
    setCabinetMode("logs");
    setChangeLogsLoading(true);
    try {
      const response = await fetch("/api/parser/urls", { cache: "no-store" });
      const body = await response.json() as { logs?: DashboardChangeLog[]; error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setChangeLogs(body.logs || []);
    } catch (reason) {
      setNotice(`Не вдалося отримати логи змін: ${reason instanceof Error ? reason.message : "невідома помилка"}`);
    } finally {
      setChangeLogsLoading(false);
    }
  }

  function makeUrlEditor(row: PriceRow, competitor: Competitor): UrlEditorState {
    const currentUrl = row.byCompetitor[competitor.id]?.url || null;
    return {
      productId: row.productId,
      competitorId: competitor.id,
      competitor: competitor.name,
      product: row.name,
      originalUrl: currentUrl,
      value: currentUrl || "",
    };
  }

  function openUrlEditor(row: PriceRow, competitor: Competitor) {
    setUrlEditor(makeUrlEditor(row, competitor));
  }

  function patchCompetitorCell(editor: UrlEditorState, nextUrl: string | null, deleted = false) {
    setData((current) => current ? {
      ...current,
      rows: current.rows.map((row) => {
        if (row.productId !== editor.productId) return row;
        const previous = row.byCompetitor[editor.competitorId];
        return {
          ...row,
          byCompetitor: {
            ...row.byCompetitor,
            [editor.competitorId]: {
              price: deleted ? null : previous?.price ?? null,
              observedPrice: deleted ? null : previous?.observedPrice ?? null,
              status: deleted ? "Видалено вручну" : previous?.status ?? null,
              url: nextUrl,
              confidence: deleted ? "none" : previous?.confidence ?? null,
              foundBrand: deleted ? null : previous?.foundBrand ?? null,
              reviewReason: deleted ? null : previous?.reviewReason ?? null,
            },
          },
        };
      }),
    } : current);
  }

  async function saveCompetitorUrl() {
    if (!urlEditor || urlSaving) return;
    const value = urlEditor.value.trim();
    if (!/^https?:\/\//i.test(value)) {
      setNotice("URL має починатися з http:// або https://");
      return;
    }
    setUrlSaving(true);
    try {
      const response = await fetch("/api/parser/urls", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: urlEditor.productId,
          competitor_id: urlEditor.competitorId,
          url: value,
          snapshot_date: data?.currentDate,
        }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; url?: string };
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
      patchCompetitorCell(urlEditor, body.url || value);
      setNotice(urlEditor.originalUrl ? "URL конкурента оновлено та записано в лог." : "URL конкурента додано та записано в лог.");
      setUrlEditor(null);
      setRefreshRequest((current) => current + 1);
    } catch (reason) {
      setNotice(`Не вдалося зберегти URL: ${reason instanceof Error ? reason.message : "невідома помилка"}`);
    } finally {
      setUrlSaving(false);
    }
  }

  async function deleteCompetitorUrl(editorOverride?: UrlEditorState) {
    const editor = editorOverride || urlEditor;
    if (!editor || urlSaving) return;
    if (!window.confirm(`Видалити URL і поточну ціну ${editor.competitor} для цього товару?`)) return;
    setUrlSaving(true);
    try {
      const response = await fetch("/api/parser/urls", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: editor.productId,
          competitor_id: editor.competitorId,
          url: editor.originalUrl,
          snapshot_date: data?.currentDate,
        }),
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
      patchCompetitorCell(editor, null, true);
      setNotice("URL і поточну ціну конкурента видалено. Дію записано в лог.");
      setUrlEditor(null);
      setRefreshRequest((current) => current + 1);
    } catch (reason) {
      setNotice(`Не вдалося видалити URL: ${reason instanceof Error ? reason.message : "невідома помилка"}`);
    } finally {
      setUrlSaving(false);
    }
  }

  async function runAgromatUpdate() {
    if (runningAction) return;
    setRunningAction("agromat");
    try {
      const response = await fetch("/api/products/sync", { method: "POST" });
      const body = await response.json() as { ok?: boolean; message?: string; error?: string; result?: { finishedAt?: string } };
      if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
      setAgromatUpdatedAt(body.result?.finishedAt || new Date().toISOString());
      setNotice("Оновлення API Agromat завершено.");
    } catch (reason) {
      setNotice(`Оновлення Agromat не запущено: ${reason instanceof Error ? reason.message : "невідома помилка"}`);
    } finally {
      setRunningAction("");
    }
  }

  async function runCompetitorUpdate(adapter: string, competitor: string) {
    if (runningAction) return;
    const canonicalAdapter = canonicalParserAdapter(adapter);
    setRunningAction(canonicalAdapter);
    setLocalRunnerHelp(false);
    try {
      const local = LOCAL_BROWSER_ADAPTERS.has(canonicalAdapter);
      const response = local
        ? await fetch("/api/parser/local-runner/queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adapter: canonicalAdapter }),
          })
        : await fetch(`/api/parser/run/prices-${encodeURIComponent(canonicalAdapter)}`, { method: "POST" });
      const body = await response.json().catch(() => ({ ok: false, error: "bad_runner_response" })) as ParserJob & { active_job_id?: string };
      if (!response.ok || body.ok === false) {
        if (body.error === "busy" && body.active_job_id) {
          setJob({ ok: true, job_id: body.active_job_id, status: "running", action: `prices-${canonicalAdapter}` });
          setNotice(`${competitor}: підключено до вже запущеного оновлення.`);
          setCabinetMode(null);
          return;
        }
        throw new Error(body.error === "local_runner_offline"
          ? "локальний runner не підключений до dashboard"
          : body.error || `HTTP ${response.status}`);
      }
      setJob({ ...body, status: body.status || "starting", action: body.action || `prices-${canonicalAdapter}` });
      setNotice(local
        ? `${competitor}: команду передано локальному runner. Відстежуйте прогрес у блоці нижче.`
        : `${competitor}: оновлення запущено${body.job_id ? ` · job ${body.job_id}` : ""}.`);
      setCabinetMode(null);
    } catch (reason) {
      if (LOCAL_BROWSER_ADAPTERS.has(canonicalAdapter)) setLocalRunnerHelp(true);
      setNotice(`${competitor}: не вдалося запустити оновлення — ${reason instanceof Error ? reason.message : "невідома помилка"}`);
    } finally {
      setRunningAction("");
    }
  }

  async function reparseCell(productId: number, competitorId: number) {
    const key = `${productId}:${competitorId}`;
    if (cellBusy[key]) return;
    setCellBusy((current) => ({ ...current, [key]: true }));
    try {
      const response = await fetch("/api/parser/reparse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, competitor_id: competitorId, snapshot_date: data?.currentDate }),
      });
      const body = await response.json() as {
        ok?: boolean;
        error?: string;
        price?: number | null;
        observed_price?: number | null;
        status?: string | null;
        confidence?: string | null;
        found_brand?: string | null;
        review_reason?: string | null;
      };
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
      setData((current) => current ? {
        ...current,
        rows: current.rows.map((row) => row.productId === productId ? {
          ...row,
          byCompetitor: {
            ...row.byCompetitor,
            [competitorId]: {
              price: typeof body.price === "number" ? body.price : null,
              observedPrice: typeof body.observed_price === "number" ? body.observed_price : null,
              status: body.status ?? row.byCompetitor[competitorId]?.status ?? null,
              url: row.byCompetitor[competitorId]?.url ?? null,
              confidence: body.confidence ?? null,
              foundBrand: body.found_brand ?? null,
              reviewReason: body.review_reason ?? null,
            },
          },
        } : row),
      } : current);
      setNotice("Ціну конкурента оновлено.");
    } catch (reason) {
      setNotice(`Не вдалося оновити ціну: ${reason instanceof Error ? reason.message : "невідома помилка"}`);
    } finally {
      setCellBusy((current) => ({ ...current, [key]: false }));
    }
  }

  useEffect(() => {
    if (!job?.job_id || !["starting", "running"].includes(job.status || "")) return;
    let stopped = false;
    const poll = async () => {
      try {
        const url = `/api/parser/job/${encodeURIComponent(job.job_id as string)}`;
        const response = await fetch(url, { cache: "no-store" });
        const next = await response.json() as ParserJob;
        if (!response.ok || !next.ok || stopped) return;
        setJob(next);
        if (next.status === "done") {
          stopped = true;
          setRefreshRequest((value) => value + 1);
          setNotice(`${next.label || "Оновлення конкурента завершено"}. Дані таблиці оновлюються.`);
        } else if (next.status === "error" || next.status === "blocked") {
          stopped = true;
          setNotice(`Оновлення зупинено: ${next.error || next.label || next.status}.`);
        }
      } catch {
        // A transient poll failure is retried on the next interval.
      }
    };
    void poll();
    const timer = window.setInterval(poll, 3_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [job?.job_id, job?.status]);

  const latestUpdate = data?.updates.find((update) => update.updatedAt)?.updatedAt || null;
  const progressPct = data?.progress.total ? Math.round((data.progress.completed / data.progress.total) * 100) : 0;
  const activeView = VIEW_ITEMS.find((item) => item.id === view) || VIEW_ITEMS[0];
  const violationTotal = (data?.violations || []).reduce((sum, item) => sum + item.count, 0);
  const hoveredViolationItem = hoveredViolation == null ? null : data?.violations.find((item) => item.competitorId === hoveredViolation);
  const jobCurrent = job?.current || 0;
  const jobTotal = job?.total || 0;
  const jobIsLocal = LOCAL_BROWSER_ADAPTERS.has(canonicalParserAdapter((job?.action || "").replace(/^prices-/, "")));
  const jobProgress = jobTotal > 0 ? Math.min(100, Math.round((jobCurrent / jobTotal) * 100)) : 0;
  const jobFinished = job?.status === "done" || job?.status === "error" || job?.status === "blocked";
  const jobRunning = job?.status === "starting" || job?.status === "running";

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
          <div className="mt-8 rounded-xl border border-[#304152] bg-[#1d2a36] p-3">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-[.14em] text-[#7f90a0]">Технічні інструменти</div>
            <div className="space-y-1.5">
              <button disabled={Boolean(exporting)} onClick={() => exportExcel(false)} className="w-full rounded-lg border border-[#36506a] bg-[#243647] px-2.5 py-2 text-left text-[9px] font-bold text-[#dce8f3] disabled:opacity-50">{exporting === "general-xlsx" ? "Формування…" : "↓ Звіт загальний (Excel)"}</button>
              <button disabled={Boolean(exporting)} onClick={() => exportExcel(true)} className="w-full rounded-lg border border-[#36506a] bg-[#243647] px-2.5 py-2 text-left text-[9px] font-bold text-[#dce8f3] disabled:opacity-50">{exporting === "segment-xlsx" ? "Формування…" : "↓ Звіт сегментований (Excel)"}</button>
              <button disabled={Boolean(exporting)} onClick={() => exportPdf(false)} className="w-full rounded-lg border border-[#36506a] bg-[#243647] px-2.5 py-2 text-left text-[9px] font-bold text-[#dce8f3] disabled:opacity-50">{exporting === "general-pdf" ? "Формування…" : "▣ Презентація загальна (PDF)"}</button>
              <button disabled={Boolean(exporting)} onClick={() => exportPdf(true)} className="w-full rounded-lg border border-[#36506a] bg-[#243647] px-2.5 py-2 text-left text-[9px] font-bold text-[#dce8f3] disabled:opacity-50">{exporting === "segment-pdf" ? "Формування…" : "▣ Презентація сегментована (PDF)"}</button>
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="flex flex-col gap-3 border-b border-[#e1e4e8] bg-white px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="text-xs text-[#8b949e]">Моніторинг цін&nbsp; / &nbsp;<b className="text-[#27313c]">{activeView.label}</b></div>
            <div className="flex flex-wrap items-center gap-2">
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
              <button onClick={openCabinet} className="rounded-xl border-0 bg-[#118dff] px-4 py-2.5 text-xs font-bold text-white shadow-[0_8px_18px_rgba(17,141,255,.2)]">● Особистий кабінет</button>
            </section>

            {notice && (
              <button onClick={() => setNotice("")} className="mb-4 w-full rounded-xl border border-[#9cccf6] bg-[#eef7ff] px-3 py-2 text-left text-xs text-[#175f9f]">{notice} <span className="float-right">×</span></button>
            )}
            {job && (
              <section className="mb-4 rounded-xl border border-[#9cccf6] bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <b className="text-[#26313d]">{job.label || `Оновлення ${(job.action || "").replace(/^prices-/, "")}`}</b>
                    <div className="mt-1 text-[10px] text-[#71808e]">
                      {job.status === "done" ? "Завершено" : job.status === "error" || job.status === "blocked" ? `Зупинено: ${job.error || job.status}` : jobIsLocal ? "Працює локально на цьому комп’ютері" : "Працює на сервері"}
                      {jobTotal > 0 ? ` · ${jobCurrent}/${jobTotal} товарів` : ""}
                    </div>
                  </div>
                  {jobFinished && <button onClick={() => setJob(null)} className="rounded-lg border-0 bg-[#edf3f8] px-2.5 py-1 text-[10px] font-bold text-[#596571]">Закрити</button>}
                </div>
                {!jobFinished && <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e8edf2]"><div className="h-full rounded-full bg-[#118dff] transition-all" style={{ width: jobTotal > 0 ? `${jobProgress}%` : "18%" }} /></div>}
              </section>
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

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                    <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[11px] outline-none focus:border-[#118dff]">
                      <option value="">Усі категорії</option>
                      {(data?.categories || []).map((item) => <option key={item.value} value={item.value}>{item.value} ({formatNumber(item.count)})</option>)}
                    </select>
                    <select value={brand} onChange={(event) => setBrand(event.target.value)} className="rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[11px] outline-none focus:border-[#118dff]">
                      <option value="">Усі бренди</option>
                      {(data?.brands || []).map((item) => <option key={item.value} value={item.value}>{item.value} ({formatNumber(item.count)})</option>)}
                    </select>
                    <select value={priceMode} onChange={(event) => setPriceMode(event.target.value)} className="rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[11px] outline-none focus:border-[#118dff]">
                      <option value="all">Будь-яка ціна Агромат</option>
                      <option value="lower">Агромат нижче</option>
                      <option value="higher">Агромат вище</option>
                    </select>
                    <select value={competitorPriceMode} onChange={(event) => setCompetitorPriceMode(event.target.value)} className="rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[11px] outline-none focus:border-[#118dff]">
                      <option value="all">З ціною + без ціни конкурента</option>
                      <option value="with">З ціною конкурента</option>
                      <option value="without">Без ціни конкурента</option>
                    </select>
                    <details className="relative rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[11px]">
                      <summary className="cursor-pointer list-none font-semibold text-[#56616c]">Конкуренти · {visibleCompetitorIds.size}</summary>
                      <div className="absolute right-0 z-30 mt-3 max-h-64 min-w-56 overflow-auto rounded-xl border border-[#d8dde3] bg-white p-2 shadow-xl">
                        <button type="button" onClick={() => { setViolationCompetitorId(0); setSelectedCompetitors(new Set()); }} className="mb-1 w-full rounded-lg bg-[#f1f5f8] px-2 py-2 text-left text-[10px] font-bold text-[#52606d]">Зняти всіх конкурентів</button>
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
                  <table className={`w-full border-collapse text-left ${visibleCompetitors.length ? "min-w-[1040px]" : "min-w-[760px]"}`}>
                    <thead className="bg-[#f7f8f8] text-[9px] font-black uppercase tracking-[.12em] text-[#8d969f]">
                      <tr>
                        <th className="px-3 py-3">Категорія</th>
                        <th className="px-3 py-3">Бренд</th>
                        <th className="px-3 py-3">Артикул</th>
                        <th className="min-w-64 px-3 py-3">Назва товару</th>
                        <th className="px-3 py-3 text-right">Агромат</th>
                        {visibleCompetitors.map((competitor) => <th key={competitor.id} className="min-w-36 px-3 py-3 text-right text-[#0b6fc2]">{competitor.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {loading && !data && (
                        <tr><td colSpan={5 + visibleCompetitors.length} className="px-4 py-16 text-center text-xs font-semibold text-[#82909d]">Завантаження нового дашборда…</td></tr>
                      )}
                      {!loading && data?.rows.length === 0 && (
                        <tr><td colSpan={5 + visibleCompetitors.length} className="px-4 py-16 text-center text-xs font-semibold text-[#82909d]">За цими фільтрами товарів не знайдено</td></tr>
                      )}
                      {(data?.rows || []).map((row) => (
                        <tr key={row.productId} className="border-t border-[#edf0f2] align-top hover:bg-[#fbfcfd]">
                          <td className="max-w-48 px-3 py-3">
                            <div className="truncate text-[11px] font-bold text-[#34404c]" title={row.category || ""}>{row.category || "Без категорії"}</div>
                          </td>
                          <td className="max-w-40 px-3 py-3">
                            <div className="truncate text-[10px] font-semibold text-[#6f7983]" title={row.brand || ""}>{row.brand || "Без бренду"}</div>
                          </td>
                          <td className="px-3 py-3 text-[10px] font-semibold text-[#58636f]">
                            {row.sku ? (
                              <button
                                type="button"
                                onClick={() => copyValue(row.sku, `${row.productId}:sku`)}
                                className="block max-w-36 truncate rounded text-left hover:text-[#118dff] focus:outline-none focus:ring-2 focus:ring-[#9cccf6]"
                                title={`Скопіювати артикул ${row.sku}`}
                              >
                                {row.sku} {copiedKey === `${row.productId}:sku` && <span className="text-[#087a55]">✓</span>}
                              </button>
                            ) : <div>—</div>}
                            <button
                              type="button"
                              onClick={() => copyValue(row.code || row.productId, `${row.productId}:idd`)}
                              className="mt-1 block max-w-36 truncate rounded text-left text-[9px] text-[#9aa2aa] hover:text-[#118dff] focus:outline-none focus:ring-2 focus:ring-[#9cccf6]"
                              title={`Скопіювати IDD ${row.code || row.productId}`}
                            >
                              IDD {row.code || row.productId} {copiedKey === `${row.productId}:idd` && <span className="text-[#087a55]">✓</span>}
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            {row.ourUrl ? <a href={row.ourUrl} target="_blank" rel="noreferrer" className="line-clamp-2 text-[11px] font-semibold leading-4 text-[#26313d] no-underline hover:text-[#118dff]">{row.name}</a> : <span className="line-clamp-2 text-[11px] font-semibold leading-4">{row.name}</span>}
                          </td>
                          <td className="px-3 py-3 text-right text-xs font-black text-[#26313d]">{formatPrice(row.ourPrice)}</td>
                          {visibleCompetitors.map((competitor) => {
                            const cell = row.byCompetitor[competitor.id];
                            const key = `${row.productId}:${competitor.id}`;
                            const competitorUrl = cell?.url || null;
                            return (
                              <td key={competitor.id} className="px-3 py-3 text-right">
                                <div className="flex min-h-[50px] flex-col items-end justify-between">
                                  <div className="flex min-h-7 items-start justify-end">
                                    {cell?.price != null && competitorUrl ? (
                                      <a href={competitorUrl} target="_blank" rel="noreferrer" className="rounded no-underline hover:opacity-75 focus:outline-none focus:ring-2 focus:ring-[#9cccf6]" title={`Відкрити товар на сайті ${competitor.name}`}>
                                        <PriceValue price={cell.price} ourPrice={row.ourPrice} />
                                      </a>
                                    ) : <PriceValue price={cell?.price ?? null} ourPrice={row.ourPrice} />}
                                  </div>
                                  <div className="flex h-5 items-center justify-end gap-1">
                                    <button
                                      onClick={() => reparseCell(row.productId, competitor.id)}
                                      disabled={Boolean(cellBusy[key])}
                                      className="h-5 w-5 rounded bg-[#eaf5ff] text-[10px] font-bold text-[#0b6fc2] disabled:opacity-50"
                                      title={`Оновити ціну ${competitor.name} для цього товару зараз`}
                                      aria-label={`Оновити ціну ${competitor.name}`}
                                    >{cellBusy[key] ? "…" : "↻"}</button>
                                    <button onClick={() => openUrlEditor(row, competitor)} className="h-5 min-w-[52px] rounded bg-[#edf6ff] px-1.5 text-[9px] font-bold text-[#0b6fc2]">{competitorUrl ? "Ред. URL" : "+ URL"}</button>
                                    <button
                                      onClick={() => void deleteCompetitorUrl(makeUrlEditor(row, competitor))}
                                      disabled={!competitorUrl && cell?.price == null}
                                      className="h-5 w-5 rounded bg-[#fff0f0] text-[9px] font-bold text-[#c64040] disabled:invisible"
                                      title="Видалити URL і поточну ціну конкурента"
                                      aria-label={`Видалити URL ${competitor.name}`}
                                    >×</button>
                                  </div>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <footer className="relative flex flex-col items-center justify-between gap-3 border-t border-[#e5e8eb] px-4 py-3 sm:flex-row">
                  <span className="text-[10px] text-[#8a949e]">Сторінка {data?.page || 1} з {totalPages}</span>
                  <div className="flex max-w-full items-center gap-1 overflow-x-auto pb-1">
                    <button disabled={page <= 1} onClick={() => { setPagePickerOpen(false); setPage((value) => Math.max(1, value - 1)); }} className="whitespace-nowrap rounded-lg border border-[#d8dde3] bg-white px-3 py-1.5 text-[10px] font-bold disabled:opacity-30">← Назад</button>
                    {paginationItems(page, totalPages).map((item) => item === "ellipsis-left" || item === "ellipsis-right" ? (
                      <button key={item} type="button" onClick={openPagePicker} className="h-7 min-w-7 rounded-lg border border-[#d8dde3] bg-white px-1 text-[10px] font-black text-[#63707d]" title="Перейти до сторінки">…</button>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        onClick={() => { setPagePickerOpen(false); setPage(item); }}
                        aria-current={page === item ? "page" : undefined}
                        className={`h-7 min-w-7 rounded-lg border px-1 text-[10px] font-black ${page === item ? "border-[#118dff] bg-[#118dff] text-white" : "border-[#d8dde3] bg-white text-[#63707d]"}`}
                      >{item}</button>
                    ))}
                    <button disabled={page >= totalPages} onClick={() => { setPagePickerOpen(false); setPage((value) => value + 1); }} className="whitespace-nowrap rounded-lg border border-[#bcd8f1] bg-[#edf6ff] px-3 py-1.5 text-[10px] font-bold text-[#0b6fc2] disabled:opacity-30">Далі →</button>
                  </div>
                  {pagePickerOpen && (
                    <form onSubmit={applyPagePicker} className="absolute bottom-14 right-4 z-30 flex items-end gap-2 rounded-xl border border-[#d8dde3] bg-white p-3 shadow-xl">
                      <label className="text-[9px] font-bold uppercase tracking-[.1em] text-[#7d8791]">Сторінка
                        <input autoFocus type="number" min="1" max={totalPages} value={pageDraft} onChange={(event) => setPageDraft(event.target.value)} className="mt-1 block w-24 rounded-lg border border-[#d8dde3] px-2.5 py-2 text-xs outline-none focus:border-[#118dff]" />
                      </label>
                      <button className="rounded-lg border-0 bg-[#118dff] px-3 py-2 text-[10px] font-bold text-white">Перейти</button>
                      <button type="button" onClick={() => setPagePickerOpen(false)} className="rounded-lg bg-[#f1f3f5] px-2.5 py-2 text-[10px] font-bold">×</button>
                    </form>
                  )}
                </footer>
              </div>

              <aside className="space-y-4">
                <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
                  <header className="border-b border-[#e5e8eb] px-4 py-3">
                    <h3 className="text-xs font-black text-[#26313d]">Порушення за конкурентами</h3>
                    <p className="mt-0.5 text-[9px] text-[#8b949e]">Конкурент дешевше Агромат більш ніж на 5%</p>
                  </header>
                  <div className="space-y-3 p-4">
                    <div className="relative mx-auto mb-5 h-44 w-44" onMouseLeave={() => setHoveredViolation(null)}>
                      <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" role="img" aria-label="Розподіл порушень за конкурентами">
                        <circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="#edf0f3" strokeWidth="7" />
                        {(() => {
                          let offset = 0;
                          return (data?.violations || []).filter((item) => item.count > 0).map((item, index) => {
                            const percentage = violationTotal ? (item.count / violationTotal) * 100 : 0;
                            const currentOffset = offset;
                            offset += percentage;
                            return (
                              <circle
                                key={item.competitorId}
                                cx="21"
                                cy="21"
                                r="15.9155"
                                fill="transparent"
                                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                                strokeWidth={hoveredViolation === item.competitorId || violationCompetitorId === item.competitorId ? "8.5" : "7"}
                                strokeDasharray={`${percentage} ${100 - percentage}`}
                                strokeDashoffset={-currentOffset}
                                pathLength="100"
                                className="cursor-pointer transition-all"
                                onMouseEnter={() => setHoveredViolation(item.competitorId)}
                                onClick={() => filterByViolation(item.competitorId, item.competitor)}
                              >
                                <title>{item.competitor}: {item.count}</title>
                              </circle>
                            );
                          });
                        })()}
                      </svg>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                        <b className="max-w-24 text-[11px] leading-4 text-[#26313d]">{hoveredViolationItem?.competitor || formatNumber(violationTotal)}</b>
                        <span className="mt-0.5 text-[9px] text-[#87919b]">{hoveredViolationItem ? `${formatNumber(hoveredViolationItem.count)} порушень` : "усі порушення"}</span>
                      </div>
                    </div>
                    {(data?.violations || []).slice(0, 8).map((item, index) => {
                      const max = Math.max(1, data?.violations[0]?.count || 1);
                      const active = violationCompetitorId === item.competitorId;
                      return (
                        <button key={item.competitorId} type="button" onClick={() => filterByViolation(item.competitorId, item.competitor)} className={`block w-full rounded-lg p-1.5 text-left transition ${active ? "bg-[#edf6ff] ring-1 ring-[#9cccf6]" : "hover:bg-[#f7f9fb]"}`}>
                          <div className="mb-1 flex items-center justify-between text-[10px]"><span className="font-semibold text-[#59646f]">{index + 1}. {item.competitor}</span><b className="text-[#26313d]">{formatNumber(item.count)}</b></div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-[#edf0f3]"><div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.round((item.count / max) * 100))}%`, background: CHART_COLORS[index % CHART_COLORS.length] }} /></div>
                        </button>
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

      {urlEditor && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-[#11182799] p-4" onMouseDown={() => !urlSaving && setUrlEditor(null)}>
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[.16em] text-[#118dff]">{urlEditor.competitor}</div>
                <h3 className="mt-1 text-base font-black text-[#26313d]">{urlEditor.originalUrl ? "Редагувати URL конкурента" : "Додати URL конкурента"}</h3>
                <p className="mt-1 line-clamp-2 text-[10px] text-[#7c8792]">{urlEditor.product}</p>
              </div>
              <button disabled={urlSaving} onClick={() => setUrlEditor(null)} className="rounded-lg bg-[#f1f3f5] px-2 py-1 text-sm disabled:opacity-50">×</button>
            </div>
            <label className="block text-[10px] font-bold uppercase tracking-[.1em] text-[#68737e]">URL товару конкурента
              <input autoFocus type="url" value={urlEditor.value} onChange={(event) => setUrlEditor((current) => current ? { ...current, value: event.target.value } : current)} placeholder="https://competitor.ua/product/..." className="mt-1.5 w-full rounded-xl border border-[#d8dde3] px-3 py-2.5 text-xs outline-none focus:border-[#118dff]" />
            </label>
            <div className="mt-4 flex flex-wrap justify-between gap-2">
              <div>
                {urlEditor.originalUrl && <button disabled={urlSaving} onClick={() => void deleteCompetitorUrl()} className="rounded-lg border border-[#efb5b5] bg-[#fff1f1] px-3 py-2 text-xs font-bold text-[#bd3b3b] disabled:opacity-50">Видалити URL і ціну</button>}
              </div>
              <div className="flex gap-2">
                <button disabled={urlSaving} onClick={() => setUrlEditor(null)} className="rounded-lg border border-[#d8dde3] bg-white px-4 py-2 text-xs font-bold disabled:opacity-50">Скасувати</button>
                <button disabled={urlSaving || !urlEditor.value.trim()} onClick={() => void saveCompetitorUrl()} className="rounded-lg border-0 bg-[#118dff] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{urlSaving ? "Збереження…" : "Зберегти"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cabinetMode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#111827a6] p-4" onMouseDown={() => setCabinetMode(null)}>
          <div className="max-h-[88dvh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between border-b border-[#e4e8ec] px-5 py-4">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[.18em] text-[#118dff]">Безпечне керування</div>
                <h3 className="mt-1 text-lg font-black text-[#24303c]">{cabinetMode === "sessions" ? "Актуальні сесії" : cabinetMode === "logs" ? "Логи змін" : "Особистий кабінет"}</h3>
                <p className="mt-1 text-[10px] text-[#7d8791]">{cabinetMode === "sessions" ? "Пристрої, активні у дашборді протягом останніх 30 хвилин." : cabinetMode === "logs" ? "Додавання, редагування і видалення URL та цін конкурентів." : "Стан джерел і ручний запуск оновлень."}</p>
              </div>
              <button onClick={() => setCabinetMode(null)} className="rounded-lg bg-[#f0f3f5] px-2.5 py-1.5 text-sm text-[#58636d]">×</button>
            </header>

            {cabinetMode === "sessions" ? (
              <div className="p-5">
                <button onClick={() => setCabinetMode("menu")} className="mb-4 rounded-lg border border-[#cbd9e7] bg-[#f3f8fd] px-3 py-2 text-[10px] font-bold text-[#0b6fc2]">← Назад до кабінету</button>
                <div className="overflow-hidden rounded-xl border border-[#dfe4ea]">
                  <div className="grid grid-cols-[1.3fr_.8fr_1fr] gap-3 bg-[#f5f7f9] px-4 py-2 text-[9px] font-black uppercase tracking-[.12em] text-[#8a949e]"><span>Пристрій</span><span>IP</span><span>Час входу</span></div>
                  {sessionsLoading && <div className="p-8 text-center text-xs text-[#7d8791]">Завантаження сесій…</div>}
                  {!sessionsLoading && sessions.length === 0 && <div className="p-8 text-center text-xs text-[#7d8791]">Активних сесій не знайдено</div>}
                  {!sessionsLoading && sessions.map((session) => (
                    <div key={session.id} className="grid grid-cols-[1.3fr_.8fr_1fr] gap-3 border-t border-[#edf0f2] px-4 py-3 text-[10px]">
                      <div><b className="text-[#34404c]">{session.device}</b><div className="mt-1 text-[9px] text-[#95a0aa]">активна {formatDateTime(session.lastSeen)}</div></div>
                      <span className="font-mono text-[#596571]">{session.ip}</span>
                      <span className="text-[#596571]">{formatDateTime(session.firstSeen)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : cabinetMode === "logs" ? (
              <div className="p-5">
                <button onClick={() => setCabinetMode("menu")} className="mb-4 rounded-lg border border-[#cbd9e7] bg-[#f3f8fd] px-3 py-2 text-[10px] font-bold text-[#0b6fc2]">← Назад до кабінету</button>
                <div className="max-h-[58dvh] overflow-auto rounded-xl border border-[#dfe4ea]">
                  <div className="sticky top-0 grid min-w-[900px] grid-cols-[1.15fr_.7fr_1fr_1fr_1.2fr_1.3fr] gap-3 bg-[#f5f7f9] px-4 py-2 text-[9px] font-black uppercase tracking-[.1em] text-[#8a949e]"><span>Пристрій</span><span>IP</span><span>Час</span><span>Конкурент</span><span>Дія</span><span>Посилання</span></div>
                  {changeLogsLoading && <div className="p-8 text-center text-xs text-[#7d8791]">Завантаження логів…</div>}
                  {!changeLogsLoading && changeLogs.length === 0 && <div className="p-8 text-center text-xs text-[#7d8791]">Змін URL ще не зафіксовано</div>}
                  {!changeLogsLoading && changeLogs.map((item) => (
                    <div key={item.id} className="grid min-w-[900px] grid-cols-[1.15fr_.7fr_1fr_1fr_1.2fr_1.3fr] gap-3 border-t border-[#edf0f2] px-4 py-3 text-[10px]">
                      <span className="font-semibold text-[#34404c]">{item.device}</span>
                      <span className="font-mono text-[#596571]">{item.ip}</span>
                      <span className="text-[#596571]">{formatDateTime(item.at)}</span>
                      <span className="font-semibold text-[#34404c]">{item.competitor}</span>
                      <span className="text-[#596571]">{changeActionLabel(item.action)}</span>
                      <span className="flex flex-col items-start gap-1">
                        {item.productUrl && <a href={item.productUrl} target="_blank" rel="noreferrer" className="max-w-44 truncate text-[#118dff] no-underline" title={item.product}>Товар AGROMAT ↗</a>}
                        {item.competitorUrl && <a href={item.competitorUrl} target="_blank" rel="noreferrer" className="max-w-44 truncate text-[#7c3aed] no-underline" title={`${item.competitor}: ${item.product}`}>Товар конкурента ↗</a>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-h-[70dvh] space-y-3 overflow-auto p-5">
                <button onClick={showSessions} className="flex w-full items-center justify-between rounded-xl border border-[#cfe1f2] bg-[#f2f8fe] px-4 py-3 text-left">
                  <span><b className="block text-xs text-[#23415d]">Актуальні сесії</b><small className="mt-1 block text-[9px] text-[#71808e]">Пристрій · IP · час входу</small></span><span className="text-[#118dff]">→</span>
                </button>
                <button onClick={showChangeLogs} className="flex w-full items-center justify-between rounded-xl border border-[#d9d0f2] bg-[#f7f3ff] px-4 py-3 text-left">
                  <span><b className="block text-xs text-[#49326d]">Логи змін</b><small className="mt-1 block text-[9px] text-[#7c6c93]">URL і ціни конкурентів · пристрій · IP · час</small></span><span className="text-[#7c3aed]">→</span>
                </button>
                {localRunnerHelp && (
                  <div className="rounded-xl border border-[#f2c66d] bg-[#fff9e8] p-4 text-[10px] leading-5 text-[#6f5311]">
                    <b className="block text-xs text-[#5b430e]">Для Vannaja потрібен локальний runner</b>
                    <ol className="mt-2 list-decimal pl-4">
                      <li>Якщо runner уже працював, зупиніть його у старому Terminal через <b>Ctrl+C</b>.</li>
                      <li>Відкрийте Terminal у папці <b>agromat-content-analytics</b> і запустіть <code className="rounded bg-white px-1.5 py-0.5 font-mono">npm run local-parser-runner</code>.</li>
                      <li>Дочекайтеся повідомлення «Підключено до dashboard», не закривайте Terminal і ще раз натисніть «Оновити Vannaja».</li>
                    </ol>
                    <div className="mt-2 text-[9px] text-[#8a6b1e]">Після успішного запуску прогрес з’явиться у верхній частині основного дашборда; дані оновляться автоматично після завершення.</div>
                    <button onClick={() => copyValue("npm run local-parser-runner", "local-runner-command")} className="mt-2 rounded-lg border border-[#e5bd65] bg-white px-2.5 py-1 text-[9px] font-bold text-[#6f5311]">{copiedKey === "local-runner-command" ? "Скопійовано ✓" : "Скопіювати команду"}</button>
                  </div>
                )}
                <button disabled={Boolean(runningAction) || Boolean(jobRunning)} onClick={runAgromatUpdate} className="flex w-full items-center justify-between rounded-xl border border-[#dfe4ea] bg-white px-4 py-3 text-left disabled:opacity-55">
                  <span><b className="block text-xs text-[#34404c]">Оновити API Agromat</b><small className="mt-1 block text-[9px] text-[#87919b]">Останнє оновлення: {formatDateTime(agromatUpdatedAt)}</small></span><span className="rounded-lg bg-[#eaf5ff] px-2.5 py-1.5 text-[10px] font-bold text-[#0b6fc2]">{runningAction === "agromat" ? "Оновлення…" : "Оновити"}</span>
                </button>
                <div className="pt-2 text-[9px] font-black uppercase tracking-[.15em] text-[#8a949e]">Конкуренти</div>
                {(data?.updates || []).map((update) => (
                  <button key={update.competitorId} disabled={Boolean(runningAction) || Boolean(jobRunning)} onClick={() => runCompetitorUpdate(update.adapter, update.competitor)} className="flex w-full items-center justify-between rounded-xl border border-[#dfe4ea] bg-white px-4 py-3 text-left disabled:opacity-55">
                    <span><b className="block text-xs text-[#34404c]">Оновити {update.competitor}</b><small className="mt-1 block text-[9px] text-[#87919b]">Останнє оновлення: {formatDateTime(update.updatedAt)}</small></span><span className="rounded-lg bg-[#eaf5ff] px-2.5 py-1.5 text-[10px] font-bold text-[#0b6fc2]">{runningAction === canonicalParserAdapter(update.adapter) ? "Запуск…" : "Оновити"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
