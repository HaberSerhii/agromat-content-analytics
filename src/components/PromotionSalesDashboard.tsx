"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PromotionSalesBucket,
  PromotionSalesDailySummary,
  PromotionSalesDataset,
  PromotionSalesProductSummary,
  PromotionSalesPromotionSummary,
  PromotionSalesStatus,
} from "@/lib/promotion-sales-types";

const numberFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });
const compactFmt = new Intl.NumberFormat("uk-UA", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const STATUS_OPTIONS: Array<{ value: PromotionSalesStatus; label: string }> = [
  { value: "Повністю відвантажений", label: "Повністю відвантажено" },
  { value: "відвантаження дозволено", label: "Відвантаження дозволено" },
];

function fmtMoney(value: number): string {
  return `${numberFmt.format(value)} грн`;
}

function fmtPct(value: number | null): string {
  return value == null ? "—" : `${pctFmt.format(value)}%`;
}

function fmtDate(value: string | null): string {
  if (!value) return "безстроково";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function fmtShortDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${day}.${month}`;
}

function fmtChartDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function inputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthRange() {
  const now = new Date();
  return {
    from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
    to: inputDate(now),
  };
}

function previousMonthRange() {
  const now = new Date();
  return {
    from: inputDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    to: inputDate(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-3 overflow-hidden rounded-full" style={{ background: "var(--bg-input)" }}>
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

function PlanProgressCard({
  label,
  revenue,
  plan,
  completionPct,
  color,
}: {
  label: string;
  revenue: number;
  plan: number | null;
  completionPct: number | null;
  color: string;
}) {
  const progress = completionPct ?? 0;
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: `${color}44`, background: "var(--bg-card)" }}>
      <div className="text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>{label}</div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <div className="text-xl font-black tabular-nums" style={{ color: "var(--text)" }}>
            {fmtMoney(revenue)}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: "var(--text-dim)" }}>
            {plan ? `з плану ${fmtMoney(plan)}` : "План не заданий"}
          </div>
        </div>
        <div className="text-xl font-black tabular-nums" style={{ color }}>
          {fmtPct(completionPct)}
        </div>
      </div>
      <div className="mt-3">
        <ProgressBar value={progress} color={progress >= 100 ? "#22c55e" : color} />
      </div>
    </div>
  );
}

function sameIdincs(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((idinc) => rightSet.has(idinc));
}

function KpiCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <div className="text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums" style={{ color }}>{value}</div>
      <div className="mt-1 text-[11px]" style={{ color: "var(--text-dim)" }}>{hint}</div>
    </div>
  );
}

type DailyChartMeasure = "revenue" | "qty";
type DailyChartSegment = "total" | "tile" | "plumbing";

function ChartToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className="h-7 rounded-md px-2.5 text-[11px] font-bold transition-colors"
            style={{
              background: active ? "var(--bg-card)" : "transparent",
              color: active ? "#118dff" : "var(--text-dim)",
              boxShadow: active ? "var(--shadow-sm)" : "none",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function DailySalesChart({
  daily,
  selectedPromotionCount,
}: {
  daily: PromotionSalesDailySummary[];
  selectedPromotionCount: number;
}) {
  const [measure, setMeasure] = useState<DailyChartMeasure>("revenue");
  const [segment, setSegment] = useState<DailyChartSegment>("total");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const color = segment === "tile" ? "#f59e0b" : segment === "plumbing" ? "#22c55e" : "#118dff";
  const values = daily.map((day) => day[segment][measure]);
  const width = 1000;
  const height = 190;
  const left = 62;
  const right = 18;
  const top = 14;
  const bottom = 36;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(0, ...values);
  const scaleMax = maxValue > 0 ? maxValue * 1.08 : 1;
  const xFor = (index: number) => daily.length <= 1
    ? left + plotWidth / 2
    : left + (index / (daily.length - 1)) * plotWidth;
  const yFor = (value: number) => top + plotHeight - (value / scaleMax) * plotHeight;
  const points = values.map((value, index) => ({ x: xFor(index), y: yFor(value), value }));
  const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const areaPath = points.length
    ? `${linePath} L${points.at(-1)?.x},${top + plotHeight} L${points[0].x},${top + plotHeight} Z`
    : "";
  const selectedIndex = daily.length
    ? Math.min(hoveredIndex ?? daily.length - 1, daily.length - 1)
    : -1;
  const selectedDay = selectedIndex >= 0 ? daily[selectedIndex] : null;
  const selectedPoint = selectedIndex >= 0 ? points[selectedIndex] : null;
  const labelCount = Math.min(6, daily.length);
  const xLabelIndexes = [...new Set(Array.from({ length: labelCount }, (_, index) => (
    labelCount <= 1 ? 0 : Math.round((index / (labelCount - 1)) * (daily.length - 1))
  )))];
  const formatValue = (value: number, compact = false) => {
    const formatted = (compact ? compactFmt : numberFmt).format(value);
    return measure === "revenue" ? `${formatted} грн` : `${formatted} шт.`;
  };

  return (
    <section className="rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>Динаміка продажів за днями</div>
          <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-dim)" }}>
            {selectedPromotionCount > 0
              ? `${selectedPromotionCount} обраних акцій · за датою продажу`
              : "Усі акційні пропозиції · за датою продажу"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ChartToggle
            value={measure}
            onChange={setMeasure}
            options={[
              { value: "revenue", label: "грн" },
              { value: "qty", label: "штуки" },
            ]}
          />
          <ChartToggle
            value={segment}
            onChange={setSegment}
            options={[
              { value: "total", label: "Всі" },
              { value: "tile", label: "Плитка" },
              { value: "plumbing", label: "Сантехніка" },
            ]}
          />
        </div>
      </div>

      <div className="mt-2 flex min-h-8 items-end justify-between gap-3">
        <div className="text-[11px] font-semibold" style={{ color: "var(--text-dim)" }}>
          {selectedDay ? fmtChartDate(selectedDay.date) : "Немає даних"}
        </div>
        <div className="text-lg font-black tabular-nums" style={{ color }}>
          {selectedDay ? formatValue(selectedDay[segment][measure]) : "—"}
        </div>
      </div>

      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block h-[172px] w-full sm:h-[190px]"
          role="img"
          aria-label={`Графік продажів за днями: ${measure === "revenue" ? "у гривнях" : "у штуках"}`}
        >
          <title>Динаміка продажів акційних товарів за датою продажу</title>
          <defs>
            <linearGradient id="promotion-sales-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.24" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {Array.from({ length: 5 }, (_, index) => {
            const ratio = index / 4;
            const y = top + ratio * plotHeight;
            const value = scaleMax * (1 - ratio);
            return (
              <g key={index}>
                <line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
                <text x={left - 9} y={y + 4} textAnchor="end" fontSize="10" fill="var(--text-dim)">
                  {formatValue(value, true).replace(" грн", "").replace(" шт.", "")}
                </text>
              </g>
            );
          })}
          {xLabelIndexes.map((index) => (
            <text
              key={daily[index]?.date}
              x={xFor(index)}
              y={height - 10}
              textAnchor={index === 0 ? "start" : index === daily.length - 1 ? "end" : "middle"}
              fontSize="10"
              fill="var(--text-dim)"
            >
              {daily[index] ? fmtShortDate(daily[index].date) : ""}
            </text>
          ))}
          <rect
            x={left}
            y={top}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onPointerMove={(event) => {
              if (!daily.length) return;
              const svg = event.currentTarget.ownerSVGElement;
              if (!svg) return;
              const bounds = svg.getBoundingClientRect();
              const viewX = ((event.clientX - bounds.left) / bounds.width) * width;
              const ratio = Math.max(0, Math.min(1, (viewX - left) / plotWidth));
              setHoveredIndex(Math.round(ratio * Math.max(0, daily.length - 1)));
            }}
            onPointerLeave={() => setHoveredIndex(null)}
          />
          {areaPath && <path d={areaPath} fill="url(#promotion-sales-area)" pointerEvents="none" />}
          {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />}
          {selectedPoint && (
            <g pointerEvents="none">
              <line x1={selectedPoint.x} x2={selectedPoint.x} y1={top} y2={top + plotHeight} stroke={color} strokeOpacity="0.35" strokeDasharray="4 4" />
              <circle cx={selectedPoint.x} cy={selectedPoint.y} r="5" fill="var(--bg-card)" stroke={color} strokeWidth="3" />
            </g>
          )}
          {points.map((point, index) => (
            <circle
              key={daily[index].date}
              cx={point.x}
              cy={point.y}
              r="8"
              fill="transparent"
              tabIndex={0}
              aria-label={`${fmtChartDate(daily[index].date)}: ${formatValue(point.value)}`}
              onFocus={() => setHoveredIndex(index)}
              onBlur={() => setHoveredIndex(null)}
            />
          ))}
          {maxValue === 0 && (
            <text x={left + plotWidth / 2} y={top + plotHeight / 2} textAnchor="middle" fontSize="12" fill="var(--text-dim)">
              У вибраному зрізі продажів немає
            </text>
          )}
        </svg>
      </div>
    </section>
  );
}

function PromotionList({
  items,
  selectedIdincs,
  onToggle,
  onClear,
}: {
  items: PromotionSalesPromotionSummary[];
  selectedIdincs: number[];
  onToggle: (idinc: number) => void;
  onClear: () => void;
}) {
  const [showWithoutSales, setShowWithoutSales] = useState(false);
  const selected = new Set(selectedIdincs);
  const withSales = items.filter((item) => item.revenue > 0);
  const withoutSales = items.filter((item) => item.revenue <= 0);
  const maxRevenue = Math.max(1, ...items.map((item) => item.revenue));
  const renderPromotion = (item: PromotionSalesPromotionSummary) => {
    const active = selected.has(item.idinc);
    return (
      <div
        key={item.idinc}
        className="grid gap-2 rounded-lg border px-3 py-2 md:min-h-[54px] md:grid-cols-[minmax(220px,330px)_1fr_145px_34px] md:items-center"
        style={{
          borderColor: active ? "#118dff" : "transparent",
          background: active ? "#118dff0f" : "transparent",
        }}
      >
        <button
          type="button"
          aria-pressed={active}
          onClick={() => onToggle(item.idinc)}
          className="min-w-0 border-0 bg-transparent p-0 text-left"
        >
          <div className="flex items-center gap-2">
            <span
              className="flex h-4 w-4 flex-none items-center justify-center rounded border text-[10px] font-black"
              style={{
                borderColor: active ? "#118dff" : "var(--border2)",
                background: active ? "#118dff" : "var(--bg-card)",
                color: active ? "#fff" : "transparent",
              }}
            >
              ✓
            </span>
            <span className="truncate text-xs font-bold" style={{ color: "var(--text)" }} title={item.name}>
              {item.idinc} · {item.name}
            </span>
          </div>
          <div className="ml-6 text-[10px]" style={{ color: "var(--text-dim)" }}>
            {fmtDate(item.startDate)}–{fmtDate(item.endDate)} · {numberFmt.format(item.productCount)} товарів
          </div>
        </button>
        <ProgressBar value={(item.revenue / maxRevenue) * 100} color="#118dff" />
        <div className="text-xs font-bold tabular-nums md:text-right" style={{ color: "var(--text)" }}>
          {fmtMoney(item.revenue)}
        </div>
        {item.publicUrl ? (
          <a
            href={item.publicUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Відкрити акцію на сайті: ${item.name}`}
            title="Відкрити сторінку акції на сайті"
            className="flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-black no-underline"
            style={{ borderColor: "#22c55e55", background: "#22c55e12", color: "#15803d" }}
          >
            ↗
          </a>
        ) : (
          <span className="text-center" style={{ color: "var(--text-muted)" }}>—</span>
        )}
      </div>
    );
  };
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold" style={{ color: "var(--text)" }}>Актуальні акції</div>
          <div className="text-[11px]" style={{ color: "var(--text-dim)" }}>
            Натисніть на акцію, щоб відфільтрувати весь дашборд
          </div>
        </div>
        {selectedIdincs.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border px-3 py-1.5 text-xs font-bold"
            style={{ borderColor: "#118dff55", background: "#118dff12", color: "#118dff" }}
          >
            Показати всі
          </button>
        )}
      </div>
      <div className="max-h-[416px] space-y-1.5 overflow-auto pr-1">
        {withSales.map(renderPromotion)}
        {withoutSales.length > 0 && (
          <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
            <button
              type="button"
              onClick={() => setShowWithoutSales((current) => !current)}
              className="w-full rounded-lg border px-3 py-2 text-left text-xs font-bold"
              style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text-mid)" }}
            >
              {showWithoutSales ? "▾" : "▸"} Без продажів ({withoutSales.length})
            </button>
            {showWithoutSales && (
              <div className="mt-1.5 space-y-1.5">
                {withoutSales.map(renderPromotion)}
              </div>
            )}
          </div>
        )}
        {!items.length && (
          <div className="py-8 text-center text-xs" style={{ color: "var(--text-dim)" }}>
            У вибраному періоді немає акцій
          </div>
        )}
      </div>
    </section>
  );
}

