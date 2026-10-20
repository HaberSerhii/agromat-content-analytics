"use client";

import { useEffect, useState } from "react";
import type { Ga4MarketingReport } from "@/lib/ga4-marketing-report";
import { marketingGroupKey, type MarketingOrderGroup } from "@/lib/order-marketing-attribution";

const number = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 });
export type TrafficFilters = { channel: string; source: string; campaign: string; medium?: string };
export function Ga4MarketingTraffic({ from, to, filters, groups, ordersLoading, ordersUnavailable, onReport, onInspect }: {
  from: string; to: string; filters: TrafficFilters; groups: MarketingOrderGroup[]; ordersLoading: boolean; ordersUnavailable: boolean;
  onReport: (report: Ga4MarketingReport | null) => void;
  onInspect: (filters: TrafficFilters) => void;
}) {
  const [report, setReport] = useState<Ga4MarketingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("revenue");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setReport(null); setPage(1);
    onReport(null);
    fetch(`/api/promotions/ga4-marketing?${new URLSearchParams({ from, to })}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не вдалося отримати дані GA4");
        return data as Ga4MarketingReport;
      })
      .then(data => { if (!controller.signal.aborted) { setReport(data); onReport(data); } })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Помилка GA4"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [from, to, retry, onReport]);
  const matches = (row: TrafficFilters) => (!filters.channel || row.channel === filters.channel) && (!filters.source || row.source === filters.source) && (!filters.campaign || row.campaign === filters.campaign) && (!filters.medium || row.medium === filters.medium);
  const ordersByKey = new Map(groups.map(group => [marketingGroupKey(group), group]));
  const trafficRows = (report?.rows || []).filter(matches);
  const trafficKeys = new Set(trafficRows.map(marketingGroupKey));
  const rows = [
    ...trafficRows.map(row => ({...row, site: ordersByKey.get(marketingGroupKey(row))})),
    ...groups.filter(group => !trafficKeys.has(marketingGroupKey(group))).map(group => ({...group, sessions: 0, purchases: 0, revenue: 0, site: group})),
  ].sort((a, b) => sort === "sessions" ? b.sessions - a.sessions : sort === "orders" ? (b.site?.orders || 0) - (a.site?.orders || 0) || b.sessions - a.sessions : (b.site?.revenue || 0) - (a.site?.revenue || 0) || b.sessions - a.sessions);
  const totals = rows.reduce((sum, row) => ({ sessions: sum.sessions + row.sessions, purchases: sum.purchases + row.purchases, revenue: sum.revenue + row.revenue }), { sessions: 0, purchases: 0, revenue: 0 });
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const visiblePage = Math.min(page, pages);
  return <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
    <div className="text-sm font-bold">Ефективність каналів і кампаній · GA4 + замовлення</div>
    <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>Спільні фільтри каналу, джерела та кампанії застосовуються до трафіку й замовлень за {from} — {to}. Статус та цінова позиція обмежують лише замовлення; сеанси GA4 охоплюють весь сайт.</p>
    {loading && <p className="mt-3 text-xs" role="status">Завантаження джерел із GA4…</p>}
    {error && <div className="mt-3 text-xs" role="alert"><p style={{ color: "#b91c1c" }}>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 rounded border px-3 py-1.5">Спробувати знову</button></div>}
    {(report || groups.length > 0) && <>
      <div className="my-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3"><div>Сеанси GA4<b className="mt-1 block text-xl">{report ? number.format(totals.sessions) : "—"}</b></div><div>Покупки GA4<b className="mt-1 block text-xl">{report ? number.format(totals.purchases) : "—"}</b></div><div>Дохід від покупок GA4<b className="mt-1 block text-xl">{report ? money.format(totals.revenue) : "—"}</b></div></div>
      <p className="mb-3 text-[10px]" style={{ color: "var(--text-muted)" }}>Замовлення сайту зіставлено з GA4 за transaction_id = внутрішній ID замовлення. Суми та статуси беруться із замовлень; покупки GA4 не підтверджують оплату чи відвантаження. Для рядків лише з UTM або маркетплейсу трафік не приписується. Часовий пояс: {report?.timeZone || "ресурсу GA4"}. Отримано: {report ? new Date(report.fetchedAt).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" }) : "недоступно"} (Київ). Кеш — 10 хв; свіжі дані можуть ще оброблятися Google.</p>
      {(report?.dataLossFromOtherRow || report?.subjectToThresholding) && <p className="mb-3 text-xs" style={{ color: "#a16207" }}>GA4 повідомив про обмеження деталізації або порогове приховування даних. Частина джерел може бути прихована чи об’єднана в (other).</p>}
      <label className="mb-3 flex items-center gap-2 text-xs">Сортувати за<select value={sort} onChange={event => {setSort(event.target.value); setPage(1);}} className="rounded border px-2 py-1" style={{background: "var(--bg-input)", borderColor: "var(--border2)"}}><option value="revenue">Сумою замовлень сайту</option><option value="orders">Кількістю замовлень сайту</option><option value="sessions">Сеансами GA4</option></select></label>
      <div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-left text-xs"><thead><tr>{["Канал", "Джерело", "Тип трафіку", "Кампанія", "Сеанси", "Покупки", "Дохід GA4", "Замовлення сайту", "Сума замовлень", "AOV сайту"].map(label => <th key={label} className="border-b px-2 py-2">{label}</th>)}</tr></thead><tbody>{rows.slice((visiblePage - 1) * 50, visiblePage * 50).map(row => <tr key={JSON.stringify([row.channel, row.source, row.medium, row.campaign])}>{[row.channel, row.source, row.medium, row.campaign, report ? number.format(row.sessions) : "—", report ? number.format(row.purchases) : "—", report ? money.format(row.revenue) : "—", ordersLoading ? "…" : ordersUnavailable ? "—" : number.format(row.site?.orders || 0), ordersLoading ? "…" : ordersUnavailable ? "—" : money.format(row.site?.revenue || 0), ordersLoading ? "…" : ordersUnavailable ? "—" : money.format(row.site?.averageOrder || 0)].map((value, i) => <td key={i} className="border-b px-2 py-2">{i === 7 ? <button type="button" disabled={ordersLoading || ordersUnavailable} onClick={() => onInspect(row)} className="font-bold text-[#118dff] underline disabled:opacity-40" aria-label={`Замовлення кампанії ${row.campaign}`}>{value}</button> : value}</td>)}</tr>)}</tbody></table></div>
      {rows.length === 0 && <p className="mt-3 text-xs">За обраний період і фільтри даних немає.</p>}
      <div className="mt-3 flex items-center justify-end gap-3 text-xs"><span>{number.format(rows.length)} комбінацій</span><button type="button" disabled={visiblePage <= 1} onClick={() => setPage(visiblePage - 1)} className="rounded border px-2 py-1 disabled:opacity-40" aria-label="Попередня сторінка GA4">←</button><span>{visiblePage} / {pages}</span><button type="button" disabled={visiblePage >= pages} onClick={() => setPage(visiblePage + 1)} className="rounded border px-2 py-1 disabled:opacity-40" aria-label="Наступна сторінка GA4">→</button></div>
    </>}
  </section>;
}
