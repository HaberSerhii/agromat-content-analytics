"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AnalyticsSignal,
  CpoDiagnosticResult,
  CpoPeriodAvailability,
  DiagnosticNode,
  MetricResult,
  MetricStatus,
  SegmentContribution,
  SignalCategory,
  SignalSeverity,
} from "@/lib/cpo-analytics/types";

const numberFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });
const moneyFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

const STATUS: Record<MetricStatus, { label: string; color: string; background: string }> = {
  good: { label: "Добре", color: "#107c10", background: "#e8f5e9" },
  neutral: { label: "Стабільно", color: "#45515d", background: "#eef1f4" },
  warning: { label: "Увага", color: "#8a5d00", background: "#fff4ce" },
  high: { label: "Високий", color: "#c35400", background: "#fff0e6" },
  critical: { label: "Критично", color: "#a4262c", background: "#fde7e9" },
  insufficient_data: { label: "Мало даних", color: "#68737e", background: "#f3f4f5" },
};

const SEVERITY_LABEL: Record<SignalSeverity | "healthy", string> = {
  healthy: "У нормі",
  info: "Інформація",
  warning: "Увага",
  high: "Високий",
  critical: "Критично",
};

const CATEGORY_LABEL: Record<SignalCategory, string> = {
  TRAFFIC: "Трафік",
  MARKETING: "Маркетинг",
  UX: "Зручність",
  CONTENT: "Контент",
  COMMERCIAL: "Комерція",
  TECH: "Технічне",
  PAYMENT: "Оплата",
  DELIVERY: "Доставка",
  SEARCH: "Пошук",
  UNKNOWN: "Не визначено",
};

function deltaText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatValue(metric: MetricResult, value: number | null): string {
  if (value == null) return "—";
  if (metric.format === "currency") return `${moneyFormat.format(value)} грн`;
  if (metric.format === "percent") return `${numberFormat.format(value)}%`;
  return moneyFormat.format(value);
}

function money(value: number): string {
  return `${moneyFormat.format(value)} грн`;
}

function StatusBadge({ status }: { status: MetricStatus }) {
  const style = STATUS[status];
  return <span className="rounded-full px-2 py-1 text-[10px] font-black" style={{ color: style.color, background: style.background }}>{style.label}</span>;
}

function NodeView({ node, depth = 0, onSignal }: { node: DiagnosticNode; depth?: number; onSignal: (id: string) => void }) {
  const style = STATUS[node.status];
  return (
    <div className={depth ? "ml-4 border-l pl-4" : ""} style={{ borderColor: "var(--border2)" }}>
      <button type="button" onClick={() => node.signalId && onSignal(node.signalId)} disabled={!node.signalId} className="my-1 flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left disabled:cursor-default" style={{ borderColor: "var(--border)", background: depth ? "#fbfcfd" : "#fff" }}>
        <span><strong className="text-sm text-[#27313c]">{node.label}</strong><span className="ml-2 text-xs" style={{ color: style.color }}>{deltaText(node.deltaPercent)}</span></span>
        <span className="text-right text-[11px] font-bold text-[#68737e]">Вплив: {money(node.impact)}</span>
      </button>
      {node.children.map((child) => <NodeView key={child.id} node={child} depth={depth + 1} onSignal={onSignal} />)}
    </div>
  );
}

function SignalCard({ signal, onInvestigate }: { signal: AnalyticsSignal; onInvestigate: () => void }) {
  const status = STATUS[signal.severity === "info" ? "warning" : signal.severity];
  return (
    <article className="rounded-2xl border bg-white p-4" style={{ borderColor: status.color + "55" }}>
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: status.color }}>{CATEGORY_LABEL[signal.category]} · Вплив {signal.impactScore}</div><h3 className="mt-1 font-black text-[#27313c]">{signal.title}</h3></div>
        <span className="rounded-full px-2 py-1 text-[10px] font-black" style={{ color: status.color, background: status.background }}>{SEVERITY_LABEL[signal.severity]}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-[#f7f9fb] p-2"><span className="text-[#7f8993]">Зміна</span><div className="font-black text-[#a4262c]">{deltaText(signal.deltaPercent)}</div></div>
        <div className="rounded-lg bg-[#f7f9fb] p-2"><span className="text-[#7f8993]">Надійність оцінки</span><div className="font-black text-[#27313c]">{signal.confidenceScore}%</div></div>
        <div className="rounded-lg bg-[#f7f9fb] p-2"><span className="text-[#7f8993]">Орієнтовно втрачено замовлень</span><div className="font-black text-[#27313c]">≈ {numberFormat.format(signal.estimatedLostOrders)}</div></div>
        <div className="rounded-lg bg-[#f7f9fb] p-2"><span className="text-[#7f8993]">Орієнтовна втрата доходу</span><div className="font-black text-[#27313c]">≈ {money(signal.estimatedRevenueLoss)}</div></div>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#68737e]">{signal.explanation}</p>
      <button type="button" onClick={onInvestigate} className="mt-3 rounded-lg bg-[#118dff] px-3 py-2 text-xs font-black text-white">Розслідувати</button>
    </article>
  );
}

