"use client";

import { useEffect, useMemo, useState } from "react";
import { Ga4MarketingTraffic } from "@/components/Ga4MarketingTraffic";
import { MarketingDailyChart } from "@/components/MarketingDailyChart";
import type { Ga4MarketingReport } from "@/lib/ga4-marketing-report";
import type { MarketingAttribution, MarketingOrderGroup } from "@/lib/order-marketing-attribution";
import type { MarketingDay } from "@/lib/marketing-daily-series";
import type { PromotionPricePosition } from "@/lib/promotion-price-position";

type UtmOption = { value: string; label: string; count: number };
type OrderRow = {
  id: number;
  order_num: string | number | null;
  date: string;
  analytics_status?: string;
  marketing?: MarketingAttribution;
  status: string | null;
  totals: { cost: number };
  source: { utm_source: string | null; utm_campaign: string | null } | null;
  items: Array<{ quantity: number; name: string }>;
};
type CampaignResponse = {
  data: OrderRow[];
  daily: MarketingDay[];
  meta: { total: number; page: number; total_pages: number };
  summary: {
    total: number;
    revenue: number;
    averageOrder: number;
    statuses: Array<{ key: string; docs: number }>;
  };
  utm: { sources: UtmOption[]; campaigns: UtmOption[] };
  marketing?: {
    availability: "ready" | "unavailable"; notice?: string; limited?: boolean;
    total: number; matched: number; utmOnly: number; marketplace: number; unknown: number; ambiguous: number;
    channels: string[]; groups: MarketingOrderGroup[];
  };
};

const numberFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const moneyFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

