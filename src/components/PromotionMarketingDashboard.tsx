"use client";

import { useEffect, useMemo, useState } from "react";
import type { PromotionPricePosition } from "@/lib/promotion-price-position";

type UtmOption = { value: string; label: string; count: number };
type OrderRow = {
  id: number;
  order_num: string | number | null;
  date: string;
  analytics_status?: string;
  status: string | null;
  totals: { cost: number };
  source: { utm_source: string | null; utm_campaign: string | null } | null;
  items: Array<{ quantity: number; name: string }>;
};
type CampaignResponse = {
  data: OrderRow[];
  meta: { total: number; page: number; total_pages: number };
  summary: {
    total: number;
    revenue: number;
    averageOrder: number;
    statuses: Array<{ key: string; docs: number }>;
  };
  utm: { sources: UtmOption[]; campaigns: UtmOption[] };
};

const numberFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const moneyFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

function inputDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function currentMonthRange() {
  const today = new Date();
  return { from: inputDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: inputDate(today) };
}

function formatMoney(value: number) {
  return `${moneyFmt.format(value)} грн`;
}

function campaignParams(from: string, to: string, campaign: string, source: string, status: string, pricePosition: PromotionPricePosition, page = 1) {
  const params = new URLSearchParams({ from, to, page: String(page) });
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
  const [campaignMetrics, setCampaignMetrics] = useState<Record<string, CampaignResponse["summary"]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/sales/webshop-orders?${campaignParams(from, to, campaign, source, status, pricePosition, page)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити UTM-замовлення");
        return payload as CampaignResponse;
      })
      .then((payload) => { setData(payload); setError(""); })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Не вдалося завантажити дані");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [campaign, from, page, pricePosition, source, status, to]);

  useEffect(() => {
    if (!data || campaign || source || status !== "all") return;
    const controller = new AbortController();
    const topCampaigns = data.utm.campaigns.filter((item) => item.value !== "missing").slice(0, 8);
    Promise.all(topCampaigns.map(async (item) => {
      const response = await fetch(`/api/sales/webshop-orders?${campaignParams(from, to, item.value, "", "all", pricePosition)}`, { signal: controller.signal });
      const payload = await response.json() as CampaignResponse;
      return [item.value, payload.summary] as const;
    })).then((rows) => setCampaignMetrics(Object.fromEntries(rows))).catch(() => undefined);
    return () => controller.abort();
  }, [campaign, data, from, pricePosition, source, status, to]);

  const summary = data?.summary;
  const totalItems = data?.data.reduce((sum, order) => sum + order.items.reduce((qty, item) => qty + (Number(item.quantity) || 0), 0), 0) ?? 0;

  return <div className="space-y-4">
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label><span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>Дата від</span><input type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPage(1); }} className="h-9 w-full rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }} /></label>
        <label><span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>Дата до</span><input type="date" value={to} min={from} onChange={(event) => { setTo(event.target.value); setPage(1); }} className="h-9 w-full rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }} /></label>
        <label><span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>Кампанія</span><select value={campaign} onChange={(event) => { setCampaign(event.target.value); setPage(1); }} className="h-9 w-full rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}><option value="">Усі кампанії</option>{data?.utm.campaigns.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
        <label><span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>UTM source</span><select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }} className="h-9 w-full rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}><option value="">Усі джерела</option>{data?.utm.sources.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
        <label><span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>Статус замовлення</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-9 w-full rounded-lg border px-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}><option value="all">Усі статуси</option>{data?.summary.statuses.map((item) => <option key={item.key} value={item.key}>{item.key} · {item.docs}</option>)}</select></label>
      </div>
      {loading && <div className="mt-2 text-[11px] font-semibold" style={{ color: "#118dff" }}>Оновлення кампаній…</div>}
      {error && <div className="mt-2 text-[11px] font-semibold" style={{ color: "#b91c1c" }}>{error}</div>}
    </section>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Транзакції" value={numberFmt.format(summary?.total ?? 0)} hint="фактичні замовлення із сайту" />
      <MetricCard label="Дохід" value={formatMoney(summary?.revenue ?? 0)} hint="сума замовлень" tone="#22a06b" />
      <MetricCard label="AOV" value={formatMoney(summary?.averageOrder ?? 0)} hint="середній чек" tone="#7c5ce7" />
      <MetricCard label="Товарів у замовленнях" value={numberFmt.format(totalItems)} hint="на поточній сторінці реєстру" tone="#f59e0b" />
      <MetricCard label="Вартість реклами" value="—" hint="потрібне підключення рекламного cost feed" tone="#6b7280" />
      <MetricCard label="CPL" value="—" hint="з’явиться після підключення витрат" tone="#6b7280" />
      <MetricCard label="CTR" value="—" hint="з’явиться після підключення показів і кліків" tone="#6b7280" />
      <MetricCard label="Замовлення із сайту" value={numberFmt.format(summary?.total ?? 0)} hint="після фільтрів кампанії та статусу" tone="#ef6c3b" />
    </div>

    {!campaign && !source && status === "all" && (data?.utm.campaigns.length ?? 0) > 0 && <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <div className="mb-3"><div className="text-sm font-bold">Ефективність за кампаніями</div><div className="text-[11px]" style={{ color: "var(--text-dim)" }}>Топ кампаній за кількістю замовлень · натисніть для детального реєстру</div></div>
      <div className="grid gap-2 lg:grid-cols-2">
        {data?.utm.campaigns.filter((item) => item.value !== "missing").slice(0, 8).map((item) => {
          const metric = campaignMetrics[item.value];
          return <button key={item.value} type="button" onClick={() => { setCampaign(item.value); setPage(1); }} className="rounded-xl border p-3 text-left" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}>
            <div className="truncate text-xs font-black" title={item.label}>{item.label}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]"><div><span style={{ color: "var(--text-muted)" }}>Транзакції</span><b className="mt-0.5 block text-sm tabular-nums" style={{ color: "#118dff" }}>{numberFmt.format(metric?.total ?? item.count)}</b></div><div><span style={{ color: "var(--text-muted)" }}>Дохід</span><b className="mt-0.5 block text-sm tabular-nums" style={{ color: "#22a06b" }}>{metric ? formatMoney(metric.revenue) : "…"}</b></div><div><span style={{ color: "var(--text-muted)" }}>AOV</span><b className="mt-0.5 block text-sm tabular-nums" style={{ color: "#7c5ce7" }}>{metric ? formatMoney(metric.averageOrder) : "…"}</b></div></div>
          </button>;
        })}
      </div>
    </section>}

    <section className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}><div><div className="text-sm font-bold">Фактичні замовлення із сайту</div><div className="text-[10px]" style={{ color: "var(--text-dim)" }}>{numberFmt.format(data?.meta.total ?? 0)} після застосованих фільтрів</div></div>{campaign && <button type="button" onClick={() => setCampaign("")} className="rounded-lg border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "#118dff55", color: "#118dff" }}>Усі кампанії</button>}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[840px] border-collapse text-left text-xs"><thead style={{ background: "var(--bg-input)", color: "var(--text-dim)" }}><tr><th className="px-4 py-2">Замовлення</th><th className="px-4 py-2">Дата</th><th className="px-4 py-2">Кампанія</th><th className="px-4 py-2">UTM source</th><th className="px-4 py-2">Статус</th><th className="px-4 py-2 text-right">Товарів</th><th className="px-4 py-2 text-right">Сума</th></tr></thead><tbody>{data?.data.map((order) => <tr key={order.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-4 py-3 font-black" style={{ color: "#118dff" }}>#{order.order_num || order.id}</td><td className="px-4 py-3 tabular-nums">{new Date(order.date).toLocaleDateString("uk-UA")}</td><td className="max-w-[220px] truncate px-4 py-3">{order.source?.utm_campaign || "Без UTM"}</td><td className="px-4 py-3">{order.source?.utm_source || "—"}</td><td className="px-4 py-3">{order.analytics_status || order.status || "—"}</td><td className="px-4 py-3 text-right tabular-nums">{numberFmt.format(order.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0))}</td><td className="px-4 py-3 text-right font-black tabular-nums">{formatMoney(order.totals.cost || 0)}</td></tr>)}</tbody></table></div>
      {(data?.meta.total_pages ?? 1) > 1 && <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border)" }}><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">←</button><span className="text-xs tabular-nums">{page} / {data?.meta.total_pages}</span><button type="button" disabled={page >= (data?.meta.total_pages ?? 1)} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">→</button></div>}
    </section>
  </div>;
}
