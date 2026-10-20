"use client";

import { useEffect, useState } from "react";
import type { Ga4MarketingReport, Ga4TrafficRow } from "@/lib/ga4-marketing-report";

const number = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 });
const filterFields = [
  { key: "channel", label: "Канал трафіку", all: "Усі канали" },
  { key: "source", label: "Джерело", all: "Усі джерела" },
  { key: "campaign", label: "Кампанія", all: "Усі кампанії" },
] as const;
type FilterField = typeof filterFields[number]["key"];

export function Ga4MarketingTraffic({ from, to }: { from: string; to: string }) {
  const [report, setReport] = useState<Ga4MarketingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Record<FilterField, string>>({ channel: "", source: "", campaign: "" });
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setReport(null); setPage(1);
    setFilters({ channel: "", source: "", campaign: "" });
    fetch(`/api/promotions/ga4-marketing?${new URLSearchParams({ from, to })}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не вдалося отримати дані GA4");
        return data as Ga4MarketingReport;
      })
      .then(data => { if (!controller.signal.aborted) setReport(data); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Помилка GA4"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [from, to, retry]);
  const matches = (row: Ga4TrafficRow, except?: FilterField) => filterFields.every(({ key }) => key === except || !filters[key] || row[key] === filters[key]);
  const rows = report?.rows.filter(row => matches(row)) || [];
  const totals = rows.reduce((sum, row) => ({ sessions: sum.sessions + row.sessions, purchases: sum.purchases + row.purchases, revenue: sum.revenue + row.revenue }), { sessions: 0, purchases: 0, revenue: 0 });
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const visiblePage = Math.min(page, pages);
  return <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
    <div className="text-sm font-bold">Канали, джерела та кампанії · GA4</div>
    <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>Прямі дані Google Analytics для всього сайту за {from} — {to}, включно з джерелами без покупок. Фільтри цього блоку застосовуються лише до GA4; реєстр замовлень нижче має власні UTM-фільтри. Статуси замовлень та цінова позиція акцій не обмежують цей звіт.</p>
    {loading && <p className="mt-3 text-xs" role="status">Завантаження джерел із GA4…</p>}
    {error && <div className="mt-3 text-xs" role="alert"><p style={{ color: "#b91c1c" }}>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 rounded border px-3 py-1.5">Спробувати знову</button></div>}
    {report && <>
      <div className="mt-4 grid gap-3 md:grid-cols-3">{filterFields.map(({ key, label, all }) => {
        const options = [...new Set(report.rows.filter(row => matches(row, key)).map(row => row[key]))].sort((a, b) => a.localeCompare(b));
        return <label key={key}><span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>{label}</span><select aria-label={`GA4: ${label}`} value={filters[key]} onChange={event => { setFilters({ ...filters, [key]: event.target.value }); setPage(1); }} className="h-9 w-full rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}><option value="">{all}</option>{options.map(value => <option key={value} value={value}>{value}</option>)}</select></label>;
      })}</div>
      <div className="my-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3"><div>Сеанси GA4<b className="mt-1 block text-xl">{number.format(totals.sessions)}</b></div><div>Покупки GA4<b className="mt-1 block text-xl">{number.format(totals.purchases)}</b></div><div>Дохід від покупок GA4<b className="mt-1 block text-xl">{money.format(totals.revenue)}</b></div></div>
      <p className="mb-3 text-[10px]" style={{ color: "var(--text-muted)" }}>Покупки — події електронної торгівлі GA4, не підтверджені оплати або відвантаження. Канали визначає GA4 за джерелом сеансу. Часовий пояс: {report.timeZone || "ресурсу GA4"}. Отримано: {new Date(report.fetchedAt).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })} (Київ). Кеш — 10 хв; свіжі дані можуть ще оброблятися Google.</p>
      {(report.dataLossFromOtherRow || report.subjectToThresholding) && <p className="mb-3 text-xs" style={{ color: "#a16207" }}>GA4 повідомив про обмеження деталізації або порогове приховування даних. Частина джерел може бути прихована чи об’єднана в (other).</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead><tr>{["Канал", "Джерело", "Тип трафіку", "Кампанія", "Сеанси", "Покупки", "Дохід, грн"].map(label => <th key={label} className="border-b px-2 py-2">{label}</th>)}</tr></thead><tbody>{rows.slice((visiblePage - 1) * 50, visiblePage * 50).map(row => <tr key={JSON.stringify([row.channel, row.source, row.medium, row.campaign])}>{[row.channel, row.source, row.medium, row.campaign, number.format(row.sessions), number.format(row.purchases), money.format(row.revenue)].map((value, i) => <td key={i} className="border-b px-2 py-2">{value}</td>)}</tr>)}</tbody></table></div>
      {rows.length === 0 && <p className="mt-3 text-xs">За обраний період і фільтри даних немає.</p>}
      <div className="mt-3 flex items-center justify-end gap-3 text-xs"><span>{number.format(rows.length)} комбінацій</span><button type="button" disabled={visiblePage <= 1} onClick={() => setPage(visiblePage - 1)} className="rounded border px-2 py-1 disabled:opacity-40" aria-label="Попередня сторінка GA4">←</button><span>{visiblePage} / {pages}</span><button type="button" disabled={visiblePage >= pages} onClick={() => setPage(visiblePage + 1)} className="rounded border px-2 py-1 disabled:opacity-40" aria-label="Наступна сторінка GA4">→</button></div>
    </>}
  </section>;
}
