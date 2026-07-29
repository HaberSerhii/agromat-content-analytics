"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type {
  PromotionWebFunnelResponse,
  WebFunnelChannel,
  WebFunnelComparison,
  WebFunnelPeriod,
  WebFunnelPeriodKind,
} from "@/lib/promotion-web-funnel-types";

type SuggestedUrl = {
  name: string;
  url: string;
};

const CHANNELS: Array<{ key: WebFunnelChannel; label: string; color: string }> = [
  { key: "all", label: "Всі канали", color: "#118dff" },
  { key: "organic", label: "Органіка", color: "#107c10" },
  { key: "cpc", label: "CPC", color: "#f7630c" },
  { key: "direct", label: "Direct", color: "#744da9" },
];

const SITEWIDE_URL = "https://www.agromat.ua/";
const numberFmt = new Intl.NumberFormat("uk-UA");

function kyivIsoToday(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function defaultCustomRange(): { from: string; to: string } {
  const to = shiftIsoDays(kyivIsoToday(), -1);
  return { from: shiftIsoDays(to, -6), to };
}

const DEFAULT_CUSTOM_RANGE = defaultCustomRange();

function periodComparisonCode(periodKind: WebFunnelPeriodKind): string {
  if (periodKind === "week") return "WoW";
  if (periodKind === "month") return "MoM";
  return "Період";
}

function formatUsers(value: number): string {
  return numberFmt.format(value);
}

function formatPct(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

function relativeDelta(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

function DeltaBadge({
  value,
  suffix = "",
  digits = 1,
}: {
  value: number | null;
  suffix?: string;
  digits?: number;
}) {
  if (value == null || !Number.isFinite(value)) {
    return (
      <span className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}>
        —
      </span>
    );
  }
  const positive = value >= 0;
  return (
    <span
      className="rounded-full px-2 py-1 text-[10px] font-bold tabular-nums"
      style={{
        background: positive ? "#e5f3e5" : "#fde8e8",
        color: positive ? "#107c10" : "#c42b1c",
      }}
    >
      {positive ? "+" : ""}{value.toFixed(digits)}{suffix}
    </span>
  );
}

function ComparisonMetricCard({
  title,
  baseline,
  current,
  kind,
}: {
  title: string;
  baseline: WebFunnelPeriod;
  current: WebFunnelPeriod;
  kind: "cr" | "orders";
}) {
  const currentValue = kind === "cr" ? current.conversionRatePct : current.orderUsers;
  const baselineValue = kind === "cr" ? baseline.conversionRatePct : baseline.orderUsers;
  const available = current.available && baseline.available && baselineValue != null;
  const delta = available ? relativeDelta(currentValue, baselineValue) : null;
  const absolute = kind === "orders" && available
    ? Number(currentValue) - Number(baselineValue)
    : null;
  const renderValue = (value: number | null, period: WebFunnelPeriod) => {
    if (!period.available || value == null) return "—";
    return kind === "cr" ? formatPct(value, 3) : formatUsers(value);
  };

  return (
    <div className="rounded-xl border px-4 py-4 text-center" style={{ borderColor: "var(--border2)", background: "#fff" }}>
      <div className="text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: "var(--text-dim)" }}>
        {title}
      </div>
      <div className="mt-3 flex items-baseline justify-center gap-2 font-black tabular-nums">
        <span style={{ color: baseline.available ? "#118dff" : "var(--text-muted)" }}>
          {renderValue(baselineValue, baseline)}
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>vs</span>
        <span style={{ color: current.available ? "#f7630c" : "var(--text-muted)" }}>
          {renderValue(currentValue, current)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        <DeltaBadge value={delta} suffix="%" />
        {kind === "orders" && (
          <DeltaBadge value={absolute} suffix=" зам." digits={0} />
        )}
      </div>
    </div>
  );
}

function ComparisonSummary({
  comparison,
  periodKind,
}: {
  comparison: WebFunnelComparison;
  periodKind: WebFunnelPeriodKind;
}) {
  const periodCode = periodComparisonCode(periodKind);
  return (
    <section className="rounded-2xl border p-4" style={{ borderColor: "var(--border2)", background: "#fff" }}>
      <div className="text-center text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-dim)" }}>
        {periodCode} · {comparison.previous.shortLabel} vs {comparison.current.shortLabel}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ComparisonMetricCard title="CR" baseline={comparison.previous} current={comparison.current} kind="cr" />
        <ComparisonMetricCard title="Замовлення" baseline={comparison.previous} current={comparison.current} kind="orders" />
      </div>

      <div className="mt-5 text-center text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-dim)" }}>
        YoY · {comparison.yearAgo.shortLabel} vs {comparison.current.shortLabel}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ComparisonMetricCard title="CR" baseline={comparison.yearAgo} current={comparison.current} kind="cr" />
        <ComparisonMetricCard title="Замовлення" baseline={comparison.yearAgo} current={comparison.current} kind="orders" />
      </div>
      {!comparison.yearAgo.available && (
        <div className="mt-3 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
          Для цієї сторінки немає даних за відповідний період минулого року.
        </div>
      )}
    </section>
  );
}

