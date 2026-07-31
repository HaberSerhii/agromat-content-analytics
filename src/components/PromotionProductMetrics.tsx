"use client";

import { useEffect, useState } from "react";
import type {
  PromotionProductMetricRow,
  PromotionProductMetricsResponse,
} from "@/lib/promotion-product-metrics-types";
import type {
  WebFunnelChannel,
  WebFunnelDevice,
} from "@/lib/promotion-web-funnel-types";

const numberFmt = new Intl.NumberFormat("uk-UA");

type RankingKind = "addToCart" | "listToProduct" | "addToWishlist";

const RANKING_CONFIG: Array<{
  kind: RankingKind;
  title: string;
  description: string;
  emptyEvent: string;
  color: string;
}> = [
  {
    kind: "addToCart",
    title: "Додавали в кошик",
    description: "За кількістю подій add_to_cart",
    emptyEvent: "add_to_cart",
    color: "#118dff",
  },
  {
    kind: "listToProduct",
    title: "Конверсія Список → Картка",
    description: "Переходи select_item ÷ покази товару view_item_list · мін. 20 показів",
    emptyEvent: "view_item_list / select_item",
    color: "#107c10",
  },
  {
    kind: "addToWishlist",
    title: "Додавали в обране",
    description: "За кількістю подій add_to_wishlist",
    emptyEvent: "add_to_wishlist",
    color: "#744da9",
  },
];

function metricValue(kind: RankingKind, row: PromotionProductMetricRow) {
  if (kind === "listToProduct") {
    return (
      <div className="text-right">
        <div className="font-black tabular-nums" style={{ color: "#107c10" }}>
          {row.listToProductConversionPct == null ? "—" : `${row.listToProductConversionPct.toFixed(1)}%`}
        </div>
        <div className="mt-0.5 text-[9px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {numberFmt.format(row.listClicks)} з {numberFmt.format(row.listImpressions)} показів
        </div>
      </div>
    );
  }
  const events = kind === "addToCart" ? row.addToCartEvents : row.addToWishlistEvents;
  const users = kind === "addToCart" ? row.addToCartUsers : row.addToWishlistUsers;
  return (
    <div className="text-right">
      <div className="font-black tabular-nums" style={{ color: "var(--text)" }}>{numberFmt.format(events)}</div>
      <div className="mt-0.5 text-[9px] tabular-nums" style={{ color: "var(--text-muted)" }}>
        {numberFmt.format(users)} користувачів
      </div>
    </div>
  );
}