function MoneyRanking({
  title,
  items,
  color,
  expandable = false,
  selectedLabel,
  onSelect,
}: {
  title: string;
  items: PromotionSalesBucket[];
  color: string;
  expandable?: boolean;
  selectedLabel?: string | null;
  onSelect?: (label: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expandable && !expanded ? items.slice(0, 20) : items;
  const maxRevenue = Math.max(1, ...items.map((item) => item.revenue));
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-bold" style={{ color: "var(--text)" }}>{title}</div>
        {expandable && items.length > 20 && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="rounded-lg border px-3 py-1 text-xs font-semibold"
            style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text-mid)" }}
          >
            {expanded ? "Показати перші 20" : `Показати всі (${items.length})`}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {visible.map((item) => (
          <button
            key={item.label}
            type="button"
            aria-pressed={selectedLabel === item.label}
            onClick={() => onSelect?.(item.label)}
            className="grid w-full gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors md:grid-cols-[190px_1fr_150px_18px] md:items-center"
            style={{
              borderColor: selectedLabel === item.label ? `${color}88` : "transparent",
              background: selectedLabel === item.label ? `${color}12` : "transparent",
              cursor: onSelect ? "pointer" : "default",
            }}
          >
            <div className="truncate text-xs font-semibold" style={{ color: "var(--text)" }} title={item.label}>
              {item.label}
            </div>
            <ProgressBar value={(item.revenue / maxRevenue) * 100} color={color} />
            <div className="text-xs font-semibold tabular-nums md:text-right" style={{ color: "var(--text-dim)" }}>
              {fmtMoney(item.revenue)}
            </div>
            <span className="text-center text-xs font-black" style={{ color }}>›</span>
          </button>
        ))}
        {!visible.length && (
          <div className="py-5 text-center text-xs" style={{ color: "var(--text-dim)" }}>Продажів немає</div>
        )}
      </div>
    </section>
  );
}

function ProductSalesDetails({
  type,
  label,
  products,
  onClose,
}: {
  type: "brand" | "category";
  label: string;
  products: PromotionSalesProductSummary[];
  onClose: () => void;
}) {
  const totalRevenue = products.reduce((sum, product) => sum + product.revenue, 0);
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "#118dff66", background: "var(--bg-card)" }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>
            {type === "brand" ? "Товари бренду" : "Товари категорії"}
          </div>
          <div className="mt-1 text-base font-black" style={{ color: "var(--text)" }}>{label}</div>
          <div className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>
            {numberFmt.format(products.length)} товарів · {fmtMoney(totalRevenue)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрити список товарів"
          className="h-8 rounded-lg border px-3 text-xs font-bold"
          style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text-mid)" }}
        >
          Закрити
        </button>
      </div>
      <div className="max-h-[520px] overflow-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
        <div
          className="sticky top-0 z-10 hidden grid-cols-[100px_minmax(280px,1fr)_190px_90px_150px] gap-3 border-b px-3 py-2 text-[10px] font-bold uppercase md:grid"
          style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text-dim)" }}
        >
          <span>Код товару</span>
          <span>Товар</span>
          <span>{type === "brand" ? "Категорія" : "Бренд"}</span>
          <span className="text-right">Документи</span>
          <span className="text-right">Продажі</span>
        </div>
        {products.map((product) => (
          <a
            key={`${product.code}-${product.brand}-${product.category}`}
            href={product.url}
            target="_blank"
            rel="noreferrer"
            className="grid gap-1 border-b px-3 py-2.5 no-underline last:border-b-0 md:grid-cols-[100px_minmax(280px,1fr)_190px_90px_150px] md:items-center md:gap-3"
            style={{ borderColor: "var(--border)", color: "inherit" }}
            title="Відкрити товар на сайті"
          >
            <span className="text-[11px] font-bold tabular-nums" style={{ color: "#118dff" }}>{product.code}</span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold" style={{ color: "var(--text)" }}>{product.name}</span>
              <span className="text-[10px] md:hidden" style={{ color: "var(--text-dim)" }}>
                {type === "brand" ? product.category : product.brand}
              </span>
            </span>
            <span className="hidden truncate text-xs md:block" style={{ color: "var(--text-dim)" }}>
              {type === "brand" ? product.category : product.brand}
            </span>
            <span className="text-xs tabular-nums md:text-right" style={{ color: "var(--text-dim)" }}>
              {numberFmt.format(product.docs)}
            </span>
            <span className="text-xs font-black tabular-nums md:text-right" style={{ color: "#22c55e" }}>
              {fmtMoney(product.revenue)} ↗
            </span>
          </a>
        ))}
        {!products.length && (
          <div className="px-4 py-8 text-center text-xs" style={{ color: "var(--text-dim)" }}>Продажів немає</div>
        )}
      </div>
    </section>
  );
}