function FunnelComparisonChart({
  comparison,
  compact = false,
}: {
  comparison: WebFunnelComparison;
  compact?: boolean;
}) {
  const left = comparison.previous;
  const right = comparison.current;
  const width = compact ? 460 : 820;
  const top = compact ? 58 : 70;
  const stepHeight = compact ? 88 : 112;
  const bottomPad = compact ? 22 : 28;
  const height = top + stepHeight * left.stages.length + bottomPad;
  const center = width / 2;
  const maxHalf = compact ? 170 : 270;
  const minHalf = compact ? 28 : 48;
  const base = Math.max(1, left.startUsers, right.startUsers);
  const visualWidth = (value: number) => {
    if (value <= 0) return minHalf;
    return Math.max(minHalf, maxHalf * Math.pow(value / base, 0.38));
  };
  const leftWidths = left.stages.map((stage) => visualWidth(stage.users));
  const rightWidths = right.stages.map((stage) => visualWidth(stage.users));
  const blueId = useId().replaceAll(":", "");
  const orangeId = useId().replaceAll(":", "");

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={compact ? "mx-auto block min-w-[400px]" : "mx-auto block min-w-[620px]"}
        role="img"
        aria-label={`Воронка ${left.label} у порівнянні з ${right.label}`}
        style={{ width: "100%", maxWidth: compact ? 680 : 900 }}
      >
        <defs>
          <linearGradient id={blueId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6bb9ff" />
            <stop offset="100%" stopColor="#168df5" />
          </linearGradient>
          <linearGradient id={orangeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f6aa82" />
            <stop offset="100%" stopColor="#f0763d" />
          </linearGradient>
        </defs>

        <g fontFamily="inherit">
          <rect x={center - 155} y="11" width="10" height="10" rx="2" fill="#168df5" />
          <text x={center - 139} y="20" fontSize={compact ? 11 : 12} fontWeight="700" fill="#118dff">
            {left.label}
          </text>
          <rect x={center + 15} y="11" width="10" height="10" rx="2" fill="#f0763d" />
          <text x={center + 31} y="20" fontSize={compact ? 11 : 12} fontWeight="700" fill="#f7630c">
            {right.label}
          </text>

          {left.stages.map((stage, index) => {
            const y1 = top + index * stepHeight;
            const y2 = y1 + stepHeight;
            const leftTop = leftWidths[index];
            const rightTop = rightWidths[index];
            const leftBottom = index < left.stages.length - 1
              ? leftWidths[index + 1]
              : Math.max(minHalf * 0.82, leftTop * 0.82);
            const rightBottom = index < right.stages.length - 1
              ? rightWidths[index + 1]
              : Math.max(minHalf * 0.82, rightTop * 0.82);
            const labelY = y1 + stepHeight * 0.5;
            const leftConversion = stage.conversionFromPreviousPct;
            const rightConversion = right.stages[index]?.conversionFromPreviousPct ?? null;
            const leftBetter = leftConversion != null && rightConversion != null && leftConversion > rightConversion;
            const rightBetter = leftConversion != null && rightConversion != null && rightConversion > leftConversion;
            return (
              <g key={stage.key}>
                {index === 0 && (
                  <>
                    <ellipse
                      cx={center - leftTop / 2}
                      cy={y1}
                      rx={leftTop / 2}
                      ry={compact ? 9 : 13}
                      fill="#b9ddff"
                      opacity={left.available ? 0.95 : 0.25}
                    />
                    <ellipse
                      cx={center + rightTop / 2}
                      cy={y1}
                      rx={rightTop / 2}
                      ry={compact ? 9 : 13}
                      fill="#f8c7ab"
                      opacity={right.available ? 0.95 : 0.25}
                    />
                  </>
                )}
                <polygon
                  points={`${center - leftTop},${y1} ${center},${y1} ${center},${y2} ${center - leftBottom},${y2}`}
                  fill={`url(#${blueId})`}
                  opacity={left.available ? 0.96 : 0.25}
                />
                <polygon
                  points={`${center},${y1} ${center + rightTop},${y1} ${center + rightBottom},${y2} ${center},${y2}`}
                  fill={`url(#${orangeId})`}
                  opacity={right.available ? 0.96 : 0.25}
                />
                {index > 0 && (
                  <line
                    x1={center - leftTop - 3}
                    x2={center + rightTop + 3}
                    y1={y1}
                    y2={y1}
                    stroke="#fff"
                    strokeWidth="3"
                  />
                )}
                <text
                  x={center}
                  y={labelY - 6}
                  textAnchor="middle"
                  fontSize={compact ? 10 : 11}
                  fontWeight="800"
                  fill="#25364a"
                >
                  {stage.label.toUpperCase()}
                </text>
                <text
                  x={center - 7}
                  y={labelY + 12}
                  textAnchor="end"
                  fontSize={compact ? 11 : 13}
                  fontWeight="900"
                  fill="#10253e"
                >
                  {left.available ? formatUsers(stage.users) : "—"}
                </text>
                <text
                  x={center + 7}
                  y={labelY + 12}
                  textAnchor="start"
                  fontSize={compact ? 11 : 13}
                  fontWeight="900"
                  fill="#10253e"
                >
                  {right.available ? formatUsers(right.stages[index]?.users || 0) : "—"}
                </text>
                {index > 0 && (
                  <>
                    <text
                      x={center - leftTop - 8}
                      y={y1 + 4}
                      textAnchor="end"
                      fontSize={compact ? 10 : 12}
                      fontWeight="800"
                      fill={leftBetter ? "#107c10" : "#8296ad"}
                    >
                      ↓{formatPct(leftConversion, 1)}
                    </text>
                    <text
                      x={center + rightTop + 8}
                      y={y1 + 4}
                      textAnchor="start"
                      fontSize={compact ? 10 : 12}
                      fontWeight="800"
                      fill={rightBetter ? "#107c10" : "#8296ad"}
                    >
                      ↓{formatPct(rightConversion, 1)}
                    </text>
                  </>
                )}
              </g>
            );
          })}
          <line x1={center} x2={center} y1={top - 5} y2={height - bottomPad + 3} stroke="rgba(255,255,255,.75)" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function ChannelPanel({
  label,
  color,
  comparison,
  periodKind,
}: {
  label: string;
  color: string;
  comparison: WebFunnelComparison;
  periodKind: WebFunnelPeriodKind;
}) {
  return (
    <section className="rounded-2xl border p-4" style={{ borderColor: `${color}55`, background: "#fff" }}>
      <div className="border-b pb-2 text-xs font-black uppercase tracking-[0.12em]" style={{ borderColor: `${color}33`, color }}>
        {label}
      </div>
      <FunnelComparisonChart comparison={comparison} compact />
      <div className="mt-2 text-center text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-dim)" }}>
        {periodComparisonCode(periodKind)} · {comparison.previous.shortLabel} vs {comparison.current.shortLabel}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ComparisonMetricCard title="CR" baseline={comparison.previous} current={comparison.current} kind="cr" />
        <ComparisonMetricCard title="Замовлення" baseline={comparison.previous} current={comparison.current} kind="orders" />
      </div>
      <div className="mt-5 text-center text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-dim)" }}>
        YoY · {comparison.yearAgo.shortLabel} vs {comparison.current.shortLabel}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ComparisonMetricCard title="CR" baseline={comparison.yearAgo} current={comparison.current} kind="cr" />
        <ComparisonMetricCard title="Замовлення" baseline={comparison.yearAgo} current={comparison.current} kind="orders" />
      </div>
    </section>
  );
}