function ProductRanking({
  kind,
  title,
  description,
  emptyEvent,
  color,
  rows,
  total,
  expanded,
  onToggle,
  copiedCode,
  onCopyCode,
}: {
  kind: RankingKind;
  title: string;
  description: string;
  emptyEvent: string;
  color: string;
  rows: PromotionProductMetricRow[];
  total: number;
  expanded: boolean;
  onToggle: () => void;
  copiedCode: number | null;
  onCopyCode: (code: number) => void;
}) {
  const visibleRows = rows.slice(0, expanded ? 250 : 20);
  return (
    <section className="overflow-hidden rounded-2xl border" style={{ background: "#fff", borderColor: "var(--border)" }}>
      <div className="border-b px-4 py-3" style={{ borderColor: "var(--border2)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.08em]" style={{ color }}>{title}</div>
            <div className="mt-1 text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>{description}</div>
          </div>
          <span className="shrink-0 rounded-lg px-2 py-1 text-[9px] font-black" style={{ background: `${color}12`, color }}>
            TOP {expanded ? Math.min(250, total) : Math.min(20, total)}
          </span>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="text-xs font-bold" style={{ color: "var(--text-mid)" }}>Немає даних за вибраний період</div>
          <div className="mx-auto mt-1 max-w-sm text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>
            Перевірте, чи передається подія <code>{emptyEvent}</code> з числовим <code>item_id = goods_ref</code>.
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr style={{ background: "var(--bg-input)", color: "var(--text-dim)" }}>
                <th className="w-10 px-2 py-2 text-right font-bold">#</th>
                <th className="px-2 py-2 text-left font-bold">Код</th>
                <th className="min-w-[220px] px-2 py-2 text-left font-bold">Товар</th>
                <th className="px-2 py-2 text-right font-bold">Залишок</th>
                <th className="min-w-[105px] px-3 py-2 text-right font-bold">Результат</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={row.goodsRef} className="border-t" style={{ borderColor: "var(--border2)" }}>
                  <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: "var(--text-muted)" }}>{index + 1}</td>
                  <td className="px-2 py-2.5">
                    {row.code != null ? (
                      <button
                        type="button"
                        onClick={() => onCopyCode(row.code as number)}
                        className="rounded border-0 bg-transparent p-0 font-bold tabular-nums hover:underline"
                        style={{ color: copiedCode === row.code ? "#107c10" : "#0078d4" }}
                        title="Скопіювати код товару"
                      >
                        {copiedCode === row.code ? "✓ " : ""}{row.code}
                      </button>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    {row.url ? (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold hover:underline"
                        style={{ color: "var(--text)" }}
                      >
                        {row.name}
                      </a>
                    ) : (
                      <div>
                        <div className="font-semibold" style={{ color: "var(--text-mid)" }}>{row.name}</div>
                        <div className="mt-0.5 text-[9px]" style={{ color: "#a4262c" }}>Не знайдено в API каталогу</div>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <span
                      className="rounded-md px-1.5 py-0.5 font-bold tabular-nums"
                      style={row.inStock
                        ? { background: "#e5f3e5", color: "#107c10" }
                        : { background: "#fde8e8", color: "#a4262c" }}
                    >
                      {row.stockQty == null ? "—" : numberFmt.format(row.stockQty)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">{metricValue(kind, row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 20 && (
        <button
          type="button"
          onClick={onToggle}
          className="w-full border-0 border-t px-4 py-2.5 text-[10px] font-bold"
          style={{ borderColor: "var(--border2)", background: "var(--bg-input)", color }}
        >
          {expanded ? "Згорнути до TOP 20" : `Показати TOP ${Math.min(250, total)}`}
        </button>
      )}
    </section>
  );
}

export function PromotionProductMetrics({
  url,
  from,
  to,
  channel,
  device,
}: {
  url: string;
  from: string;
  to: string;
  channel: WebFunnelChannel;
  device: WebFunnelDevice;
}) {
  const [includeOutOfStock, setIncludeOutOfStock] = useState(false);
  const [data, setData] = useState<PromotionProductMetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<RankingKind, boolean>>({
    addToCart: false,
    listToProduct: false,
    addToWishlist: false,
  });
  const [copiedCode, setCopiedCode] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      url,
      from,
      to,
      channel,
      device,
      include_out_of_stock: includeOutOfStock ? "1" : "0",
    });
    setLoading(true);
    setError("");
    setExpanded({ addToCart: false, listToProduct: false, addToWishlist: false });
    fetch(`/api/promotions/product-metrics?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити метрики товарів");
        setData(payload as PromotionProductMetricsResponse);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(reason instanceof Error ? reason.message : "Не вдалося завантажити метрики товарів");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [channel, device, from, includeOutOfStock, to, url]);

  const copyCode = async (code: number) => {
    try {
      await navigator.clipboard.writeText(String(code));
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode((current) => current === code ? null : current), 1500);
    } catch {
      setCopiedCode(null);
    }
  };

  return (
    <section className="rounded-2xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-dim)" }}>
            TOP товарів за веб-метриками
          </div>
          <div className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
            GA4 item_id → goods_ref · актуальна назва, код, URL та залишок із API каталогу
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}>
          <input
            type="checkbox"
            checked={includeOutOfStock}
            onChange={(event) => setIncludeOutOfStock(event.target.checked)}
            className="h-4 w-4 accent-[#118dff]"
          />
          <span className="text-[10px] font-bold" style={{ color: "var(--text-mid)" }}>
            Показувати також товари без залишку
          </span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[9px]">
        <span className="rounded-lg px-2 py-1 font-semibold" style={{ background: "#e5f3e5", color: "#107c10" }}>
          {includeOutOfStock ? "Усі залишки" : "За замовчуванням: залишок > 1"}
        </span>
        {data && data.tracking.unmatchedGoodsRefs > 0 && (
          <span className="rounded-lg px-2 py-1 font-semibold" style={{ background: "#fff4ce", color: "#8a6d00" }}>
            {numberFmt.format(data.tracking.unmatchedGoodsRefs)} goods_ref не знайдено в поточному каталозі
          </span>
        )}
        {loading && <span className="px-2 py-1 font-semibold" style={{ color: "#118dff" }}>Оновлюємо TOP…</span>}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border px-4 py-3 text-xs" style={{ borderColor: "#f4b8b8", background: "#fff4f4", color: "#a4262c" }}>
          {error}
        </div>
      )}

      {!data && loading && !error && (
        <div className="mt-4 rounded-xl border px-5 py-12 text-center text-xs font-bold" style={{ borderColor: "var(--border2)", color: "var(--text-dim)" }}>
          Рахуємо товарні події та звіряємо залишки…
        </div>
      )}

      {data && (
        <div className={`mt-4 grid gap-4 xl:grid-cols-3 ${loading ? "opacity-60" : ""}`}>
          {RANKING_CONFIG.map((config) => (
            <ProductRanking
              key={config.kind}
              {...config}
              rows={data.rankings[config.kind]}
              total={data.totals[config.kind]}
              expanded={expanded[config.kind]}
              onToggle={() => setExpanded((current) => ({ ...current, [config.kind]: !current[config.kind] }))}
              copiedCode={copiedCode}
              onCopyCode={copyCode}
            />
          ))}
        </div>
      )}
    </section>
  );
}