function SegmentTable({ title, rows }: { title: string; rows: SegmentContribution[] }) {
  return (
    <div className="min-w-0 rounded-xl border" style={{ borderColor: "var(--border)" }}>
      <div className="border-b px-3 py-2 text-xs font-black text-[#27313c]" style={{ borderColor: "var(--border)" }}>{title}</div>
      {rows.length ? <div className="overflow-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="text-[#7f8993]"><tr><th className="p-2">Сегмент</th><th className="p-2 text-right">Конверсія</th><th className="p-2 text-right">Зміна</th><th className="p-2 text-right">Внесок</th><th className="p-2 text-right">Втрачено замовлень</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.dimension}:${row.dimensionValue}`} className="border-t" style={{ borderColor: "var(--border)" }}><td className="max-w-56 truncate p-2 font-bold text-[#27313c]" title={row.dimensionValue}>{row.dimensionValue}</td><td className="p-2 text-right">{row.conversionCurrent.toFixed(2)}%</td><td className="p-2 text-right text-[#a4262c]">{deltaText(row.deltaPercent)}</td><td className="p-2 text-right">{row.shareOfTotalLossPct.toFixed(1)}%</td><td className="p-2 text-right">≈ {numberFormat.format(row.estimatedLostOrders)}</td></tr>)}</tbody></table></div> : <div className="p-3 text-xs text-[#7f8993]">Немає негативних сегментів із достатнім обсягом даних.</div>}
    </div>
  );
}

export function CpoAnalyticsDashboard() {
  const [periodKind, setPeriodKind] = useState<"week" | "month">("week");
  const [period, setPeriod] = useState("");
  const [availability, setAvailability] = useState<CpoPeriodAvailability | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [data, setData] = useState<CpoDiagnosticResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function readAvailability() {
      setLoadingAvailability(true);
      setError(null);
      try {
        const response = await fetch("/api/cpo-diagnostics", { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося прочитати доступні періоди");
        if (controller.signal.aborted) return;
        const available = payload as CpoPeriodAvailability;
        setAvailability(available);
        const latest = available.periods.week[0];
        setPeriod(latest ? `${latest.year}:${latest.number}` : "");
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "Не вдалося прочитати доступні періоди");
      } finally {
        if (!controller.signal.aborted) setLoadingAvailability(false);
      }
    }
    void readAvailability();
    return () => controller.abort();
  }, [availabilityAttempt]);

  const availablePeriods = availability?.periods[periodKind] ?? [];
  const selectedPeriod = availablePeriods.find((range) => `${range.year}:${range.number}` === period);
  const selectedSignal = useMemo(() => data?.topSignals.find((signal) => signal.id === selectedSignalId) || null, [data, selectedSignalId]);

  async function load() {
    if (!selectedPeriod) return;
    setLoading(true);
    setData(null);
    setError(null);
    setSelectedSignalId(null);
    try {
      const response = await fetch("/api/cpo-diagnostics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ periodKind, period: selectedPeriod.number, year: selectedPeriod.year, action: "read" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не вдалося виконати діагностику");
      setData(payload as CpoDiagnosticResult);
    } catch (requestError) {
      setData(null);
      setError(requestError instanceof Error ? requestError.message : "Не вдалося виконати діагностику");
    } finally {
      setLoading(false);
    }
  }

  function investigate(id: string) {
    setSelectedSignalId(id);
    requestAnimationFrame(() => document.getElementById("cpo-investigation")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className="promo-v2 min-h-[calc(100vh-92px)] rounded-2xl p-3 sm:p-5" style={{ background: "var(--bg)" }}>
      <section className="rounded-2xl border bg-white p-4 sm:p-6" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="inline-flex rounded-full bg-[#e8f3ff] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#0067b8]">Діагностичний модуль CPO · пілотна версія</div><h1 className="mt-2 text-2xl font-black text-[#27313c]">Центр CPO-аналітики</h1><p className="mt-1 max-w-3xl text-sm text-[#68737e]">Дохід → бізнес-чинник → етап воронки → сегмент із найбільшим внеском. Усі розрахунки виконуються кодом із локального знімка даних.</p></div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold text-[#45515d]">Період<select value={periodKind} disabled={loading || loadingAvailability || !availability} onChange={(event) => {
              const kind = event.target.value as "week" | "month";
              const latest = availability?.periods[kind][0];
              setPeriodKind(kind);
              setPeriod(latest ? `${latest.year}:${latest.number}` : "");
              setData(null);
              setError(null);
              setSelectedSignalId(null);
            }} className="mt-1 block h-10 rounded-lg border bg-white px-3" style={{ borderColor: "var(--border2)" }}><option value="week">Тиждень</option><option value="month">Місяць</option></select></label>
            <label className="text-xs font-bold text-[#45515d]">Доступний період<select value={period} disabled={loading || loadingAvailability || !availablePeriods.length} onChange={(event) => { setPeriod(event.target.value); setData(null); setError(null); setSelectedSignalId(null); }} className="mt-1 block h-10 min-w-36 rounded-lg border bg-white px-3" style={{ borderColor: "var(--border2)" }}>
              {!availablePeriods.length && <option value="">{loadingAvailability ? "Завантажуємо…" : "Немає доступних періодів"}</option>}
              {availablePeriods.map((range) => <option key={`${range.year}:${range.number}`} value={`${range.year}:${range.number}`}>{range.label}</option>)}
            </select></label>
            <button type="button" onClick={() => void load()} disabled={loading || loadingAvailability || !selectedPeriod} className="h-10 rounded-lg bg-[#118dff] px-5 text-sm font-black text-white disabled:opacity-50">{loading ? "Аналізуємо…" : "Запустити діагностику"}</button>
          </div>
        </div>
        <div className="mt-4 rounded-xl border bg-[#f7f9fb] p-3 text-xs text-[#45515d]" style={{ borderColor: "var(--border2)" }}>Країна: Україна · поточний період проти попереднього та аналогічного періоду торік · відкриття не запускає BigQuery{availability && <span className="mt-1 block font-bold">Дані у знімку до {availability.dataTo} · доступні лише завершені періоди в межах знімка</span>}</div>
        {availability?.refresh && <div className="mt-2 text-xs text-[#68737e]" role="status">
          {availability.refresh.state === "waiting_for_source"
            ? `Очікуємо повне вивантаження GA4 за тиждень до ${availability.refresh.targetDataTo}. Перевірка повторюється щогодини.`
            : availability.refresh.state === "error"
              ? "Автооновлення не завершено. Показуємо останній успішний знімок; повторна спроба — протягом години."
              : availability.refresh.state === "running"
                ? "Оновлюємо дані у фоновому режимі. Поки доступний попередній успішний знімок."
                : `Автооновлення увімкнено · знімок оновлено ${new Date(availability.savedAt).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}${availability.refresh.finalized ? "" : " · дані ще можуть уточнюватися через пізні події GA4"}`}
        </div>}
        {error && <div className="mt-4 rounded-xl border border-[#f3b8bd] bg-[#fde7e9] p-4 text-sm text-[#a4262c]"><strong>Діагностика недоступна.</strong> {error}{!availability && <button type="button" disabled={loadingAvailability} onClick={() => setAvailabilityAttempt((attempt) => attempt + 1)} className="ml-3 underline disabled:opacity-50">Повторити</button>}</div>}
      </section>

      {!data && !error && <section className="mt-4 rounded-2xl border bg-white p-10 text-center" style={{ borderColor: "var(--border)" }}><div className="text-4xl">⌁</div><h2 className="mt-3 text-lg font-black text-[#27313c]">{loadingAvailability ? "Перевіряємо доступні періоди…" : selectedPeriod ? "Готово до автоматичної діагностики" : "Немає завершених періодів у знімку"}</h2><p className="mx-auto mt-2 max-w-xl text-sm text-[#68737e]">{selectedPeriod ? "Оберіть завершений період. Модуль сам визначить бізнес-чинник, проблемний етап воронки й сегменти з найбільшим впливом." : "Для діагностики потрібен повний тиждень або місяць у збережених даних."}</p></section>}

      {data && <>
        <section className="mt-4 rounded-2xl border bg-white p-4 sm:p-5" style={{ borderColor: "var(--border)" }}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#7f8993]">Підсумок для керівництва · {data.periods.current.label}</div><h2 className="mt-1 text-xl font-black text-[#27313c]">Стан: <span className="uppercase">{SEVERITY_LABEL[data.overallStatus]}</span></h2><p className="mt-2 max-w-4xl text-sm leading-6 text-[#45515d]">{data.summary}</p></div><div className="text-right text-xs text-[#7f8993]">Знімок даних: {new Date(data.sourceCubeSavedAt).toLocaleString("uk-UA")}<br />Україна</div></div></section>

        <section className="mt-4"><div className="mb-2 flex items-end justify-between"><div><h2 className="text-lg font-black text-[#27313c]">Ключові показники</h2><p className="text-xs text-[#68737e]">Поточний період · попередній період · аналогічний період торік</p></div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{data.executiveMetrics.map((metric) => <article key={metric.key} className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)" }}><div className="flex items-start justify-between gap-2"><span className="text-xs font-black text-[#45515d]">{metric.label}</span><StatusBadge status={metric.status} /></div><div className="mt-3 text-2xl font-black text-[#27313c]">{formatValue(metric, metric.current)}</div><div className="mt-3 grid grid-cols-2 gap-2 text-[11px]"><div><span className="text-[#7f8993]">Попередній</span><div className="font-bold">{formatValue(metric, metric.previous)} · <span className={metric.deltaPercent != null && metric.deltaPercent < 0 ? "text-[#a4262c]" : "text-[#107c10]"}>{deltaText(metric.deltaPercent)}</span></div></div><div><span className="text-[#7f8993]">Торік</span><div className="font-bold">{formatValue(metric, metric.previousYear)} · <span className={metric.yoyDeltaPercent != null && metric.yoyDeltaPercent < 0 ? "text-[#a4262c]" : "text-[#107c10]"}>{deltaText(metric.yoyDeltaPercent)}</span></div></div></div></article>)}</div></section>

        <section className="mt-4"><h2 className="text-lg font-black text-[#27313c]">Головні сигнали</h2><p className="mb-3 text-xs text-[#68737e]">Рейтинг враховує вплив, обсяг даних, орієнтовні втрати та надійність оцінки, а не лише відсоток зміни.</p>{data.topSignals.length ? <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{data.topSignals.map((signal) => <SignalCard key={signal.id} signal={signal} onInvestigate={() => investigate(signal.id)} />)}</div> : <div className="rounded-2xl border bg-white p-6 text-sm text-[#107c10]" style={{ borderColor: "var(--border)" }}>Значущих негативних сигналів із достатнім обсягом даних не знайдено.</div>}</section>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border bg-white p-4 sm:p-5" style={{ borderColor: "var(--border)" }}><h2 className="text-lg font-black text-[#27313c]">Розклад бізнес-показників</h2><p className="text-xs text-[#68737e]">Дохід = трафік × коефіцієнт конверсії × середній чек · внесок за методом Шеплі, сума дорівнює зміні доходу.</p><div className="mt-4 space-y-3">{data.businessDecomposition.map((item) => <div key={item.key} className="rounded-xl border p-3" style={{ borderColor: item.isPrimaryDriver ? "#a4262c66" : "var(--border)" }}><div className="flex items-center justify-between gap-3"><strong className="text-sm text-[#27313c]">{item.label}{item.isPrimaryDriver ? " · головний чинник" : ""}</strong><span className={item.revenueContribution < 0 ? "font-black text-[#a4262c]" : "font-black text-[#107c10]"}>{item.revenueContribution > 0 ? "+" : ""}{money(item.revenueContribution)}</span></div><div className="mt-1 text-xs text-[#68737e]">{numberFormat.format(item.previous)} → {numberFormat.format(item.current)} · {deltaText(item.deltaPercent)}</div></div>)}</div></section>
          <section className="rounded-2xl border bg-white p-4 sm:p-5" style={{ borderColor: "var(--border)" }}><h2 className="text-lg font-black text-[#27313c]">Розклад воронки</h2><p className="text-xs text-[#68737e]">Розрахунок за сеансами; кількість подій зберігається окремо на рівні даних.</p><div className="mt-3 overflow-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="text-[#7f8993]"><tr><th className="p-2">Етап</th><th className="p-2 text-right">Поточна конверсія</th><th className="p-2 text-right">Попередня</th><th className="p-2 text-right">Зміна</th><th className="p-2 text-right">Втрачено замовлень</th><th className="p-2 text-right">Вплив</th></tr></thead><tbody>{data.funnel.map((item) => <tr key={item.key} className="border-t" style={{ borderColor: item.key === data.primaryFunnelStage ? "#a4262c" : "var(--border)" }}><td className="p-2 font-bold text-[#27313c]">{item.label}{item.key === data.primaryFunnelStage ? " ⚠" : ""}</td><td className="p-2 text-right">{item.currentRate == null ? "—" : `${item.currentRate}%`}</td><td className="p-2 text-right">{item.previousRate == null ? "—" : `${item.previousRate}%`}</td><td className="p-2 text-right text-[#a4262c]">{deltaText(item.deltaPercent)}</td><td className="p-2 text-right">≈ {numberFormat.format(item.estimatedLostOrders)}</td><td className="p-2 text-right font-bold">{item.impactScore}</td></tr>)}</tbody></table></div></section>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <section className="rounded-2xl border bg-white p-4 sm:p-5" style={{ borderColor: "var(--border)" }}><h2 className="text-lg font-black text-[#27313c]">Дерево діагностики</h2><p className="mb-3 text-xs text-[#68737e]">Проблема → чинник → етап воронки → сегмент. Вузли із сигналами можна відкрити.</p>{data.diagnosticTree.map((node) => <NodeView key={node.id} node={node} onSignal={investigate} />)}</section>
          <section className="rounded-2xl border bg-white p-4 sm:p-5" style={{ borderColor: "var(--border)" }}><h2 className="text-lg font-black text-[#27313c]">Потребує уваги</h2><div className="mt-3 space-y-2">{data.requiresAttention.length ? data.requiresAttention.map((signal, index) => <button type="button" onClick={() => investigate(signal.id)} key={signal.id} className="block w-full rounded-xl border p-3 text-left" style={{ borderColor: "var(--border)" }}><div className="text-xs font-black text-[#27313c]">{index + 1}. {signal.title}</div><div className="mt-1 text-[11px] text-[#68737e]">Вплив {signal.impactScore} · ≈ {money(signal.estimatedRevenueLoss)}</div></button>) : <div className="text-sm text-[#107c10]">Критичних проблем не знайдено.</div>}</div></section>
        </div>

        {selectedSignal && <section id="cpo-investigation" className="mt-4 scroll-mt-4 rounded-2xl border bg-white p-4 sm:p-6" style={{ borderColor: "#118dff" }}><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#0067b8]">Дослідження · {CATEGORY_LABEL[selectedSignal.category]}</div><h2 className="mt-1 text-xl font-black text-[#27313c]">{selectedSignal.title}</h2><p className="mt-2 max-w-4xl text-sm text-[#45515d]">{selectedSignal.explanation}</p></div><button type="button" onClick={() => setSelectedSignalId(null)} className="rounded-lg border px-3 py-1 text-xs font-bold" style={{ borderColor: "var(--border2)" }}>Закрити</button></div><div className="mt-4 grid gap-3 md:grid-cols-3"><div className="rounded-xl bg-[#f7f9fb] p-3"><div className="text-[10px] font-black uppercase text-[#7f8993]">Орієнтовно втрачено замовлень</div><div className="mt-1 text-xl font-black">≈ {numberFormat.format(selectedSignal.estimatedLostOrders)}</div></div><div className="rounded-xl bg-[#f7f9fb] p-3"><div className="text-[10px] font-black uppercase text-[#7f8993]">Орієнтовна втрата доходу</div><div className="mt-1 text-xl font-black">≈ {money(selectedSignal.estimatedRevenueLoss)}</div></div><div className="rounded-xl bg-[#f7f9fb] p-3"><div className="text-[10px] font-black uppercase text-[#7f8993]">Надійність оцінки</div><div className="mt-1 text-xl font-black">{selectedSignal.confidenceScore}%</div></div></div><h3 className="mt-5 text-sm font-black text-[#27313c]">Що перевірити</h3><ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[#45515d]">{selectedSignal.recommendedChecks.map((check) => <li key={check}>{check}</li>)}</ol><div className="mt-5 grid gap-3 xl:grid-cols-2"><SegmentTable title="Пристрій" rows={data.segmentContributions.device} /><SegmentTable title="Джерело та канал" rows={data.segmentContributions.source_medium} /><SegmentTable title="Місто" rows={data.segmentContributions.city} /><SegmentTable title="Цільова сторінка" rows={data.segmentContributions.landing_page} /></div></section>}

        <section className="mt-4 rounded-2xl border bg-[#fffdf6] p-4" style={{ borderColor: "#f0d98c" }}><h2 className="text-sm font-black text-[#6b5600]">Обмеження пілотної версії</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[#6b5f32]">{data.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>
      </>}
    </div>
  );
}
