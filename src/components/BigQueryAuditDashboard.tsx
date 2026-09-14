"use client";

import { useMemo, useState } from "react";
import type { BigQueryAuditResponse } from "@/lib/bigquery-audit-types";

const numberFormatter = new Intl.NumberFormat("uk-UA");

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function formatBytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** exponent).toFixed(exponent > 2 ? 2 : 1)} ${units[exponent]}`;
}

const statusStyle = {
  ok: { background: "#e8f5e9", color: "#107c10", label: "OK" },
  warning: { background: "#fff4ce", color: "#8a5d00", label: "Увага" },
  missing: { background: "#fde7e9", color: "#a4262c", label: "Немає" },
};

export function BigQueryAuditDashboard() {
  const now = new Date();
  const currentYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric" }).format(now));
  const currentMonth = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", month: "2-digit" }).format(now));
  const isoWeek = (date: Date) => {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
    const day = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - day);
    const start = new Date(Date.UTC(target.getUTCFullYear(), 0, 1, 12));
    return Math.ceil((((target.getTime() - start.getTime()) / 86_400_000) + 1) / 7);
  };
  const currentWeek = isoWeek(new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(now) + "T12:00:00Z"));
  const [periodKind, setPeriodKind] = useState<"week" | "month">("week");
  const [period, setPeriod] = useState(Math.max(1, currentWeek - 1));
  const [data, setData] = useState<BigQueryAuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotMissing, setSnapshotMissing] = useState(false);
  const [eventFilter, setEventFilter] = useState("");
  const [parameterFilter, setParameterFilter] = useState("");

  const visibleEvents = useMemo(() => {
    const query = eventFilter.trim().toLowerCase();
    return query ? data?.events.filter((event) => event.name.toLowerCase().includes(query)) || [] : data?.events || [];
  }, [data, eventFilter]);

  const visibleParameters = useMemo(() => {
    const query = parameterFilter.trim().toLowerCase();
    return query
      ? data?.parameters.filter((parameter) => `${parameter.eventName} ${parameter.key}`.toLowerCase().includes(query)) || []
      : data?.parameters || [];
  }, [data, parameterFilter]);

  async function runAudit(buildSnapshot = false) {
    setLoading(true);
    setError(null);
    setSnapshotMissing(false);
    try {
      const response = await fetch("/api/bigquery/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodKind, period, buildSnapshot }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.code === "snapshot_missing") setSnapshotMissing(true);
        throw new Error(payload.error || "Не вдалося виконати аудит");
      }
      setData(payload as BigQueryAuditResponse);
    } catch (auditError) {
      setError(auditError instanceof Error ? auditError.message : "Не вдалося виконати аудит");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="promo-v2 min-h-[calc(100vh-92px)] rounded-2xl p-3 sm:p-5" style={{ background: "var(--bg)" }}>
      <section className="rounded-2xl border bg-white p-4 sm:p-6" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 inline-flex rounded-full bg-[#e8f3ff] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#0067b8]">Внутрішній розділ</div>
            <h1 className="text-2xl font-black text-[#27313c]">Аудит GA4 / BigQuery</h1>
            <p className="mt-1 max-w-3xl text-sm text-[#68737e]">Швидка перевірка свіжості даних, подій та їх параметрів. Розділ доступний лише за прямим URL і не показується в меню.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold text-[#45515d]">
              Тип періоду
              <select value={periodKind} onChange={(event) => {
                const nextKind = event.target.value as "week" | "month";
                setPeriodKind(nextKind);
                setPeriod(nextKind === "week" ? Math.max(1, currentWeek - 1) : Math.max(1, currentMonth - 1));
                setData(null);
              }} className="mt-1 block h-10 rounded-lg border bg-white px-3" style={{ borderColor: "var(--border2)" }}>
                <option value="week">Тиждень</option>
                <option value="month">Місяць</option>
              </select>
            </label>
            <label className="text-xs font-bold text-[#45515d]">
              {periodKind === "week" ? `Номер тижня · ${currentYear}` : `Місяць · ${currentYear}`}
              <select value={period} onChange={(event) => { setPeriod(Number(event.target.value)); setData(null); }} className="mt-1 block h-10 min-w-36 rounded-lg border bg-white px-3" style={{ borderColor: "var(--border2)" }}>
                {periodKind === "week"
                  ? Array.from({ length: Math.max(1, currentWeek - 1) }, (_, index) => index + 1).reverse().map((week) => <option key={week} value={week}>Тиждень {week}</option>)
                  : Array.from({ length: Math.max(1, currentMonth - 1) }, (_, index) => index + 1).reverse().map((month) => <option key={month} value={month}>{new Intl.DateTimeFormat("uk-UA", { month: "long" }).format(new Date(2024, month - 1, 1))}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void runAudit(false)} disabled={loading} className="h-10 rounded-lg bg-[#118dff] px-5 text-sm font-black text-white disabled:opacity-50">
              {loading ? "Завантажуємо…" : "Відкрити аудит"}
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-[#d8dde3] bg-[#f7f9fb] p-3 text-xs text-[#45515d]">
          Усі періоди читаються з єдиного локального знімка · країна: Україна · перемикання тижнів і місяців не запускає BigQuery
        </div>
        {error && (
          <div className="mt-4 rounded-xl border border-[#f3b8bd] bg-[#fde7e9] p-4 text-sm text-[#a4262c]">
            <strong>Аудит не відкрито.</strong> {error}
            {snapshotMissing && (
              <div className="mt-3">
                <button type="button" onClick={() => void runAudit(true)} disabled={loading} className="rounded-lg bg-[#a4262c] px-4 py-2 text-xs font-black text-white disabled:opacity-50">
                  Створити єдиний знімок України (одноразово сканує BigQuery, ліміт 70 GB)
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {!data && !error && (
        <section className="mt-4 rounded-2xl border bg-white p-8 text-center" style={{ borderColor: "var(--border)" }}>
          <div className="text-4xl">⌕</div>
          <h2 className="mt-3 text-lg font-black text-[#27313c]">Готово до аналізу знімка</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[#68737e]">Відкриття та перемикання періодів працюють з локальним файлом і не сканують BigQuery.</p>
        </section>
      )}

      {data && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["Обраний період", data.periods.current.label],
              ["Подій у вибірці", formatNumber(data.totals.events)],
              ["Типів подій", formatNumber(data.totals.eventTypes)],
              ["Пар event + параметр", formatNumber(data.totals.parameters)],
              ["Одноразово оброблено", formatBytes(data.bytesProcessed)],
            ].map(([label, value]) => (
              <section key={label} className="rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
                <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#7f8993]">{label}</div>
                <div className="mt-2 text-lg font-black text-[#27313c]">{value}</div>
              </section>
            ))}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {([data.periods.current, data.periods.previous, data.periods.yearAgo] as const).map((auditPeriod, index) => (
              <section key={auditPeriod.key} className="rounded-2xl border bg-white p-4" style={{ borderColor: index === 0 ? "#118dff" : "var(--border)" }}>
                <div className="flex items-center justify-between gap-2"><strong className="text-sm text-[#27313c]">{auditPeriod.label}</strong>{index === 0 && <span className="rounded-full bg-[#e8f3ff] px-2 py-0.5 text-[10px] font-black text-[#0067b8]">ОБРАНО</span>}</div>
                <div className="mt-1 text-xs text-[#7f8993]">{auditPeriod.from} — {auditPeriod.to}</div>
                <div className="mt-3 text-2xl font-black text-[#27313c]">{formatNumber(auditPeriod.events)}</div>
                <div className="text-xs text-[#68737e]">подій · {auditPeriod.eventTypes} типів</div>
              </section>
            ))}
          </div>

          <section className="mt-4 rounded-2xl border bg-white p-4 sm:p-5" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="text-lg font-black text-[#27313c]">Швидка діагностика</h2><p className="text-xs text-[#68737e]">Україна · обраний період {data.sampleFrom} — {data.sampleTo} · {data.projectId}.{data.datasetId}</p></div>
              <div className="text-right text-xs text-[#7f8993]"><div className="font-bold" style={{ color: data.storage.source === "saved" ? "#107c10" : "#0067b8" }}>{data.storage.source === "saved" ? "Збережений звіт" : "Щойно отримано з BigQuery"} · {formatBytes(data.storage.compressedBytes)}</div><div>Оновлено {new Date(data.storage.savedAt).toLocaleString("uk-UA")}</div></div>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {data.checks.map((check) => {
                const style = statusStyle[check.status];
                return (
                  <div key={check.key} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between gap-2"><strong className="text-sm text-[#27313c]">{check.label}</strong><span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: style.background, color: style.color }}>{style.label}</span></div>
                    <div className="mt-1 font-mono text-[11px] text-[#0067b8]">{check.key}</div>
                    <p className="mt-2 text-xs text-[#68737e]">{check.detail}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <section className="min-w-0 rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-black text-[#27313c]">Події</h2><input value={eventFilter} onChange={(event) => setEventFilter(event.target.value)} placeholder="Знайти подію…" className="h-9 w-44 rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)" }} /></div>
              <div className="mt-3 max-h-[560px] overflow-auto">
                <table className="w-full min-w-[650px] text-left text-xs">
                  <thead className="sticky top-0 bg-white text-[#7f8993]"><tr><th className="p-2">Подія</th><th className="p-2 text-right">Обраний</th><th className="p-2 text-right">Попередній</th><th className="p-2 text-right">Δ</th><th className="p-2 text-right">Рік тому</th><th className="p-2 text-right">Δ рік</th><th className="p-2 text-right">Активні дні</th></tr></thead>
                  <tbody>{visibleEvents.map((event) => <tr key={event.name} className="border-t" style={{ borderColor: "var(--border)" }}><td className="p-2 font-mono font-bold text-[#27313c]">{event.name}</td><td className="p-2 text-right font-bold">{formatNumber(event.current.events)}</td><td className="p-2 text-right">{formatNumber(event.previous.events)}</td><td className="p-2 text-right" style={{ color: event.deltaPreviousPct != null && event.deltaPreviousPct < 0 ? "#a4262c" : "#107c10" }}>{event.deltaPreviousPct == null ? "—" : `${event.deltaPreviousPct > 0 ? "+" : ""}${event.deltaPreviousPct}%`}</td><td className="p-2 text-right">{formatNumber(event.yearAgo.events)}</td><td className="p-2 text-right" style={{ color: event.deltaYearAgoPct != null && event.deltaYearAgoPct < 0 ? "#a4262c" : "#107c10" }}>{event.deltaYearAgoPct == null ? "—" : `${event.deltaYearAgoPct > 0 ? "+" : ""}${event.deltaYearAgoPct}%`}</td><td className="p-2 text-right">{event.current.daysActive}/{data.sampledDays}</td></tr>)}</tbody>
                </table>
              </div>
            </section>

            <section className="min-w-0 rounded-2xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-black text-[#27313c]">Параметри подій</h2><input value={parameterFilter} onChange={(event) => setParameterFilter(event.target.value)} placeholder="Подія або параметр…" className="h-9 w-48 rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)" }} /></div>
              <div className="mt-3 max-h-[560px] overflow-auto">
                <table className="w-full min-w-[650px] text-left text-xs">
                  <thead className="sticky top-0 bg-white text-[#7f8993]"><tr><th className="p-2">Подія</th><th className="p-2">Параметр</th><th className="p-2">Тип</th><th className="p-2 text-right">Заповнено</th><th className="p-2 text-right">Кількість</th></tr></thead>
                  <tbody>{visibleParameters.map((parameter) => <tr key={`${parameter.eventName}:${parameter.key}`} className="border-t" style={{ borderColor: "var(--border)" }}><td className="p-2 font-mono text-[#45515d]">{parameter.eventName}</td><td className="p-2 font-mono font-bold text-[#0067b8]">{parameter.key}</td><td className="p-2">{parameter.valueType}</td><td className="p-2 text-right">{parameter.populationPct}%</td><td className="p-2 text-right">{formatNumber(parameter.occurrences)}</td></tr>)}</tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
