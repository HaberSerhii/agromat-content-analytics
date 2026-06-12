"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SalesRow = {
  docsRef: string;
  number: string;
  createdDate: string;
  shippedDate: string | null;
  seller: string;
  state: string;
  docsSum: number;
  returnSum: number;
  goodsCount: number;
  goodsCodes: string;
  trademarksNames: string;
  groupRefs: string;
  goodsNames: string;
  margin: number | null;
  stockm: string;
  planGroup: string;
};

type BucketSummary = {
  label: string;
  docs: number;
  goods: number;
  revenue: number;
  avgMargin: number | null;
};

type SalesDataset = {
  source: {
    bucket: string;
    key: string;
    size: number | null;
    lastModified: string | null;
    refreshPolicy: string;
    nextRefreshAt: string | null;
  };
  filter: {
    from: string | null;
    to: string | null;
    label: string;
    productCodes: number[];
    matchedProductCodes: number[];
    statuses: string[];
  };
  rows: SalesRow[];
  summary: {
    totalDocs: number;
    shippedDocs: number;
    shippedGoods: number;
    shippedRevenue: number;
    canceledDocs: number;
    returnedRevenue: number;
    firstShippedDate: string | null;
    lastShippedDate: string | null;
    selected: {
      docs: number;
      goods: number;
      revenue: number;
      returnedRevenue: number;
      canceledDocs: number;
      canceledRevenue: number;
    };
    plan: {
      month: string;
      plan: number | null;
      revenue: number;
      goods: number;
      docs: number;
      completionPct: number | null;
      segments: Array<{
        segment: string;
        plan: number;
        revenue: number;
        goods: number;
        docs: number;
        completionPct: number | null;
      }>;
      previousMonthRevenue: number;
      revenueDeltaPct: number | null;
      forecastRevenue: number | null;
      forecastCompletionPct: number | null;
      elapsedDays: number;
      daysInMonth: number;
    };
    byDate: Array<{ date: string; docs: number; goods: number; revenue: number }>;
    months: Array<{ month: string; docs: number; goods: number; revenue: number }>;
    segments: BucketSummary[];
    brands: BucketSummary[];
    categories: BucketSummary[];
    states: Array<{ state: string; docs: number; revenue: number }>;
    availableStates: Array<{ state: string; docs: number; revenue: number }>;
  };
};

type SavedProductSet = { id: string; name: string; ids: number[]; rawText: string; createdAt: number };
const SALES_SETS_KEY = "agromat.analytics.salesSets.v1";

const numberFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });
const STATUS_FILTERS = [
  { label: "Повністю відвантажений", value: "Повністю відвантажений" },
  { label: "Скасована", value: "Скасована" },
  { label: "Відвантаження дозволено", value: "відвантаження дозволено" },
  { label: "Сформовано", value: "сформовано" },
] as const;

function fmtMoney(value: number) {
  return `${numberFmt.format(value)} грн`;
}

function fmtNum(value: number) {
  return numberFmt.format(value);
}

function fmtPct(value: number | null) {
  return value == null ? "—" : `${pctFmt.format(value)}%`;
}

function fmtIsoDateShort(value: string) {
  const [year, month, day] = value.split("-");
  return day && month && year ? `${day}-${month}-${year}` : value;
}

function fmtStatusLabel(status: string) {
  return STATUS_FILTERS.find((item) => item.value === status)?.label || status;
}

function KpiCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
        <div className="text-xs font-semibold uppercase tracking-normal" style={{ color: "var(--text-dim)" }}>{label}</div>
      </div>
      <div className="mt-2 text-2xl font-black" style={{ color: "var(--text)" }}>{value}</div>
      {hint && <div className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>{hint}</div>}
    </div>
  );
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-3 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