function SelectedPromotionProducts({
  promotions,
  products,
}: {
  promotions: PromotionSalesPromotionSummary[];
  products: PromotionSalesProductSummary[];
}) {
  const totalRevenue = products.reduce((sum, product) => sum + product.revenue, 0);
  const totalQty = products.reduce((sum, product) => sum + product.qty, 0);
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "#118dff66", background: "var(--bg-card)" }}>
      <div className="mb-3">
        <div className="text-[10px] font-bold uppercase" style={{ color: "#118dff" }}>
          Продані товари в обраній акції
        </div>
        <div className="mt-1 truncate text-sm font-black" style={{ color: "var(--text)" }} title={promotions.map((promotion) => promotion.name).join("; ")}>
          {promotions.map((promotion) => `${promotion.idinc} · ${promotion.name}`).join("; ")}
        </div>
        <div className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>
          {numberFmt.format(products.length)} товарів · {numberFmt.format(totalQty)} шт. · {fmtMoney(totalRevenue)}
        </div>
      </div>
      <div className="max-h-[460px] overflow-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
        <div
          className="sticky top-0 z-10 hidden grid-cols-[90px_minmax(260px,1fr)_210px_80px_80px_145px] gap-3 border-b px-3 py-2 text-[10px] font-bold uppercase md:grid"
          style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text-dim)" }}
        >
          <span>Код товару</span>
          <span>Товар</span>
          <span>Бренд · категорія</span>
          <span className="text-right">Документи</span>
          <span className="text-right">Штуки</span>
          <span className="text-right">Продажі</span>
        </div>
        {products.map((product) => (
          <a
            key={`${product.code}-${product.brand}-${product.category}`}
            href={product.url}
            target="_blank"
            rel="noreferrer"
            className="grid gap-1 border-b px-3 py-2.5 no-underline last:border-b-0 md:grid-cols-[90px_minmax(260px,1fr)_210px_80px_80px_145px] md:items-center md:gap-3"
            style={{ borderColor: "var(--border)", color: "inherit" }}
            title="Відкрити товар на сайті"
          >
            <span className="text-[11px] font-bold tabular-nums" style={{ color: "#118dff" }}>{product.code}</span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold" style={{ color: "var(--text)" }}>{product.name}</span>
              <span className="text-[10px] md:hidden" style={{ color: "var(--text-dim)" }}>
                {product.brand} · {product.category}
              </span>
            </span>
            <span className="hidden min-w-0 md:block">
              <span className="block truncate text-xs font-semibold" style={{ color: "var(--text-mid)" }}>{product.brand}</span>
              <span className="block truncate text-[10px]" style={{ color: "var(--text-dim)" }}>{product.category}</span>
            </span>
            <span className="text-xs tabular-nums md:text-right" style={{ color: "var(--text-dim)" }}>
              {numberFmt.format(product.docs)} док.
            </span>
            <span className="text-xs font-bold tabular-nums md:text-right" style={{ color: "var(--text-mid)" }}>
              {numberFmt.format(product.qty)} шт.
            </span>
            <span className="text-xs font-black tabular-nums md:text-right" style={{ color: "#22c55e" }}>
              {fmtMoney(product.revenue)} ↗
            </span>
          </a>
        ))}
        {!products.length && (
          <div className="px-4 py-8 text-center text-xs" style={{ color: "var(--text-dim)" }}>
            У вибраному періоді продажів товарів цієї акції немає
          </div>
        )}
      </div>
    </section>
  );
}