export function PromotionWebFunnelDashboard({
  suggestedUrls,
}: {
  suggestedUrls: SuggestedUrl[];
}) {
  const dataListId = useId();
  const [draftUrl, setDraftUrl] = useState("");
  const [appliedUrl, setAppliedUrl] = useState(SITEWIDE_URL);
  const [periodKind, setPeriodKind] = useState<WebFunnelPeriodKind>("week");
  const [anchor, setAnchor] = useState("");
  const [customFrom, setCustomFrom] = useState(DEFAULT_CUSTOM_RANGE.from);
  const [customTo, setCustomTo] = useState(DEFAULT_CUSTOM_RANGE.to);
  const [appliedCustomFrom, setAppliedCustomFrom] = useState(DEFAULT_CUSTOM_RANGE.from);
  const [appliedCustomTo, setAppliedCustomTo] = useState(DEFAULT_CUSTOM_RANGE.to);
  const [channel, setChannel] = useState<WebFunnelChannel>("all");
  const [data, setData] = useState<PromotionWebFunnelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const uniqueSuggestions = useMemo(() => {
    const seen = new Set<string>();
    return suggestedUrls.filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }, [suggestedUrls]);

  useEffect(() => {
    if (!appliedUrl) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ url: appliedUrl, period: periodKind });
    if (anchor) params.set("anchor", anchor);
    if (periodKind === "custom") {
      params.set("from", appliedCustomFrom);
      params.set("to", appliedCustomTo);
    }
    setLoading(true);
    setError("");
    fetch(`/api/promotions/web-funnel?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося побудувати воронку");
        setData(payload as PromotionWebFunnelResponse);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(reason instanceof Error ? reason.message : "Не вдалося побудувати воронку");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [anchor, appliedCustomFrom, appliedCustomTo, appliedUrl, periodKind]);

  const applyUrl = (event: React.FormEvent) => {
    event.preventDefault();
    const next = draftUrl.trim() || SITEWIDE_URL;
    setAnchor("");
    setData(null);
    setAppliedUrl(next);
  };

  const changeDraftUrl = (value: string) => {
    setDraftUrl(value);
    if (!value.trim()) {
      setAnchor("");
      setData(null);
      setError("");
      setAppliedUrl(SITEWIDE_URL);
    }
  };

  const changePeriod = (value: WebFunnelPeriodKind) => {
    setPeriodKind(value);
    setAnchor("");
    if (value === "custom") {
      setAppliedCustomFrom(customFrom);
      setAppliedCustomTo(customTo);
    }
  };

  const applyCustomPeriod = () => {
    if (!customFrom || !customTo) {
      setError("Оберіть початок і кінець періоду");
      return;
    }
    if (customFrom > customTo) {
      setError("Дата початку має бути раніше дати завершення");
      return;
    }
    setError("");
    setAnchor("");
    setData(null);
    setAppliedCustomFrom(customFrom);
    setAppliedCustomTo(customTo);
  };

  const comparison = data?.comparisons[channel] ?? null;

  return (
    <div className="space-y-4">
      <section
        className="rounded-2xl border p-4"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <form onSubmit={applyUrl} className="min-w-[300px] flex-1">
            <label className="mb-1 block text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-dim)" }}>
              URL сторінки · порожнє поле показує весь сайт
            </label>
            <div className="flex gap-2">
              <input
                type="search"
                value={draftUrl}
                onChange={(event) => changeDraftUrl(event.target.value)}
                list={dataListId}
                placeholder="Весь сайт — або вставте URL окремої сторінки"
                className="h-10 min-w-0 flex-1 rounded-xl border px-3 text-xs outline-none"
                style={{ background: "var(--bg-input)", borderColor: "var(--border2)", color: "var(--text)" }}
              />
              <datalist id={dataListId}>
                {uniqueSuggestions.map((item) => (
                  <option key={`${item.url}-${item.name}`} value={item.url}>{item.name}</option>
                ))}
              </datalist>
              <button
                type="submit"
                disabled={loading}
                className="h-10 rounded-xl border-0 px-5 text-xs font-bold text-white disabled:opacity-50"
                style={{ background: "#118dff" }}
              >
                {loading ? "Рахуємо…" : draftUrl.trim() ? "Побудувати" : "Весь сайт"}
              </button>
            </div>
          </form>

          <div>
            <div className="mb-1 text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-dim)" }}>
              Канал
            </div>
            <div className="flex rounded-xl border p-0.5" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}>
              {CHANNELS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setChannel(item.key)}
                  className="rounded-lg border-0 px-3 py-2 text-[11px] font-bold"
                  style={channel === item.key
                    ? { background: "#fff", color: item.color, boxShadow: "var(--shadow-sm)" }
                    : { background: "transparent", color: "var(--text-dim)" }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {data && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-lg px-2.5 py-1 text-[10px] font-semibold" style={{ background: "#e8f4ff", color: "#0067b8" }}>
              {data.scope === "sitewide" ? "Увесь сайт" : data.normalizedUrl}
            </span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {data.scope === "sitewide"
                ? "Унікальні користувачі кожної події GA4 · як у загальній воронці Looker"
                : "Унікальні користувачі · події після відвідування URL в одній сесії"}
            </span>
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-xl border px-4 py-3 text-xs" style={{ borderColor: "#f4b8b8", background: "#fff4f4", color: "#a4262c" }}>
          {error}
        </div>
      )}

      {loading && !data && !error && (
        <section className="rounded-2xl border px-6 py-16 text-center" style={{ background: "#fff", borderColor: "var(--border)" }}>
          <div className="text-base font-bold" style={{ color: "var(--text)" }}>Будуємо воронку…</div>
          <div className="mx-auto mt-2 max-w-xl text-xs leading-5" style={{ color: "var(--text-dim)" }}>
            Отримуємо унікальних користувачів із GA4 та порівнюємо вибрані періоди.
          </div>
        </section>
      )}

      {data && comparison && (
        <>
          <section
            className="rounded-2xl border p-3"
            style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl border p-0.5" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}>
                {([
                  ["week", "Тижні"],
                  ["month", "Місяці"],
                  ["custom", "Календар"],
                ] as Array<[WebFunnelPeriodKind, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => changePeriod(value)}
                    className="rounded-lg border-0 px-3 py-1.5 text-xs font-bold"
                    style={periodKind === value
                      ? { background: "#e8f4ff", color: "#0078d4" }
                      : { background: "transparent", color: "var(--text-dim)" }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {periodKind === "custom" && (
                <div className="flex flex-wrap items-end gap-2 rounded-xl border p-2" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}>
                  <label className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>
                    Від
                    <input
                      type="date"
                      value={customFrom}
                      max={DEFAULT_CUSTOM_RANGE.to}
                      onChange={(event) => setCustomFrom(event.target.value)}
                      className="mt-1 block h-8 rounded-lg border px-2 text-xs font-semibold outline-none"
                      style={{ background: "#fff", borderColor: "var(--border2)", color: "var(--text)" }}
                    />
                  </label>
                  <label className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--text-dim)" }}>
                    До
                    <input
                      type="date"
                      value={customTo}
                      max={DEFAULT_CUSTOM_RANGE.to}
                      onChange={(event) => setCustomTo(event.target.value)}
                      className="mt-1 block h-8 rounded-lg border px-2 text-xs font-semibold outline-none"
                      style={{ background: "#fff", borderColor: "var(--border2)", color: "var(--text)" }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={applyCustomPeriod}
                    disabled={loading}
                    className="h-8 rounded-lg border-0 px-3 text-[11px] font-bold text-white disabled:opacity-50"
                    style={{ background: "#118dff" }}
                  >
                    Застосувати
                  </button>
                </div>
              )}

              {periodKind !== "custom" && (
                <button
                  type="button"
                  onClick={() => setAnchor(data.navigation.previousAnchor)}
                  className="h-8 w-8 rounded-lg border text-sm font-bold"
                  style={{ background: "#fff", borderColor: "var(--border2)", color: "var(--text-mid)" }}
                  aria-label="Попередній період"
                >
                  ◀
                </button>
              )}
              <span className="rounded-lg border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "#b9dfff", background: "#f6fbff", color: "#0078d4" }}>
                {comparison.previous.label}
              </span>
              <span className="text-xs font-bold" style={{ color: "var(--text-muted)" }}>→</span>
              <span className="rounded-lg border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "#f8c4a8", background: "#fff8f4", color: "#f05a1a" }}>
                {comparison.current.label}
              </span>
              {periodKind !== "custom" && (
                <button
                  type="button"
                  onClick={() => setAnchor(data.navigation.nextAnchor)}
                  disabled={!data.navigation.canGoNext}
                  className="h-8 w-8 rounded-lg border text-sm font-bold disabled:opacity-30"
                  style={{ background: "#fff", borderColor: "var(--border2)", color: "var(--text-mid)" }}
                  aria-label="Наступний період"
                >
                  ▶
                </button>
              )}
              {loading && <span className="text-[10px]" style={{ color: "#118dff" }}>Оновлюємо дані…</span>}
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(340px,.8fr)]">
            <section
              className="rounded-2xl border p-4"
              style={{ background: "#fff", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}
            >
              <FunnelComparisonChart comparison={comparison} />
            </section>
            <ComparisonSummary comparison={comparison} periodKind={periodKind} />
          </div>

          <div>
            <div className="mb-2 text-xs font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-dim)" }}>
              Порівняння за каналами
            </div>
            <div className="grid gap-4 xl:grid-cols-3">
              {CHANNELS.filter((item) => item.key !== "all").map((item) => (
                <ChannelPanel
                  key={item.key}
                  label={item.label}
                  color={item.color}
                  comparison={data.comparisons[item.key]}
                  periodKind={periodKind}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