function RankingList({ title, items, maxRevenue, color }: { title: string; items: BucketSummary[]; maxRevenue: number; color: string }) {
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" }}>
      <div className="text-sm font-bold mb-3" style={{ color: "var(--text)" }}>{title}</div>
      <div className="space-y-2">
        {items.slice(0, 10).map((item) => (
          <div key={item.label} className="grid gap-2 md:grid-cols-[190px_1fr_170px] md:items-center">
            <div className="text-xs font-semibold truncate" style={{ color: "var(--text)" }} title={item.label}>{item.label}</div>
            <ProgressBar value={(item.revenue / maxRevenue) * 100} color={color} />
            <div className="text-xs md:text-right" style={{ color: "var(--text-dim)" }}>
              {fmtMoney(item.revenue)} · {fmtNum(item.goods)} шт
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusFilter({
  selectedStatuses,
  onReset,
  onToggle,
}: {
  selectedStatuses: string[];
  onReset: () => void;
  onToggle: (status: string) => void;
}) {
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" }}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReset}
          className="h-8 rounded-lg px-3 text-xs font-bold border"
          style={{
            borderColor: selectedStatuses.length ? "var(--border)" : "#118dff",
            background: selectedStatuses.length ? "var(--bg-input)" : "#118dff",
            color: selectedStatuses.length ? "var(--text)" : "#fff",
          }}
        >
          Усі статуси
        </button>
        {STATUS_FILTERS.map((status) => {
          const active = selectedStatuses.includes(status.value);
          return (
            <button
              key={status.value}
              type="button"
              onClick={() => onToggle(status.value)}
              className="h-8 rounded-lg px-3 text-xs font-bold border"
              style={{
                borderColor: active ? "#118dff" : "var(--border)",
                background: active ? "#118dff" : "var(--bg-input)",
                color: active ? "#fff" : "var(--text)",
              }}
            >
              {status.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function parseBulkIds(text: string) {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const part of text.split(/[\s,;|]+/)) {
    const n = parseInt(part.trim(), 10);
    if (Number.isFinite(n) && !seen.has(n)) {
      seen.add(n);
      ids.push(n);
    }
  }
  return ids;
}

function ProductSetModal({ initialText, onApply, onClose }: {
  initialText: string;
  onApply: (ids: number[], rawText: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const parsed = useMemo(() => parseBulkIds(text), [text]);

  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.45)" }} onClick={onClose}>
      <div className="rounded-xl flex flex-col" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", width: "100%", maxWidth: 560 }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>Додати набір товарів</div>
          <button onClick={onClose} className="px-3 py-1 rounded-lg text-xs border-0" style={{ background: "var(--bg-input)", color: "var(--text-mid)" }}>Закрити</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs" style={{ color: "var(--text-dim)" }}>
            Встав IDD / code товарів через пробіл, кому, табуляцію або новий рядок. Продажі будуть відфільтровані по документах, де є хоча б один товар з набору.
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={9}
            autoFocus
            placeholder={"305190, 598397\n533613 533629"}
            className="w-full rounded-lg px-3 py-2 text-xs border outline-none tabular-nums"
            style={{ background: "var(--bg-input)", color: "var(--text)", borderColor: "var(--border2)", resize: "vertical", fontFamily: "monospace" }}
          />
          <div className="text-xs tabular-nums" style={{ color: parsed.length ? "#107c10" : "var(--text-dim)" }}>
            {parsed.length ? `Розпізнано ${fmtNum(parsed.length)} унікальних IDD` : "Встав IDD щоб застосувати фільтр"}
          </div>
        </div>
        <div className="p-4 border-t flex items-center justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <button onClick={onClose} className="h-9 rounded-lg px-3 text-xs font-bold border" style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text)" }}>Скасувати</button>
          <button
            onClick={() => {
              if (!parsed.length) return;
              onApply(parsed, text);
              onClose();
            }}
            disabled={!parsed.length}
            className="h-9 rounded-lg px-3 text-xs font-bold border disabled:opacity-50"
            style={{ borderColor: "#118dff", background: "#118dff", color: "#fff" }}
          >
            Застосувати ({fmtNum(parsed.length)})
          </button>
        </div>
      </div>
    </div>
  );
}

async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function toInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthRange() {
  const now = new Date();
  return {
    from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
    to: toInputDate(now),
  };
}

function previousMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: toInputDate(first), to: toInputDate(last) };
}

export function SalesDashboard() {
  const initialRange = useMemo(() => currentMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [productSet, setProductSet] = useState<{ ids: number[]; rawText: string } | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [showProductSetModal, setShowProductSetModal] = useState(false);
  const [savedSets, setSavedSets] = useState<SavedProductSet[]>([]);
  const [setName, setSetName] = useState("");
  const [data, setData] = useState<SalesDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(SALES_SETS_KEY) || "[]");
      if (Array.isArray(value)) setSavedSets(value);
    } catch {}
  }, []);

  const persistSavedSets = (next: SavedProductSet[]) => {
    setSavedSets(next);
    localStorage.setItem(SALES_SETS_KEY, JSON.stringify(next));
  };

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    if (hasLoadedRef.current) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    const params = new URLSearchParams();
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (productSet?.ids.length) params.set("product_codes", productSet.ids.join(","));
    selectedStatuses.forEach((status) => params.append("status", status));
    fetch(`/api/sales?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Не вдалося завантажити аналіз продаж");
        return json as SalesDataset;
      })
      .then((json) => {
        if (!alive) return;
        setData(json);
        setError(null);
        hasLoadedRef.current = true;
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Не вдалося завантажити аналіз продаж");
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [dateFrom, dateTo, productSet, selectedStatuses]);
  const maxBrandRevenue = useMemo(
    () => Math.max(1, ...(data?.summary.brands || []).map((item) => item.revenue)),
    [data],
  );
  const maxCategoryRevenue = useMemo(
    () => Math.max(1, ...(data?.summary.categories || []).map((item) => item.revenue)),
    [data],
  );

  if (loading) {
    return (
      <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>
        Завантаження аналізу продаж з AWS S3…
      </div>
    );
  }

  if (!data && error) {
    return (
      <div className="rounded-xl border p-5" style={{ borderColor: "rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)" }}>
        <div className="text-sm font-bold" style={{ color: "#b91c1c" }}>Аналіз продаж не завантажився</div>
        <div className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-xs py-6 text-center" style={{ color: "var(--text-dim)" }}>
        Завантаження аналізу продаж з AWS S3…
      </div>
    );
  }

  const plan = data.summary.plan;
  const planPct = plan.completionPct ?? 0;
  const forecastPct = plan.forecastCompletionPct ?? null;
  const statusLabel = selectedStatuses.length ? selectedStatuses.map(fmtStatusLabel).join(", ") : "усіх статусів";
  const applyCurrentMonth = () => {
    const range = currentMonthRange();
    setDateFrom(range.from);
    setDateTo(range.to);
  };
  const applyPreviousMonth = () => {
    const range = previousMonthRange();
    setDateFrom(range.from);
    setDateTo(range.to);
  };
  const applyAllPeriod = () => {
    setDateFrom("");
    setDateTo("");
  };
  const toggleStatus = (status: string) => {
    setSelectedStatuses((current) => (
      current.includes(status)
        ? current.filter((item) => item !== status)
        : [...current, status]
    ));
  };
  const resetStatuses = () => setSelectedStatuses([]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black m-0" style={{ color: "var(--text)" }}>Аналіз продаж</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {refreshing && (
            <div className="text-xs rounded-lg border px-3 py-2" style={{ borderColor: "rgba(17,141,255,.28)", color: "#075985", background: "rgba(17,141,255,.08)" }}>
              Оновлення…
            </div>
          )}
          {error && (
            <div className="text-xs rounded-lg border px-3 py-2" style={{ borderColor: "rgba(239,68,68,.35)", color: "#b91c1c", background: "rgba(239,68,68,.08)" }}>
              {error}
            </div>
          )}
        </div>
      </div>

      <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" }}>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-dim)" }}>З дати відвантаження</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-9 rounded-lg border px-3 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text)" }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-dim)" }}>По дату відвантаження</label>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="h-9 rounded-lg border px-3 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text)" }}
            />
          </div>
          <button type="button" onClick={applyCurrentMonth} className="h-9 rounded-lg px-3 text-xs font-bold border" style={{ borderColor: "var(--border)", background: "#118dff", color: "#fff" }}>
            Поточний місяць
          </button>
          <button type="button" onClick={applyPreviousMonth} className="h-9 rounded-lg px-3 text-xs font-bold border" style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text)" }}>
            Минулий місяць
          </button>
          <button type="button" onClick={applyAllPeriod} className="h-9 rounded-lg px-3 text-xs font-bold border" style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text)" }}>
            Весь період
          </button>
          <button
            type="button"
            onClick={() => setShowProductSetModal(true)}
            className="h-9 rounded-lg px-3 text-xs font-bold border"
            style={{ borderColor: productSet ? "#118dff" : "var(--border)", background: productSet ? "#118dff" : "var(--bg-input)", color: productSet ? "#fff" : "var(--text)" }}
          >
            Додати набір товарів{productSet ? ` (${fmtNum(productSet.ids.length)})` : ""}
          </button>
          {productSet && (
            <button type="button" onClick={() => setProductSet(null)} className="h-9 rounded-lg px-3 text-xs font-bold border" style={{ borderColor: "rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)", color: "#b91c1c" }}>
              Скинути набір
            </button>
          )}
          <div className="text-xs ml-auto" style={{ color: "var(--text-dim)" }}>
            Обрано: <b style={{ color: "var(--text)" }}>{data.filter.label}</b>
          </div>
        </div>
        {productSet && (
          <div className="mt-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "rgba(17,141,255,.28)", background: "rgba(17,141,255,.08)", color: "var(--text-dim)" }}>
            Набір товарів: запитано <b style={{ color: "var(--text)" }}>{fmtNum(productSet.ids.length)}</b>, знайдено у продажах <b style={{ color: "var(--text)" }}>{fmtNum(data.filter.matchedProductCodes.length)}</b>.
          </div>
        )}
        {productSet && (
          <div className="mt-3 flex gap-2 flex-wrap">
            <input value={setName} onChange={(event) => setSetName(event.target.value)} placeholder="Назва сегмента"
              className="h-9 rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text)" }} />
            <button type="button" onClick={() => {
              const name = setName.trim();
              if (!name) return;
              const next = { id: `${Date.now()}`, name, ...productSet, createdAt: Date.now() };
              persistSavedSets([next, ...savedSets.filter((item) => item.name.toLowerCase() !== name.toLowerCase())]);
              setSetName("");
            }} className="h-9 rounded-lg px-3 text-xs font-bold border" style={{ borderColor: "#118dff", background: "#118dff", color: "#fff" }}>
              Зберегти сегмент
            </button>
          </div>
        )}
        {savedSets.length > 0 && (
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {savedSets.map((set) => (
              <div key={set.id} className="rounded-lg border px-3 py-2 flex items-center gap-2" style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}>
                <button type="button" onClick={() => setProductSet({ ids: set.ids, rawText: set.rawText })} className="text-left border-0 bg-transparent flex-1 min-w-0">
                  <div className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{set.name}</div>
                  <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>{fmtNum(set.ids.length)} IDD</div>
                </button>
                <button type="button" title="Скопіювати всі IDD" onClick={() => copyText(set.ids.join("\n"))} className="h-8 px-2 rounded-lg border text-xs" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>Копіювати</button>
                <button type="button" title="Видалити" onClick={() => persistSavedSets(savedSets.filter((item) => item.id !== set.id))} className="h-8 px-2 rounded-lg border text-xs" style={{ borderColor: "rgba(239,68,68,.35)", color: "#b91c1c", background: "rgba(239,68,68,.08)" }}>×</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <StatusFilter
        selectedStatuses={selectedStatuses}
        onReset={resetStatuses}
        onToggle={toggleStatus}
      />

      <section className="rounded-xl border p-5" style={{ borderColor: "rgba(17,141,255,.28)", background: "linear-gradient(135deg, rgba(17,141,255,.10), rgba(34,197,94,.10))", boxShadow: "var(--shadow-sm)" }}>
        <div className="grid gap-5 xl:items-center">
          <div>
            <div className="text-xs font-semibold uppercase tracking-normal" style={{ color: "var(--text-dim)" }}>
              План місяця · {plan.month}
            </div>
            <div className="mt-2 flex items-end gap-3 flex-wrap">
              <div className="text-3xl font-black" style={{ color: "var(--text)" }}>{fmtMoney(plan.revenue)}</div>
              <div className="text-sm pb-1" style={{ color: "var(--text-dim)" }}>
                {plan.plan ? `з плану ${fmtMoney(plan.plan)}` : "план ще не заданий"}
              </div>
            </div>
            <div className="mt-4">
              <ProgressBar value={planPct} color={planPct >= 100 ? "#22c55e" : "#118dff"} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3 text-xs">
              <div style={{ color: "var(--text-dim)" }}>Виконання: <b style={{ color: "var(--text)" }}>{fmtPct(plan.completionPct)}</b></div>
              <div style={{ color: "var(--text-dim)" }}>Прогноз: <b style={{ color: "var(--text)" }}>{plan.forecastRevenue ? fmtMoney(plan.forecastRevenue) : "—"}</b></div>
              <div style={{ color: "var(--text-dim)" }}>Прогноз плану: <b style={{ color: "var(--text)" }}>{fmtPct(forecastPct)}</b></div>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {plan.segments.filter((segment) => segment.segment !== "Інше").map((segment) => (
                <div key={segment.segment} className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "rgba(255,255,255,.54)" }}>
                  <div className="text-xs font-bold" style={{ color: "var(--text)" }}>{segment.segment}</div>
                  <div className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>{fmtMoney(segment.revenue)} з {fmtMoney(segment.plan)}</div>
                  <div className="mt-2"><ProgressBar value={segment.completionPct || 0} color="#118dff" /></div>
                  <div className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>{fmtPct(segment.completionPct)} · {fmtNum(segment.goods)} шт</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Сума документів" value={fmtMoney(data.summary.selected.revenue)} hint={`${fmtNum(data.summary.selected.docs)} документів · ${statusLabel}`} accent="#118dff" />
        <KpiCard label="Товарів у документах" value={fmtNum(data.summary.selected.goods)} hint={`за фільтром ${statusLabel}`} accent="#22c55e" />
        <KpiCard label="Повернення" value={fmtMoney(data.summary.selected.returnedRevenue)} accent="#f59e0b" />
        <KpiCard label="Скасовано" value={fmtNum(data.summary.selected.canceledDocs)} hint={fmtMoney(data.summary.selected.canceledRevenue)} accent="#ef4444" />
      </div>

      <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" }}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>Продажі по датах відвантаження</div>
          <div className="text-xs" style={{ color: "var(--text-dim)" }}>
            Період: {data.summary.firstShippedDate || "—"} — {data.summary.lastShippedDate || "—"}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead style={{ background: "var(--bg-input)", color: "var(--text-dim)" }}>
              <tr>
                <th className="text-left px-3 py-2">Дата відвантаження</th>
                <th className="text-left px-3 py-2 w-[420px]">Документи</th>
                <th className="text-left px-3 py-2 w-[420px]">Товари</th>
                <th className="text-left px-3 py-2 w-[420px]">Сума</th>
              </tr>
            </thead>
            <tbody>
              {data.summary.byDate.map((day) => (
                <tr key={day.date} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--text)" }}>{fmtIsoDateShort(day.date)}</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: "var(--text)" }}>{fmtNum(day.docs)}</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: "var(--text-dim)" }}>{fmtNum(day.goods)}</td>
                  <td className="px-3 py-2 font-bold tabular-nums" style={{ color: "var(--text)" }}>{fmtMoney(day.revenue)}</td>
                </tr>
              ))}
              {!data.summary.byDate.length && (
                <tr>
                  <td className="px-3 py-6 text-center" colSpan={4} style={{ color: "var(--text-dim)" }}>Немає відвантажень під обрані фільтри</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <RankingList title="Бренди" items={data.summary.brands} maxRevenue={maxBrandRevenue} color="#22c55e" />

      <section className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
        <RankingList title="Категорії" items={data.summary.categories} maxRevenue={maxCategoryRevenue} color="#f59e0b" />
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" }}>
          <div className="text-sm font-bold mb-3" style={{ color: "var(--text)" }}>Статуси документів</div>
          <div className="space-y-2">
            {data.summary.states.map((state) => (
              <div key={state.state} className="grid grid-cols-3 gap-3 text-xs">
                <span className="font-semibold" style={{ color: "var(--text)" }}>{state.state}</span>
                <span className="tabular-nums" style={{ color: "var(--text-dim)" }}>{fmtNum(state.docs)}</span>
                <span className="tabular-nums" style={{ color: "var(--text-dim)" }}>{fmtMoney(state.revenue)}</span>
              </div>
            ))}
            {!data.summary.states.length && (
              <div className="text-xs" style={{ color: "var(--text-dim)" }}>Немає статусів під обрані фільтри</div>
            )}
          </div>
        </section>
      </section>

      {showProductSetModal && (
        <ProductSetModal
          initialText={productSet?.rawText || ""}
          onApply={(ids, rawText) => setProductSet({ ids, rawText })}
          onClose={() => setShowProductSetModal(false)}
        />
      )}
    </div>
  );
}