export function PromotionSalesDashboard() {
  const initialRange = useMemo(() => currentMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [selectedPromotionIdincs, setSelectedPromotionIdincs] = useState<number[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<{
    type: "brand" | "category";
    label: string;
  } | null>(null);
  const [data, setData] = useState<PromotionSalesDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    if (hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);
    const params = new URLSearchParams({ from: dateFrom, to: dateTo });
    selectedPromotionIdincs.forEach((idinc) => params.append("promotion_idinc", String(idinc)));
    fetch(`/api/promotions/sales?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити продажі акційних товарів");
        return payload as PromotionSalesDataset;
      })
      .then((payload) => {
        if (!alive) return;
        setData(payload);
        setError("");
        hasLoadedRef.current = true;
        const available = new Set(payload.summary.promotions.map((promotion) => promotion.idinc));
        setSelectedPromotionIdincs((current) => {
          const next = current.filter((idinc) => available.has(idinc));
          return next.length === current.length ? current : next;
        });
      })
      .catch((reason: unknown) => {
        if (!alive || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setError(reason instanceof Error ? reason.message : "Не вдалося завантажити продажі акційних товарів");
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [dateFrom, dateTo, selectedPromotionIdincs]);

  const changeFrom = (value: string) => {
    setDateFrom(value);
    if (value > dateTo) setDateTo(value);
  };
  const changeTo = (value: string) => {
    setDateTo(value);
    if (value < dateFrom) setDateFrom(value);
  };
  const shiftRange = (days: number) => {
    setDateFrom((current) => shiftDate(current, days));
    setDateTo((current) => shiftDate(current, days));
  };
  const togglePromotion = (idinc: number) => {
    setSelectedPromotionIdincs((current) => (
      current.includes(idinc)
        ? current.filter((item) => item !== idinc)
        : [...current, idinc]
    ));
  };

  if (loading && !data) {
    return (
      <div className="rounded-xl border px-6 py-20 text-center text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
        Завантажуємо продажі акційних товарів з AWS S3…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border px-6 py-12 text-center" style={{ borderColor: "#ef444455", background: "#ef44440a" }}>
        <div className="text-sm font-bold" style={{ color: "#b91c1c" }}>Продажі не завантажилися</div>
        <div className="mt-2 text-xs" style={{ color: "var(--text-dim)" }}>{error}</div>
      </div>
    );
  }

  const selectedPromotions = data.summary.promotions.filter((promotion) =>
    data.filter.selectedPromotionIdincs.includes(promotion.idinc));
  const selectedProducts = selectedBucket
    ? data.summary.products.filter((product) => (
      selectedBucket.type === "brand"
        ? product.brand === selectedBucket.label
        : product.category === selectedBucket.label
    ))
    : [];
  const plan = data.summary.plan;
  const tilePlan = plan.segments.find((segment) => segment.segment === "Плитка");
  const plumbingPlan = plan.segments.find((segment) => segment.segment === "Сантехніка");

  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <div className="flex flex-wrap items-end gap-2 sm:gap-3">
          <div className="grid w-full grid-cols-[36px_minmax(0,1fr)_minmax(0,1fr)_36px] items-end gap-2 md:w-auto">
          <button
            type="button"
            aria-label="Попередній день"
            onClick={() => shiftRange(-1)}
            className="h-9 w-9 rounded-lg border text-lg font-bold"
            style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text-mid)" }}
          >
            ←
          </button>
          <label className="block min-w-0">
            <span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>Дата від</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo}
              onChange={(event) => changeFrom(event.target.value)}
              className="h-9 w-full min-w-0 rounded-lg border px-2 text-xs font-semibold sm:px-3"
              style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text)" }}
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>Дата до</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(event) => changeTo(event.target.value)}
              className="h-9 w-full min-w-0 rounded-lg border px-2 text-xs font-semibold sm:px-3"
              style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text)" }}
            />
          </label>
          <button
            type="button"
            aria-label="Наступний день"
            onClick={() => shiftRange(1)}
            className="h-9 w-9 rounded-lg border text-lg font-bold"
            style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text-mid)" }}
          >
            →
          </button>
          </div>
          <button
            type="button"
            onClick={() => {
              const range = currentMonthRange();
              setDateFrom(range.from);
              setDateTo(range.to);
            }}
            className="h-9 flex-1 rounded-lg border px-3 text-xs font-bold sm:flex-none"
            style={{ borderColor: "#118dff", background: "#118dff", color: "#fff" }}
          >
            Поточний місяць
          </button>
          <button
            type="button"
            onClick={() => {
              const range = previousMonthRange();
              setDateFrom(range.from);
              setDateTo(range.to);
            }}
            className="h-9 flex-1 rounded-lg border px-3 text-xs font-bold sm:flex-none"
            style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "var(--text)" }}
          >
            Минулий місяць
          </button>
          <div className="ml-0 w-full text-left sm:ml-auto sm:w-auto sm:text-right">
            <div className="text-2xl font-black tabular-nums" style={{ color: "#118dff" }}>
              {numberFmt.format(data.summary.activePromotions)}
            </div>
            <div className="text-[10px] font-semibold uppercase" style={{ color: "var(--text-dim)" }}>
              актуальних акцій у діапазоні
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "#22c55e44", background: "#22c55e0d", color: "#15803d" }}>
            Продажі та план: повністю відвантажені + відвантаження дозволено
          </span>
          {refreshing && <span className="text-xs" style={{ color: "#118dff" }}>Оновлення…</span>}
          {error && <span className="text-xs" style={{ color: "#b91c1c" }}>{error}</span>}
        </div>
        {data.summary.publicPromotionGroups.length > 0 && (
          <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 text-[10px] font-bold uppercase" style={{ color: "var(--text-dim)" }}>
              Акції на сайті
            </div>
            <div className="flex flex-wrap gap-2">
              {data.summary.publicPromotionGroups.map((group) => {
                const active = sameIdincs(data.filter.selectedPromotionIdincs, group.promotionIdincs);
                return (
                  <button
                    key={`${group.url}-${group.name}`}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedPromotionIdincs((current) => (
                      sameIdincs(current, group.promotionIdincs) ? [] : group.promotionIdincs
                    ))}
                    className="rounded-lg border px-3 py-1.5 text-left text-xs font-semibold"
                    style={{
                      borderColor: active ? "#118dff" : "var(--border)",
                      background: active ? "#118dff" : "var(--bg-input)",
                      color: active ? "#fff" : "var(--text-mid)",
                    }}
                    title={`Обрати ${group.promotionIdincs.length} пов’язаних акцій P2`}
                  >
                    {group.name}
                    <span className="ml-1 opacity-70">· {group.promotionIdincs.length} P2</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {selectedPromotions.length > 0 && (
          <div className="mt-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "#118dff44", background: "#118dff0d", color: "var(--text-mid)" }}>
            Обрано акцій: <b style={{ color: "var(--text)" }}>{selectedPromotions.length}</b>
            <span style={{ color: "var(--text-dim)" }}>
              {" · "}{selectedPromotions.map((promotion) => `${promotion.idinc} · ${promotion.name}`).join("; ")}
            </span>
          </div>
        )}
      </section>

      <DailySalesChart
        daily={data.summary.daily ?? []}
        selectedPromotionCount={selectedPromotions.length}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Акцій у діапазоні"
          value={numberFmt.format(data.summary.activePromotions)}
          hint={`${numberFmt.format(data.summary.productCount)} унікальних акційних товарів`}
          color="#118dff"
        />
        <KpiCard
          label="Продажі акційних товарів"
          value={fmtMoney(data.summary.revenue)}
          hint={selectedPromotions.length ? `${selectedPromotions.length} обраних акцій` : "усі акції у вибраному діапазоні"}
          color="#22c55e"
        />
        <KpiCard
          label="Документів у продажах"
          value={numberFmt.format(data.summary.docs)}
          hint="повністю відвантажені та з дозволеним відвантаженням"
          color="#8b5cf6"
        />
        <KpiCard
          label={`План місяця · ${plan.month}`}
          value={fmtPct(plan.completionPct)}
          hint={`${fmtMoney(plan.revenue)} з ${plan.plan ? fmtMoney(plan.plan) : "план не заданий"}`}
          color="#f59e0b"
        />
      </div>

      <section className="rounded-xl border p-4" style={{ borderColor: "#118dff44", background: "linear-gradient(135deg, #118dff0a, #22c55e0a)" }}>
        <div className="mb-3 text-xs font-bold uppercase" style={{ color: "var(--text-dim)" }}>
          План місяця · продажі акційних товарів · {plan.month}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <PlanProgressCard
            label="Загальний план"
            revenue={plan.revenue}
            plan={plan.plan}
            completionPct={plan.completionPct}
            color="#118dff"
          />
          <PlanProgressCard
            label="Плитка"
            revenue={tilePlan?.revenue ?? 0}
            plan={tilePlan?.plan ?? null}
            completionPct={tilePlan?.completionPct ?? null}
            color="#f59e0b"
          />
          <PlanProgressCard
            label="Сантехніка"
            revenue={plumbingPlan?.revenue ?? 0}
            plan={plumbingPlan?.plan ?? null}
            completionPct={plumbingPlan?.completionPct ?? null}
            color="#22c55e"
          />
        </div>
      </section>

      <PromotionList
        items={data.summary.promotions}
        selectedIdincs={data.filter.selectedPromotionIdincs}
        onToggle={togglePromotion}
        onClear={() => setSelectedPromotionIdincs([])}
      />

      {selectedPromotions.length > 0 && (
        <SelectedPromotionProducts
          promotions={selectedPromotions}
          products={data.summary.products}
        />
      )}

      <MoneyRanking
        title="Бренди"
        items={data.summary.brands}
        color="#22c55e"
        expandable
        selectedLabel={selectedBucket?.type === "brand" ? selectedBucket.label : null}
        onSelect={(label) => setSelectedBucket((current) => (
          current?.type === "brand" && current.label === label ? null : { type: "brand", label }
        ))}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <MoneyRanking
          title="Категорії"
          items={data.summary.categories}
          color="#f59e0b"
          expandable
          selectedLabel={selectedBucket?.type === "category" ? selectedBucket.label : null}
          onSelect={(label) => setSelectedBucket((current) => (
            current?.type === "category" && current.label === label ? null : { type: "category", label }
          ))}
        />
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
          <div className="mb-3 text-sm font-bold" style={{ color: "var(--text)" }}>Статуси документів</div>
          <div className="space-y-3">
            {data.summary.states.map((state) => {
              const option = STATUS_OPTIONS.find((item) => item.value === state.state);
              return (
                <div key={state.state} className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-bold" style={{ color: "var(--text)" }}>{option?.label ?? state.state}</div>
                    <div className="text-sm font-black tabular-nums" style={{ color: "#118dff" }}>{fmtMoney(state.revenue)}</div>
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: "var(--text-dim)" }}>
                    {numberFmt.format(state.docs)} документів
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: "#118dff33", background: "#118dff0a", color: "var(--text-dim)" }}>
            У продажі та план входять повністю відвантажені документи й документи зі статусом «Відвантаження дозволено». Для повністю відвантажених перевіряються дата створення та дата повного відвантаження; для дозволених — дата створення. Усі дати мають входити у строк акції та вибраний календарний діапазон.
          </div>
        </section>
      </div>

      {selectedBucket && (
        <ProductSalesDetails
          type={selectedBucket.type}
          label={selectedBucket.label}
          products={selectedProducts}
          onClose={() => setSelectedBucket(null)}
        />
      )}
    </div>
  );
}