function currentMonthRange() {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function formatMoney(value: number) {
  return `${moneyFmt.format(value)} грн`;
}

function campaignParams(from: string, to: string, campaign: string, source: string, status: string, pricePosition: PromotionPricePosition, page = 1, channel = "", medium = "") {
  const params = new URLSearchParams({ from, to, page: String(page), attribution: "ga4" });
  if (medium) params.set("traffic_medium", medium);
  if (channel) params.set("traffic_channel", channel);
  if (campaign) params.set("utm_campaign", campaign);
  if (source) params.set("utm_source", source);
  if (status !== "all") params.set("order_status", status);
  if (pricePosition !== "all") params.set("promotion_price_position", pricePosition);
  return params;
}

function MetricCard({ label, value, hint, tone = "#118dff" }: { label: string; value: string; hint: string; tone?: string }) {
  return <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
    <div className="text-[10px] font-black uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>{label}</div>
    <div className="mt-2 text-2xl font-black tabular-nums" style={{ color: tone }}>{value}</div>
    <div className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>{hint}</div>
  </div>;
}

export function PromotionMarketingDashboard({ pricePosition = "all" }: { pricePosition?: PromotionPricePosition }) {
  const initial = useMemo(currentMonthRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [campaign, setCampaign] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CampaignResponse | null>(null);
  const [channel, setChannel] = useState("");
  const [medium, setMedium] = useState("");
  const [ga4Report, setGa4Report] = useState<Ga4MarketingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    fetch(`/api/sales/webshop-orders?${campaignParams(from, to, campaign, source, status, pricePosition, page, channel, medium)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити замовлення та джерела");
        return payload as CampaignResponse;
      })
      .then((payload) => { if (!controller.signal.aborted) { setData(payload); setError(""); } })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Не вдалося завантажити дані");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [campaign, channel, from, medium, page, pricePosition, source, status, to]);

  const rawFilter = (value: string) => value === "missing" ? "(not set)" : value.replace(/^value:/, "");
  const trafficFilters = {channel, medium, source: rawFilter(source), campaign: rawFilter(campaign)};
  const ga4Options = (field: "source" | "campaign") => (ga4Report?.rows || []).filter(row =>
    (!channel || row.channel === channel) && (field === "source" || !source || row.source === rawFilter(source)) && (field === "campaign" || !campaign || row.campaign === rawFilter(campaign))
  ).map(row => ({value: row[field] === "(not set)" ? "missing" : `value:${row[field]}`, label: row[field], count: 0}));
  const options = (field: "source" | "campaign") => {
    const result = new Map(ga4Options(field).map(option => [option.value, option]));
    for (const option of data?.utm[field === "source" ? "sources" : "campaigns"] || []) result.set(option.value, {...option, label: option.value === "missing" ? "Джерело / кампанія не визначені" : option.label});
    const selected = field === "source" ? source : campaign;
    if (selected && !result.has(selected)) result.set(selected, {value: selected, label: rawFilter(selected), count: 0});
    return [...result.values()].sort((a, b) => a.label.localeCompare(b.label));
  };
  const channels = [...new Set([...(channel ? [channel] : []), ...(data?.marketing?.channels || []), ...(ga4Report?.rows || []).filter(row => (!source || row.source === rawFilter(source)) && (!campaign || row.campaign === rawFilter(campaign))).map(row => row.channel)])].sort();

  const summary = data?.summary;
  const totalItems = data?.data.reduce((sum, order) => sum + order.items.reduce((qty, item) => qty + (Number(item.quantity) || 0), 0), 0) ?? 0;

  return <div className="space-y-4">
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <label><span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>Дата від</span><input type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPage(1); setChannel(""); setMedium(""); setSource(""); setCampaign(""); }} className="h-9 w-full rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }} /></label>
        <label><span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>Дата до</span><input type="date" value={to} min={from} onChange={(event) => { setTo(event.target.value); setPage(1); setChannel(""); setMedium(""); setSource(""); setCampaign(""); }} className="h-9 w-full rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }} /></label>
        <label><span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>Канал трафіку</span><select aria-label="Канал трафіку" value={channel} onChange={event => {setChannel(event.target.value); setMedium(""); setPage(1);}} className="h-9 w-full rounded-lg border px-3 text-xs" style={{borderColor: "var(--border2)", background: "var(--bg-input)"}}><option value="">Усі канали</option>{channels.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>Кампанія</span><select value={campaign} onChange={(event) => { setCampaign(event.target.value); setMedium(""); setPage(1); }} className="h-9 w-full rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}><option value="">Усі кампанії</option>{options("campaign").map((item) => <option key={item.value} value={item.value}>{item.label} · {item.count} зам.</option>)}</select></label>
        <label><span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>Джерело</span><select value={source} onChange={(event) => { setSource(event.target.value); setMedium(""); setPage(1); }} className="h-9 w-full rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}><option value="">Усі джерела</option>{options("source").map((item) => <option key={item.value} value={item.value}>{item.label} · {item.count} зам.</option>)}</select></label>
        <label><span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>Статус замовлення</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-9 w-full rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}><option value="all">Усі статуси</option>{data?.summary.statuses.map((item) => <option key={item.key} value={item.key}>{item.key} · {item.docs}</option>)}</select></label>
      </div>
      {medium && <p className="mt-2 text-xs">Тип трафіку: <b>{medium}</b></p>}
      {(channel || source || campaign || medium) && <button type="button" onClick={() => {setChannel(""); setMedium(""); setSource(""); setCampaign(""); setPage(1);}} className="mt-3 rounded border px-3 py-1.5 text-xs">Усі канали та кампанії</button>}
      {loading && <div className="mt-2 text-[11px] font-semibold" style={{ color: "#118dff" }}>Оновлення кампаній…</div>}
      {error && <div className="mt-2 text-[11px] font-semibold" style={{ color: "#b91c1c" }}>{error}</div>}
    </section>

    <div className="rounded-xl border p-4 text-xs" style={{borderColor: "var(--border)", background: "var(--bg-card)"}}>
      <b>Зіставлення замовлень із каналами</b>
      <p className="mt-2">{loading ? "Оновлення…" : `GA4: ${data?.marketing?.matched ?? 0} · лише UTM: ${data?.marketing?.utmOnly ?? 0} · маркетплейс: ${data?.marketing?.marketplace ?? 0} · джерело не визначено: ${data?.marketing?.unknown ?? 0}`}</p>
      <p className="mt-1" style={{color: "var(--text-muted)"}}>Відсутність збігу GA4 не означає прямий перехід. Дані за сьогодні можуть ще оброблятися. Замовлення Rozetka показані як окремий канал продажів.</p>
      {data?.marketing?.notice && <p className="mt-2" role="alert" style={{color: "#b91c1c"}}>{data.marketing.notice}</p>}
      {data?.marketing?.limited && <p className="mt-2">GA4 обмежив деталізацію; частина замовлень може залишитися без зіставлення.</p>}
    </div>

    <Ga4MarketingTraffic from={from} to={to} filters={trafficFilters} groups={data?.marketing?.groups || []} ordersLoading={loading} ordersUnavailable={Boolean(error)} onReport={setGa4Report} onInspect={row => {setChannel(row.channel); setMedium(row.medium || ""); setSource(row.source === "(not set)" ? "missing" : `value:${row.source}`); setCampaign(row.campaign === "(not set)" ? "missing" : `value:${row.campaign}`); setPage(1);}} />

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Замовлення сайту" value={numberFmt.format(summary?.total ?? 0)} hint="фактичні замовлення із сайту" />
      <MetricCard label="Дохід" value={formatMoney(summary?.revenue ?? 0)} hint="сума замовлень" tone="#22a06b" />
      <MetricCard label="AOV" value={formatMoney(summary?.averageOrder ?? 0)} hint="середній чек" tone="#7c5ce7" />
      <MetricCard label="Товарів у замовленнях" value={numberFmt.format(totalItems)} hint="на поточній сторінці реєстру" tone="#f59e0b" />
      <MetricCard label="Вартість реклами" value="—" hint="потрібне підключення рекламного cost feed" tone="#6b7280" />
      <MetricCard label="CPL" value="—" hint="з’явиться після підключення витрат" tone="#6b7280" />
      <MetricCard label="CTR" value="—" hint="з’явиться після підключення показів і кліків" tone="#6b7280" />
      <MetricCard label="Зіставлено з GA4" value={numberFmt.format(data?.marketing?.matched ?? 0)} hint="точний збіг transaction_id з ID замовлення" tone="#ef6c3b" />
    </div>

    <MarketingDailyChart days={data?.daily || []} campaign={[channel, medium, rawFilter(source), rawFilter(campaign)].filter(Boolean).join(" · ")} loading={loading} error={error} onClear={() => { setCampaign(""); setSource(""); setChannel(""); setMedium(""); setPage(1); }} />

    <section className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}><div><div className="text-sm font-bold">Фактичні замовлення із сайту</div><div className="text-[10px]" style={{ color: "var(--text-dim)" }}>{numberFmt.format(data?.meta.total ?? 0)} після застосованих фільтрів</div></div>{campaign && <button type="button" onClick={() => setCampaign("")} className="rounded-lg border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "#118dff55", color: "#118dff" }}>Усі кампанії</button>}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1150px] border-collapse text-left text-xs"><thead style={{ background: "var(--bg-input)", color: "var(--text-dim)" }}><tr><th className="px-4 py-2">Замовлення</th><th className="px-4 py-2">Дата</th><th className="px-4 py-2">Канал</th><th className="px-4 py-2">Кампанія</th><th className="px-4 py-2">Джерело / тип</th><th className="px-4 py-2">Визначено за</th><th className="px-4 py-2">Статус</th><th className="px-4 py-2 text-right">Товарів</th><th className="px-4 py-2 text-right">Сума</th></tr></thead><tbody>{data?.data.map((order) => <tr key={order.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-4 py-3 font-black" style={{ color: "#118dff" }}>#{order.order_num || order.id}</td><td className="px-4 py-3 tabular-nums">{new Date(order.date).toLocaleDateString("uk-UA")}</td><td className="px-4 py-3">{order.marketing?.channel || "Джерело не визначено"}</td><td title={order.marketing?.campaign} className="max-w-[260px] truncate px-4 py-3">{order.marketing?.campaign === "(not set)" ? "Не визначено" : order.marketing?.campaign || "Не визначено"}</td><td className="px-4 py-3">{order.marketing?.source === "(not set)" ? "Не визначено" : order.marketing?.source || "—"}<small className="block">{order.marketing?.medium === "(not set)" ? "" : order.marketing?.medium}</small></td><td className="px-4 py-3"><details><summary className="cursor-pointer">{order.marketing?.method === "ga4" ? `GA4 · #${order.marketing.transactionId}` : order.marketing?.method === "utm" ? "UTM замовлення" : order.marketing?.method === "marketplace" ? "Інтеграція Rozetka" : "Немає зіставлення"}</summary><p className="mt-1">Збережені UTM: {order.source?.utm_source || "—"} / {order.source?.utm_campaign || "—"}</p>{order.marketing?.reason === "ambiguous" && <p>Кілька різних джерел GA4 для одного transaction_id — автоматичний вибір не виконується.</p>}</details></td><td className="px-4 py-3">{order.analytics_status || order.status || "—"}</td><td className="px-4 py-3 text-right tabular-nums">{numberFmt.format(order.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0))}</td><td className="px-4 py-3 text-right font-black tabular-nums">{formatMoney(order.totals.cost || 0)}</td></tr>)}</tbody></table></div>
      {(data?.meta.total_pages ?? 1) > 1 && <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border)" }}><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">←</button><span className="text-xs tabular-nums">{page} / {data?.meta.total_pages}</span><button type="button" disabled={page >= (data?.meta.total_pages ?? 1)} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">→</button></div>}
    </section>
  </div>;
}
